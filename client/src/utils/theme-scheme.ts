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
  // ---- 新增美化模板（2026-10）：薰衣草 / 薄荷 / 珊瑚 / 北欧 / 咖啡 / 赛博 ----
  lavender: pack(
    "lavender",
    "#8b5cf6",
    {
      "surface-page": "#f6f4fb",
      "surface-raised": "#ffffff",
      "surface-sunken": "#efeaf8",
      "surface-hover": "#e6dff4",
      "surface-active": "#d8cdec",
      "text-primary": "#1c1726",
      "text-secondary": "#6b5e7e",
      "text-muted": "#6f6390",
      "border-default": "#e6dff4",
      "border-strong": "#d3c8e8",
    },
    {
      "surface-page": "#1b1726",
      "surface-raised": "#281f38",
      "surface-sunken": "#322744",
      "surface-hover": "#3c2f52",
      "surface-active": "#4a3a63",
      "text-primary": "#f3eeff",
      "text-secondary": "#d6cbee",
      "text-muted": "#a99bc8",
      "border-default": "#352a48",
      "border-strong": "#463860",
    },
  ),
  mint: pack(
    "mint",
    "#10b981",
    {
      "surface-page": "#f1faf6",
      "surface-raised": "#ffffff",
      "surface-sunken": "#e6f5ee",
      "surface-hover": "#d7f0e6",
      "surface-active": "#c2e7d8",
      "text-primary": "#0c1a14",
      "text-secondary": "#4f7367",
      "text-muted": "#4d7264",
      "border-default": "#d7f0e6",
      "border-strong": "#bfe3d4",
    },
    {
      "surface-page": "#0f1a16",
      "surface-raised": "#1a2a24",
      "surface-sunken": "#22332c",
      "surface-hover": "#2a3e35",
      "surface-active": "#385145",
      "text-primary": "#e9f7f0",
      "text-secondary": "#c2e6d7",
      "text-muted": "#8fb7a8",
      "border-default": "#243a32",
      "border-strong": "#315045",
    },
  ),
  coral: pack(
    "coral",
    "#e6427a",
    {
      "surface-page": "#fdf2f5",
      "surface-raised": "#ffffff",
      "surface-sunken": "#fbe6ec",
      "surface-hover": "#f8d9e2",
      "surface-active": "#f2c2d1",
      "text-primary": "#2a0e16",
      "text-secondary": "#8a4456",
      "text-muted": "#8e4a5b",
      "border-default": "#f8d9e2",
      "border-strong": "#efc3d2",
    },
    {
      "surface-page": "#221016",
      "surface-raised": "#331a22",
      "surface-sunken": "#3f222c",
      "surface-hover": "#4c2935",
      "surface-active": "#5e3543",
      "text-primary": "#ffe9ef",
      "text-secondary": "#f0c9d4",
      "text-muted": "#c498a7",
      "border-default": "#42232e",
      "border-strong": "#56303d",
    },
  ),
  nord: pack(
    "nord",
    "#88c0d0",
    {
      "surface-page": "#eceff4",
      "surface-raised": "#ffffff",
      "surface-sunken": "#e5e9f0",
      "surface-hover": "#d8dee9",
      "surface-active": "#c8d0e0",
      "text-primary": "#2e3440",
      "text-secondary": "#4c566a",
      "text-muted": "#54607a",
      "border-default": "#d8dee9",
      "border-strong": "#c8d0e0",
    },
    {
      "surface-page": "#2e3440",
      "surface-raised": "#3b4252",
      "surface-sunken": "#434c5e",
      "surface-hover": "#4c566a",
      "surface-active": "#5a6580",
      "text-primary": "#eceff4",
      "text-secondary": "#d8dee9",
      "text-muted": "#aeb8c9",
      "border-default": "#434c5e",
      "border-strong": "#4c566a",
    },
  ),
  coffee: pack(
    "coffee",
    "#b5733d",
    {
      "surface-page": "#f6f1ec",
      "surface-raised": "#fffdfb",
      "surface-sunken": "#efe6dd",
      "surface-hover": "#e6d8cc",
      "surface-active": "#d8c4b3",
      "text-primary": "#2a1d12",
      "text-secondary": "#6f5640",
      "text-muted": "#745c46",
      "border-default": "#e6d8cc",
      "border-strong": "#d4bfac",
    },
    {
      "surface-page": "#20160e",
      "surface-raised": "#2e2117",
      "surface-sunken": "#3a2a1d",
      "surface-hover": "#473424",
      "surface-active": "#57442f",
      "text-primary": "#f3e9df",
      "text-secondary": "#ddc9b6",
      "text-muted": "#b29882",
      "border-default": "#3c2c1e",
      "border-strong": "#4d3a27",
    },
  ),
  cyber: pack(
    "cyber",
    "#22d3ee",
    {
      "surface-page": "#eef4f8",
      "surface-raised": "#ffffff",
      "surface-sunken": "#e2edf5",
      "surface-hover": "#d3e6f2",
      "surface-active": "#bcdaec",
      "text-primary": "#07131c",
      "text-secondary": "#3a5a72",
      "text-muted": "#3f627a",
      "border-default": "#d3e6f2",
      "border-strong": "#b8d4e6",
    },
    {
      "surface-page": "#07131c",
      "surface-raised": "#0e2230",
      "surface-sunken": "#123042",
      "surface-hover": "#173d54",
      "surface-active": "#1f4f6c",
      "text-primary": "#d7f7ff",
      "text-secondary": "#9fdcf0",
      "text-muted": "#6fc0d8",
      "border-default": "#123042",
      "border-strong": "#1d4257",
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
// 外部主题接入：从 CSS 文本解析令牌色值 + 自定义 CSS 挂载
// 支持 Hexo / Halo / Astro / 各类 Tailwind(shadcn) 主题：
//   - :root / html / body                 -> 同时填 light/dark 两档
//   - [data-color-mode="light"|"dark"]    -> 只填对应档
//   - @media (prefers-color-scheme: …)    -> 媒体查询包裹（Astro/现代主题常见）
//   - .dark / :root.dark / [data-theme]    -> class 制深色模式（Tailwind darkMode:'class'）
//   - --<token>-light / --<token>-dark     -> 显式分档
//   - Tailwind/shadcn 命名映射：--background->surface-page、--foreground->text-primary、
//     --card/--popover->surface-raised、--muted-foreground->text-muted、--border->border-default、
//     --primary->accent …（含 Tailwind v4 的 --color-* 前缀）
//   - --theme-color / --accent-color / --accent / --primary -> 方案主色
// 未解析到的令牌回落 default 包对应档。令牌与主色都解析不到时返回 null。
// ---------------------------------------------------------------------------

export const CUSTOM_CSS_STYLE_ID = "rin-custom-css";

/** 接受 3/4/6/8 位十六进制（4/8 位的 alpha 部分被剥离，仅取 RGB） */
function normalizeHex(value: string): string | null {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  } else if (hex.length === 4) {
    hex = hex.slice(0, 3);
  } else if (hex.length === 8) {
    hex = hex.slice(0, 6);
  } else if (hex.length !== 6) {
    return null;
  }
  return `#${hex.toLowerCase()}`;
}

/** 外部令牌名 -> Rin 令牌（覆盖 Tailwind v3/v4 与 shadcn 常见命名） */
const TOKEN_ALIASES: Record<string, ThemeToken> = {
  background: "surface-page",
  "bg-default": "surface-page",
  card: "surface-raised",
  popover: "surface-raised",
  sunken: "surface-sunken",
  "color-muted": "surface-sunken",
  hover: "surface-hover",
  "color-secondary": "surface-hover",
  active: "surface-active",
  foreground: "text-primary",
  "fg-default": "text-primary",
  "text-color": "text-primary",
  "text-default": "text-primary",
  "color-text": "text-primary",
  secondary: "text-secondary",
  "secondary-foreground": "text-secondary",
  muted: "text-muted",
  "muted-foreground": "text-muted",
  border: "border-default",
  "border-color": "border-default",
  input: "border-default",
  ring: "border-strong",
};

/** 由 @media / @supports 前导判断其约束的配色档 */
function mediaModeOf(prelude: string): "light" | "dark" | null {
  const b = prelude.toLowerCase();
  if (/prefers-color-scheme:\s*dark/.test(b) || /color-scheme:\s*dark/.test(b)) return "dark";
  if (/prefers-color-scheme:\s*light/.test(b) || /color-scheme:\s*light/.test(b)) return "light";
  return null;
}

/** 由选择器判断其约束的配色档 */
function selectorMode(selector: string): "light" | "dark" | "root" | "unspecified" {
  if (/\[data-color-mode\s*=\s*["']?dark["']?\]/i.test(selector)) return "dark";
  if (/\[data-color-mode\s*=\s*["']?light["']?\]/i.test(selector)) return "light";
  if (
    /\.dark\b/.test(selector) ||
    /(?:root|html|body)\.dark\b/.test(selector) ||
    /\[data-theme\s*=\s*["']?dark["']?\]/i.test(selector)
  )
    return "dark";
  if (/\.light\b/.test(selector) || /\[data-theme\s*=\s*["']?light["']?\]/i.test(selector)) return "light";
  if (/:root\b|\bhtml\b|\bbody\b/.test(selector)) return "root";
  return "unspecified";
}

/** 找到 openIdx 处 '{' 匹配的右括号，返回内部内容与结束位置 */
function matchBrace(css: string, openIdx: number): { body: string; end: number } {
  let depth = 1;
  let j = openIdx + 1;
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") depth--;
    j++;
  }
  return { body: css.slice(openIdx + 1, j - 1), end: j };
}

/**
 * 把 CSS 扫描成规则列表。媒体查询/容器/特性查询（@media/@supports/@container）
 * 作为作用域包裹，将其内部规则继承对应配色档后递归收集；@keyframes/@font-face 等
 * 直接丢弃。嵌套规则（主题 CSS 中极少出现）按单层处理。
 */
function scanRules(css: string, inheritMode: "light" | "dark" | null, out: Rule[]): void {
  let i = 0;
  let buf = "";
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "{") {
      const trimmed = buf.trim();
      if (trimmed.startsWith("@")) {
        const inner = matchBrace(css, i);
        const keyword = trimmed.slice(1).split(/[\s(]/)[0];
        const mode = mediaModeOf(trimmed);
        if (keyword === "media" || keyword === "supports" || keyword === "container") {
          scanRules(inner.body, mode ?? inheritMode, out);
        }
        // 其它 @ 规则（keyframes / font-face 等）丢弃其内容
        buf = "";
        i = inner.end;
        continue;
      }
      const inner = matchBrace(css, i);
      out.push({ selector: trimmed, inheritMode, body: inner.body });
      buf = "";
      i = inner.end;
      continue;
    }
    if (c === "}") {
      // 游离的右括号（来自被丢弃的 @ 规则）：清空缓冲即可
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
}

interface Rule {
  selector: string;
  inheritMode: "light" | "dark" | null;
  body: string;
}

const ACCENT_NAMES = new Set([
  "theme-color",
  "accent-color",
  "accent",
  "primary",
  "color-primary",
]);

export function importSchemeFromCss(cssText: string): ThemeSchemePack | null {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
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

  const rules: Rule[] = [];
  scanRules(css, null, rules);

  for (const rule of rules) {
    const selMode = selectorMode(rule.selector);
    let mode: "light" | "dark" | "both" | "skip";
    if (selMode === "dark") mode = "dark";
    else if (selMode === "light") mode = "light";
    else if (rule.inheritMode === "dark") mode = "dark";
    else if (rule.inheritMode === "light") mode = "light";
    else if (selMode === "root") mode = "both";
    else mode = "skip";
    if (mode === "skip") continue;

    const declRe = /--([A-Za-z0-9-]+)\s*:\s*([^;]+)/g;
    let decl: RegExpExecArray | null;
    while ((decl = declRe.exec(rule.body))) {
      const name = decl[1];
      const hex = normalizeHex(decl[2]);
      if (!hex) continue;
      if (ACCENT_NAMES.has(name)) {
        accent = hex;
        found += 1;
        continue;
      }
      const suffixed = /^([a-z-]+)-(light|dark)$/.exec(name);
      if (suffixed) {
        const token = suffixed[1] as ThemeToken;
        if (THEME_TOKENS.includes(token)) assign(token, suffixed[2] as "light" | "dark", hex);
        continue;
      }
      const baseName = name.startsWith("color-") ? name.slice(6) : name;
      const aliased = TOKEN_ALIASES[baseName] ?? TOKEN_ALIASES[name];
      const token = (aliased && THEME_TOKENS.includes(aliased))
        ? aliased
        : THEME_TOKENS.includes(name as ThemeToken)
          ? (name as ThemeToken)
          : null;
      if (token) assign(token, mode, hex);
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
