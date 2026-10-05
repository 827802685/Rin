# 自动化执行记录：Rin 博客本体每日迭代（client/ + server/ + packages/api）

> 2026-10-04 起迭代目标已从 daily-blog 子项目切回 Rin 本体（daily-blog 已从主干移除）。

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
