// Standalone test of the new importSchemeFromCss parser logic (mirrors theme-scheme.ts).
// Run: node test-importScheme.mjs

const THEME_TOKENS = [
  "surface-page", "surface-raised", "surface-sunken", "surface-hover", "surface-active",
  "text-primary", "text-secondary", "text-muted", "border-default", "border-strong",
];
const THEME_SCHEMES_default = {
  light: Object.fromEntries(THEME_TOKENS.map(t => [t, "#f5f5f5"])),
  dark: Object.fromEntries(THEME_TOKENS.map(t => [t, "#1c1c1e"])),
  accent: "#5ab0d8",
};

function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  else if (hex.length === 4) hex = hex.slice(0, 3);
  else if (hex.length === 8) hex = hex.slice(0, 6);
  else if (hex.length === 6) { /* ok */ }
  else return null;
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  return `#${hex.toLowerCase()}`;
}

// External token name -> Rin token (covers Tailwind v3/v4 & shadcn naming)
const TOKEN_ALIASES = {
  background: "surface-page", "bg-default": "surface-page",
  card: "surface-raised", popover: "surface-raised",
  sunken: "surface-sunken", "color-muted": "surface-sunken",
  hover: "surface-hover", "color-secondary": "surface-hover",
  active: "surface-active",
  foreground: "text-primary", "fg-default": "text-primary", "text-color": "text-primary",
  "text-default": "text-primary", "color-text": "text-primary",
  secondary: "text-secondary", "secondary-foreground": "text-secondary",
  muted: "text-muted", "muted-foreground": "text-muted",
  border: "border-default", "border-color": "border-default", input: "border-default",
  ring: "border-strong",
};

function mediaModeOf(prelude) {
  const b = prelude.toLowerCase();
  if (/prefers-color-scheme:\s*dark/.test(b) || /color-scheme:\s*dark/.test(b)) return "dark";
  if (/prefers-color-scheme:\s*light/.test(b) || /color-scheme:\s*light/.test(b)) return "light";
  return null;
}

