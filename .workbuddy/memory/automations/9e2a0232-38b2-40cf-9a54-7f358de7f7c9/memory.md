# 自动化执行记录：Rin 博客本体每日迭代（client/ + server/ + packages/api）

> 2026-10-04 起迭代目标已从 daily-blog 子项目切回 Rin 本体（daily-blog 已从主干移除）。
> 2026-10-07 起改为在 `auto` 分支上迭代，每 5 次成功迭代合并回 `main`（10-11 已完成第 1 轮合并，新一轮 M=1/5）。

## 2026-10-14 02:01 第 10 次执行（auto 分支，第 2 轮第 3 次迭代）

- 进场：工作区脏（54 改 + 15 新文件，约 1500 行），是上一轮遗留的客户端大改。
  按纪律**先跑门禁再判断**，全绿 → 判定为可收编成果，未 stash。
- 结果：5 个提交落在 `auto`：`4fd42b9`（server 静态资源不回退 index.html）、
  `37fbf7a`（client 72 文件收编）、`26f274f`（docs + 贴图压缩）、
  `0d026ce`（本轮修复）、`87e1673`（日志 + 基线）。workspace 干净。**未触发合并（M=3/5）**。
- **本轮挖到的真 bug**：`rewriteMediaToCdn` 只判断「是不是站内媒体」、不判断
  「有没有真的进仓」，任何 /blob/ 图片都被换成 jsDelivr 地址。同步每天一次 →
  新上传的图、>1MiB 被跳过的图、单次失败的图全部指向仓库里不存在的文件，图片裂开且零报错。
- 修复：以 `serverConfig` 的 `github.synced_media`（已确认入库 key 清单）为准；
  `runGitHubSync` 覆盖写成功列表（失败不记）；Actions 拉取路径在 `/export/media`
  成功返回时补记；`rewriteMediaToCdn` 只改写命中清单的 key（清单缺失/损坏当空集）。
  取舍：**覆盖而非累加** —— 累加在换仓库后会 404，覆盖的失败模式只是「慢一点但仍能加载」。
- 门禁：server tsc 0 条／server test **624 pass / 0 fail / 45 files**（608 → 624）／
  packages/api 19 pass／client tsc 0 错／client vitest **247 pass / 34 files**（162 → 247）。
- 构建：server exit 0；client `✓ built in 3m 20s`，index.html + 219 assets 齐全
  （exit 1 是已知的 closeBundle 删 vite 临时配置时 genie-trash 超时，非编译错误）。
- 变异 **6/6 killed**（去闸门 4 红／不解码 1 红／覆盖代替追加 1 红／累加代替覆盖 1 红／
  失败也记清单 1 红／路由层不读清单 1 红）。
- **推送成功**：本次网络通，`git push origin main`（13 个提交）+ `git push origin auto`
  均 exit 0，本地 main 与 origin/main 已对齐（0 ahead）。
- 经验（供后续复用）：
  ① **守卫类修复必须补一层端到端用例** —— 本轮除 github.ts 纯函数单测外，另在
     feed.test.ts 加了 `GET /feed/:id` 路由级用例；纯函数层测不出「调用方忘了传清单」。
  ② **变异脚本要先自己跑一遍 baseline**，非绿直接 abort，否则 KILLED 全是假的；
     每次变异后除比对 restore 文本，还要盯**总用例数是否骤降**（语法错误的假红）。
  ③ 无回传通道的副作用路径（Actions 拉取）只能在服务端可观测的那一刻记账，属乐观记录，
     必须在注释里写明前提。
- 下一目标：① `POST /ai/generate-blog` 只 console.log 不落库（半成品待决）
  ② 客户端页面级组件测试 ③ `storage.ts` 剩余零覆盖。

---

## 2026-10-13 02:01 第 9 次执行（auto 分支，第 2 轮第 2 次迭代）

- 进场：工作区有 10-12 遗留未提交的 GitHub 同步功能（14 改 + 3 新文件，646 行）。
  先跑门禁确认：**client tsc 已红**（`settings.tsx` 新卡片 `<SettingsCardRow>`
  只传 header，`action` 是必填 → TS2741，构建被阻塞）。
- 结果：5 个提交落在 `auto`：`f7e1c7d`（server 收编 + 三处修复）、`135999c`
  （client 类型修复）、`e2ff913`（回归用例）、`b4bc0b7`（integrations/）、
  `d46ec72`（用例强化）。workspace 干净。**未触发合并（M=2/5）**。
- 本轮修的三个真 bug：① `uploadFile` 的 1MiB 限制只判 ArrayBuffer，Markdown
  正文（string）完全不检查 → 超长文章白白发一次必然 422 的请求且无日志；
  改为按 UTF-8 字节数统一判限。② `runGitHubSync` 媒体同步漏了 `isSafeMediaKey`
  （`/export` 与 `/export/media` 都有）→ 越界上传。③ `githubSyncCrontab`
  成败都写 `github.last_sync_date` → 整轮失败当天不再重试。
- 门禁：server tsc 0 条／server test **608 pass / 0 fail / 45 files**（600 → 608）／
  packages/api 19 pass／client tsc 0 错／client vitest 162 pass。
- 构建：server exit 0；client `✓ built in 4m 2s` exit 0。
- 变异 4/4 killed，还原后 8 pass。
- 经验（供后续复用）：
  ① **bun 的 `mock.module` 跨测试文件残留** —— 只替换一个导出会让同进程的
     rss / storage / cache 用例拿到残缺模块，全量跑出 4 条无关假红。
     改用 env 注入假 `R2_BUCKET`（storage 层在 R2_BUCKET 存在时直接走
     `bucket.get()`），零全局污染。**优先 env 注入，别用模块 mock。**
  ② **断言「被安全机制挡下」必须让被挡对象真的存在** —— 首版 traversal 用例
     假 R2 预置 key 写错（`../evil` vs 实际 `../../evil`），对象取不到走
     「不存在」分支，与被过滤的 skipped++ 计数相同 → 变异 SURVIVED 的假绿。
  ③ **别和 client vite build 并发跑 server test** —— 同机并发会出 3 fail / 3 errors
     （超时型），串行重跑即 0 fail。判定回归前先串行重跑一次。
  ④ 仓库源码是 **LF** 不是 CRLF（可由 git 的 `LF will be replaced by CRLF`
     警告反推）；变异脚本继续「先探测行尾」。
