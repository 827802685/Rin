# Rin 博客 · 美化增强与主题支持补丁

针对 `827802685/Rin` 主仓 `main` 分支。本补丁做三件事：

1. **新增 6 套美化模板（配色方案）** —— 直接满足"添加更多美化模板选项"。
2. **增强外部主题接入，支持 Astro（兼修解析 bug）** —— 满足"添加 theme 支持 hexo/astro"。
3. **主题模块 bug 扫描与修复**。

> 说明：仓库 `theme/` 目录下含一个数 GB 的模型文件（`芙宁娜免费模型`），导致整仓无法在沙箱内完整下载。因此本工作基于 **精准抓取的真实源码**（`client/src/utils/theme-scheme.ts`、`theme-color.ts`、`page/settings-theme.tsx`、两份 locale）完成，并通过独立单测 + 语法检查验证，而非完整 `bun build`（沙箱无法跑通）。

---

## 一、新增美化模板（6 套配色方案）

在 `THEME_SCHEMES` 中新增，设置页「配色方案」卡片网格会自动出现，运行时经既有 `applyThemeConfig` 管线生效（启动逻辑 `use-app-bootstrap.ts` 无硬编码方案列表）：

| id | 中文标签 | 强调色 | 风格 |
|----|----------|--------|------|
| `lavender` | 薰衣草 | `#8b5cf6` | 柔紫 |
| `mint` | 薄荷 | `#10b981` | 清新青绿 |
| `coral` | 珊瑚 | `#e6427a` | 暖珊瑚粉 |
| `nord` | 北欧 | `#88c0d0` | Nord 极地灰蓝 |
| `coffee` | 咖啡 | `#b5733d` | 暖棕 |
| `cyber` | 赛博 | `#22d3ee` | 深蓝 + 霓虹青 |

每套均按现有口径给出 `light`/`dark` 双档共 10 个语义令牌，文本对比度 ≥ 4.5:1（沿用原 `default` 方案对 `text-muted` 的 WCAG 处理）。

同时给「主题色」新增 2 个强调色预设：**Lavender** `#a78bfa`、**Mint** `#10b981`，并补了中英文 i18n 标签。

---

## 二、外部主题接入增强（Astro / 各类 Tailwind）

原 `importSchemeFromCss()` 已能把 Hexo/Halo 的 CSS 解析成方案，但存在真实缺口。本补丁重写了解析器，现在支持：

- `@media (prefers-color-scheme: dark/light)` 包裹（Astro 与现代主题最常见）
- class 制深色模式：`.dark` / `:root.dark` / `[data-theme="dark"]` / `[data-theme="light"]`
- Tailwind / shadcn 令牌命名映射：`--background→surface-page`、`--foreground→text-primary`、`--card/--popover→surface-raised`、`--muted-foreground→text-muted`、`--border/--input→border-default`、`--primary→accent` …（含 Tailwind v4 的 `--color-*` 前缀）
- 显式分档 `--<token>-light` / `--<token>-dark`
- **色值格式全面支持**：十六进制（3/4/6/8 位）、`rgb()/rgba()`、`hsl()/hsla()`（转 hex），以及 `oklch()/oklab()/lab()/lch()/color()/hwb()/var()`（浏览器原生，原样透传）。这是现代 Astro / Tailwind v4 主题（默认用 `oklch()`）能否导入的关键——旧实现**只认十六进制**，会整段丢弃导致 `importSchemeFromCss` 返回 `null`、回落 default，等于"Astro 支持"对绝大多数现代主题实际失效。
- `@media not (prefers-color-scheme: dark)` 取反已处理（深色/浅色档正确互换）
- 令牌/主色都解析不到时返回 `null`（回落 default，不报错）

即：把任意 Hexo / Astro / shadcn 主题的根 CSS 粘进设置页「自定义 CSS」框，点"应用预览"即可一键导入为配色方案。

---

