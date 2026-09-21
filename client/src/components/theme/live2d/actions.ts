// Live2D 动作引擎：JS 驱动参数动画（不依赖模型 motion3 文件，避免改远程 CDN），
// 以及从捕获的渲染器实例中取模型实例的工具。

export type ActionName = "pet" | "wave" | "shake" | "dance";

type ParamCurve = { id: string; fn: (t: number) => number };

type ActionDef = {
  duration: number;
  expression?: string;
  params: ParamCurve[];
};

// 参数动画曲线：t 为归一化时间 [0,1]。
// 参数范围参考 Live2D 标准：ParamAngle* ±30，ParamBodyAngle* ±30，
// ParamEye*Open/Smile 0~1，ParamMouthForm -1~1，Param85 为手臂摆动角（-30~30），
// Param92/87/94/3/93 为手臂位置开关（0~1）。
export const ACTIONS: Record<ActionName, ActionDef> = {
  pet: {
    duration: 2.2,
    expression: "blush",
    params: [
      // 低头蹭蹭 + 轻微左右摆
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 6 },
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 4 },
      { id: "ParamBodyAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 3 },
      // 开心眯眼
      { id: "ParamEyeROpen", fn: () => -0.25 },
      { id: "ParamEyeLOpen", fn: () => -0.25 },
      { id: "ParamEyeRSmile", fn: () => 0.8 },
      { id: "ParamEyeLSmile", fn: () => 0.8 },
      // 微笑
      { id: "ParamMouthForm", fn: () => 0.6 },
    ],
  },
  wave: {
    duration: 2.6,
    expression: "cat_mouth",
    params: [
      // 手臂上下挥动（Param85 大幅摆臂）
      { id: "Param85", fn: (t) => Math.sin(t * Math.PI * 4) * 18 },
      { id: "Param92", fn: (t) => (t < 0.15 ? 0 : 1) },
      // 头轻微侧倾
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "ParamAngleX", fn: () => 4 },
    ],
  },
  shake: {
    duration: 1.6,
    params: [
      // 左右摇头，幅度逐渐衰减
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 6) * 11 * (1 - t) },
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 3) * 3 * (1 - t) },
    ],
  },
  dance: {
    duration: 4,
    expression: "stars",
    params: [
      // 身体左右摇摆 + 头点动 + 手臂舞动
      { id: "ParamBodyAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 8 },
      { id: "ParamBodyAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "ParamAngleY", fn: (t) => Math.sin(t * Math.PI * 4) * 6 },
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "Param85", fn: (t) => Math.sin(t * Math.PI * 2) * 15 },
      { id: "Param92", fn: (t) => (Math.sin(t * Math.PI * 2) > 0 ? 1 : 0) },
      { id: "ParamBreath", fn: (t) => Math.sin(t * Math.PI * 2) * 0.4 },
    ],
  },
};

// 空闲时轮播的安全表情（对应 CDN 模型配置里的 Expression Name）
export const IDLE_EXPRESSIONS = [
  "blush",
  "cat_mouth",
  "stars",
  "sweat",
  "cheek_rest",
  "smart",
  "cover_mouth",
  "antenna_fan",
];

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export type Live2dModelLike = {
  setDragging?: (x: number, y: number) => void;
  startRandomMotion?: (group: string, priority: number) => void;
  setRandomExpression?: () => void;
  setExpression?: (name: string) => void;
  getModel?: () => {
    setParameterValueById?: (id: string, value: number) => void;
  };
  _expressionManager?: { stopAllMotions?: () => void };
  _motionManager?: { stopAllMotions?: () => void };
  _state?: number;
  update?: unknown;
};

// 从捕获的 AppDelegate 实例中取出 Live2D 模型（CubismUserModel），用于喂拖拽/物理/动作
export function getLive2dModel(): Live2dModelLike | undefined {
  const app = (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp;
  const sub = (app as { _subdelegates?: { at?: (i: number) => unknown } } | undefined)?._subdelegates?.at?.(0);
  const manager = (sub as { getLive2DManager?: () => unknown } | undefined)?.getLive2DManager?.();
  return (manager as { _models?: { at?: (i: number) => Live2dModelLike } } | undefined)?._models?.at?.(0);
}

// 复位当前动作/表情：按 Cubism 惯例 stopAllMotions 在 motionManager 上
// （旧实现误调 expressionManager 导致表情复位静默失败），两个都兜底尝试。
export function stopAllMotions(model: Live2dModelLike): void {
  try {
    model._motionManager?.stopAllMotions?.();
  } catch {
    // ignore
  }
  try {
    model._expressionManager?.stopAllMotions?.();
  } catch {
    // ignore
  }
}

// 当前正在播放的动作（模块级单例，供 update 钩子读取）
const actionState: {
  current: { name: ActionName; startTime: number; def: ActionDef } | null;
} = { current: null };

export function isActionPlaying(): boolean {
  return actionState.current !== null;
}

export function playAction(name: ActionName) {
  const model = getLive2dModel();
  if (!model) return;
  const def = ACTIONS[name];
  if (!def) return;
  actionState.current = { name, startTime: performance.now(), def };
  if (def.expression) {
    try {
      model.setExpression?.(def.expression);
    } catch {
      // ignore
    }
  }
}

// 每帧把动作参数写入模型（在渲染器 update 之后执行，覆盖该帧的最终参数）
function applyActionFrame(model: Live2dModelLike) {
  const action = actionState.current;
  if (!action) return;
  const cubism = model.getModel?.();
  if (!cubism || typeof cubism.setParameterValueById !== "function") return;
  const elapsed = (performance.now() - action.startTime) / 1000;
  const t = Math.min(1, elapsed / action.def.duration);
  for (const curve of action.def.params) {
    try {
      cubism.setParameterValueById(curve.id, curve.fn(t));
    } catch {
      // ignore
    }
  }
  if (t >= 1) {
    actionState.current = null;
    if (action.def.expression) {
      stopAllMotions(model);
    }
  }
}

// 在模型实例上包一层 update：渲染器每帧调用 s.update()，我们在其后注入动作参数
export function patchModelForActions(model: Live2dModelLike) {
  const patchable = model as Live2dModelLike & { __rinActionPatched?: boolean };
  if (patchable.__rinActionPatched) return;
  patchable.__rinActionPatched = true;
  const origUpdate = model.update;
  if (typeof origUpdate !== "function") return;
  model.update = function (this: unknown, ...args: unknown[]) {
    const result = (origUpdate as (...a: unknown[]) => unknown).apply(this, args);
    applyActionFrame(this as Live2dModelLike);
    return result;
  };
}
