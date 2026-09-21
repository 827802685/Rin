# Rin 博客自主迭代（72 小时窗口）— 执行记录

## 2026-09-13（第 3 轮）commit 637cc2b
- 完成待办 #1：parseSchema 接入 feed 创建/更新/置顶、评论、友链创建/更新、
  PUT /user/profile、POST /auth/login；并把 friendUpdateSchema 与 UpdateFriendRequest
  改为可选字段以匹配 wrap() 的真实语义。
- 顺手完成待办 #4：callback.tsx 的 "Waiting..." 走 i18n（callback.waiting，四语言）。
- 新增 17 个 server 测试 + 5 个 schema 层测试；全量：server 364 pass / 0 fail，
  packages/api 19 pass，client 61 pass / 0 fail。rss.test.ts 的沙箱网络超时本轮未复现（会抖动）。

## 下一轮可直接接着做的
- 待办 #2：settings.tsx / settings-theme.tsx / tools-admin.tsx 抽 useSettingsDraft hook
- 待办 #3：client 重复 6 次的长 className 模板抽到 @rin/ui
- 待办 #5：error-boundary.tsx 遗留 TODO（接 Sentry 或明确移除）
- 待办 #6：feed.ts 搜索分页与列表分页在空结果时行为不一致

## 经验
- 判断字段是否真必填，要看 client 实际载荷（writing.tsx / friends.tsx），别只看 schema 或测试。
- parseSchema 要放在 404/403 之后，避免非管理员先收到 400。

## 2026-09-20（部署轮，非迭代轮）
用户给出 Cloudflare 账户 ID + 账户级 Token，要求部署测试。已完成：Rin 全量部署到
`zjkl account`，worker `rin-server` / D1 `rin` / 队列 `rin-server-tasks` 就绪，3 个密钥已同步，
为全新部署（未覆盖线上）。本轮未做待办 #2~#6。

关键经验（下轮直接用）：
- `cfat_` 前缀是**账户级 Token**，`/user/tokens/verify` 必 401，要用 `/accounts` 系列端点验活。
- 该账户 **Workers Free，5 个 cron 槽位已满**（clist-cf / freellmapi-cf / meting-api-serverless /
  mini-flow / uptimeflare_worker）。带 cron 的 `deploy` 会失败并使 `syncWorkerSecrets` 不执行；
  用 `deploy --preview` 绕过。
- 本机网络**封锁 workers.dev 与 wrangler 预览端点**，`wrangler dev`（本地/远端）均不可用
  ⇒ 部署后无法做 HTTP 冒烟，只能做 API 层验证。
- `@smithy/*` 曾出现残缺安装导致 wrangler 打包失败；修法是重装 `@smithy`/`@aws-sdk` 家族，
  `bun install --frozen-lockfile` 不会污染 bun.lock。
- 仓库源码是 LF，不是 CRLF；判断行尾要用 `od -c`。
- 本轮代码改动（已提交）：`db-migrate-local.ts` 去 `bunx` 依赖、`.gitignore` 忽略
  `.wrangler-secrets.json`、新增其 4 个测试用例。

## 2026-09-20（cron 实跑轮）commit 1535728
用户腾出 cron 槽位后：用 Cloudflare API 给 `rin-server` 注册 `*/20 * * * *`（账户回到 5/5）。
首次真正实跑了 cron 目标 `handleScheduled` —— 靠临时配置去掉 `[ai]`/`[placement]` 后
`wrangler dev -l --test-scheduled` + `/__scheduled` 可在本机验证（公网仍被封）。

实跑暴露一个真实缺陷并修复：`rssCrontab` 在对象存储未配置时仍会尝试写入，导致未开通 R2/S3 的
部署每 20 分钟打印 3 条凭证错误。新增 `isObjectStorageConfigured()` 守卫；并把 `rss.test.ts`
里两个零断言的空壳 crontab 测试换成真正可失败的用例（反向验证通过：禁掉守卫则精确失败）。

关键经验：**Bun 1.3.13 的 `mock.module` 会跨测试文件泄漏，且 `mock.restore()` 无法撤销**；
`handleScheduled` 因此改为可选注入 `modules` 参数，测试不再用 `mock.module`。
同类问题以后优先用注入，不要用模块 mock。

验证：server 391 pass / 0 fail、client 119 pass / 0 fail、packages/api 19 pass、`bun.lock` 未动。
部署：重跑 `deploy`（不传密钥环境变量 ⇒ 跳过密钥同步 ⇒ 线上凭据原样保留）**已成功**
（cron 那一步通过，`schedule: */20 * * * *`，Version ID `f7174fda-…`）。
遗留：待办 #2~#6 仍未做；rss 测试的框架性网络依赖未改。

