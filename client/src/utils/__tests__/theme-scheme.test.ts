import { afterEach, describe, expect, it } from "vitest";
import {
  applyCustomThemeCss,
  applySchemeTokens,
  applyThemeConfig,
  applyThemeScheme,
  CUSTOM_CSS_STYLE_ID,
  getThemeScheme,
  importSchemeFromCss,
  THEME_SCHEMES,
  THEME_SCHEME_IDS,
  THEME_TOKENS,
} from "../theme-scheme";

const HEX = /^#[0-9a-f]{6}$/i;

function hexLuminance(hex: string) {
  const value = hex.slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return (r + g + b) / (3 * 255);
}

afterEach(() => {
  document.documentElement.style.cssText = "";
});

describe("THEME_SCHEMES", () => {
  it("ships the six preset packs", () => {
    expect([...THEME_SCHEME_IDS].sort()).toEqual([
      "amber",
      "default",
      "forest",
      "mono",
      "ocean",
      "sakura",
    ]);
  });

  it("defines every token as hex for both modes in every pack", () => {
    for (const id of THEME_SCHEME_IDS) {
      const scheme = THEME_SCHEMES[id];
      expect(scheme.accent).toMatch(HEX);
      for (const token of THEME_TOKENS) {
        expect(scheme.light[token], `${id}.light.${token}`).toMatch(HEX);
        expect(scheme.dark[token], `${id}.dark.${token}`).toMatch(HEX);
      }
    }
  });

  it("keeps dark pages darker than their light counterparts", () => {
    for (const id of THEME_SCHEME_IDS) {
      const scheme = THEME_SCHEMES[id];
      const lightPage = hexLuminance(scheme.light["surface-page"]);
      const darkPage = hexLuminance(scheme.dark["surface-page"]);
      expect(darkPage, `${id} dark page`).toBeLessThan(0.3);
      expect(lightPage, `${id} light page`).toBeGreaterThan(0.6);
      // 文字与页面底色必须拉开对比，否则换色板等于换瞎
      const darkText = hexLuminance(scheme.dark["text-primary"]);
      const lightText = hexLuminance(scheme.light["text-primary"]);
      expect(darkText - darkPage).toBeGreaterThan(0.4);
      expect(lightPage - lightText).toBeGreaterThan(0.4);
    }
  });
});

describe("getThemeScheme", () => {
  it("falls back to the default pack for unknown or non-string ids", () => {
    expect(getThemeScheme("no-such-scheme")).toBe(THEME_SCHEMES.default);
    expect(getThemeScheme(undefined)).toBe(THEME_SCHEMES.default);
    expect(getThemeScheme(42)).toBe(THEME_SCHEMES.default);
    expect(getThemeScheme("sakura")).toBe(THEME_SCHEMES.sakura);
  });
});

describe("applySchemeTokens", () => {
  it("writes both light and dark raw variables to documentElement", () => {
    applySchemeTokens(THEME_SCHEMES.sakura);
    const root = document.documentElement;
    for (const token of THEME_TOKENS) {
      expect(root.style.getPropertyValue(`--${token}-light`)).toBe(
        THEME_SCHEMES.sakura.light[token],
      );
      expect(root.style.getPropertyValue(`--${token}-dark`)).toBe(
        THEME_SCHEMES.sakura.dark[token],
      );
    }
  });
});

describe("applyThemeScheme", () => {
  it("applies the pack accent when no override is given", () => {
    applyThemeScheme("ocean");
    // #3f8fc7
    expect(document.documentElement.style.getPropertyValue("--theme-rgb")).toBe(
      "63 143 199",
    );
  });

  it("prefers an explicit accent override", () => {
    applyThemeScheme("ocean", "#ff0000");
    expect(document.documentElement.style.getPropertyValue("--theme-rgb")).toBe(
      "255 0 0",
    );
    // 强调色被覆盖不影响令牌面：色板仍然完整写入
    expect(document.documentElement.style.getPropertyValue("--surface-page-light")).toBe(
      THEME_SCHEMES.ocean.light["surface-page"],
    );
  });

  it("unknown ids resolve to the default pack instead of throwing", () => {
    applyThemeScheme("not-a-scheme");
    expect(document.documentElement.style.getPropertyValue("--surface-page-light")).toBe(
      THEME_SCHEMES.default.light["surface-page"],
    );
    expect(document.documentElement.style.getPropertyValue("--theme-rgb")).toBe(
      "90 176 216",
    );
  });
});