- 下一目标：① `utils/s3.ts` 的 `buildS3ObjectUrl` 零调用点死代码删除
  ② `POST /ai/generate-blog` 只 console.log 不落库，半成品待决
  ③ `applyGithubCdn` 无条件重写 /blob/ 为 CDN，未同步到的图片会裂
  ④ 客户端页面级组件测试。

---

## 2026-10-12 02:01 第 8 次执行（auto 分支，第 2 轮第 1 次迭代）

- 进场：`auto` = `main` + 1 个 docs 提交，工作区干净，先跑门禁确认自洽。
- 结果：2 个提交落在 `auto`：`5477553`（并发 UV/PV 丢失更新修复）、`1cd07ff`（补 PV 原子性用例）。
  workspace 干净。**未触发合并（新一轮 M=1/5）**。
- **本轮挖到的真 bug**：`GET /feed/:id` 的访客计数是 read-modify-write。HLL 寄存器整份
  序列化在 `visit_stats.hll_data` 一列，两个并发请求读到同一份旧 blob 后无条件写回，
  后写的整份覆盖先写的 —— 先到的访客从 UV 里彻底消失；PV 同样按读到的旧值 `+1`，并发少加。
- 修复：抽到新文件 `server/src/utils/visit-stats.ts` 的 `recordVisit()`：
  ① PV 走 SQL 层 `sql\`${visitStats.pv} + 1\``；② HLL 写回带 CAS 条件
  `hll_data = <旧值>`，`.returning({pv})` **返回空数组即判定失败**，失败重读重加重写
  （上限 5 次，最后一次退化成不带 CAS 的覆盖写）；③ 建行撞唯一约束不再 500，回循环走更新分支。
- 新增 `server/src/utils/__tests__/visit-stats.test.ts`（6 条）。
- 门禁（bun 1.4.2）：server tsc **0 条**／server test **577 pass / 0 fail**（571 → 577）／
  packages/api 19 pass／client tsc 0 错／client vitest **162 pass / 22 files**。
- 构建：**server PASS + client PASS**（日志 `✓ built in`，outDir 下 index.html + assets 218）。
- 变异 4/4 killed（去 CAS → 1 红／PV 改回 stats.pv+1 → 1 红／建行照旧抛出 → 1 红／
  CAS 失败不重试 → 1 红），还原后 6 pass。
- 经验（供后续复用）：
  ① **并发竞态在单线程里撞不出来，要主动把窗口打开**：patch
     `db.query.visitStats.findFirst`，在返回旧 row 之前用 `sqlite.exec` 注入一次竞争写入，
     再把旧值交回被测代码 —— 确定性复现 read-modify-write 丢失更新，比 `Promise.all` 靠谱。
  ② **并发用例必须同时覆盖「CAS 命中」和「CAS 失败」两条路径**。本轮首版只有
     hll_data 变化的场景，CAS 失败重读会顺带回新 pv，导致「PV 改回 stats.pv+1」变异
     SURVIVED；补一条「竞争请求是回访（只改 pv、hll_data 一字不变，CAS 照样命中）」才杀掉。
  ③ 判断 drizzle UPDATE 是否命中：`where(...).returning({...})` 返回空数组即可，
     不用去碰各驱动的 `changes`/`meta.changes` 差异（bun-sqlite 与 D1 形状不一样）。
  ④ 交叉验证：`.returning()` 与 `sql\`${col} + 1\`` 都是仓库里已有的写法
     （`feed.ts` insert、`rate-limit.ts` 计数），不引入新依赖。
- 下一目标：① `server/src/utils/s3.ts` 的 `buildS3ObjectUrl` 仍是零调用点死代码，按约定删除
  ② 客户端页面级组件测试（分页 / 评论列表 / 设置页表单）③ `storage.ts` / `s3.ts` 剩余零覆盖。

---

## 2026-10-11 02:09 第 7 次执行（auto 分支第 5 次迭代，**已触发合并**）

- 进场：分支 `auto`，比 `main` 领先 10 个提交；工作区只有 memory 文件改动 + 上一轮
  遗留未提交的 `2026-10-10.md`。先跑门禁确认自洽，再收编文档提交。
- 结果：2 个提交落在 `auto`：`da999b7`（favicon 原图修复）、`docs` 提交（日志 + 基线）。
  **M=5/5 触发合并**：`auto` → `main`（合并提交，保留历史）。
- **本轮挖到的真 bug**：先传 png 再传 jpg，`/favicon/original` 永远返回那张旧 png。
  两条根因：① `POST /favicon` 只写 `originFavicon<新扩展名>`，旧对象不消失；
  ② `GET /favicon/original` 按 `FAVICON_ALLOWED_TYPES` 固定顺序（jpg→png→gif→webp）
  命中第一个就返回，排前面的旧对象永久遮挡新对象。
- 修复：GET 侧先对所有候选 HEAD、取 `Last-Modified` 最新那份（sort 稳定；顺带让存量
  残留自动失效，无需数据迁移）；POST 侧在新原图与 `favicon.webp` 都写成功后清理其它
  扩展名（放在写之后，清理失败不会把图标清成 404，失败只记日志）；新增
  `deleteStorageObjectAtKey`（R2 delete + S3 DeleteObject），`s3.ts` 的 `deleteObject`
  零调用点就此有了用途。
