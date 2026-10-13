// Live2D 编排层性能补丁的可测纯逻辑：帧率封顶、帧缓冲分辨率封顶与像素探测节流。
// 只作用在本地对渲染器原型/调用点的包装上，不改远端 widget fork 源码。

export const FPS_CAP_OPTIONS = [0, 30] as const;
export type FpsCap = (typeof FPS_CAP_OPTIONS)[number];

export function normalizeFpsCap(value: unknown): FpsCap {
  return Number(value) === 30 ? 30 : 0;
}

type FpsCapState = { lastAt: number; cost: number; skipped: number };

/**
 * 把每帧调用的方法包成「最多每 minInterval 毫秒真正执行一次」，其余帧直接跳过。
 * 这里是纯跳过、不补排 rAF：实测远端引擎的自续帧循环是 AppDelegate.run 内部的
 * 闭包（`this._drawFrameId = requestAnimationFrame(t)`），被包的 update 只是循环
 * 里的一步，跳过它只会少画一帧，循环照自己续帧，不会把链路掐断。
 *
 * 除了比时间间隔，还按上一次执行的**成本**补跳整数帧：只看间隔的话，一旦单帧
 * 耗时本身就超过间隔（实测 furina 在这台机器上单帧约 77ms、上限 33ms），每帧都会
 * 被判为「已经够久了」而放行，封顶等于没做。补跳之后封顶在重模型上仍然降低主线程占用。
 */
export function createFpsCapWrapper(
  orig: (...args: unknown[]) => unknown,
  minInterval: number,
): (...args: unknown[]) => unknown {
  const states = new WeakMap<object, FpsCapState>();
  function wrapper(this: object, ...args: unknown[]): unknown {
    const self = this;
    const now = performance.now();
    const state = states.get(self);
    if (state) {
      const skip = minInterval > 0 ? Math.max(0, Math.ceil(state.cost / minInterval) - 1) : 0;
      if (state.skipped < skip) {
        state.skipped += 1;
        return undefined;
      }
      if (now - state.lastAt < minInterval) {
        return undefined;
      }
    }
    const startedAt = performance.now();
    const result = orig.apply(self, args);
    states.set(self, { lastAt: now, cost: performance.now() - startedAt, skipped: 0 });
    return result;
  }
  return wrapper;
}

type SubdelegateList = {
  getSize?: () => number;
  at?: (index: number) => unknown;
};

type MarkedFunction = ((...args: unknown[]) => unknown) & { rinDprCap?: boolean };

/**
 * 调用期间把 window.devicePixelRatio 临时封顶，结束立即还原（页面其它部分不受影响）。
 * devicePixelRatio 在浏览器里是 Window.prototype 上的访问器，在 window 实例上定义同名
 * 自有属性即可遮蔽；还原时按先前取到的描述符恢复——原来没有自有属性就 delete，
 * 原本就有（或被外层同类包装写过）就原样定义回去，这样嵌套调用不会提前丢掉封顶。
 * 真实值已低于上限时原样调用。
 */
export function createDprCapWrapper(
  orig: (...args: unknown[]) => unknown,
  maxDpr: number,
): (...args: unknown[]) => unknown {
  return function (this: unknown, ...args: unknown[]): unknown {
    const realDpr = window.devicePixelRatio;
    if (realDpr <= maxDpr) {
      return orig.apply(this, args);
    }
    const previous = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    try {
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        get: () => maxDpr,
      });
      return orig.apply(this, args);
    } finally {
      if (previous) {
        Object.defineProperty(window, "devicePixelRatio", previous);
      } else {
        delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
      }
    }
  };
}

/**
 * 帧缓冲分辨率封顶的真正落点（同样是实测定位，不是按方法名猜的）：
 * 引擎在 `subdelegate.resizeCanvas()` 里做
 * `canvas.width = canvas.clientWidth * window.devicePixelRatio`，
 * 而 resizeCanvas 不在 AppDelegate.prototype 上——原型层的封顶覆盖不到它。
 * 后果实测过：dpr≈2.67 的机器上 300px 容器仍开成 800x800 帧缓冲，
 * 而坐标换算（AppDelegate.transformOffset 里的 devicePixelRatio）却是封顶口径，
 * 两边不一致，鼠标跟视线也会偏。
 *
 * 遮蔽成实例自有属性（不动远端原型），挂完再置 `_needResize`：
 * 引擎自身的 update() 见到该标记会走一遍 onResize（ResizeObserver 回调也用它），
 * 首次未封顶创建的帧缓冲因此能收敛到封顶尺寸。
 * 返回封顶生效的 subdelegate 数量；拿 0 且期望封顶时说明结构不认识，不要对外说已封顶。
 */
export function capSubdelegateDpr(app: unknown, maxDpr: number): number {
  const list = (app as { _subdelegates?: SubdelegateList })?._subdelegates;
  if (
    !list ||
    typeof list.getSize !== "function" ||
    typeof list.at !== "function"
  ) {
    return 0;
  }
  let capped = 0;
  for (let i = 0; i < (list.getSize?.() ?? 0); i += 1) {
    const subdelegate = list.at?.(i) as
      | { resizeCanvas?: MarkedFunction; _needResize?: boolean }
      | undefined;
    const current = subdelegate?.resizeCanvas;
    if (typeof current !== "function") {
      continue;
    }
    if (current.rinDprCap) {
      capped += 1;
      continue;
    }
    const wrapped = createDprCapWrapper(current, maxDpr);
    (wrapped as MarkedFunction).rinDprCap = true;
    subdelegate!.resizeCanvas = wrapped;
    subdelegate!._needResize = true;
    capped += 1;
  }
  return capped;
}

