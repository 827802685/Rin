# Rin 项目长期约定

## 分支策略

- **2026-10-07 起：自动化迭代改用 `auto` 分支**（自动化任务硬要求）。`auto` 从 `main` 创建，
  每 5 次成功迭代合并回 `main`（合并提交，保留历史），`main` 只接收合并、不直接开发。
- 2026-10-04 ~ 2026-10-06 期间的约定是「全仓库只有一个分支 `main`」，已被上面的 `auto` 策略取代；
  `dev`、`iter`、`iter/YYYY-MM-DD`、`release/*`、`agent/developer/*` 等旧本地分支不再保留。
- 上游 `release/*`、`agent/developer/*` 属于 `upstream` 远程，本地不保留对应分支，也不改动。

## 提交与推送

- **允许并期望推送到 `origin/main`**（用户 2026-10-04 明确授权「通过密钥推送」，此后长期有效）；
  `upstream` 远程一律不推送。
- 禁止 `git push --force` / `git reset --hard`。
- 禁止把 token、密钥写入文件或 commit。
- 提交信息用 conventional commits，**说明用中文**。

## 推送前置条件（2026-10-04 实测）

- **凭据缺失是首要阻塞**：本机无 `gh`、无 `~/.ssh`、无 `~/.git-credentials`；`credential.helper=helper-selector`
  中无 github 条目。`git push origin main` 的结果是
  `fatal: could not read Username for 'https://github.com': terminal prompts disabled`
  —— 即已经走到认证环节，但拿不到任何凭据。
- **网络到 github.com 时通时不通**：多数尝试失败（`CONNECT tunnel failed, response 502`，或直连
  `github.com:443` 21 秒超时），但 2026-10-04 12:42 那次推送确实连上了并卡在认证。
  同机 `baidu.com` 稳定 200 → 是域名级放行策略 + 链路不稳，不是整机断网。
- WorkBuddy 的 GitHub 连接器（账号 `827802685`，即本仓库 owner）可用，但它走后端 API，
  **不能执行 `git push`，也不能删除远端分支**；`push_files` 只能按文件内容建新提交，
  会让云端 main 与本地 main 成为同内容的两个不同 SHA 提交（分歧），不采用。
- 补齐办法：给 git 一份可达的凭据（PAT 或 SSH key）+ 一条稳定的 github.com 通道，然后
  `git push origin main`、必要时 `git push origin --delete <branch>` 即可完成云端收敛。

## 提交前验证门禁（必跑，失败不提交）

bun（2026-10-04 装回，`--version` 已验证 1.4.2）：
`C:\Users\Administrator\.workbuddy\binaries\bun\node_modules\@oven\bun-windows-x64\bin\bun.exe`

```bash
cd server      && "$BUN" run tsc --noEmit && "$BUN" test
cd client      && "$BUN" run tsc --noEmit && "$BUN" run vitest run
cd packages/api && "$BUN" test
```

基线（2026-10-09 02:1x 实测，脚本与包名以当前仓库为准）：

- `packages/api`：19 pass / 0 fail。
- `server`：`bun run tsc --noEmit` **0 条**（2026-10-09 由 18 条归零，见下）；
  `bun test` **563 pass / 0 fail**。
  ~~旧基线：tsc 恒定 18 条 TS2345/TS2741/TS2352~~ —— 2026-10-09 已查明：
  主因不是 pnpm 残留 hono，而是 `server/src/errors/index.ts` 把
  `ErrorResponse` / `ErrorDetail` 声明成 **interface**，Hono 的 `c.json()`
  要求参数能落到 `JSONValue`，而 TS 只给类型别名隐式索引签名。
  改 `type` + 删零引用死代码后归零。**不要再当成环境噪声忽略**；
  今后 server tsc 出现任何错误都是真回归。
- `client`：`tsc --noEmit` 0 错；`vitest run` 22 个文件 **162 pass / 0 fail**，exit 0。

已知偶发（不算回归）：沙箱到不了 `test.r2.cloudflarestorage.com` 时 `rss.test.ts` /
`favicon.test.ts` 的 S3 用例会 5000ms 超时，网络通时自己会过。

判定口径：**除上面两类环境型噪声之外，任何新增失败都算回归，必须查清，不许留着。**

## 构建（bun run build）