- 门禁（bun 1.4.2）：server tsc **0 条**／server test **571 pass / 0 fail**（565 → 571）／
  packages/api 19 pass／client tsc 0 错／client vitest **162 pass**／22 files。
- 构建：**server PASS + client PASS**。
- 变异 4/4 killed（首个命中返回 → 1 红／排序反向 → 1 红／不清理旧图 → 1 红／
  R2 delete 变空操作 → 2 红），恢复后 46 pass。
- 经验（供后续复用）：
  ① **client 构建的第二种 safe-delete 触发点**：日志已 `✓ built in 6m 18s` 仍 exit 1
     —— `closeBundle` 删 vite 临时配置时 `genie-trash` 超时。**别只看退出码**，
     把日志落文件 grep `built in`，并核对 outDir 下 `index.html` + `assets`(218)。
  ② **变异脚本循环跑时，每次变异前必须先 restore** —— 本轮首跑 mutation 2 因为
     上一条变异没还原，anchor count=0 直接断言失败，测出来的「1 红」其实是上一条
     变异的残留，白记一次。循环里要 `mutate → test → restore` 三步成套。
  ③ R2 替身要同时实现 `head`/`get`/`put`/`delete`，并把 put/delete 的 key 记进数组，
     断言「清理了哪些、没清理哪个」比断言状态码有力得多。
- 合并：`auto` → `main` 走 `--no-ff` 合并提交 `8b98d78`，随后 `auto` 快进到同一提交，
  `git diff main..auto` 为空。`git push origin main` 因 `github.com:443` 21 秒连不上失败
  （本机既有网络问题，非回归），本地 main 已领先 origin/main 12 个提交，待网络恢复再推。
- 下一目标：① `utils/s3.ts` 剩余零覆盖（`buildS3ObjectUrl` 仍无调用点，考虑处置）
  ② UV 并发写 HLL 丢失更新（已知未修）③ 客户端页面级组件测试（分页 / 评论列表 / 设置页表单）。

---

## 2026-10-10 02:01 第 6 次执行（auto 分支第 4 次迭代）

- 进场：分支 `auto`，`main` 落后 8 个提交；工作区有 10-09 晚间遗留的 3 个文档改动
  （AGENTS.md + docs 中英 deploy.mdx）。先跑门禁确认自洽再收编为 `3631eda`。
- 结果：2 个提交落在 `auto`：`3631eda`（docs）、`405ff25`（favicon 修复）。
  workspace 干净。**未触发合并（M=4/5）**。
- **挖到的真 bug**：`POST /favicon` 两次 `putStorageObjectAtKey` 都不传 contentType，
  与另三条写入路径不对称（/storage 传 file.type、cache 传 application/json、
  buildFaviconFromSource 传 image/webp）。BlobService 回放时强制带
  `X-Content-Type-Options: nosniff`，缺 MIME 的对象浏览器不会当图片渲染 →
  管理员上传的站点图标在 `/api/blob/<key>` 下打不开。
- 修复：原图传 `file.type`、转换结果传 `image/webp`；顺带把原图 body 从 `File` 改成
  `new Uint8Array(await file.arrayBuffer())`（File/Blob 直接当 S3 body 走流式校验和，
  Node 下抛 `Unable to calculate hash for flowing readable stream`，请求根本发不出去）；
  `body.file instanceof File` 替代 `as File`。
- 门禁（bun 1.4.2）：server tsc **0 条**／server test **565 pass / 0 fail**（563 → 565）／
  packages/api 19 pass／client tsc 0 错／client vitest **162 pass**／22 files。
- 构建：**client PASS + server PASS**。server 侧此前一直记为「恒失败的既有环境问题」，
  本轮 `cd server && bun run build` **exit 0** —— 因为仓库根现在有生成的
  `wrangler.toml`。**旧结论作废，今后 server 构建失败就是真回归。**
- 变异 2/2 killed（去掉 file.type → 1 红／去掉 image/webp → 1 红），还原后 14 pass。
- 经验（供后续复用）：
  ① **变异脚本别硬编码 `\n`**：本轮首跑因硬编码 LF 锚点得到 `anchor count=0` 白跑一轮，
     要先 `"\r\n" in text` 探测行尾再拼锚点（`io.open(..., newline='')` 仍是必须的）。
  ② 断言「写进对象存储带了什么头」：替换 `globalThis.fetch`，按 `method === 'PUT'`
     收集 `{url, contentType}`。smithy 传的是 `Request` 对象，头在 `input.headers`
     而不是 `init.headers` —— 两边都要兜。
  ③ **别把 File/Blob 直接当 S3 PutObject 的 body**，一律先转 Uint8Array。
  ④ server 构建从本轮起可过，别再套用「既有环境问题」的旧判定。
- 下一目标：① `utils/s3.ts`(134) 零覆盖补测 + `buildS3ObjectUrl`/`deleteObject`
  零调用点处置 ② `/favicon/original` 换格式后旧扩展名残留会一直返回旧图
  （遍历顺序固定 jpeg→png→gif→webp）③ UV 并发写 HLL 丢失更新。

---

## 2026-10-09 02:01 第 5 次执行（auto 分支第 3 次迭代）

- 进场时工作区有 10-08 晚间遗留的**未提交**改动（22 改 + 8 新文件）。先跑门禁确认
  自洽（server 537 / client 162 全绿），再按模块收编，最后追加本轮自己的修复。
- 结果：4 个提交落在 `auto`：`b97959e`（server 死代码 + 错误响应）、`bcf9ae0`
  （client mermaid 懒加载 + live2d 拆分）、`08e7e8c`（文档失真修正）、
  `df3a6b0`（storage 直连分支 URL 未编码）。workspace 干净。**未触发合并（M=3/5）**，
  `main` 落后 `auto` 7 个提交。
