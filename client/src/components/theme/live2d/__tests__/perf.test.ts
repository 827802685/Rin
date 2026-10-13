import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capSubdelegateDpr,
  capSubdelegateFps,
  createDprCapWrapper,
  createFpsCapWrapper,
  createPixelAlphaProbe,
  normalizeFpsCap,
  releaseDragSetDragging,
  takeOverDragSetDragging,
} from "../perf";

afterEach(() => {
  vi.restoreAllMocks();
  // 用例用 defineProperty 在 window 实例上覆写 devicePixelRatio，删掉即回到 jsdom 原型值
  delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
});

function setDevicePixelRatio(value: number) {
  Object.defineProperty(window, "devicePixelRatio", {
    configurable: true,
    writable: true,
    value,
  });
}

describe("normalizeFpsCap", () => {
  it("只接受 0 或 30，其它值回落 0", () => {
    expect(normalizeFpsCap(30)).toBe(30);
    expect(normalizeFpsCap("30")).toBe(30);
    expect(normalizeFpsCap(0)).toBe(0);
    expect(normalizeFpsCap("0")).toBe(0);
    expect(normalizeFpsCap(undefined)).toBe(0);
    expect(normalizeFpsCap(60)).toBe(0);
    expect(normalizeFpsCap("abc")).toBe(0);
  });
});

describe("createFpsCapWrapper", () => {
  it("按 minInterval 节流：窗口内的调用直接跳过，不补排 rAF", () => {
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const rafs: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      rafs.push(cb);
      return rafs.length;
    });

    const orig = vi.fn();
    const wrapper = createFpsCapWrapper(orig, 100);
    const obj = { run: wrapper };

    obj.run(); // now=1000，距初始 last(-Inf) 超阈值 → 执行
    expect(orig).toHaveBeenCalledTimes(1);

    obj.run(); // 同一帧 → 跳过，且不再自己排队（循环由引擎续帧）
    expect(orig).toHaveBeenCalledTimes(1);
    expect(rafs.length).toBe(0);

    now = 1050; // 仍未到 100ms
    obj.run();
    expect(orig).toHaveBeenCalledTimes(1);

    now = 1200; // 间隔到了
    obj.run();
    expect(orig).toHaveBeenCalledTimes(2);
  });

  // 只看间隔的封顶在重模型上是空承诺：真机实测 furina 在这台机器单帧约 77ms，
  // 上限 33ms 时每一帧都"已经超过间隔"，于是每帧放行、fps 与 draws 完全没变。
  it("单帧成本超过上限时按帧补跳：耗 77ms、上限 33ms → 每 3 帧才执行一次", () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    let runs = 0;
    const orig = () => {
      runs += 1;
      t += 77; // 模拟一次昂贵的网格更新
    };
    const wrapper = createFpsCapWrapper(orig, 33);
    const obj = { update: wrapper };

    obj.update(); // 第 1 帧执行，记下成本 77 → 之后要补跳 ceil(77/33)-1 = 2 帧
    expect(runs).toBe(1);

    obj.update(); // 第 2 帧补跳
    obj.update(); // 第 3 帧补跳
    expect(runs).toBe(1);

    obj.update(); // 第 4 帧跳够且距上次执行 77ms ≥ 33ms → 执行
    expect(runs).toBe(2);

    obj.update();
    obj.update();
    expect(runs).toBe(2);

    obj.update();
    expect(runs).toBe(3);
  });

  it("成本低于上限时退回纯时间判定，不多跳帧", () => {
    let t = 0;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    let runs = 0;
    const orig = () => {
      runs += 1;
      t += 8; // 轻模型：单帧 8ms < 33ms
    };
    const wrapper = createFpsCapWrapper(orig, 33);
    const obj = { update: wrapper };

    // 60fps 节奏下每帧前进 16.7ms：应严格按间隔放行，不额外丢帧
    for (let i = 0; i < 4; i += 1) {
      obj.update();
      t += 16.7;
    }
    // 帧0 执行(t=8→24.7)，帧1 24.7-0<33 跳，帧2 41.4-0≥33 执行，帧3 66-41.4<33 跳
    expect(runs).toBe(2);
  });

  it("this 与参数透传给原方法，各实例状态独立", () => {
    let now = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const seen: unknown[] = [];
    const orig = function (this: { tag: string }, a: number) {
      seen.push({ tag: this.tag, a });
    };
    const wrapper = createFpsCapWrapper(
      orig as unknown as (...args: unknown[]) => unknown,
      100,
    );
    const objA = { tag: "A", run: wrapper };
    const objB = { tag: "B", run: wrapper };

    objA.run(1); // now=5000 执行
    objA.run(2); // 同帧跳过
    objB.run(3); // 不同实例，独立 last → 也执行
    expect(seen).toEqual([
      { tag: "A", a: 1 },
      { tag: "B", a: 3 },
    ]);
  });
});