- **client 侧可过**（vite，约 3.5 分钟）。但 `bun run build` 直接跑会被
  WorkBuddy 的 safe-delete shim 拦住：vite 清空 `dist/client/assets`（218 文件）
  超过 50 个的批量删除阈值，报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`。
  **这不是编译错误**。绕法：`cd client && bun x vite build --outDir dist/vb-$(date +%s)`
  —— 注意 outDir **必须每次都是全新目录**：只要目标目录已存在且 assets 下
  文件 > 50，`prepareOutDir` → `emptyDir` 同样会被拦（2026-10-09 实测踩到）。
- **server 侧恒失败且属既有环境问题**：`wrangler deploy --dry-run` 报
  `The detected framework ("Hono") cannot be automatically configured` ——
  `server/` 下没有 wrangler 配置文件，workspace 内 wrangler 自动配置受限。
  2026-10-07 已在父提交的临时 worktree 上复现同样失败，**不要当成回归去修**。
- 另注：`bun run build:server` 里的 `bunx` 不在 PATH（bun 是绝对路径调用的），
  必须写成 `bun x wrangler ...`。

## 遗留未提交改动的处理

- 自动轮次进场时若工作区是脏的，**先跑一遍门禁再决定**，不要想当然 stash。
  2026-10-09 进场看到 22 改 + 8 新文件的遗留工作，实跑全绿，收编为 3 个提交；
  直接判成「半成品」丢掉会白扔一天工作量。
- 收编大块遗留改动按 `server/` / `client/` / `docs` 分批提交，三者互不依赖，
  拆分零风险但可追溯性显著更好。

## 变异测试纪律

- **不要用 `git checkout -- <file>` 还原变异**：它会连带抹掉尚未提交的修复。
  2026-10-05 实际踩到（UV 修复被还原）。要么先提交再变异，要么手工备份再还原。
- Python 处理 CRLF 源码必须 `io.open(p, encoding='utf-8', newline='')`，
  默认 universal newlines 会把 `\r\n` 吃掉，导致 `str.replace` 静默匹配不到。
- 断言「少 1」这类 off-by-one 时，容差 `±1` 会正好放过 bug，小基数区间要断言精确值。

## 环境陷阱

- **bun 已不在本机**：`C:\Users\Administrator\.bun` 于 2026-10-03 确认不存在，`bun` 与 baseline 版均无法调用，
  server / client / packages/api 的 bun 系门禁（tsc / bun test / vitest）当前**无法实跑**，不得声明其通过。
  仍可用的替代：`node_modules/.bin/tsc.exe`、`node_modules/.bin/vitest.exe`；
  managed node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-5\node.exe`；
  daily-blog 用 `node --test tests/*.test.js`（纯 Node，可跑）。
- bash 必须先 `export PATH="/usr/bin:/bin:$PATH"`，否则 ls/find/grep/dirname 全部 command not found。
- PowerShell 工具不返回 stdout，一律用 Bash。
- 源码是 **CRLF 行尾**，正则处理内容时必须用 `\r?\n`。
- 不要动 `bun.lock`（本机镜像会写脏，需要时 `git checkout -- bun.lock`）。
- `F:/Documents/GitHub/Rin` 的 `node_modules` 有 pnpm 残留的 `hono@4.13.2`（顶层是 4.12.2），
  会导致那里的 `tsc` 报 `string | undefined` 误报。

## 工作区

- `F:/Documents/GitHub/Rin` —— 唯一工作区，checkout 在 `main`。
- 旧 AI worktree `C:/Users/Administrator/WorkBuddy/Worktrees/Rin/main-f7c3f4a1` 目录已不存在，worktree 记录已 prune。

## 已发生的事故记录（避免重犯）

- 2026-10-04 11:53 用户在本机产生提交 `c0c7c59 "update"`：一次性删掉 428 个文件——包括
  `daily-blog` 的 Day 7 / Day 8 全部实现与用例（27 个文件）、`models/`（约 95MB Live2D 资源）、
  `theme/`、`.zcode/`、`.workbuddy/`，并把 `.github/ISSUE_TEMPLATE` 换成 upstream 版本。
  该提交**未并入 `main`**（已丢弃）。教训：不要用整棵树替换类命令（如 `git checkout <ref> -- .`）
  同步上游，它会静默删除本地独有目录与已交付功能。