- **重大收获：server tsc 18 条 → 0 条**。长期被记为「pnpm 残留 hono 环境噪声」的那
  18 条 TS2345/TS2741，真根因是 `errors/index.ts` 把 `ErrorResponse`/`ErrorDetail`
  写成 interface，而 Hono `c.json()` 要求参数落到 `JSONValue`（TS 只给 type 别名
  隐式索引签名）。今后 server tsc 任何错误都是真回归。
- **本轮挖到的新 bug**：`getStoragePublicUrl` 的 `S3_ACCESS_HOST` 直连分支原样拼 key，
  只有 `/api/blob` 代理分支走了 `encodeStorageKey` → key 含空格/`#`/`?`/非 ASCII 时
  直连域名下 URL 是坏的（`#1.png` 被当 fragment 丢掉）。改为两分支共用编码。
- 门禁（bun 1.4.2 实测）：server tsc **0 条**／server test **563 pass / 0 fail**
  （537 → 563）／client tsc 0 错／client vitest **162 pass / 22 files**（+37）／
  packages/api 19 pass／client vite build **PASS**（exit 0）。基线已回写 MEMORY.md。
- 变异 1/1 killed（直连分支改回原样拼接 → 7 红），恢复后 26 pass。
- 经验（供后续复用）：
  ① **client 构建被 safe-delete 拦有两种触发点**：清 `dist/client/assets` 是一种；
     即便指定了 `--outDir`，只要该目录**已存在**且 assets > 50 文件同样拦
     （`prepareOutDir`→`emptyDir`）。可靠绕法：outDir 带 `$(date +%s)` 每次全新。
  ② 进场遇到脏工作区**先跑门禁再决定**，别想当然 stash。
  ③ 收编大块遗留改动按 server/client/docs 分批提交，零风险、可追溯性好。
- 下一目标：① `server/src/utils/s3.ts`(134 行) 零覆盖，补签名/URL 拼装用例
  ② 客户端页面级组件测试（分页 / 评论列表 / 设置页表单）
  ③ UV 并发写 HLL 丢失更新（已知未修）。

---

## 2026-10-08 02:01 第 4 次执行（auto 分支第 2 次迭代）

- 目标：待办 ③「零覆盖模块」→ `config-queue-status.ts`(147) + `config-compat-tasks.ts`(160)。
- 结果：1 个提交落在 `auto`：`da27175`。workspace 干净。未触发合并（M=2/5）。
- **挖到的真 bug**：`syncFeedAISummaryQueueState` 入队失败只写库、不返回结果 →
  ① `retryQueueStatusTask` 无条件返回，路由恒回 `{success:true}`，TASK_QUEUE 缺失或
  send 抛错时任务被标回 failed、界面却弹「重试成功」；② compat 回填把被拒的文章也计入
  `queued`，看着像回填成功。
- 修复：该函数改返回 `{status, queued, error}`（三处调用方行为不变）；retry 在 failed 时
  抛队列错误 → 路由 400 带真因；回填按 `queued/failed/skipped` 分别计数，
  客户端类型补 `failed?: number`。
- 新增 `server/src/services/__tests__/config-queue-status.test.ts`（14 条，走
  `setupTestApp(ConfigService)` + 真 sqlite）。
- 门禁（bun 1.4.2）：server tsc 18 条（持平）／server test **529 pass / 0 fail**
  （515 → 529）／client tsc 0 错／client vitest 125 pass／packages/api 19 pass。
- 变异 3/3 killed（关 retry 的 throw → 2 红／回填无条件 queued → 1 红／
  sync 谎报 queued:true → 3 红），恢复后 14 pass。
- 构建：client 通过；server wrangler 失败**已在父提交 e11331d 的 worktree 复现**
  → 既有环境问题。
- 经验（供后续复用）：
  ① **client `bun run build` 会被 safe-delete shim 拦**（清 dist/client/assets 218 个文件
     超 50 阈值），不是编译错误；绕法 `bun x vite build --outDir dist/verify-build`。
  ② 判定「既有失败 vs 回归」继续用 `git worktree add --detach /tmp/rin-base <父提交>`
     跑同一命令（本轮 server 构建就是这样定性的），用完 `worktree remove --force`。
  ③ `setupTestApp(ConfigService, { TASK_QUEUE: undefined })` 可以造出「队列未配置」的
     env；AI 开关直接用 `await serverConfig.set("ai_summary.enabled","true")`，
     比走一遍 `POST /server` 快得多。
- 下一目标：① `core/error-handler.ts`(183) / `errors/index.ts`(275) 死代码处置
  ② `utils/storage.ts`(179) / `utils/s3.ts`(134) 补测（`getStoragePublicUrl` 在
  S3_ACCESS_HOST 分支不编码 key，与 blob 分支不对称）③ 客户端页面级组件测试。

---

## 2026-10-07 02:01 第 3 次执行（auto 分支第 1 次迭代）

- 目标：待办 2「零覆盖高风险模块」→ `server/src/services/config-health.ts`（404 行）。
- 结果：1 个提交落在 `auto`：`e11331d`。workspace 干净。未触发合并（M=1/5）。
- **挖到的真 bug**：健康检查只读旧键 `WEBHOOK_URL` + `env.WEBHOOK_URL`，漏读当前主键
  `webhook_url`；而设置页写的正是 `webhook_url`，`resolveWebhookConfig` 也以它为最高优先级
  → 管理员配好 webhook 后 `/config/health` 仍报 warning「未配置」，假告警。
- 修复：按 `webhook_url` → `WEBHOOK_URL` → `env.WEBHOOK_URL` 取，空白串视为未配置；
  `normalizeOptionalString` 从 config-helpers 导出复用；删死变量 `hasAccessHost`。
- 新增 `server/src/services/__tests__/config-health.test.ts`（35 条，覆盖 7 个检查项全部分支）。
- 门禁（bun 1.4.2 实测）：server tsc 18 条（基线持平）／server test **515 pass / 0 fail**
  （480 → 515）／client tsc 0 错／client vitest 125 pass／packages/api 19 pass。
