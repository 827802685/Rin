// 防回归：顶栏胶囊同时挂着 .bg-w 和 .rin-glass，两者都是单类选择器，
// 谁在样式表后面谁赢。历史上 .bg-w 赢过，背景被压回不透明纯白，
// backdrop-filter 于是完全看不出效果（模糊的是被自己挡住的内容）。
// 这里锁住三个不变量：双类名提特异性、背景必须半透明、必须有暗色与无滤镜降级。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vitest 的 cwd 是 client/
const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");

function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? null;
}

describe("rin-glass 液态玻璃", () => {
  it("用双类名声明，避免被同元素的 .bg-w 覆盖", () => {
    const body = ruleBody(".rin-glass.rin-glass");
    expect(body).not.toBeNull();
  });

  it("不再保留单类 .rin-glass 规则（会与 .bg-w 打平手）", () => {
    // 只认行首的裸选择器，注释里出现 .rin-glass 不算
    expect(/^\.rin-glass\s*\{/m.test(css)).toBe(false);
  });

  it("背景半透明且带模糊，两者缺一玻璃就失效", () => {
    const body = ruleBody(".rin-glass.rin-glass") ?? "";
    expect(body).toContain("color-mix");
    expect(body).toMatch(/backdrop-filter:\s*blur\(/);
    // 透光率必须低于 100%，否则背景不透明
    const mix = body.match(/color-mix\(in srgb,.*?(\d{1,3})%\s*,\s*transparent\)/);
    expect(mix).not.toBeNull();
    expect(Number(mix?.[1])).toBeLessThan(100);
  });

  it("暗色模式有独立的一套配色", () => {
    const body = ruleBody('[data-color-mode="dark"] .rin-glass.rin-glass') ?? "";
    expect(body).toContain("rgba(255, 255, 255");
  });

  it("不支持 backdrop-filter 时退回近乎不透明，保证正文不穿透", () => {
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\)/);
  });
});
