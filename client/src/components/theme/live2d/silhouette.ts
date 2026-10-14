// 看板娘「人物轮廓贴合容器」：测出画布里不透明像素的包围盒，把画布放大并裁掉留白。
//
// 为什么需要：渲染器按 moc3 的画布矩形铺满容器，而人物本体往往只占其中一块——
// 实测手机 393px 视口里画布 177×177 CSS，人物只有 99×134（占面积 42%），四周全是
// 透明留白。留白既让看板娘看着比工具栏还小，又因为容器吃掉整片正方形而挡住下面的
// 点击与滚动。测出包围盒后按包围盒放大画布（帧缓冲跟着变大，不是位图拉伸），再用
// clip-path 把留白裁掉，于是「看到的即命中的」，留白处的事件全部还给页面。
//
// 比例不变性：渲染器的贴合是按 canvas.width/height 做的，画布 CSS 等比放大时帧缓冲
// 等比放大，人物在画布中的相对位置/占比不变 ⇒ 测量只需做一次，容器改尺寸（缩放配置、
// 旋转屏幕）后用同一份比例重算即可。

// 不透明包围盒，取值是相对画布盒子的比例（0..1），与像素尺寸无关。
export type SilhouetteRect = { left: number; top: number; width: number; height: number };

// 贴合后画布相对容器的样式值（CSS 像素）。
export type SilhouetteFit = {
  width: number;
  height: number;
  left: number;
  top: number;
  // clip-path: inset(top right bottom left)，画布自身坐标系
  clip: { top: number; right: number; bottom: number; left: number };
};

export type SilhouetteFitOptions = {
  // 放大上限：留白特别多的模型不做夸张拉伸（画布越大帧缓冲越贵）
  maxScale?: number;
  // 四周留白比例，避免人物贴死容器边缘
  padding?: number;
};

const DEFAULT_MAX_SCALE = 1.6;
const DEFAULT_PADDING = 0.02;

// 浏览器是否真支持 clip-path:inset()。贴合靠 clip-path 把命中区收到人物那块矩形，
// 老内核（iOS 13.0 及以下只认 -webkit- 前缀，更早的版本连 inset() 都不实现）不支持时
// 放大画布却没有裁剪 ⇒ 命中矩形比容器还大，挡住更多页面控件，比不贴合更糟。
// 参数是 globalThis.CSS（省略以适配无 CSS 对象的环境）；CSS.supports 缺失时按"不支持"处理，
// 反正不贴合只是维持原样显示。
export function supportsClipPath(
  css: { supports?: (property: string, value: string) => boolean } | undefined = undefined,
): boolean {
  const supports = css?.supports;
  if (typeof supports !== "function") return false;
  const test = (property: string) => {
    try {
      return supports.call(css, property, "inset(0px)") === true;
    } catch {
      return false;
    }
  };
  return test("clip-path") || test("-webkit-clip-path");
}

// 由包围盒比例算出贴合样式；box 为容器边长。返回 null 表示无需/无法贴合
//（缺测量、非法尺寸，或人物本就占满容器——放大不到 1% 就别动，避免无谓的帧缓冲开销）。
export function computeSilhouetteFit(
  rect: SilhouetteRect | null,
  box: { width: number; height: number },
  options: SilhouetteFitOptions = {},
): SilhouetteFit | null {
  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const padding = options.padding ?? DEFAULT_PADDING;
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
    return null;
  }
  if (
    rect.left < 0 ||
    rect.top < 0 ||
    rect.left + rect.width > 1.001 ||
    rect.top + rect.height > 1.001
  ) {
    return null; // 测量明显不可信（越界），宁可不贴合
  }
  // rect 是相对容器的比例 ⇒ 等比放大到填满容器的系数就是 1/占比 取小的一侧
  const fitScale = Math.min(
    Math.min(1 / rect.width, 1 / rect.height) * (1 - padding),
    maxScale,
  );
  if (fitScale <= 1.01) return null;

  const width = box.width * fitScale;
  const height = box.height * fitScale;
  // 人物中心 → 容器中心
  const centerX = (rect.left + rect.width / 2) * width;
  const centerY = (rect.top + rect.height / 2) * height;
  return {
    width,
    height,
    left: box.width / 2 - centerX,
    top: box.height / 2 - centerY,
    clip: {
      left: rect.left * width,
      top: rect.top * height,
      right: width - (rect.left + rect.width) * width,
      bottom: height - (rect.top + rect.height) * height,
    },
  };
}

// 读一次画布像素，算不透明包围盒（返回比例）。只在模型就绪后调用一次。
// 拿不到 WebGL 上下文、读回失败或整幅透明时返回 null，调用方保持原样显示。
export function measureSilhouette(
  canvas: HTMLCanvasElement,
  alphaThreshold: number,
): SilhouetteRect | null {
  const gl = (canvas.getContext("webgl2") ||
    canvas.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
  const w = canvas.width;
  const h = canvas.height;
  if (!gl || w <= 0 || h <= 0) return null;
  const pixels = new Uint8Array(w * h * 4);
  try {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  } catch {
    return null;
  }
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      if (pixels[(row + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  // WebGL 原点在左下角，readPixels 的第 0 行是画面底部：换成 CSS 的自上而下坐标，
  // 否则算出来的贴合会把人物整体往下推一个留白的高度（实测脚被裁掉、下半身掉出视口）。
  const cssTop = h - 1 - maxY;
  const cssBottom = h - 1 - minY;
  return {
    left: minX / w,
    top: cssTop / h,
    width: (maxX - minX + 1) / w,
    height: (cssBottom - cssTop + 1) / h,
  };
}