## 2026-09-20（测试隔离轮）commit dddce89
用户只说「改」，按上一轮报告点名的两处测试基础设施缺陷执行：

1. **mock env 的 S3 端点此前是真实域名** `test.r2.cloudflarestorage.com`（可解析、会真发请求），
   未打桩 fetch 的用例每次都要等 1~3 s 网络失败 —— 这才是 4 个 rss 抖动失败的真根因。
   改为 `http://127.0.0.1:9` + `S3_FORCE_PATH_STYLE: 'true'`（实测 1389 ms → 87 ms）。
   **关键点：必须同时开 path style**，否则桶名进主机名，失败速度又变成看 DNS 脸色
   （本机对不可路由名字的 DNS 响应极不稳定：`.invalid` 要 4.3 s）。
2. **删掉最后一处 `mock.module`**（fetch-handler.test.ts）→ 改为 `handleFetch` 可选第 3 参
   `resolveApp`，与 scheduled-handler 同一套路。

结果：`rss.test.ts` 29.96 s / 1 fail → 11.47 s / 0 fail；全量 33.07 s → 27~28 s，
连续 4 轮 392 pass / 0 fail。反向验证：把 `resolveApp()` 换回 `getApp()` 则 2 用例精确失败。
首轮全量有 1 次纯 SQLite 用例超时（负载抖动，之后 4 轮未复现），已记录未修。
本轮只动测试 + handler 注入签名，**线上行为不变，未重新部署**。
遗留：待办 #2~#6 仍未做。

## 2026-09-20（迭代轮）commit 7206ea3，分支 iter/2026-09-20
**重要：任务清单里的 #2 / #5 以及 #3 的主要部分此前已被其它轮次做完**，本轮核对后未重复劳动
（useSettingsDraft hook 已存在且三页在用；error-boundary 已无 TODO；fieldClassName 已抽出）。
以后接手这条自动化，先 `git log` + grep 核对清单，别照抄待办。

本轮做两件：
1. **#6 搜索/列表分页统一**。新增 `server/src/utils/pagination.ts`
   （`parsePagination` 把 page/limit 约束成正整数、`toPage` 统一 limit+1 翻页判定），
   feed 列表 / 搜索 / moments 三处内联解析全部接上。
   **关键发现**：对合法入参，旧搜索逻辑与列表逻辑其实完全等价（已逐案验算）；
   真正的分歧只在 `limit=0 / -5 / abc` 这类退化值 —— 搜索会返回空页却带 `hasNext:true`。
   搜索另外改为与列表相同的 `count() + offset/limit+1`，不再把全部命中行读进内存再切片，
   缓存键相应带上 page/limit。
2. **#3 收尾**：`@rin/ui` 新增 `field-styles.ts`（base/default/compact/tight），
   替掉 settings-theme ×3、date-time-input ×2 的内联长 className（类名集合逐字保持一致）。
   **坑**：mono 代码框是 `text-xs`，不能叠含 `text-sm` 的 `fieldClassName`
   （Tailwind 里 text-sm 后出会赢），只能用 base 拼装。

验证：server 421 pass / 0 fail（+29）、client 125 pass / 0 fail（+6）、packages/api 19 pass、
packages/ui tsc 干净；反向验证（换回旧 parseInt 解析）3 例精确失败；`bun.lock` 未动、未 push。
遗留：client `bun run build` 末尾被沙箱 `[safe-delete] genie-trash ETIMEDOUT` 打断，
但 4688 modules 已 transform 成功，非代码问题。**待办清单已清空，下轮需用户给新方向。**

## 2026-09-21（安全修复轮）commit d226b99，分支 iter/2026-09-21
清单已清空，未重复劳动（先 `git log` + grep 核对过 #1~#6 全部已完成）。自主找缝，做两项：

1. **`POST /storage` 零校验**（真实安全缺陷）。缺 file/key → TypeError → 500；且
   `file.type` 原样写入对象存储 Content-Type，`/api/blob/*` 又原样回显 ⇒
   **上传 text/html 即同源存储型 XSS**。补齐 file 存在性 / 5MB（对齐 client
   `DEFAULT_IMAGE_MAX_FILE_SIZE`）/ `image/*`（对齐 client `isImageFile`），
   blob 响应加 `nosniff` + `CSP default-src 'none'; sandbox` 兜住 SVG。
