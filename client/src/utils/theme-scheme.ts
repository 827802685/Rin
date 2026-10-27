import { applyThemeColor } from "./theme-color";

/**
 * 配色令牌：JS 只写 <token>-light / <token>-dark 双档原始值，
 * 实际取值由 CSS 按 [data-color-mode] 解析，深色切换不依赖 JS。
 */
export const THEME_TOKENS = [
  "surface-page",
  "surface-raised",
  "surface-sunken",
  "surface-hover",
  "surface-active",
  "text-primary",
  "text-secondary",
  "text-muted",
  "border-default",
  "border-strong",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

export interface ThemeSchemePack {
  id: string;
  /** 该方案的默认强调色；用户显式设置 theme.color 时会被覆盖 */
  accent: string;
  light: Record<ThemeToken, string>;
  dark: Record<ThemeToken, string>;
}

const pack = (
  id: string,
  accent: string,
  light: Record<ThemeToken, string>,
  dark: Record<ThemeToken, string>,
): ThemeSchemePack => ({ id, accent, light, dark });

// 口径：灰阶打底 + 语义色保留色相；深/浅两档分别按对比度重挑色值
export const THEME_SCHEMES: Record<string, ThemeSchemePack> = {
  default: pack(
    "default",
    "#5ab0d8",
    {
      "surface-page": "#f5f5f5",
      "surface-raised": "#ffffff",
      "surface-sunken": "#f5f5f5",
      "surface-hover": "#e5e5e5",
      "surface-active": "#d4d4d4",
      "text-primary": "#000000",
      "text-secondary": "#737373",
      // 原 #a3a3a3 在 #f5f5f5 上只有 2.4:1，12px 的 meta/计数几乎看不清；
      // 压到 4.8:1 后仍保持“比次要文字浅”的层级。
      "text-muted": "#6b6b6b",
      "border-default": "#e5e5e5",
      "border-strong": "#d4d4d4",
    },
    {
      "surface-page": "#1c1c1e",
      "surface-raised": "#333333",
      "surface-sunken": "#404040",
      "surface-hover": "#525252",
      "surface-active": "#737373",
      "text-primary": "#ffffff",
      "text-secondary": "#e5e5e5",
      "text-muted": "#a3a3a3",
      "border-default": "#3f3f46",
      "border-strong": "#525252",
    },
  ),
  sakura: pack(
    "sakura",
    "#d16180",
    {
      "surface-page": "#faf3f4",
      "surface-raised": "#ffffff",
      "surface-sunken": "#f6ecee",
      "surface-hover": "#f0dfe3",
      "surface-active": "#e7ccd3",
      "text-primary": "#1f1215",
      "text-secondary": "#7a5b64",
      "text-muted": "#826069",
      "border-default": "#f0dfe3",
      "border-strong": "#e0c7cd",
    },
    {
      "surface-page": "#241a1d",
      "surface-raised": "#35272c",
      "surface-sunken": "#423138",
      "surface-hover": "#4e3b42",
      "surface-active": "#614951",
      "text-primary": "#ffeef2",
      "text-secondary": "#e7d3d9",
      "text-muted": "#b39aa1",
      "border-default": "#4a383e",
      "border-strong": "#5b464d",
    },
  ),
  ocean: pack(
    "ocean",
    "#3f8fc7",
    {
      "surface-page": "#f2f6f9",
      "surface-raised": "#ffffff",
      "surface-sunken": "#e9f0f5",
      "surface-hover": "#dbe7ef",
      "surface-active": "#c7dae7",
      "text-primary": "#0b1620",
      "text-secondary": "#5c7386",
      "text-muted": "#62798c",
      "border-default": "#dbe7ef",
      "border-strong": "#c2d6e3",
    },
    {
      "surface-page": "#16202a",
      "surface-raised": "#24313d",
      "surface-sunken": "#2d3d4c",
      "surface-hover": "#374a5b",
      "surface-active": "#44586b",
      "text-primary": "#eef5fb",
      "text-secondary": "#c9dae8",
      "text-muted": "#93a9bc",
      "border-default": "#33424f",
      "border-strong": "#425666",
    },
  ),
  forest: pack(
    "forest",
    "#3e8e5e",
    {
      "surface-page": "#f3f7f3",
      "surface-raised": "#ffffff",
      "surface-sunken": "#e9f1ea",
      "surface-hover": "#dcebdd",
      "surface-active": "#c7ddc9",
      "text-primary": "#0f1a12",
      "text-secondary": "#5c7361",
      "text-muted": "#59735f",
      "border-default": "#dcebdd",
      "border-strong": "#c2d8c6",
    },
    {
      "surface-page": "#17211a",
      "surface-raised": "#253027",
      "surface-sunken": "#2e3b30",
      "surface-hover": "#38473b",
      "surface-active": "#465749",
      "text-primary": "#eff6ef",
      "text-secondary": "#cfdfcf",
      "text-muted": "#96ac9a",
      "border-default": "#334236",
      "border-strong": "#425445",
    },
  ),
  mono: pack(
    "mono",
    "#64748b",
    {
      "surface-page": "#f6f6f7",
      "surface-raised": "#ffffff",
      "surface-sunken": "#eeeef0",
      "surface-hover": "#e2e2e5",
      "surface-active": "#d3d3d8",
      "text-primary": "#18181b",
      "text-secondary": "#71717a",
      "text-muted": "#65656e",
      "border-default": "#e2e2e5",
      "border-strong": "#d4d4d8",
    },
    {
      "surface-page": "#18181b",
      "surface-raised": "#27272a",
      "surface-sunken": "#3f3f46",
      "surface-hover": "#52525b",
      "surface-active": "#71717a",
      "text-primary": "#fafafa",
      "text-secondary": "#d4d4d8",
      "text-muted": "#a1a1aa",
      "border-default": "#3f3f46",
      "border-strong": "#52525b",
    },
  ),
  amber: pack(
    "amber",
    "#b97a2f",
    {
      "surface-page": "#faf6ef",
      "surface-raised": "#fffdf9",
      "surface-sunken": "#f4ecdf",
      "surface-hover": "#ecdfc9",
      "surface-active": "#e0cdb0",
      "text-primary": "#1d1508",
      "text-secondary": "#7a6748",
      "text-muted": "#7a6a4e",
      "border-default": "#ecdfc9",
      "border-strong": "#dcc9ab",
    },
    {
      "surface-page": "#211b12",
      "surface-raised": "#302718",
      "surface-sunken": "#3b3020",
      "surface-hover": "#473b27",
      "surface-active": "#574a33",
      "text-primary": "#f7efdf",
      "text-secondary": "#ded0b8",
      "text-muted": "#a89878",
      "border-default": "#443826",
      "border-strong": "#55482f",
    },
  ),
};

export const THEME_SCHEME_IDS = Object.keys(THEME_SCHEMES);

export function getThemeScheme(id: unknown): ThemeSchemePack {
  return THEME_SCHEMES[typeof id === "string" ? id : ""] ?? THEME_SCHEMES.default;
}

/** 把色板的原始变量写到 documentElement（--<token>-light / --<token>-dark） */
export function applySchemeTokens(scheme: ThemeSchemePack) {
  const root = document.documentElement;

  for (const token of THEME_TOKENS) {
    root.style.setProperty(`--${token}-light`, scheme.light[token]);
    root.style.setProperty(`--${token}-dark`, scheme.dark[token]);
  }
}

/**
 * 应用配色方案。accentOverride = 用户在设置页显式选的主色，优先于方案默认色。
 */
export function applyThemeScheme(schemeId: unknown, accentOverride?: string | null) {
  const scheme = getThemeScheme(schemeId);
  applySchemeTokens(scheme);
  applyThemeColor(accentOverride || scheme.accent);
}

// ---------------------------------------------------------------------------
// 外部主题接入（groundwork）：从 CSS 文本解析令牌色值 + 自定义 CSS 挂载
// ---------------------------------------------------------------------------

export const CUSTOM_CSS_STYLE_ID = "rin-custom-css";

const HEX_VALUE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeHex(value: string): string | null {
  const match = HEX_VALUE.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return `#${hex.toLowerCase()}`;
}

/** 剥掉注释，避免注释里的示例值被误解析 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 把外部主题（Hexo/Halo 等）的 CSS 文本解析成 Rin 令牌色板。
 *
 * 识别规则（刻意保守，只认与 Rin 令牌同名或 `--<token>-light/-dark` 形式的
 * 十六进制色值；命名不同的值解析不到，需先按 docs 的对照映射改名）：
 * - `:root { --surface-page: #fff }`            → 同时填 light/dark 两档
 * - `[data-color-mode="light"] { … }` / `="dark"` → 只填对应档
 * - 任何块里的 `--<token>-light` / `--<token>-dark` → 只填对应档
 * - `--theme-color` / `--accent-color` / `--accent` → 方案主色
 *
 * 未解析到的令牌回落 default 包对应档。令牌与主色都解析不到时返回 null。
 */
export function importSchemeFromCss(cssText: string): ThemeSchemePack | null {
  const css = stripCssComments(cssText);
  const fallback = THEME_SCHEMES.default;
  const light: Record<ThemeToken, string> = { ...fallback.light };
  const dark: Record<ThemeToken, string> = { ...fallback.dark };
  let accent: string | null = null;
  let found = 0;

  const assign = (token: ThemeToken, mode: "light" | "dark" | "both", hex: string) => {
    if (mode === "light" || mode === "both") light[token] = hex;
    if (mode === "dark" || mode === "both") dark[token] = hex;
    found += 1;
  };

  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(css))) {
    const selector = block[1];
    let blockMode: "light" | "dark" | "root" = "root";
    if (/\[data-color-mode\s*=\s*["']?dark["']?\]/.test(selector)) {
      blockMode = "dark";
    } else if (/\[data-color-mode\s*=\s*["']?light["']?\]/.test(selector)) {
      blockMode = "light";
    } else if (!/:root|\bhtml\b|\bbody\b/.test(selector)) {
      continue;
    }

    const declRe = /--([A-Za-z0-9-]+)\s*:\s*([^;]+)/g;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(block[2]))) {
      const name = decl[1];
      const hex = normalizeHex(decl[2]);
      if (!hex) continue;
      if (name === "theme-color" || name === "accent-color" || name === "accent") {
        accent = hex;
        found += 1;
        continue;
      }
      const suffixed = /^([a-z-]+)-(light|dark)$/.exec(name);
      if (suffixed) {
        const token = suffixed[1] as ThemeToken;
        if (THEME_TOKENS.includes(token)) {
          assign(token, suffixed[2] as "light" | "dark", hex);
        }
        continue;
      }
      const token = name as ThemeToken;
      if (THEME_TOKENS.includes(token)) {
        assign(token, blockMode === "root" ? "both" : blockMode, hex);
      }
    }
  }

  if (found === 0) return null;
  return { id: "custom", accent: accent ?? fallback.accent, light, dark };
}

/**
 * 清洗自定义 CSS：剥掉 script 标签残留（CSS 里出现它必是误粘贴/注入尝试）。
 * 挂载走 textContent，不会被 HTML 解析，此处只是不让垃圾进样式表。
 */
export function sanitizeCustomCss(css: string): string {
  return css.replace(/<\/?\s*script[^>]*>/gi, "");
}

/** 把自定义 CSS 挂到 <head> 末尾的专用 <style>；空文本则移除。 */
export function applyCustomThemeCss(css: unknown) {
  const text = typeof css === "string" ? sanitizeCustomCss(css).trim() : "";
  let el = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!text) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = text;
}

/**
 * 应用主题配置的总入口：自定义 CSS 挂载 + 方案令牌落地。
 * theme.scheme === "custom" 时先尝试把 theme.custom_css 解析成色板，
 * 解析不到（或没写 CSS）则回落 default 方案，不报错。
 */
export function applyThemeConfig(input: {
  scheme: unknown;
  color?: string | null;
  customCss?: unknown;
}) {
  applyCustomThemeCss(input.customCss);
  if (input.scheme === "custom") {
    const parsed =
      typeof input.customCss === "string" && input.customCss.trim()
        ? importSchemeFromCss(input.customCss)
        : null;
    if (parsed) {
      applySchemeTokens(parsed);
      applyThemeColor(input.color || parsed.accent);
      return;
    }
  }
  applyThemeScheme(input.scheme, input.color);
}
