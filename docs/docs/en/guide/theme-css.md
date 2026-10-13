# Adopting External Themes (Custom CSS / Color Tokens)

Rin's UI colors are driven by a set of CSS tokens. In **Admin → Theme → Custom CSS (experimental)**
you can paste color values from another theme (Hexo / Halo, etc.), have them parsed into a Rin
color scheme, or mount the custom CSS as-is.

> This is the first step ("groundwork") toward adopting themes from other frameworks: only
> **color-level** mapping is supported — no templates, scripts, or layouts from the other theme.
> Only hex values (`#rgb` / `#rrggbb`) are parsed.

## Rin token reference

| Token | Meaning | Typical foreign variable names (examples) |
| --- | --- | --- |
| `surface-page` | Page background | `--background`, `--bg`, `--color-bg` |
| `surface-raised` | Card / content surface | `--card-bg`, `--color-panel` |
| `surface-sunken` | Sunken areas (code blocks, quotes) | `--code-bg`, `--blockquote-bg` |
| `surface-hover` | Hover background | `--hover-bg` |
| `surface-active` | Active/pressed background | `--active-bg` |
| `text-primary` | Primary text | `--font-color`, `--color-text` |
| `text-secondary` | Secondary text | `--font-2`, `--color-text-secondary` |
| `text-muted` | Muted text / placeholders | `--color-text-muted`, `--muted` |
| `border-default` | Default borders | `--border-color`, `--color-border` |
| `border-strong` | Emphasized borders | `--border-strong` |
| (accent) | Links / buttons accent color | `--theme-color`, `--main-color`, `--accent` |

Foreign themes name their variables inconsistently, so rename the values you found into the Rin
token names above before pasting.

## Parsing rules

Pasted CSS is read by `importSchemeFromCss` as follows:

```css
/* 1) Hex values in :root apply to BOTH dark and light modes */
:root {
  --surface-page: #f6f7f9;
  --text-primary: #17181c;
  --theme-color: #d16180; /* --accent / --accent-color also work */
}

/* 2) [data-color-mode] blocks apply to that mode only */
[data-color-mode="light"] { --surface-page: #f6f7f9; }
[data-color-mode="dark"]  { --surface-page: #17181b; }

/* 3) -light / -dark suffixes in the variable name apply to that mode only */
:root {
  --surface-page-light: #f6f7f9;
  --surface-page-dark: #17181b;
}
```

- Only custom properties **named after Rin tokens** (with or without `-light`/`-dark` suffixes) are recognized.
- Tokens you don't provide fall back to the built-in "default" pack, per mode.
- Comments (`/* … */`) are stripped and never parsed.
- If neither a token nor an accent can be parsed, the import is reported as failed, and the CSS
  is still mounted as-is as a fallback.

## Migration steps from Hexo / Halo

1. Locate the theme's palette source — e.g. Hexo themes usually define it in
   `source/css/_var.styl`, `_config.yml`, or a `:root` block; Halo themes commonly in
   `settings/design.css` or the theme's `styles/theme.css`.
2. Rename those variables to the Rin token names above, keeping their hex values.
3. Paste into Admin → Theme → Custom CSS and click "Apply preview".
4. Once satisfied, save: `theme.scheme` becomes `custom`, and on later visits the client
   re-parses `theme.custom_css`. Dark/light resolution happens in CSS via `[data-color-mode]`,
   with no JS involved.

## Caveats

- "Apply preview" only affects the current browser; **saving** writes the site config for all visitors.
- Custom CSS is mounted as-is (only leftover `<script>` tags are stripped); there is no style sandbox.
  If it contains `@import`, the UI warns you: external stylesheets are fetched by every visitor's
  browser and may load uncontrolled resources or fail cross-origin.
- Leaving the theme settings page restores the draft state; unsaved previews do not linger.