## 三、Bug 扫描结论（theme 模块）

| # | 位置 | 问题 | 处理 |
|---|------|------|------|
| 1 | `importSchemeFromCss` | **真实 bug**：`@media (prefers-color-scheme: dark){ :root{…} }` 包裹的深色令牌被整个跳过（正则不处理嵌套/媒体查询），外部主题深色档全部丢失 | 重写解析器，`scanRules` + `mediaModeOf` 把媒体查询作为作用域包裹，内部规则继承对应配色档 |
| 2 | 同上 | 不支持 class 制深色模式（`.dark` / `[data-theme]`），大量 Astro/Tailwind 主题因此解析不到任何令牌 | `selectorMode` 识别 |
| 3 | 同上 | 不识别 Tailwind/shadcn 令牌命名（`--background`/`--card`/`--muted-foreground`/`--primary`/`--border`/`--color-*`） | 新增 `TOKEN_ALIASES` 映射 |
| 4 | `normalizeHex`（theme-scheme.ts） | 不支持 4/8 位带 alpha 十六进制（`#rrggbbaa`），外部 CSS 常见 → 令牌被丢弃 | 剥离 alpha 后取 RGB |
| 5 | `settings-theme.tsx:542` | 强调色标签用 `option.label.toLowerCase()` 拼 i18n key，新增预设必须保证 label 小写且 locale 有键 | 已对齐（Lavender/Mint 均加中英文） |
| 6 | `importSchemeFromCss` / `normalizeHex` | **严重功能 bug**：仅接受十六进制色值。现代 Astro / Tailwind v4 主题默认用 `oklch()`，`rgb()`/`hsl()` 也被丢弃 → 解析不到任何令牌、`found===0`、返回 `null`，"支持 Astro 主题导入"对绝大多数现代主题**实际无效** | 重写为 `parseColorValue`：hex 规范化、`rgb/rgba/hsl/hsla` 转 hex、`oklch/oklab/lab/lch/color/hwb/var` 原样透传，非法值跳过不污染令牌 |
| 7 | `mediaModeOf` | `@media not (prefers-color-scheme: dark)` 取反未处理，会把深色块误判为浅色 | 识别 `not` 关键字并翻转 dark/light |

> 本次 bug 扫描聚焦主题模块（可访问文件）。近期 commit 修复的「侧栏吸顶 / 目录空载 / 阅读进度条 / 深浅色适配」位于页面组件，若需要可继续对这些文件做专项扫描。

---

## 四、产物与验证

- 补丁文件：`/workspace/rin-theme-enhancements.patch`（相对仓库根，4 文件，+413/−49，含 oklch 修复）
- 完整新文件：`/workspace/deliverables/theme-scheme.ts`（可直接覆盖）
- 解析器单测：`/workspace/deliverables/test-importScheme.mjs`

**应用方式（在仓库根目录）：**
```bash
git apply /workspace/rin-theme-enhancements.patch
# 或手动把 client/src/utils/theme-scheme.ts 替换为 deliverables/theme-scheme.ts
```

**验证：**
```bash
# 1) 解析器单测（无需构建，38 项全过：Hexo / Astro(含 oklch) / shadcn / rgb/hsl / not 取反 / 回归）
node /workspace/deliverables/test-importScheme.mjs

# 2) 语法检查（Node 22 类型剥离）
node --experimental-strip-types --check client/src/utils/theme-scheme.ts

# 3) 本地起服务后在 设置 → 个性化 → 配色方案 看到 6 张新卡片；
#    在「自定义 CSS」粘贴任意 Astro/shadcn 主题根变量并点"应用预览"，即可导入。
```

> 仍建议在本机 `bun run dev` 后人工过一遍设置页，确认新方案卡片渲染、深浅色切换、以及"自定义 CSS 导入"符合预期（沙箱无法跑通完整构建，已用单测 + 语法检查 + 补丁可应用性验证替代）。