describe("capSubdelegateFps", () => {
  // 造一个和远端引擎同形状的 app：_subdelegates 是 getSize/at 的列表，
  // update 挂在原型上（实例自有属性遮蔽它）
  function makeApp(count = 1) {
    class Sub {
      draws = 0;
      update() {
        this.draws += 1;
      }
    }
    const items = Array.from({ length: count }, () => new Sub());
    const app = {
      _subdelegates: {
        getSize: () => items.length,
        at: (i: number) => items[i],
      },
    };
    return { app, items, Sub };
  }

  it("封顶只遮蔽实例的 update，不动原型", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { app, items, Sub } = makeApp(2);
    const protoUpdate = Sub.prototype.update;

    expect(capSubdelegateFps(app, 30)).toBe(2);
    const capped = items[0].update as unknown as { rinFpsCap?: boolean };
    expect(capped.rinFpsCap).toBe(true);
    expect(Sub.prototype.update).toBe(protoUpdate);

    now = 1000;
    items[0].update();
    items[0].update(); // 同一时间窗内 → 跳过
    expect(items[0].draws).toBe(1);
  });

  it("fpsCap=0 时撤掉自己挂过的遮蔽，恢复原型方法", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { app, items } = makeApp(1);

    capSubdelegateFps(app, 30);
    expect(Object.prototype.hasOwnProperty.call(items[0], "update")).toBe(true);

    expect(capSubdelegateFps(app, 0)).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(items[0], "update")).toBe(false);

    now = 1000;
    items[0].update();
    items[0].update(); // 已恢复原方法，不节流
    expect(items[0].draws).toBe(2);
  });

  it("封顶值可以改小重挂，不会包中包", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { app, items } = makeApp(1);

    capSubdelegateFps(app, 30); // ≈33ms 窗口
    capSubdelegateFps(app, 15); // ≈66ms 窗口，重新包而不是叠一层

    now = 1000;
    items[0].update(); // 执行
    now = 1040; // 距上次 40ms：30 档会画，15 档不画
    items[0].update();
    expect(items[0].draws).toBe(1);
    now = 1070;
    items[0].update();
    expect(items[0].draws).toBe(2);
  });

  it("结构不认识（没有 _subdelegates）返回 0，调用方据此不声称已封顶", () => {
    expect(capSubdelegateFps({}, 30)).toBe(0);
    expect(capSubdelegateFps(undefined, 30)).toBe(0);
    expect(capSubdelegateFps({ _subdelegates: {} }, 30)).toBe(0);
  });
});

describe("createDprCapWrapper", () => {
  it("调用窗口内读到上限值，结束后按原描述符还原", () => {
    setDevicePixelRatio(2.67);
    const seen: number[] = [];
    const orig = vi.fn(() => {
      seen.push(window.devicePixelRatio);
    });
    const wrapper = createDprCapWrapper(orig, 1.5);

    wrapper();

    expect(seen).toEqual([1.5]);
    expect(window.devicePixelRatio).toBe(2.67);
  });

  it("真实值不高于上限时不接管，原样调用", () => {
    setDevicePixelRatio(1);
    const seen: number[] = [];
    const wrapper = createDprCapWrapper(() => {
      seen.push(window.devicePixelRatio);
      // 不接管时不应把 window 上的值换成封顶 getter
      const desc = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      seen.push(desc && desc.get ? 1 : 0);
    }, 1.5);

    wrapper();

    expect(seen).toEqual([1, 0]);
  });

  it("嵌套调用不会提前把值还原成真实 dpr", () => {
    setDevicePixelRatio(3);
    const seen: number[] = [];
    const inner = createDprCapWrapper(() => {
      seen.push(window.devicePixelRatio);
    }, 1.5);
    const outer = createDprCapWrapper(() => {
      inner();
      seen.push(window.devicePixelRatio); // 内层返回后仍应在封顶内
    }, 1.5);

    outer();

    expect(seen).toEqual([1.5, 1.5]);
    expect(window.devicePixelRatio).toBe(3);
  });
});