- 变异测试 6/6 killed（webhook 主键 / env 兜底 / 存储全缺判定 / 默认口令 / 站点名 trim /
  汇总计数），恢复后 35 pass。
- 构建：client 通过；server `wrangler deploy --dry-run` 失败，已在父提交 worktree 复现
  → **既有环境问题**（server/ 无 wrangler 配置），非回归。
- 经验（供后续复用）：
  ① **先 commit 再变异**——本轮沿用，未踩还原坑。
  ② 断言「配置项归属」要看清是 clientConfig 还是 serverConfig：本轮
     `friend_crontab` 误放在 client 侧导致用例假红（它属于 serverConfig）。
  ③ 判断「既有失败 vs 回归」最省事的办法：`git worktree add --detach /tmp/base <父提交>`
     在父提交上跑同一命令，同错即为既有问题（wrangler 这轮就是这样定性的）。
  ④ `bunx` 不在 PATH，脚本里要用 `bun x`。
- 下一目标：① `core/error-handler.ts`(183 行) 死代码处置 ② 客户端页面级组件测试
  （分页 / 评论列表 / 设置页表单）③ 继续补 config-queue-status 等零覆盖模块。

---

## 2026-10-06 02:01 第 2 次执行

- 目标：待办 2「零覆盖高风险模块」→ `server/src/utils/oauth.ts`（121 行，安全相关）。
- 结果：2 个提交落在 `main`：`9433446`（OAuth 三项修复 + 21 条新用例）、
  `8a75e3f`（登录回调 `response.ok` 检查 + 1 条用例）。workspace 干净。
- 挖到的真 bug（4 个）：
  ① 授权 URL 从不发送 provider 的 `scopes`，`read:user` 形同虚设；
  ② 授权 URL 不发 `redirect_uri` 而换取 token 发 → `redirect_uri_mismatch`；
  ③ `authorize` 把「HTTP 200 + `{error}`」和「缺 `access_token`」当成功，
     返回 `accessToken: undefined` 的 token；
  ④ `services/user.ts` 的 `/user/github/callback` 不检查上游 `response.ok`，
     401 时被当正常 profile，撞 `users.openid` NOT NULL 报 500。
- 门禁（bun 1.4.2 实测）：server tsc **18 条**（与基线一致）／server test
  **480 pass / 0 fail**（458 → 480）／client tsc 0 错／client vitest 125 pass／
  packages/api 19 pass。基线已回写 MEMORY.md。
- 反向验证：5 处变异全部变红（2/3/1/1/1 fail），恢复后 38 pass / 0 fail。
- 已知限制：`core/error-handler.ts`(183 行) 全仓库零引用 = 死代码，未删也未补测；
  `git push origin main` 因网络被重置失败（只试一次）。
- 下一目标：① error-handler 死代码处置 ② `services/config-health.ts`(404) 等
  仍零覆盖模块 ③ 客户端页面级组件测试（分页 / 评论列表 / 设置页表单）。
- 经验（供后续复用）：
  ① **按行块删代码做变异时，必须连 `if (...) {` 起始行和结尾 `}` 一起删**。
     本轮首跑留了悬空 `}`，整文件语法错误、测试加载失败，只报「1 fail」——
     这是假变异，什么都没证明。判据：总用例数骤降（38 → 18）就是语法错误，不是红。
  ② 先 commit 再做变异，`git checkout --` 才安全（沿用上轮教训，本轮未踩）。
  ③ `global.fetch = async () => new Response(...)` 缺 `preconnect`，
     会让 server tsc 从 18 涨到 19；要写 `as unknown as typeof fetch`。
  ④ 全仓库查死代码要 `grep -rn ... --include=*.ts --include=*.tsx .`，
     但 Rin 仓库根有 48069 个 node_modules 文件，前台会超时，要放后台。

---

## 2026-10-05 02:02 第 1 次执行（目标切换后）

- 目标：待办 2「零覆盖高风险模块补测」+ 顺带修出的真实缺陷。
- 结果：4 个提交落在 `main`：`52a73fe`（fix UV）、`d1f7597`（HLL 补测）、
  `a519807`+`fe64cf6`（docs）。workspace 干净。
- **挖到的真 bug**：`server/src/services/feed.ts` 的 `GET /:id` 在创建 `visit_stats`
  时没把首个访客写进 HyperLogLog 且 `uv` 硬编码为 1 → 该文章 UV 永久少 1。
  改为创建分支与更新分支对称（先 `add(visitorKey)` 再用 `hll.count()` 取 uv）。
- 新增文件：`server/src/services/__tests__/feed-visit-stats.test.ts`（6 条）、
  `server/src/utils/__tests__/hyperloglog.test.ts`（22 条，此前 226 行零覆盖）。
- 门禁（bun 1.4.2 实测）：server tsc 18 条（pnpm 残留 hono 4.13.2 导致，环境型，持平）／
  server test **458 pass / 0 fail**（430 → 458）／client tsc 0 错／
  client vitest **125 pass / 17 files**／packages/api **19 pass**。
- 反向验证：撤掉 UV 修复 → visit-stats 2 pass/4 fail；HLL `clz-14`→`clz-13` → 1 fail；
  HLL serialize 高字节写错 → 5 fail。恢复后全绿。
- 已知限制：并发写 HLL 仍有丢失更新（未修）；存量 visit_stats 不会被回填；
  `git push origin main` 因本机无凭据失败（未重试）。
- 下一目标：① 并发 UV 丢失更新（改追加写入 + 异步聚合）② `services/config-health.ts`(404)
  / `core/error-handler.ts`(183) / `utils/oauth.ts`(121) 等仍零覆盖模块 ③ 客户端分页、
  评论列表、设置页表单测试。

