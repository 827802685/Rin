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

基线（2026-10-12 02:1x 实测，脚本与包名以当前仓库为准）：

- `packages/api`：19 pass / 0 fail。
- `server`：`bun run tsc --noEmit` **0 条**（2026-10-09 由 18 条归零，见下）；
  `bun test` **577 pass / 0 fail / 43 files**（10-11 565 → 571，10-12 → 577）。
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
- **server 侧 2026-10-10 起也能过了**（exit 0）。此前记录为「恒失败」：
  `wrangler deploy --dry-run` 报 `The detected framework ("Hono") cannot be
  automatically configured`，根因是 `server/` 下没有 wrangler 配置文件。
  现在仓库根有生成的 `wrangler.toml`，`cd server && bun run build` 直接跑通，
  会打印绑定清单后 `--dry-run: exiting now.`。
  **所以今后 server 构建失败是真回归，不要再拿旧结论当既有环境问题。**
- **client 构建还有第二种 safe-delete 触发点**（2026-10-11 实测）：即使 outDir 全新、
  日志已经打印 `✓ built in 6m 18s`，进程仍会 exit 1。错误在 `closeBundle`
  —— vite 收尾要删 `node_modules/.vite-temp/vite.config.ts.timestamp-*.mjs`，
  shim 走 `genie-trash` 子进程 `ETIMEDOUT`。**这是收尾清理失败，不是编译错误**；
  判据是日志里 `✓ built in` 是否出现 + outDir 下 `index.html`/`assets`(218) 是否齐全。
  所以**不要只看退出码判 client 构建成败**，要把日志落文件再 grep。
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

- ~~**bun 已不在本机**~~ —— 该结论已于 2026-10-04 作废：`C:\Users\Administrator\.bun`
  确实不存在，但 WorkBuddy 自带一份 bun 1.4.2（路径见本文件顶部「提交前验证门禁」），
  server / client / packages/api 三套 bun 门禁**都能实跑**。看到这条旧记录不要当真。
- bash 必须先 `export PATH="/usr/bin:/bin:$PATH"`，否则 ls/find/grep/dirname 全部 command not found。
- PowerShell 工具不返回 stdout，一律用 Bash。
- 源码行尾**按文件而异**：`server/src/services/*.ts` 等新文件是 **LF**，部分老文件是 CRLF。
  正则/变异脚本一律先 `"\r\n" in text` 探测再拼锚点（git 的 `LF will be replaced by CRLF`
  警告可反推行尾）。
- **bun 的 `mock.module` 会跨测试文件残留**（2026-10-13 实测）：只替换一个导出会让同进程的
  rss / storage / cache 用例拿到残缺模块，全量跑出无关的假红。优先用 **env 注入假 R2_BUCKET**
  （storage 层在 `env.R2_BUCKET` 存在时直接走 `bucket.get()`），不要用模块 mock。
- **别和 client vite build 并发跑 server test**：同机并发会出 3 fail / 3 errors（超时型），
  串行重跑即 0 fail。判定回归前先串行重跑一次。
- 不要动 `bun.lock`（本机镜像会写脏，需要时 `git checkout -- bun.lock`）。
- `F:/Documents/GitHub/Rin` 的 `node_modules` 有 pnpm 残留的 `hono@4.13.2`（顶层是 4.12.2），
  会导致那里的 `tsc` 报 `string | undefined` 误报。
- **别把 `File` / `Blob` 直接当 S3 `PutObjectCommand` 的 body**：会走流式校验和，
  Node 运行时在发出请求之前就抛 `Unable to calculate hash for flowing readable stream`
  （`@smithy/hash-stream-node` → `getAwsChunkedEncodingStream`）。一律先
  `new Uint8Array(await file.arrayBuffer())`。2026-10-10 修 favicon 上传时踩到。
- 变异脚本里**别硬编码 `\n`**：先 `"\r\n" in text` 探测行尾再拼锚点。
  2026-10-10 首跑因为硬编码 `\n` 得到 `anchor count=0`，白跑一轮。
- 测「写入对象存储带了什么头」最省事的写法：替换 `globalThis.fetch`，按
  `method === 'PUT'` 收集 `{url, contentType}`（smithy 传的是 `Request` 对象，
  头在 `input.headers`，不是 `init.headers`），其余 GET 一律返 200 webp 字节。

## 工作区

- `F:/Documents/GitHub/Rin` —— 唯一工作区，checkout 在 `main`。
- 自 2026-10-07 起自动化迭代实际 checkout 在 **`auto`**，`main` 只接收每 5 次的合并。
- 旧 AI worktree `C:/Users/Administrator/WorkBuddy/Worktrees/Rin/main-f7c3f4a1` 目录已不存在，worktree 记录已 prune。

## 已发生的事故记录（避免重犯）

- 2026-10-04 11:53 用户在本机产生提交 `c0c7c59 "update"`：一次性删掉 428 个文件——包括
  `daily-blog` 的 Day 7 / Day 8 全部实现与用例（27 个文件）、`models/`（约 95MB Live2D 资源）、
  `theme/`、`.zcode/`、`.workbuddy/`，并把 `.github/ISSUE_TEMPLATE` 换成 upstream 版本。
  该提交**未并入 `main`**（已丢弃）。教训：不要用整棵树替换类命令（如 `git checkout <ref> -- .`）
  同步上游，它会静默删除本地独有目录与已交付功能。