describe("capSubdelegateDpr", () => {
  // 与远端引擎同形状：resizeCanvas 在原型上，内部按 window.devicePixelRatio 开帧缓冲
  function makeDprApp(count = 1) {
    class Sub {
      widths: number[] = [];
      _needResize = false;
      resizeCanvas() {
        this.widths.push(100 * window.devicePixelRatio);
      }
    }
    const items = Array.from({ length: count }, () => new Sub());
    const app = {
      _subdelegates: {
        getSize: () => items.length,
        at: (i: number) => items[i],
      },
    };
    return { app, items, Sub };
  }

  it("遮蔽实例的 resizeCanvas，并触发一次引擎自身的重排", () => {
    setDevicePixelRatio(2.67);
    const { app, items, Sub } = makeDprApp(2);
    const protoResize = Sub.prototype.resizeCanvas;

    expect(capSubdelegateDpr(app, 1.5)).toBe(2);
    expect(Sub.prototype.resizeCanvas).toBe(protoResize);
    expect(Object.prototype.hasOwnProperty.call(items[0], "resizeCanvas")).toBe(true);
    // 首次未封顶开大的帧缓冲靠这个标记收敛（引擎 update() 见它走 onResize）
    expect(items[0]._needResize).toBe(true);

    items[0].resizeCanvas();
    expect(items[0].widths).toEqual([150]);
    expect(window.devicePixelRatio).toBe(2.67);
  });

  it("重复调用不叠包", () => {
    setDevicePixelRatio(2.67);
    const { app, items } = makeDprApp(1);

    capSubdelegateDpr(app, 1.5);
    const firstShadow = items[0].resizeCanvas;
    expect(capSubdelegateDpr(app, 1.5)).toBe(1);
    // 同一个遮蔽函数，没有再包一层
    expect(items[0].resizeCanvas).toBe(firstShadow);

    items[0].resizeCanvas();
    items[0].resizeCanvas();
    expect(items[0].widths).toEqual([150, 150]);
    expect(window.devicePixelRatio).toBe(2.67);
  });

  it("结构不认识返回 0，调用方据此不声称已封顶", () => {
    expect(capSubdelegateDpr({}, 1.5)).toBe(0);
    expect(capSubdelegateDpr(undefined, 1.5)).toBe(0);
    expect(capSubdelegateDpr({ _subdelegates: { getSize: () => 1, at: () => ({}) } }, 1.5)).toBe(0);
  });
});

describe("createPixelAlphaProbe", () => {
  it("窗口内且邻近复用上次采样，超出任一条件则重读", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const read = vi.fn(() => 200);
    const probe = createPixelAlphaProbe(read, 100, 8);

    expect(probe(50, 50)).toBe(200); // 首次：last.at=-Inf → 读
    expect(read).toHaveBeenCalledTimes(1);

    now = 50;
    expect(probe(52, 51)).toBe(200); // 50ms<100 且距离≤8 → 复用
    expect(read).toHaveBeenCalledTimes(1);

    now = 200;
    expect(probe(52, 51)).toBe(200); // 窗口过期 → 重读
    expect(read).toHaveBeenCalledTimes(2);

    now = 200;
    expect(probe(200, 200)).toBe(200); // 距离 >8 → 重读
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("透传 read 返回的不同 alpha 值", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const seq = [255, 0];
    let i = 0;
    const read = vi.fn(() => seq[Math.min(i++, seq.length - 1)]);
    const probe = createPixelAlphaProbe(read, 100, 8);

    expect(probe(10, 10)).toBe(255);
    now = 200; // 过期重读
    expect(probe(10, 10)).toBe(0);
  });
});

// 远端引擎的 setDragging 实现靠 this 取自己的拖拽管理器，丢 this 就抛 TypeError。
// 真机实测到过这个失败：接管时把原方法存成裸引用直接调用，每次拖动都抛错，
// 并且松手后拖拽状态不还原（整页光标停在 grabbing、文本无法选中）。
class FlutterModel {
  managerHits = 0;
  fed: string[] = [];

  setDragging(x: number, y: number): void {
    this.managerHits += 1;
    this.fed.push(`${x},${y}`);
  }
}

describe("takeOverDragSetDragging", () => {
  it("拖动期间改喂指针速度，且始终以 model 作为 this 调原方法", () => {
    const model = new FlutterModel();
    const orig = model.setDragging;

    expect(takeOverDragSetDragging(model, () => ({ x: 2, y: -3 }))).toBe(orig);
    expect(model.setDragging).not.toBe(orig);

    // 渲染器传入的位置被忽略，速度夹到 [-1, 1]
    model.setDragging(0.1, 0.2);
    expect(model.fed).toEqual(["1,-1"]);
    expect(model.managerHits).toBe(1);
  });

  it("模型没有 setDragging 时返回 null，不做任何改动", () => {
    const model: { setDragging?: (x: number, y: number) => void } = {};
    expect(takeOverDragSetDragging(model, () => ({ x: 0, y: 0 }))).toBeNull();
    expect(model.setDragging).toBeUndefined();
  });
});

describe("releaseDragSetDragging", () => {
  it("按 20 帧衰减回灌速度，最后挂回原方法并归零，全程 this 不丢", () => {
    const model = new FlutterModel();
    const orig = model.setDragging;
    const queued: Array<() => void> = [];
    model.setDragging = () => {
      throw new Error("收尾期间不应仍是接管版本");
    };

    releaseDragSetDragging(model, orig, () => ({ x: 1, y: 1 }), (cb) => queued.push(cb), 20);

    expect(model.fed).toEqual(["0.95,0.95"]);
    while (queued.length) {
      (queued.shift() as () => void)();
    }

    expect(model.setDragging).toBe(orig);
    expect(model.fed).toHaveLength(21);
    expect(model.fed[model.fed.length - 1]).toBe("0,0");
    expect(model.managerHits).toBe(21);
  });
});