describe("importSchemeFromCss", () => {
  it("parses :root hex tokens into both modes, expanding 3-digit shorthand", () => {
    const pack = importSchemeFromCss(`
      :root {
        --surface-page: #fff;
        --text-primary: #101010;
        --border-default: #EEE;
      }
    `);
    expect(pack).not.toBeNull();
    expect(pack!.id).toBe("custom");
    expect(pack!.light["surface-page"]).toBe("#ffffff");
    expect(pack!.dark["surface-page"]).toBe("#ffffff");
    expect(pack!.light["text-primary"]).toBe("#101010");
    expect(pack!.light["border-default"]).toBe("#eeeeee");
    // 未提供的令牌回落 default 包
    expect(pack!.light["surface-raised"]).toBe(THEME_SCHEMES.default.light["surface-raised"]);
  });

  it("honors [data-color-mode] blocks and per-mode -light/-dark suffixes", () => {
    const pack = importSchemeFromCss(`
      [data-color-mode="light"] { --surface-page: #fafafa; }
      [data-color-mode="dark"]  { --surface-page: #171717; }
      :root { --text-primary-light: #000000; --text-primary-dark: #ffffff; }
    `);
    expect(pack).not.toBeNull();
    expect(pack!.light["surface-page"]).toBe("#fafafa");
    expect(pack!.dark["surface-page"]).toBe("#171717");
    expect(pack!.light["text-primary"]).toBe("#000000");
    expect(pack!.dark["text-primary"]).toBe("#ffffff");
  });

  it("picks up an accent from --theme-color/--accent", () => {
    expect(importSchemeFromCss(":root{--theme-color:#ff0000}")!.accent).toBe("#ff0000");
    expect(importSchemeFromCss(":root{--accent:#00ff00}")!.accent).toBe("#00ff00");
    // 无 accent 回落 default 主色
    expect(importSchemeFromCss(":root{--surface-page:#123456}")!.accent).toBe(
      THEME_SCHEMES.default.accent,
    );
  });

  it("returns null when nothing token-shaped is present", () => {
    expect(importSchemeFromCss("")).toBeNull();
    expect(importSchemeFromCss("body { margin: 0 }")).toBeNull();
    // 非十六进制值（rgb()/命名色）不解析
    expect(importSchemeFromCss(":root{--surface-page:rgb(1,2,3)}")).toBeNull();
    // 注释里的值不算数
    expect(importSchemeFromCss("/* --surface-page:#000000 */")).toBeNull();
  });

  it("ignores unknown custom properties", () => {
    const pack = importSchemeFromCss(":root{--surface-page:#0a0a0a; --not-a-token:#ff00ff}");
    expect(pack).not.toBeNull();
    expect(pack!.dark["surface-page"]).toBe("#0a0a0a");
    // 未知变量不应污染任何令牌（accent 只认 --theme-color/--accent）
    expect(pack!.accent).toBe(THEME_SCHEMES.default.accent);
  });
});

describe("applyCustomThemeCss", () => {
  afterEach(() => {
    document.getElementById(CUSTOM_CSS_STYLE_ID)?.remove();
  });

  it("creates a <style> with the given id and fills textContent", () => {
    applyCustomThemeCss("body { color: red }");
    const el = document.getElementById(CUSTOM_CSS_STYLE_ID);
    expect(el?.tagName).toBe("STYLE");
    expect(el?.textContent).toBe("body { color: red }");
  });

  it("strips script tags before mounting", () => {
    applyCustomThemeCss("a{color:red}</script><script>x()</script>");
    const el = document.getElementById(CUSTOM_CSS_STYLE_ID);
    expect(el?.textContent).not.toMatch(/<\/?script/i);
    expect(el?.textContent).toContain("a{color:red}");
  });

  it("empty/whitespace or non-string removes any existing node", () => {
    applyCustomThemeCss("a{color:red}");
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).not.toBeNull();
    applyCustomThemeCss("   ");
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).toBeNull();
    applyCustomThemeCss(undefined);
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).toBeNull();
  });
});

describe("applyThemeConfig", () => {
  afterEach(() => {
    document.getElementById(CUSTOM_CSS_STYLE_ID)?.remove();
  });

  it("scheme=custom with importable CSS writes the parsed pack tokens", () => {
    applyThemeConfig({
      scheme: "custom",
      customCss: ":root{--surface-page:#0b0b0b;--theme-color:#123456}",
    });
    expect(document.documentElement.style.getPropertyValue("--surface-page-dark")).toBe("#0b0b0b");
    expect(document.documentElement.style.getPropertyValue("--theme-rgb")).toBe("18 52 86");
    // 自定义 CSS 同时挂到独立 style 节点
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)).not.toBeNull();
  });

  it("scheme=custom with un-importable CSS falls back to the default pack", () => {
    applyThemeConfig({ scheme: "custom", customCss: "body{color:red}" });
    expect(document.documentElement.style.getPropertyValue("--surface-page-light")).toBe(
      THEME_SCHEMES.default.light["surface-page"],
    );
  });

  it("a named scheme ignores custom CSS parsing but still mounts it", () => {
    applyThemeConfig({ scheme: "ocean", customCss: ":root{--surface-page:#000000}" });
    // 走的是 ocean 令牌，而不是被 CSS 覆盖
    expect(document.documentElement.style.getPropertyValue("--surface-page-light")).toBe(
      THEME_SCHEMES.ocean.light["surface-page"],
    );
    expect(document.getElementById(CUSTOM_CSS_STYLE_ID)?.textContent).toContain(
      "--surface-page:#000000",
    );
  });

  it("accent override wins over both scheme and parsed accent", () => {
    applyThemeConfig({
      scheme: "custom",
      color: "#ffffff",
      customCss: ":root{--theme-color:#000000}",
    });
    expect(document.documentElement.style.getPropertyValue("--theme-rgb")).toBe("255 255 255");
  });
});
