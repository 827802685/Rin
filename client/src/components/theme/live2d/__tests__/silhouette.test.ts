import { describe, expect, it } from "vitest";
import {
  type SilhouetteRect,
  computeSilhouetteFit,
  measureSilhouette,
  supportsClipPath,
} from "../silhouette";

// 输入取自 393px 手机视口的真机测量：画布 177×177 CSS（位图 265×265），
// 不透明像素在位图行 0..199（WebGL 行 0 是画面底部）⇒ CSS 自上而下是行 65..264，
// 即人物只有 99×134、脚贴着画布底边、头顶留白 65 像素。
const MEASURED_BCSZ: SilhouetteRect = {
  left: 62 / 265,
  top: 65 / 265,
  width: 148 / 265,
  height: 200 / 265,
};
const BOX = { width: 177, height: 177 };

describe("computeSilhouetteFit", () => {
  it("把人物放大到填满容器，并把它居中回容器", () => {
    const fit = computeSilhouetteFit(MEASURED_BCSZ, BOX);
    expect(fit).not.toBeNull();
    const { width, height, left, top, clip } = fit!;
    // 等比放大（画布保持正方形 ⇒ 渲染器的贴合比例不变）
    expect(width).toBeCloseTo(height, 6);
    // 人物在放大后的画布里仍然占 clip 那块，且落点正好是容器中央
    const charW = width - clip.left - clip.right;
    const charH = height - clip.top - clip.bottom;
    expect(left + clip.left).toBeCloseTo((BOX.width - charW) / 2, 6);
    expect(top + clip.top).toBeCloseTo((BOX.height - charH) / 2, 6);
    // 人物由填满较短的那一边：高 173 ≈ 容器高（含 2% 内边距）
    expect(charH).toBeCloseTo(BOX.height * 0.98, 0);
    // 相比不贴合时（99×134）明显变大
    expect(charW).toBeGreaterThan(99 * 1.25);
    expect(charH).toBeGreaterThan(134 * 1.25);
  });

  it("留白再大也只放大到 maxScale，避免帧缓冲失控", () => {
    const tiny: SilhouetteRect = { left: 0.4, top: 0.4, width: 0.1, height: 0.1 };
    const fit = computeSilhouetteFit(tiny, BOX, { maxScale: 1.6 })!;
    expect(fit.width).toBeCloseTo(BOX.width * 1.6, 6);
  });

  it("人物本就占满容器 / 缺测量 / 非法输入都不做贴合", () => {
    expect(computeSilhouetteFit(null, BOX)).toBeNull();
    expect(computeSilhouetteFit({ left: 0, top: 0, width: 1, height: 1 }, BOX)).toBeNull();
    expect(computeSilhouetteFit({ left: 0, top: 0, width: 0, height: 1 }, BOX)).toBeNull();
    expect(computeSilhouetteFit(MEASURED_BCSZ, { width: 0, height: 177 })).toBeNull();
    // 越界的测量明显不可信（比例和超过 1）
    expect(computeSilhouetteFit({ left: 0.5, top: 0, width: 0.9, height: 0.5 }, BOX)).toBeNull();
  });

  it("容器变尺寸时按同一份比例重算（不必重新测量）", () => {
    const small = computeSilhouetteFit(MEASURED_BCSZ, BOX)!;
    const big = computeSilhouetteFit(MEASURED_BCSZ, { width: 216, height: 216 })!;
    expect(big.width / small.width).toBeCloseTo(216 / 177, 6);
    expect(big.left / small.left).toBeCloseTo(216 / 177, 6);
  });
});

describe("measureSilhouette", () => {
  it("拿不到 WebGL 上下文时返回 null（调用方保持原样显示）", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    expect(measureSilhouette(canvas, 16)).toBeNull();
  });

  it("把 readPixels 的自下而上行序换成 CSS 的自上而下", () => {
    // 4×4，不透明像素只在位图行 0..1（WebGL 行 0 = 画面最底）⇒ CSS 里应在下半部
    const w = 4;
    const h = 4;
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < w; x += 1) px[(y * w + x) * 4 + 3] = 255;
    }
    const gl = {
      FRAMEBUFFER: 0,
      RGBA: 0,
      UNSIGNED_BYTE: 0,
      bindFramebuffer: () => undefined,
      readPixels: (
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        _f: number,
        _t: number,
        dest: Uint8Array,
      ) => dest.set(px),
    };
    const canvas = {
      width: w,
      height: h,
      getContext: (kind: string) => (kind === "webgl2" ? gl : null),
    } as unknown as HTMLCanvasElement;

    expect(measureSilhouette(canvas, 16)).toEqual({
      left: 0,
      top: 0.5,
      width: 1,
      height: 0.5,
    });
  });
});

describe("supportsClipPath", () => {
  it("标准属性或 -webkit- 前缀任一可用即算支持", () => {
    const ok = (names: string[]) => ({
      supports: (property: string) => names.includes(property),
    });
    expect(supportsClipPath(ok(["clip-path"]))).toBe(true);
    // iOS 13.0 及以下只认带前缀的写法
    expect(supportsClipPath(ok(["-webkit-clip-path"]))).toBe(true);
    expect(supportsClipPath(ok([]))).toBe(false);
  });

  it("没有 CSS 对象或没有 supports 方法都算不支持（保持原样，不做放大）", () => {
    expect(supportsClipPath(undefined)).toBe(false);
    expect(supportsClipPath({})).toBe(false);
  });

  it("supports 抛错（部分内核占位实现）按不支持处理", () => {
    const boom = () => {
      throw new Error("not implemented");
    };
    expect(supportsClipPath({ supports: boom as never })).toBe(false);
  });
});
