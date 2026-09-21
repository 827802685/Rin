# Rin 项目长期约定

## 分支策略（2026-09-21 起生效）

- **唯一工作分支：`dev`** —— 所有迭代都在 `dev` 上提交，**不再按日期新建 `iter/YYYY-MM-DD` 分支**。
  用户明确要求分支收敛，本地不再保留一堆迭代分支。
- `main` 是主干（跟踪 `origin/main`），**不直接在其上开发，不 push**。
- 上游分支 `release/*`、`agent/developer/*` 是 `upstream` 远程的跟踪分支，不改动。
- 远程旧分支 `origin/iter/2026-09-20`、`origin/iter/2026-09-21`、`origin/workbuddy/main-f7c3f4a1`
  仍存在但已废弃，本地对应分支已删除；需要清理时须用户授权（涉及 push）。

## 提交与推送

- 禁止 push 到远程（除非用户当次明确授权）。
- 禁止 `git push --force` / `git reset --hard`。
- 禁止把 token、密钥写入文件或 commit。
- 提交信息用 conventional commits，**说明用中文**。

## 提交前验证门禁（必跑，失败不提交）

```bash
cd server      && <bun> run tsc --noEmit && <bun> test
cd client      && <bun> run tsc --noEmit && <bun> run vitest run
cd packages/api && <bun> test
```

基线：server 430 pass / 0 fail，client 125 pass / 0 fail，api 19 pass / 0 fail。
失败数增多即为回归，必须查清。

## 环境陷阱

- **bun 必须用 baseline 版**：`C:\Users\Administrator\.bun\bin\bun-windows-x64-baseline\bun.exe`
  （另一个 `bun-windows-x64/bun.exe` 在本机会段错误，完全不可用）。
- bash 必须先 `export PATH="/usr/bin:/bin:$PATH"`，否则 ls/find/grep/dirname 全部 command not found。
- PowerShell 工具不返回 stdout，一律用 Bash。
- 源码是 **CRLF 行尾**，正则处理内容时必须用 `\r?\n`。
- 不要动 `bun.lock`（本机镜像会写脏，需要时 `git checkout -- bun.lock`）。
- `F:/Documents/GitHub/Rin` 的 `node_modules` 有 pnpm 残留的 `hono@4.13.2`（顶层是 4.12.2），
  会导致那里的 `tsc` 报 `string | undefined` 误报；C: worktree 干净，以 C: 的验证结果为准。

## 两个工作区

- `C:/Users/Administrator/WorkBuddy/Worktrees/Rin/main-f7c3f4a1` —— AI 迭代用 worktree，当前在 `dev`。
- `F:/Documents/GitHub/Rin` —— 用户主项目目录，当前 checkout 在 `release/v0.3.0`（用户自己切的）。