function selectorMode(sel) {
  if (/\[data-color-mode\s*=\s*["']?dark["']?\]/i.test(sel)) return "dark";
  if (/\[data-color-mode\s*=\s*["']?light["']?\]/i.test(sel)) return "light";
  if (/\.dark\b/.test(sel) || /(?:root|html|body)\.dark\b/.test(sel) ||
      /\[data-theme\s*=\s*["']?dark["']?\]/i.test(sel)) return "dark";
  if (/\.light\b/.test(sel) || /\[data-theme\s*=\s*["']?light["']?\]/i.test(sel)) return "light";
  if (/:root\b|\bhtml\b|\bbody\b/.test(sel)) return "root";
  return "unspecified";
}

// find matching brace body starting at index of '{'
function matchBrace(css, openIdx) {
  let depth = 1, j = openIdx + 1;
  while (j < css.length && depth > 0) {
    if (css[j] === "{") depth++;
    else if (css[j] === "}") depth--;
    j++;
  }
  return { body: css.slice(openIdx + 1, j - 1), end: j };
}

function scan(css, inheritMode, out) {
  let i = 0, buf = "", n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "{") {
      const trimmed = buf.trim();
      if (trimmed.startsWith("@")) {
        const inner = matchBrace(css, i);
        const kw = trimmed.slice(1).split(/[\s(]/)[0];
        const mode = mediaModeOf(trimmed);
        if (kw === "media" || kw === "supports" || kw === "container") {
          scan(inner.body, mode ?? inheritMode, out);
        }
        buf = ""; i = inner.end; continue;
      } else {
        const inner = matchBrace(css, i);
        out.push({ selector: trimmed, inheritMode, body: inner.body });
        buf = ""; i = inner.end; continue;
      }
    }
    if (c === "}") { buf = ""; i++; continue; }
    buf += c; i++;
  }
}

export function importSchemeFromCss(cssText) {
  const fallback = THEME_SCHEMES_default;
  const light = { ...fallback.light };
  const dark = { ...fallback.dark };
  let accent = null;
  let found = 0;

  const assign = (token, mode, hex) => {
    if (mode === "light" || mode === "both") light[token] = hex;
    if (mode === "dark" || mode === "both") dark[token] = hex;
    found += 1;
  };

  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  scan(css, null, rules);

  for (const rule of rules) {
    const selMode = selectorMode(rule.selector);
    let mode;
    if (selMode === "dark") mode = "dark";
    else if (selMode === "light") mode = "light";
    else if (rule.inheritMode === "dark") mode = "dark";
    else if (rule.inheritMode === "light") mode = "light";
    else if (selMode === "root") mode = "both";
    else mode = "skip";
    if (mode === "skip") continue;

    const declRe = /--([A-Za-z0-9-]+)\s*:\s*([^;]+)/g;
    let d;
    while ((d = declRe.exec(rule.body))) {
      const name = d[1];
      const hex = normalizeHex(d[2]);
      if (!hex) continue;
      if (name === "theme-color" || name === "accent-color" || name === "accent" ||
          name === "primary" || name === "color-primary") {
        accent = hex; found += 1; continue;
      }
      const suffixed = /^([a-z-]+)-(light|dark)$/.exec(name);
      if (suffixed) {
        const token = suffixed[1];
        if (THEME_TOKENS.includes(token)) assign(token, suffixed[2], hex);
        continue;
      }
      const baseName = name.startsWith("color-") ? name.slice(6) : name;
      const aliased = TOKEN_ALIASES[baseName] ?? TOKEN_ALIASES[name];
      const token = (aliased && THEME_TOKENS.includes(aliased))
        ? aliased
        : (THEME_TOKENS.includes(name) ? name : null);
      if (token) assign(token, mode, hex);
    }
  }

  if (found === 0) return null;
  return { id: "custom", accent: accent ?? fallback.accent, light, dark };
}

// ---------------- TESTS ----------------
let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`FAIL: ${msg}\n  expected ${e}\n  actual   ${a}`); }
}

// 1) Hexo-style :root + [data-color-mode]
const hexo = `:root { --surface-page: #ffffff; --text-primary: #111111; --theme-color: #fc466b; }
[data-color-mode="dark"] { --surface-page: #111111; --text-primary: #eeeeee; }`;
let r = importSchemeFromCss(hexo);
eq(r.accent, "#fc466b", "hexo accent");
eq(r.light["surface-page"], "#ffffff", "hexo light page");
eq(r.dark["surface-page"], "#111111", "hexo dark page");
eq(r.light["text-primary"], "#111111", "hexo light text");

// 2) Astro / modern: @media prefers-color-scheme
const astro = `:root { --background: #f4f4f5; --foreground: #18181b; --primary: #7c3aed; }
@media (prefers-color-scheme: dark) { :root { --background: #18181b; --foreground: #fafafa; } }`;
r = importSchemeFromCss(astro);
eq(r.accent, "#7c3aed", "astro accent from --primary");
eq(r.light["surface-page"], "#f4f4f5", "astro light background->surface-page");
eq(r.light["text-primary"], "#18181b", "astro light foreground->text-primary");
eq(r.dark["surface-page"], "#18181b", "astro dark background->surface-page (media parsed)");
eq(r.dark["text-primary"], "#fafafa", "astro dark foreground->text-primary (media parsed)");

// 3) shadcn / Tailwind v4 class-based dark
const shadcn = `:root { --background: #ffffff; --foreground: #0f172a; --card: #ffffff; --muted-foreground: #64748b; --primary: #2563eb; --border: #e2e8f0; }
.dark { --background: #0f172a; --foreground: #f8fafc; --muted-foreground: #94a3b8; --border: #1e293b; }`;
r = importSchemeFromCss(shadcn);
eq(r.light["surface-page"], "#ffffff", "shadcn light bg");
eq(r.light["surface-raised"], "#ffffff", "shadcn light card->surface-raised");
eq(r.light["text-muted"], "#64748b", "shadcn light muted-foreground->text-muted");
eq(r.light["border-default"], "#e2e8f0", "shadcn light border->border-default");
eq(r.dark["surface-page"], "#0f172a", "shadcn dark bg");
eq(r.dark["text-muted"], "#94a3b8", "shadcn dark muted");
eq(r.accent, "#2563eb", "shadcn accent from --primary");

// 4) Tailwind v4 --color-* prefix
const tw4 = `:root { --color-background: #fafafa; --color-foreground: #171717; }
.dark { --color-background: #171717; --color-foreground: #fafafa; }`;
r = importSchemeFromCss(tw4);
eq(r.light["surface-page"], "#fafafa", "tw4 light color-background");
eq(r.dark["surface-page"], "#171717", "tw4 dark color-background");

// 5) --<token>-light/-dark explicit
const suffixed = `:root { --surface-page-light: #fafafa; --surface-page-dark: #111111; --accent-color: #0f766e; }`;
r = importSchemeFromCss(suffixed);
eq(r.light["surface-page"], "#fafafa", "suffixed light");
eq(r.dark["surface-page"], "#111111", "suffixed dark");
eq(r.accent, "#0f766e", "suffixed accent-color");

// 6) alpha hex stripped
const alpha = `:root { --surface-page: #fafafaee; --text-primary: #111111cc; --theme-color: #5ab0d8; }`;
r = importSchemeFromCss(alpha);
eq(r.light["surface-page"], "#fafafa", "alpha hex stripped light");
eq(r.light["text-primary"], "#111111", "alpha hex stripped text");

// 7) no tokens -> null
eq(importSchemeFromCss(`:root { --foo: #fff; }`), null, "no known tokens -> null");

// 8) regression: original default behavior still works
const basic = `:root { --surface-page: #f5f5f5; --text-primary: #000; --theme-color: #5ab0d8; }`;
r = importSchemeFromCss(basic);
eq(r.light["surface-page"], "#f5f5f5", "regression light");
eq(r.dark["surface-page"], "#f5f5f5", "regression dark falls back to default");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