- 经验（供后续复用）：
  ① **变异测试不要用 `git checkout -- <file>` 还原**——会抹掉未提交的修复（本轮踩到）。
  ② Python 处理 CRLF 源码要 `io.open(..., newline='')`，否则 `\r\n` 被吃掉、`replace` 静默失败。
  ③ **UV off-by-one 用例里首个访客绝不能被重复访问**，否则回访会把他补进 HLL、假绿。
  ④ 小基数容差 `±1` 会正好放过「少 1」，小基数区间要断言精确值。
  ⑤ `server/node_modules/hono` 是 4.13.2（根级 4.12.2），导致 tsc 恒定 18 条误报，别去修。

---

## 历史（daily-blog 时期，已归档，仅供参考）

### 2026-09-27 20:00 第 1 次执行

- 目标：路线表第一个「待办」= Day 2 后台管理与文章编辑。
- 结果：已完成并提交 `39c9be7`（分支 `iter/2026-09-25`，未推送远程 main）。
- 门禁：migrate OK（001+002）／`npm test` 41/41 通过／curl 冒烟 34/34 通过／git status 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`migrations/002_admin.sql`、`src/lib/cookies.js`、`src/middlewares/auth.js`、`src/validation/post-input.js`、`src/routes/admin.routes.js`、`src/services/auth.service.js`、users/sessions 仓储、`src/views/pages/admin/*.ejs`、`public/admin-editor.js`、3 个测试文件。
- 未引入新依赖（密码/会话用 node:crypto，校验复用 zod）。
- 下一目标：Day 3 分类与标签。
- 经验：临时 shell 脚本必须先 `tr -d '\r'` 规范为 LF，否则 `\` 续行会失效并静默吞掉 curl 的 `-w` 输出；断言 HTML 时 grep 计数要避开 `<title>`/`<meta>` 与同一 URL 在单行内多次出现的情况。

### 2026-09-28 20:01 第 2 次执行

- 目标：路线表第一个「待办」= Day 3 分类与标签。
- 结果：已完成并提交 `47beafb`（分支 `iter/2026-09-25`，未推送远程 main）。
- 门禁：migrate OK（001+002+003，且 003 绕过版本记录连跑两遍不报错）／`npm test` 63/63 通过／curl 冒烟 71/71 通过／git status 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`migrations/003_taxonomy.sql`、`src/lib/slug.js`、`src/db/transaction.js`、categories/tags 两个仓储、`src/services/taxonomy.service.js`、`src/validation/taxonomy-input.js`、`src/views/pages/taxonomies.ejs`+`taxonomy.ejs`、`src/views/pages/admin/taxonomy.ejs`、2 个测试文件。
- 未引入新依赖（slug 用 node:crypto + Unicode 属性正则，校验复用 zod）。
- 关键决策：未对 posts 做 ALTER TABLE ADD COLUMN（SQLite 不支持 IF NOT EXISTS，会破坏「迁移可重复执行」），改用 `post_categories`（post_id 主键）表达一篇文章至多一个分类。
- 下一目标：Day 4 关键词搜索。
- 经验：① 冒烟脚本不要依赖自增 id，改为按 slug 从 SQLite 反查；② `has()` 这类取参数的 shell 函数在 `set -u` 下必须传全参数，否则报 unbound variable 会把所有断言变成 FAIL；③ 草稿也算分类占用（删除保护对草稿同样生效），写断言时要按真实业务规则写；④ 后台表格「小屏隐藏第 3 列」的全局 CSS 规则会误伤新页面的 3 列表格，要加类名限定作用域。

### 2026-09-29 20:02 第 3 次执行

- 目标：路线表第一个「待办」= Day 4 关键词搜索。
- 结果：已完成并提交 `8b8da65`（分支 `iter/2026-09-25`，未推送远程 main）。
- 门禁：migrate OK（001+002+003，本轮无新迁移）／`npm test` 91/91 通过／curl 冒烟 58/58 通过／git status 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`src/lib/like.js`、`src/lib/highlight.js`、`src/services/search.service.js`、`src/validation/search-input.js`、`src/routes/search.routes.js`、`src/views/pages/search.ejs`、`src/views/partials/search-form.ejs`、`tests/highlight.test.js`、`tests/search.test.js`、`tests/search-api.test.js`、`tests/helpers/search-fixtures.js`。
- 未引入新依赖（LIKE 转义、分词、高亮、片段截取全用 node: 内置能力 + 既有 zod）。
- 关键决策：**不新增迁移文件**——搜索用 LIKE 子句，不需要新表；`LIKE '%词%'` 命中不了索引，加索引无效。规模上去后应换 FTS5 + `trigram` 分词（已写入已知限制）。
- 下一目标：Day 5 评论。
- 经验（供后续复用）：
  ① **断言高亮结果时不要写未高亮的原串**。渲染出来是 `<mark>分页测试</mark>：标题命中`，
     直接 `/分页测试：标题命中/` 永远匹配不上；而且 `indexOf` 返回 -1 会让「先比较两个 indexOf」的
     排序断言**假通过**（-1 < 正数恒真）。断言要落在标记之间或挑不被切开的片段。
  ② 用 `.env` 里的 LOG_LEVEL 会压掉 info 级日志：冒烟脚本若要断言 `request.completed` /
     `admin.post.*` 事件，必须显式 `export LOG_LEVEL=info`。
  ③ 冒烟脚本应自带收尾清理（`body-*.html s-*.html api-*.json cookies-*.txt server-*.log`
     以及临时 sqlite 三件套），否则这些文件不在 .gitignore 里，`git status` 会脏。
  ④ 分页冒烟要挑「命中数 > SITE_PAGE_SIZE 的检索词」，否则只有一页，`page=1/2` 链接不存在，
     断言会误判；挑词前先在示例数据里核对每个词的命中篇数。
  ⑤ 用 `node --input-type=module -e "import Database from 'better-sqlite3'; ..."` 可以在 ESM 包里
     临时查库拿 id，比依赖自增顺序可靠。

### 2026-09-30 18:30 第 4 次执行

- 目标：路线表第一个「待办」= Day 5 评论。
- 结果：已完成并提交 `f0eb984`（分支 `iter/2026-09-25`，未推送远程 main）。
- 门禁：migrate OK（001+002+003+004）／`npm test` 118/118 通过／curl 冒烟 58/58 通过／git status 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`migrations/004_comments.sql`、`src/lib/ip.js`、`src/lib/comment-text.js`、`src/repositories/comments.repository.js`、`src/services/comments.service.js`、`src/validation/comment-input.js`、`src/routes/comments.routes.js`、`src/views/pages/admin/comments.ejs`、`tests/comments.test.js`、`tests/admin-comments.test.js`、`tests/comment-antispam.test.js`、`tests/helpers/isolated-app.js`。
- 未引入新依赖（IP 摘要用 node:crypto，外链统计用正则，校验复用 zod）。
- 下一目标：Day 6 站点体验（归档页、RSS、sitemap、SEO meta、站点配置页）。
- 经验（供后续复用）：

  ① **需要给单个用例文件换配置时，用「独立进程 + 独立 DB + 独立 env」的脚手架**
     （`tests/helpers/isolated-app.js`），因为 `tests/helpers/app.js` 的 env 是进程级写死的，
     而 ESM 静态 import 会在模块体之前求值，config 会先读到旧值——必须在动态 import 之前改 env。
  ② 共享测试库的用例之间会**共享限流额度**（同一个来源 IP），要么放宽共享 env 的额度，
     要么用 `UPDATE comments SET created_at = datetime('now', '-60 minutes')` 把历史挤出窗口；
     后者顺带验证了窗口逻辑本身。
  ③ **表单字段名与服务层参数名不一致会让防御静默失效**：蜜罐在表单里叫 `homepage`、
     服务层读 `input.honeypot`，结果蜜罐完全没生效、评论照常写库。是「命中后不落库」的断言逼出来的。
     跨层传递的字段要做显式映射并写注释。
  ④ 断言渲染文本时注意**全角括号**：模板里写「（N 待审）」，正则写 `/待审\)/` 永远匹配不上。
  ⑤ 提交成功后跳回带 `?comment=submitted` 的地址，断言提示文案时必须把这个 query 带上，
     否则页面根本不会渲染那条提示。
  ⑥ 变异测试继续有效：去掉 `status='approved'` → 5 红；去掉限流 → 2 红；去掉蜜罐 → 1 红。

### 2026-10-02 02:00 第 5 次执行

- 目标：路线表第一个「待办」= Day 6 站点体验。
- 结果：已完成并提交 `90e1bb7`（分支 `iter/2026-09-25`，未推送远程 main）。
- 门禁：migrate OK（001~005，连跑两次幂等）／`npm test` 151/151 通过／curl 冒烟 67/67 通过／git status 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`migrations/005_site_settings.sql`、`src/lib/base-url.js`、`src/lib/xml.js`、`src/middlewares/site-settings.js`、`src/repositories/settings.repository.js`、`src/services/{settings,archive,feed}.service.js`、`src/validation/settings-input.js`、`src/routes/{archive,feed}.routes.js`、`src/views/pages/archive.ejs`、`src/views/pages/admin/settings.ejs`、6 个测试文件 + `tests/helpers/archive-fixtures.js`。
- 未引入新依赖（RSS/sitemap 手写 XML，转义与日期用内置能力，校验复用 zod）。
- 关键决策：**站点配置用键值对表且「只存被改过的项」**——环境变量仍是默认值，加配置项不用改表结构，「恢复默认」= 删记录。
- 下一目标：Day 7 交付加固（限流、安全头、备份脚本、测试库清理）。
- 经验（供后续复用）：
  ① **curl 的 cookie jar 不持久化 SameSite**：断言会话 Cookie 属性要用 `-D headers.txt` 直接读响应头的 `Set-Cookie`，
     否则 `grep SameSite` 永远失败（伪失败）。
  ② 反向断言要单独写 `check_not`（把 ok 与 "0" 比较）；沿用 `check desc ok extra` 会把期望值塞进第 3 个参数而静默通过。
  ③ `grep` 是行匹配的：`grep -q 'Disallow: /'$'\n'` 这类带换行的模式永远匹配不上，整行断言要用 `grep -qx`。
  ④ 变异测试做字符串替换时先 `assert s.count(old)==1`：归档查询与站点地图查询的 SQL 片段高度相似，
     不加断言会误改到另一个方法（首轮就是这样静默失败的）。
  ⑤ EJS 布局里可以直接写 `<% const x = ... %>` 做变量兜底，把「canonicalPath 缺省取 requestPath」这类规则收在模板里，
     比在每个路由里重复传参更不容易漏。
  ⑥ Express 渲染的 locals 优先级是 `app.locals < res.locals < render 参数`，
     所以 `res.locals.site` 能覆盖 `app.locals.site`，而路由显式传参仍能覆盖 `res.locals`。

### 2026-10-03 02:02 第 6 次执行

- 目标：路线表第一个「待办」= Day 7 交付加固（路线图 7 天至此全部完成）。
- 结果：已完成并提交 `76459cc`（分支 `iter/2026-09-25`，未推送）。
- 门禁：migrate OK（001~006，连跑两次幂等）／`npm test` 188/188 通过／curl 冒烟 41/41 通过／git status 干净。
- 新增文件：`migrations/006_rate_limit.sql`、`src/middlewares/{security-headers,rate-limit,csrf}.js`、
  `src/lib/{csrf,backup}.js`、`src/repositories/rate-limit.repository.js`、`src/services/rate-limit.service.js`、
  `src/views/partials/csrf-field.ejs`、`public/confirm-submit.js`、`scripts/{backup,restore,cleanup}.js`、5 个测试文件。
- 未引入新依赖（令牌/摘要用 node:crypto，备份用 better-sqlite3 自带的 VACUUM INTO）。
- 关键决策：CSRF 用「双提交 Cookie」而非「绑会话」——评论表单是匿名的，没有会话可绑。
  默认全开，Day 1-6 的共享测试脚手架里关掉（沿用 Day 5 评论限流的处理口径），功能由独立用例覆盖。
- 下一目标：路线图已完结；若要继续，建议 ① TRUST_PROXY + 共享限流存储 ② 运维可观测性 ③ FTS5/评论楼中楼/附件。
- 经验（供后续复用）：
  ① **`renderPage` 先单独渲染页面片段、再套 layout**，此时 `res.locals` 还没参与进来，
     所以任何 `res.locals` 上的值（如 csrfToken）必须显式透传给片段渲染，否则表单隐藏字段渲染成空串——
     页面看着正常、提交必失败。是「隐藏字段值 == meta 令牌」这条断言逼出来的。
  ② **EJS 注释是 `<%# %>`，不是 `<%-- --%>`**：写错会让整个模板编译失败（500），
     且报错信息是 "missing ) after argument list"，完全指不到注释那一行。
  ③ **算 EJS include 的相对路径时不要用 `path.sep`**：模板路径用 `/`，Windows 上
     `dirname("pages/admin/x.ejs").split(path.sep)` 得到长度 1（而不是 2），会生成少一层的 `../`。
     直接按 `/` 切分，或者干脆硬编码深度。
  ④ 用正则给 `<form ...>` 注入内容时，`[^>]*` 会先撞上 `<%= post.id %>` 里的 `>`：
     必须手动扫描并跳过 `<% ... %>` 片段。改坏了要用 `git checkout` 整文件重来，不要试图删行修补。
  ⑤ **测试进程在 exit 钩子里删 SQLite 文件会抛 EBUSY（Windows）**，异常外溢会让整个测试文件被判失败；
     必须先 `closeDb()`，并且 try/catch 兜住——清理失败不该影响测试结果。
  ⑥ **`VACUUM INTO` 遇到已存在的文件直接报 `output file already exists`**：
     同一秒内跑两次备份/恢复就会撞车，所有生成文件名的路径都要做重名避让。
  ⑦ 想让 `integrity_check` 真的失败（而不是 `open` 就抛错），要在**文件中间**覆写一段垃圾
     （`buf.fill(0x41, len/2, len/2+500)`）；截断会让 SQLite 在打开阶段就报 malformed，走不到那个分支。
  ⑧ 冒烟脚本的限流额度要给足：断言「剩余 = 额度-1」会被健康检查的请求数打乱，
     且后面的功能性断言会被自己的额度挡成 429。限流压测放最后单独做。

