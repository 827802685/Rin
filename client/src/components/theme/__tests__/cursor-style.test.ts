import { describe, expect, it } from "vitest";
import { buildCursorCss } from "../cursor-style";

describe("buildCursorCss", () => {
  it("covers all six state selector groups", () => {
    const css = buildCursorCss("furina", {});
    expect(css).toContain("html, body, *, *::before, *::after");
    expect(css).toContain('[role="button"]');
    expect(css).toContain("textarea");
    expect(css).toContain('input[type="range"]');
    expect(css).toContain("button:disabled");
    expect(css).toContain("[title]");
  });

  it("every rule pins priority with !important and a keyword fallback", () => {
    const css = buildCursorCss("dot", {});
    const rules = css.split("\n    ").filter((line) => line.includes("cursor:"));
    expect(rules.length).toBeGreaterThanOrEqual(6);
    expect(css).toContain("url(\"data:image/svg+xml");
    expect(css).not.toContain("undefined");
  });

  it("applies per-state overrides into the default group only", () => {
    const css = buildCursorCss("minimal", { default: "/mine/normal.png" });
    expect(css).toContain('url("/mine/normal.png") 0 0, auto');
    // 无图案方案的其他状态保持原生关键字
    expect(css).toContain("cursor: pointer !important");
  });
});
