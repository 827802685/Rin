# Rin 项目长期约定

## 分支策略（2026-10-04 起生效）

- **全仓库只有一个分支：`main`**。本地与远端都只保留 `main`；`dev`、`iter`、`iter/YYYY-MM-DD`、
  `release/*`、`agent/developer/*` 等本地分支一律不再保留（2026-10-03 删一轮，2026-10-04 收敛到单分支）。
- **所有迭代提交直接落在 `main` 上**，不做分支切换、不做合并。每日迭代交付后即推送 `origin/main`。
- `main` 是主干（跟踪 `origin/main`）。
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

基线（2026-10-04 实测，脚本与包名以当前仓库为准）：

- `packages/api`：19 pass / 0 fail。
- `server`：430 tests，421 pass / **9 fail** —— 这 9 条全是 S3/R2 存储用例的 5000ms 超时
  （RSSService 7 条 + FaviconService 2 条）；本机到不了 `test.r2.cloudflarestorage.com`，属**已知环境型失败**。
- `client`：16 个测试文件全过（110~117 pass / 0 fail），但 vitest 以 exit 1 结束 —— 原因是
  WorkBuddy 注入的 `node-brokered-fs-shim.cjs` 在临时目录写文件时抛 `EPERM`，属**宿主环境异常**，与代码无关。

判定口径：**除上面两类环境型失败之外，任何新增失败都算回归，必须查清，不许留着。**

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