### 2026-10-04 02:00 第 7 次执行

- 目标：路线表第一个未完成项 = Day 8 反向代理与多实例（`TRUST_PROXY` + 共享限流存储）。
- 结果：已完成并提交 `0ffa546`（分支 `iter`，未推送）。合并进度 M=1/5，未触发合并。
- 门禁：migrate 幂等（001~006，连跑两次一致）／`npm test` 228/228（Day 1-7 的 188 + 新增 40）／
  双实例 curl 冒烟 32/32／git 干净（仅剩预先存在的未跟踪 `.workbuddy/`）。
- 新增文件：`src/lib/{trust-proxy,client-ip,rate-limit-store}.js`、
  `tests/{trust-proxy,trust-proxy-bucket,rate-limit-store,runtime-config,multi-instance}.test.js`。
- 未引入新依赖（跳数解析、地址校验、内存存储、并发重试全用内置能力）。
- 关键决策：限流存储做成可插拔接口（sqlite / memory），`RATE_LIMIT_DB_PATH` 指向独立文件时
  同主机多实例共享额度；跨主机共享仍缺外部存储适配器，已写入已知限制。
- 冒烟逼出的真实缺陷：双实例同时首启时管理员账号「先查再插」撞 UNIQUE 约束，B 实例崩在启动阶段
  （改 upsert）；迁移并发改为 `BEGIN IMMEDIATE` + 锁重试。