/**
 * 帧率封顶的真正落点（实测定位，不是按方法名猜出来的）：
 * 远端引擎每帧的 GPU 开销集中在 `AppDelegate._subdelegates[i].update()`
 * ——它内部完成清屏 + `_view.render()`，看板娘一帧约 49 次 drawElements。
 * 循环本体（AppDelegate.run）只调用一次，包它等于没包，这正是旧实现在
 * 真实环境里静默空转的原因。
 *
 * 只给实例挂自有属性来遮蔽原型方法，不动远端 fork 的原型；重复调用先撤旧包装
 * 再包，既不会包中包，也能让"30 改 15"这类调整真的生效。
 * 返回封顶生效的 subdelegate 数量；fpsCap<=0 时撤掉已有包装并返回 0。
 * 拿到 0 且期望封顶时说明引擎结构不认识，不要对外声称已封顶。
 */
export function capSubdelegateFps(app: unknown, fpsCap: number): number {
  const list = (app as { _subdelegates?: SubdelegateList })?._subdelegates;
  if (
    !list ||
    typeof list.getSize !== "function" ||
    typeof list.at !== "function"
  ) {
    return 0;
  }
  const minInterval = fpsCap > 0 ? 1000 / fpsCap : 0;
  let capped = 0;
  for (let i = 0; i < (list.getSize?.() ?? 0); i += 1) {
    const subdelegate = list.at?.(i) as
      | { update?: ((...args: unknown[]) => unknown) & { rinFpsCap?: boolean } }
      | undefined;
    const current = subdelegate?.update;
    if (typeof current !== "function") {
      continue;
    }
    // 先撤掉我们挂过的遮蔽，拿到干净的原型方法再按新参数包
    if (current.rinFpsCap) {
      delete subdelegate!.update;
    }
    const orig = subdelegate!.update;
    if (!minInterval || typeof orig !== "function") {
      continue;
    }
    const wrapped = createFpsCapWrapper(orig, minInterval) as (
      ...args: unknown[]
    ) => unknown;
    (wrapped as { rinFpsCap?: boolean }).rinFpsCap = true;
    subdelegate!.update = wrapped;
    capped += 1;
  }
  return capped;
}

/**
 * 像素命中探测的节流缓存：100ms 内、8px 内的重复探测直接复用上次结果。
 * 点击检测本就只在 pointerdown 发生（不是逐帧轮询），这里只防连点时
 * 密集 readPixels 卡主线程，最坏误差一帧的点击位置。
 */
export function createPixelAlphaProbe(
  read: (x: number, y: number) => number,
  minIntervalMs = 100,
  maxDistance = 8,
): (x: number, y: number) => number {
  let last = { x: 0, y: 0, at: Number.NEGATIVE_INFINITY, alpha: 255 };
  return (x, y) => {
    const now = performance.now();
    if (now - last.at < minIntervalMs && Math.hypot(x - last.x, y - last.y) <= maxDistance) {
      return last.alpha;
    }
    const alpha = read(x, y);
    last = { x, y, at: now, alpha };
    return alpha;
  };
}

export type DragVelocity = { x: number; y: number };

type SetDraggingModel = {
  setDragging?: (x: number, y: number) => void;
};

const clampToUnit = (value: number) => Math.min(Math.max(value, -1), 1);

/**
 * 拖动期间接管模型的 setDragging：渲染器每帧用它把指针位置喂给模型，这里改成按真实
 * 指针速度喂值，衣服/头发才会跟着拖动惯性飘。返回被接管的原始方法，由调用方在松手后挂回。
 *
 * 原方法必须以 model 为 this 调用：远端引擎的实现内部要读 `this._dragManager`，
 * 把它存成裸引用再直接调用会丢 this（严格模式下是 undefined），实测每次拖动都抛
 * TypeError，并且拖拽状态因此停在拖动档、松手后光标和文本禁选都不还原。
 */
export function takeOverDragSetDragging(
  model: SetDraggingModel,
  readVelocity: () => DragVelocity,
): ((x: number, y: number) => void) | null {
  const orig = model.setDragging;
  if (typeof orig !== "function") {
    return null;
  }
  model.setDragging = (_x: number, _y: number) => {
    const v = readVelocity();
    orig.call(model, clampToUnit(v.x), clampToUnit(v.y));
  };
  return orig;
}

/**
 * 松手收尾：按 framesCount 帧线性衰减继续喂速度，让拖拽管理器自然回弹，
 * 最后一帧把原始方法挂回去并归零。scheduleFrame 注入是为了能在无 rAF 的环境里测。
 */
export function releaseDragSetDragging(
  model: SetDraggingModel,
  orig: (x: number, y: number) => void,
  readVelocity: () => DragVelocity,
  scheduleFrame: (callback: () => void) => void = (cb) => requestAnimationFrame(cb),
  framesCount = 20,
): void {
  let frames = 0;
  const tick = () => {
    if (frames >= framesCount) {
      model.setDragging = orig;
      orig.call(model, 0, 0);
      return;
    }
    frames += 1;
    const decay = Math.max(0, 1 - frames / framesCount);
    const v = readVelocity();
    orig.call(model, v.x * decay, v.y * decay);
    scheduleFrame(tick);
  };
  tick();
}