2. **`GET /tag/:name` 的 decodeURI 无保护**，字面 `%` → URIError → 500；而
   `/search/:keyword` 早先已修同类 —— 典型「只修一处」。抽 `decodePathParam`
   到 `server/src/utils/path.ts` 供两处共用。

验证：server 430 pass / 0 fail（基线 421，+9）、client 125、api 19、全部 tsc 干净、
`bun.lock` 未动、未 push。**三处反向验证均精确命中**（改坏哪一处就只挂对应用例）。

经验（下次直接用）：
- 找「完善现有功能」的缝，**最有效的抓手是同类功能之间的不一致** —— favicon 有
  file/size/type 校验而 storage 没有；search 修了 decodeURI 而 tag 没修。两处都靠
  「同一个仓库里已有样板」定位到，比凭空想快得多。
- 判「上传接口要不要限类型」，别只看 schema：**要看响应路径会不会回显 content-type**。
  blob 路由原样透传 headers 才是 XSS 的那一半，光限制上传类型还不够（SVG 仍是 image/*）。
- 收紧服务端校验若与既有测试冲突（本轮 4 处用 `text/plain`），先确认真是唯一消费者
  再改测试；本轮 grep 确认只有 client `image-upload.ts` 用，theme/docs 无调用。
- 写 JSDoc 插到既有函数前时，**注意别插进上一个函数的文档块和函数体之间**
  （本轮一度把 `getFirstPathSegment` 的中文 JSDoc 挤成了孤儿，已修正）。

## 2026-09-21 合并到 main（用户交互轮，非自动化）
用户要求「合并分支应用线上真实生产环境」，澄清后确认范围为**只本地合并、不 push、不部署**。

- `main` 在另一个 worktree（`F:/Documents/GitHub/Rin`），本 worktree（C: `main-f7c3f4a1`）跑在
  iter 分支上。main 落后 23 个提交、无分叉 ⇒ fast-forward 即可。
- F: 工作区有用户 12 项未提交的 live2d 改动，5 个文件撞车 ⇒ 用 `git stash -u` → merge → `pop` 绕过。
- pop 后 `settings-theme.tsx` 两处冲突 + 一处合并残留（`[draft]`），已手工解决（详见当天 memory）。

经验（下次合并直接复用）：
- **跨 worktree 合并不要硬来**：main 被别的 worktree checkout 时，本 worktree 不能 checkout main；
  正确做法是到承载 main 的那个 worktree 里操作（`F:/Documents/GitHub/Rin`）。
- **`git stash -u` → fast-forward → `stash pop` 是处理「目标分支工作区脏」的标准套路**；
  冲突时 git 会自动保留 stash 条目，不会丢数据，可放心用。
- **pop 冲突的根因常是「主干重构 vs 本地旧写法」**：本轮主干把 settings 页重构成
  `useSettingsDraft` hook，用户本地还停留在 `useState<SettingsDraft>`，于是只留下了 `[draft]`
  依赖却丢了定义。这类残留 tsc 会直接报 `Cannot find name`，比内容冲突更好定位。
- **同一 commit 在两个 worktree 的 tsc 结果不同，先怀疑 node_modules 而不是代码**：
  本轮 F: 有 pnpm 残留 `hono@4.13.2`（顶层 4.12.2）⇒ `c.req.param()` 被推导成
  `string | undefined`；C: 只有 4.12.2 所以全绿。判定手法：diff tsconfig + 对比
  `node_modules/<pkg>/package.json` 版本 + `find node_modules -name <pkg>` 找重复副本。

## 2026-09-21 分支收敛（用户要求，【务必遵守】）

**用户明确要求：不要再按日期开 `iter/YYYY-MM-DD` 分支，全部收敛成一个分支。**

现已执行：
- 从 `main` 创建长期工作分支 **`dev`**，C: worktree 已切到 `dev`。
- 已合并并**删除** `iter/2026-09-20`、`iter/2026-09-21`、`workbuddy/main-f7c3f4a1`
  （三者均已 0 提交未并入 dev，删除安全）。
- 保留 `main`（主干）、`release/v0.3.0` 与 `agent/developer/1254500b`（upstream 跟踪分支，不动）。

**以后所有迭代直接在 `dev` 上提交，禁止新建分支。**

关键发现（易踩坑）：两个同为 "test" 的提交只差 33 秒，但内容完全不同 ——
`e4bfd50`（iter/2026-09-21）**只提交了 .workbuddy 记忆文件、零代码**；真正的 live2d
模块化重构在 `bc38458`（main）。所以**判断哪条分支最新不能只看提交时间**，
必须 `git show --stat` 看实际改动内容，否则会把代码丢掉。
