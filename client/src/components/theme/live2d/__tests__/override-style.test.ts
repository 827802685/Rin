import { describe, expect, it } from "vitest";
import { OVERRIDE_STYLE_ID, buildOverrideStyleCss } from "../override-style";

// 断言与拆分前 live2d-widget.tsx 内联 rules 数组的输出逐字节等价：
// 以下期望串全部原样摘自拆分前的规则条目。

describe("buildOverrideStyleCss", () => {
  const css = buildOverrideStyleCss(false);
  const lines = css.split("\n");

  it("starts with the override style id marker rule", () => {
    expect(OVERRIDE_STYLE_ID).toBe("rin-live2d-widget--override");
    expect(lines[0]).toBe(`#${OVERRIDE_STYLE_ID}{}`);
  });

  it("pins #waifu into the React container without fixed positioning", () => {
    expect(css).toContain(
      "#waifu{position:absolute !important;top:0;left:0;bottom:auto !important;",
    );
    expect(css).toContain("width:100%;height:100%;margin:0}");
    expect(css).toContain(
      "#waifu-canvas{width:100% !important;height:100% !important;margin:0;position:relative}",
    );
  });

  it("只让画布接收事件：容器留白不再吃掉点击与滚动", () => {
    // 实测：容器是正方形，人物只占中间一块，旧样式整片正方形都吃事件（手机上进还
    // 因为 touch-action:none 挡住页面滚动）。现在命中区收到画布，再由 clip-path
    // 裁成人物那块矩形（见 live2d/silhouette.ts）。
    expect(css).toContain("#waifu,#waifu-canvas{pointer-events:none}");
    expect(css).toContain("pointer-events:auto;touch-action:pan-y;cursor:grab;");
  });

  it("gates canvas visibility until the model is ready (fade-in)", () => {
    expect(css).toContain("opacity:0;transition:opacity .4s ease;}");
    expect(css).toContain("#live2d.rin-live2d-ready{opacity:1;}");
  });

  it("restyles the tips bubble as light blue with !important everywhere", () => {
    expect(css).toContain(
      "background:rgba(186,225,248,.92) !important;border:1px solid rgba(90,176,232,.45) !important;",
    );
    expect(css).toContain(
      'border-radius:12px !important;box-shadow:0 4px 16px rgba(90,176,232,.28) !important;',
    );
    expect(css).toContain(
      '[data-color-mode="dark"] #waifu-tips{background:rgba(46,84,120,.9) !important;',
    );
    expect(css).toContain("#waifu-tips.waifu-tips-active{opacity:1 !important;}");
  });

  it("hides the plugin tool column and toggle", () => {
    expect(css).toContain("#waifu-tool,#waifu-toggle{display:none !important}");
  });

  it("omits every edgeRest rule when the mode is off", () => {
    expect(css).not.toContain("clip-path");
    expect(css).not.toContain("::after");
    expect(css).not.toContain("::before");
    expect(css).not.toContain("scale(1.45)");
  });

  it("appends the edge-rest crop rules (and only those) when enabled", () => {
    const edgeCss = buildOverrideStyleCss(true);
    expect(edgeCss.startsWith(css)).toBe(true);
    // 追加段 = 分隔换行 + 逐行的 edge 规则
    expect(edgeCss.slice(css.length + 1)).toBe(
      [
        "#waifu{bottom:0 !important;transform:none !important;}",
        "#live2d{transform:scale(1.45);transform-origin:50% 100%;",
        "clip-path:inset(10% 0 32% 0);",
        "-webkit-clip-path:inset(10% 0 32% 0);}",
        '#waifu::after{content:"";position:absolute;left:0;right:0;bottom:0;',
        "height:10px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,",
        "rgba(255,255,255,.25) 40%,rgba(0,0,0,.12) 100%);",
        "pointer-events:none;z-index:1;}",
        '[data-color-mode="dark"] #waifu::after{',
        "background:linear-gradient(180deg,rgba(0,0,0,0) 0%,",
        "rgba(255,255,255,.08) 40%,rgba(0,0,0,.35) 100%);}",
        '#waifu::before{content:"";position:absolute;left:0;right:0;bottom:10px;',
        "height:2px;background:rgba(120,180,230,.35);",
        "pointer-events:none;z-index:1;}",
      ].join("\n"),
    );
  });
});