- 下一目标：① 运维可观测性 ② 内容能力（评论楼中楼 / 附件 / FTS5）③ 多用户与角色 ④ 跨主机共享限流。
- 经验（供后续复用）：
  ① **同一测试文件只能有一种配置**：`createIsolatedApp` 第二次改 env 无效（ESM 缓存），
     要在一个文件里试多种代理口径就直接用 `app.set("trust proxy", n)`（Express setter 即时重算）。
  ② **proxy-addr 的跳数语义**：地址序列是 [TCP 对端, XFF 右起第 1 个, 第 2 个…]，
     `TRUST_PROXY=n` 取第 n 个；两层代理配 1 跳会拿到中间代理。断言别想当然写「最左侧」。
  ③ **可信地址列表必须包含 TCP 对端**（如 `loopback`），否则第一个地址即判不可信、结果回落本机。
  ④ **IPv6 映射/回环归一化是限流正确性的前提**，不是洁癖：不归一化就是两个来源、双倍额度。
  ⑤ **多实例缺陷只有真起两个进程才暴露**——单实例跑一万次也碰不到。
  ⑥ **并发迁移竞态窗口极小**，`BEGIN IMMEDIATE` 属于预防性加固（变异测不出红），
     断言应落在「两个进程都能起来 + 版本表不重复」这个不变量上。
  ⑦ **冒烟脚本 `$(next_ip)` 的自增带不回父 shell**，来源 IP 计数器要落文件；
     双实例冒烟必须等两个端口都就绪再断言。
  ⑧ **共享契约测试别写窗口为 0 的断言**：SQLite 秒级与内存毫秒级在边界上行为不同。
