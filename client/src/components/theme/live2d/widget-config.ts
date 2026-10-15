// Live2D 看板娘的组件配置归一化（widget.live2d.* 设置项 → 渲染用数值）。
//
// 纯函数模块：无 DOM、无 React 依赖，行为与 live2d-widget.tsx 拆分前的内联逻辑逐条等价。
//   - scale：Number 化后钳制在 [0.1, 2]，非法值回退 1（防止超大值挡住整页）；
//   - edge：字符串布尔标记（trim + 小写后 === "true"）；
//   - layout：JSON 字符串 → 仅保留有限数值的键值对（注入模型配置的 Layout 段）；
//   - 容器尺寸：与插件 #waifu-canvas 的 300x300 基准一致，随 scale 缩放取整。

// scale 的安全范围（与拆分前 widget 内联的 0.1/2 钳制一致）
const MIN_SCALE = 0.1;
const MAX_SCALE = 2;
// 插件 #waifu-canvas 的基准尺寸（像素）
const BASE_BOX = 300;
// 窄屏阈值与收缩比例、上下限（见 widgetBoxSize）
const NARROW_VIEWPORT = 640;
const NARROW_RATIO = 0.55;
const MIN_NARROW_BOX = 180;
const MAX_NARROW_BOX = 240;
// 矮视口阈值与比例（横屏手机 / 窗口化桌面，见 widgetBoxSize）
const SHORT_VIEWPORT = 500;
const SHORT_RATIO = 0.55;

// 缩放配置归一化：缺失/非法 → 1；有限值钳制到 [0.1, 2]。
export function normalizeScale(raw: unknown): number {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) ? Math.min(Math.max(n, MIN_SCALE), MAX_SCALE) : 1;
}

// "趴在屏幕边缘"开关：配置值按字符串比较，"true"（忽略首尾空白与大小写）才开启。
export function isEdgeRestEnabled(raw: unknown): boolean {
  return String(raw ?? "").trim().toLowerCase() === "true";
}

// 解析 Layout 配置（JSON 字符串，如 {"Center Y": 0.05}）
export function parseLayoutConfig(raw: string): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

// 模型容器边长（宽=高）：300 * scale 四舍五入。
//
// 窄屏收缩（实测）：531px 宽的视口里 300px 画布 + 工具列占了约 63% 的宽度，
// 看板娘压在正文与设置项上面。宽度不足 NARROW_VIEWPORT 时按视口比例收，
// 并夹在 [MIN_NARROW_BOX, MAX_NARROW_BOX] 里。
//
// 比例从 0.45 提到 0.55：393px 视口下 0.45 只有 177 见方，而人物不透明区仅 99×134
// ——比竖排工具栏（约 220px 高）的一半还小，用户直接反馈「模型变小了」。配合轮廓
// 贴合（见 live2d/silhouette.ts，把人物放大到填满容器）后，216 见方才是能看清的大小。
//
// 矮视口收缩：横屏手机（851×393）宽度超过 NARROW_VIEWPORT，走不到上面的分支，
// 实测 300 见方的容器里人物高 293、占屏高 75%，加上竖排工具栏正好顶满屏幕。
// 所以再按视口高度收一次（下限仍是 MIN_NARROW_BOX，保证看得清）。
//
// 用户显式调小的 scale 仍然优先（capped 不会超过 side）。视口尺寸省略或 0 表示
// 未知 → 保持原尺寸。
export function widgetBoxSize(
  scale: number,
  viewportWidth = 0,
  viewportHeight = 0,
): { width: number; height: number } {
  const side = Math.round(BASE_BOX * scale);
  let capped = side;
  if (viewportWidth && viewportWidth < NARROW_VIEWPORT) {
    const fromWidth = Math.min(
      MAX_NARROW_BOX,
      Math.max(MIN_NARROW_BOX, Math.round(viewportWidth * NARROW_RATIO)),
    );
    capped = Math.min(capped, fromWidth);
  }
  if (viewportHeight && viewportHeight < SHORT_VIEWPORT) {
    capped = Math.min(capped, Math.max(MIN_NARROW_BOX, Math.round(viewportHeight * SHORT_RATIO)));
  }
  return { width: capped, height: capped };
}
