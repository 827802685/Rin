# 迭代记录

单分支开发：所有迭代提交都放在 `iter/2026-09-25` 分支。每天结束时必须满足验收标准：**能启动、页面可访问、核心操作流程走通**。

## 整体路线图

| 天 | 主题 | 优先级 | 交付内容 | 状态 |
| --- | --- | --- | --- | --- |
| Day 1 | 最小可运行版本 | P0 | 项目骨架、文章模型、列表页、详情页、健康检查、日志与错误处理 | ✅ 已完成 |
| Day 2 | 后台管理与文章编辑 | P0 | 管理员登录、Markdown 编辑、新建/编辑/删除、草稿与发布 | ✅ 已完成 |
| Day 3 | 分类与标签 | P1 | 分类/标签数据模型、文章归类、分类页与标签页 | ✅ 已完成 |
| Day 4 | 搜索 | P1 | 关键词搜索页、搜索接口、结果高亮、空结果提示 | ✅ 已完成 |
| Day 5 | 评论 | P2 | 游客评论提交、审核状态、后台审核、基础防灌水 | ✅ 已完成 |
| Day 6 | 站点体验 | P2 | 归档页、RSS、sitemap、SEO meta、站点配置页 | ⬜ 待办 |
| Day 7 | 交付加固 | P1 | 限流、安全头、备份脚本、完整文档与测试补齐 | ⬜ 待办 |

排期原则：先保证「能读」（Day 1），再保证「能写」（Day 2），随后依次补组织方式（Day 3）、检索（Day 4）、互动（Day 5），最后做体验与加固（Day 6-7）。

---

## Day 1（2026-09-25）· 最小可运行版本

### 本次新增功能

- 项目骨架与分层结构：路由 → 服务 → 仓储，配置/日志/错误基础设施一次到位
- 文章数据模型与可重复执行的 SQL 迁移（`migrations/001_init.sql`）
- 首页文章列表（支持 `?page=` 分页）与文章详情页（Markdown 渲染 + HTML 白名单清洗）
- 健康检查端点 `/health`、`/ready`
- 优雅停机（SIGINT/SIGTERM）、结构化 JSON 日志（requestId 贯穿）

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `src/config.js` | 集中配置，启动时校验并快速失败 |
| `src/logger.js` | 结构化 JSON 日志 + 请求级日志器 |
| `src/errors.js` | `AppError` / `NotFoundError` 等类型化错误 |
| `src/db/index.js`、`src/db/migrations.js` | 数据库连接、WAL、迁移执行与版本记录 |
| `src/repositories/posts.repository.js` | 文章查询 SQL |
| `src/services/posts.service.js` | 分页、详情查询、Markdown 渲染、摘要与阅读时长 |
| `src/routes/site.routes.js`、`src/routes/health.routes.js` | 页面路由与健康检查 |
| `src/middlewares/*` | 请求上下文、404 兜底、全局错误处理 |
| `src/views/**`、`public/styles.css` | EJS 模板与基础样式 |
| `scripts/migrate.js`、`scripts/seed.js`、`scripts/reset.js` | 迁移、示例数据、重置 |

### 验证结果

- `npm run migrate` → 执行 `001_init.sql`
- `npm run seed` → 写入 3 篇示例文章
- `npm test` → 8 个用例全部通过（健康检查、首页、分页、详情、404、静态资源）
- 启动冒烟（PORT=3100）：`/health` 200、`/ready` 200、首页 200 且渲染 3 篇文章、详情页 200 且渲染 Markdown 标题、未知文章 404、`/assets/styles.css` 200

### 已知限制

- 还没有后台管理与登录，文章内容目前只能通过 SQL 或 `npm run seed` 写入
- 未做分类/标签、搜索、评论（按路线图在 Day 3-5 实现）
- 文章正文 HTML 已做白名单清洗，但尚未支持附件上传与图片管理

### 下一步（Day 2）

管理员登录（会话 Cookie，密码哈希存储）+ 后台文章管理：新建、编辑、删除、草稿/发布切换，并在首页与详情页体现草稿不可见。

---

## Day 2（2026-09-27）· 后台管理与文章编辑

### 本次新增功能

**认证与会话**

- 管理员账号表 + 登录会话表（`migrations/002_admin.sql`，可重复执行）
- 密码使用 Node 内置 `scrypt` 加盐哈希存储，格式 `scrypt$N$r$p$salt$hash`，参数随哈希落库便于日后升级；校验用 `timingSafeEqual` 恒定时间比较
- 账号不存在时也执行一次哈希校验，抹平响应时间差异，避免用户名枚举
- 会话令牌为 32 字节随机串，**只在 Cookie 中携带**；落库的是 SHA-256 摘要，数据库泄露也无法直接冒用
- Cookie 默认 `HttpOnly` + `SameSite=Lax`，`Secure` 在生产环境默认开启（`SESSION_COOKIE_SECURE` 可覆盖）
- 登录 / 登出 / 会话过期校验；登录时顺带清理过期会话
- `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 是管理员账号的事实来源：启动时自动创建或同步（密码一致则跳过 scrypt 计算），改密码 = 改 `.env` 后重启
- 未设置 `ADMIN_PASSWORD` 时不创建账号，后台登录整体关闭，前台照常可读；生产环境则启动即失败

**文章管理**

- 后台列表 `/admin`：草稿与已发布同时可见，支持 `?status=draft|published` 筛选与分页，显示各状态计数、最近登录时间
- 新建 / 编辑文章：标题、slug、摘要、作者、正文（Markdown）、状态
- 删除文章（带确认），状态一键「发布 / 转为草稿」
- 编辑页**实时预览**：正文输入 400ms 后请求 `/admin/api/preview`，复用前台同一套 marked + sanitize-html 渲染与清洗逻辑，预览即所得
- `Ctrl / Cmd + S` 保存

**业务规则**

- 草稿在前台完全不可见：首页列表与详情页都只查 `status = 'published'`
- slug 留空时由标题自动生成；中文标题（如「第 2 天」）被削成 `2` 这类无意义片段时退化为 `post-YYYYMMDD-随机串`；自动生成冲突时追加序号
- 手填 slug 撞车直接返回 409 并回填用户输入，不做隐式改名（避免写出与预期不符的链接）
- `published_at` 规则：首次发布时写入，转草稿保留，重新发布不覆盖，保证列表排序稳定
- 表单校验失败返回 400，页面逐项列出错误并保留用户输入；`?next=` 只接受站内相对路径，避免开放重定向

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `migrations/002_admin.sql` | `admin_users`（账号）与 `admin_sessions`（会话摘要 + 过期时间） |
| `src/config.js` | 新增 `ADMIN_*` / `SESSION_*` 集中校验；生产环境强制口令，占位值直接拒绝启动 |
| `src/errors.js` | 新增 `UnauthorizedError` / `ForbiddenError` / `ConflictError` |
| `src/lib/cookies.js` | 极简 Cookie 解析与序列化（避免为此引入新依赖） |
| `src/repositories/users.repository.js`、`sessions.repository.js` | 账号与会话的 SQL |
| `src/repositories/posts.repository.js` | 新增后台分页查询、按 id 查询、slug 占用检查、增删改、状态切换 |
| `src/services/auth.service.js` | 密码哈希/校验、会话签发与撤销、`ensureAdminFromEnv` |
| `src/services/posts.service.js` | 新增后台列表、新建/编辑/删除、状态切换、slug 生成规则、预览渲染 |
| `src/validation/post-input.js` | 后台表单校验（zod），返回错误映射与回填值 |
| `src/middlewares/auth.js` | `attachAdmin`（解析会话）、`requireAdmin`（页面跳转 / 接口 401）、Cookie 写入与清除 |
| `src/routes/admin.routes.js` | 登录、登出、后台列表、新建、编辑、删除、状态切换、预览接口 |
| `src/views/pages/admin/*.ejs` | 登录页、后台列表、编辑器（含预览面板） |
| `public/admin-editor.js`、`public/styles.css` | 实时预览脚本；后台表单/表格/徽章样式 |
| `src/app.js`、`src/server.js`、`scripts/reset.js` | 挂载请求体解析与后台路由；启动时同步管理员账号 |
| `tests/admin-auth.test.js`、`tests/admin-posts.test.js`、`tests/auth-service.test.js` | 认证与后台管理用例（新增 33 个） |

不引入任何新的第三方依赖：密码哈希与令牌生成用 `node:crypto`，Cookie 自行解析，表单校验复用 Day 1 已有的 zod。

### 验证结果

- `npm run migrate` → `["001_init.sql","002_admin.sql"]`，重复执行不重跑（幂等）
- `npm test` → **41 个用例全部通过**（Day 1 的 8 个 + Day 2 新增 33 个）
- `npm start` 后 curl 冒烟 → **34 项检查全部通过**，覆盖：健康检查、首页/详情页、未登录拦截（页面 302 / 接口 401）、登录（错误口令 401、正确口令 303 + `HttpOnly; SameSite=Lax` Cookie）、后台列表、预览接口（渲染 `## 预览标题` 且 `<script>` 被清洗）、新建草稿（前台 404 且不出现在首页、后台可见）、发布（前台可见且渲染 Markdown）、编辑（新标题与新正文生效）、slug 冲突 409、标题为空 400、状态筛选、转回草稿、删除、登出后会话立即失效
- 服务端结构化日志可串联全过程：`admin.bootstrap` → `auth.login.failed` → `auth.login.succeeded` → `admin.post.created` → `admin.post.status_changed` ×2 → `admin.post.updated` → `admin.post.deleted` → `auth.logout`
- 测试过程暴露并修复了 4 个真实缺陷：① 中文标题被 slugify 削成 `13220-7` 这类无意义 slug；② 状态字段的校验错误信息在编辑器页面上无处显示（新增错误汇总区 + 字段级提示）；③ 测试断言用错 API（`assert.notMatch`）；④ 用负 TTL 伪造过期会话会写入 `NULL` 并被 NOT NULL 约束拦下（改为直接写入过去的 `expires_at`）
- 反向验证：故意去掉详情查询的 `status = 'published'` 过滤后，「新建草稿前台不可见」「转草稿后前台不可见」两个用例立刻失败；恢复后 41/41 重新全绿

### 已知限制

- 后台写操作只依赖 `SameSite=Lax` Cookie 抵御跨站提交，**尚未加 CSRF token**；登录接口也**没有限流 / 锁定**——按路线图归入 Day 7 加固
- 修改管理员密码需要改 `.env` 后重启（无站内改密码页）；也没有多用户、角色与权限划分
- 无附件上传与图床，正文插图只能引用外链；Markdown 编辑器是纯 textarea（无工具栏、无语法高亮、无草稿自动保存）
- 预览是 400ms 防抖的服务端往返，不依赖任何前端 Markdown 库；离线或会话过期时预览区会提示失败
- 文章删除是物理删除，无回收站与版本历史
- 测试库按进程生成 `data/test-<pid>.db`，长期跑测试会在 `data/` 累积这些文件（已被 gitignore 忽略），可在 Day 7 加清理脚本

### 下一步（Day 3）

分类与标签：新增分类/标签数据模型与文章-标签关联，后台可维护分类标签，前台提供分类页与标签页。

---

## Day 3（2026-09-28）· 分类与标签

### 本次新增功能

**数据模型**

- 新增 `migrations/003_taxonomy.sql`：`categories`、`tags`、`post_categories`、`post_tags` 四张表与两个外键索引
- 没有对已交付的 `posts` 表做 `ALTER TABLE ADD COLUMN`：SQLite 的 `ADD COLUMN` 不支持 `IF NOT EXISTS`，
  重复执行会直接报 `duplicate column name`，无法满足「迁移可重复执行」的约束。
  因此用 `post_categories` 表 + `post_id` 主键表达「一篇文章至多属于一个分类」，既保持幂等也不改写旧迁移
- `post_tags` 是文章与标签的多对多关联表；文章删除时两张关联表都 `ON DELETE CASCADE` 连带清理

**前台**

- 新增分类总览 `/categories`、分类文章页 `/categories/:slug`、标签总览 `/tags`、标签文章页 `/tags/:slug`
- 首页文章卡片与文章详情页展示分类与标签，全部可点击跳转；站点头部导航加入「分类 / 标签」入口
- 列表页（首页 / 分类页 / 标签页）统一走同一个分页实现：超范围页码回落到最后一页，每页条数上下限一致
- 列表页的分类与标签用两次批量查询补齐（`WHERE post_id IN (...)`），不是逐篇文章查询，避免 N+1

**后台**

- 新增 `/admin/taxonomy` 分类与标签管理页：新建、重命名、调整 slug、删除，并显示各自文章数与前台链接
- 文章编辑器新增「分类」单选下拉（可留空 = 不设分类）与「标签」逗号分隔输入框
  （支持中文逗号与顿号，带 `datalist` 提示已有标签），编辑时回填已选分类与已有标签
- 文章主体与分类/标签写入放在同一事务内，避免出现「文章存了但标签丢了」的中间状态
- 后台文章列表与 `/admin/taxonomy` 都按「全部文章（含草稿）」计数，前台一律只算已发布

**业务规则**

- 分类与标签的 slug 留空自动生成：中文名称**直接以中文作为 slug**（URL 会被浏览器编码，但可读性好），
  英文派生不出有意义片段时退化为 `tag-20260928-a1b2c3`；手填 slug 冲突返回 409 并回填输入
- 分类名称、标签名称均要求唯一，重名返回 409
- **分类下仍有文章（含草稿）时禁止删除**（409 并告知篇数），不做静默解绑；
  标签删除只解除关联，文章本身不受影响
- 标签对同一篇文章去重（不区分大小写），数量上限由 `SITE_MAX_TAGS_PER_POST` 控制，超限返回 400 且整篇文章不写库
- 写文章时填写的标签若不存在会自动创建，省去先去后台建标签的一步
- 前台分类页/标签页对不存在或已删除的分类/标签直接 404，而不是渲染空列表

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `migrations/003_taxonomy.sql` | 分类、标签、文章-分类、文章-标签四张表与索引 |
| `src/lib/slug.js` | 文章/分类/标签共用的 slug 生成规则（英文派生、中文兜底、时间戳兜底） |
| `src/db/transaction.js` | 事务助手，把「只由仓储调用组成」的函数包进一个事务 |
| `src/repositories/categories.repository.js`、`tags.repository.js` | 分类与标签的 SQL（含按已发布/全部两种口径计数） |
| `src/repositories/posts.repository.js` | 新增按分类/标签分页查询、批量取分类标签、设置分类、同步标签 |
| `src/services/taxonomy.service.js` | 分类/标签 CRUD、slug 与重名规则、删除占用保护、标签解析与同步 |
| `src/services/posts.service.js` | 列表与详情挂载分类标签；新增 `listByCategorySlug` / `listByTagSlug`；写入走事务 |
| `src/validation/taxonomy-input.js` | 分类/标签表单校验（slug 允许中文） |
| `src/validation/post-input.js` | 新增 `categoryId` 与 `tags` 字段校验 |
| `src/routes/site.routes.js` | 前台分类页与标签页路由 |
| `src/routes/admin.routes.js` | 分类标签管理路由；编辑器注入分类列表与标签候选 |
| `src/views/pages/taxonomies.ejs`、`taxonomy.ejs` | 前台分类/标签总览与文章列表 |
| `src/views/pages/admin/taxonomy.ejs` | 后台分类与标签管理页 |
| `src/views/pages/home.ejs`、`post.ejs`、`partials/header.ejs`、`pages/admin/editor.ejs`、`pages/admin/dashboard.ejs` | 分类标签展示、导航入口、编辑器表单 |
| `public/styles.css` | chip、分类标签列表、后台管理页样式；把「小屏隐藏表格第 3 列」限定到后台文章列表 |
| `src/config.js`、`.env.example` | 新增 `SITE_MAX_TAGS_PER_POST` 集中校验；`SITE_PAGE_SIZE` 补上 1-100 边界 |
| `src/db/seed.js` | 示例分类/标签与文章关联，幂等且不覆盖人工改动 |
| `tests/taxonomy.test.js`、`tests/admin-taxonomy.test.js` | 前台 7 个 + 后台 15 个用例（新增 22 个） |

不引入任何新的第三方依赖：slug 生成与中文兜底用 `node:crypto` + Unicode 属性正则，校验复用已有的 zod。

### 验证结果

- `npm run migrate` → `["001_init.sql","002_admin.sql","003_taxonomy.sql"]`；连续执行两次迁移脚本后表清单不变，
  `003` 本身可重复执行（已单独验证：绕过版本记录直接连跑两遍不报错）
- `npm test` → **63 个用例全部通过**（Day 1 的 8 个 + Day 2 的 33 个 + Day 3 新增 22 个）
- `npm start` 后 curl 冒烟 → **71 项检查全部通过**，覆盖：首页/分类页/标签页渲染与 chip、
  中文 slug 标签页（URL 编码后请求）、草稿在分类页不可见且不计入计数、未登录跳转登录页（页面 302 / 接口 401）、
  登录（错误口令 401 / 正确口令 303）、后台管理页、新建分类/标签、文章写入分类与标签后前台可见、
  编辑页回填分类与标签、名称重复 409、slug 冲突 409、删除占用分类 409（并提示篇数）、名称为空 400、
  重命名后新 slug 可访问且旧 slug 404、删除标签只解除关联、预览接口、转草稿后前台 404、
  分类被草稿占用时同样禁止删除、清空分类后可删除、删除分类不影响文章、登出后会话立即失效
- 服务端结构化日志可串联全过程：`admin.bootstrap` → `auth.login.failed` → `auth.login.succeeded` →
  `admin.category.created` → `admin.tag.created` ×2 → `admin.post.created` → `admin.category.updated` →
  `admin.tag.deleted` → `admin.post.status_changed` → `admin.post.updated` → `admin.category.deleted` → `auth.logout`
- 反向验证：故意去掉分类查询与计数里的 `status = 'published'` 过滤后，
  「草稿的分类不计入前台分类页与计数」用例立刻失败；恢复后 63/63 重新全绿
- 测试过程中发现并修复的真实问题：① `posts.service` 里残留了重复的 `slugifyTitle` 定义（改为统一从 `src/lib/slug.js` 引入）；
  ② 冒烟脚本首轮把文章 id 写死为 1，实际改到的是示例文章，说明「按 slug 反查 id」比依赖自增顺序可靠；
  ③ 小屏隐藏表格第 3 列的旧规则会误伤分类标签管理页，改为只作用于后台文章列表

### 已知限制

- 一篇文章只能有一个分类（`post_categories` 用 `post_id` 做主键强制），不支持多分类；标签则不限个数（受配置上限约束）
- 分类/标签的排序是「名称升序（ASCII 优先，中文在后）」，没有手工排序、没有层级（不支持父子分类）
- 中文 slug 的链接在浏览器地址栏会显示为 `%E6%8A%80%E6%9C%AF` 形式，可读性不如英文 slug；
  需要英文链接时请在创建时手填 slug
- 分类与标签的写操作仍只依赖 `SameSite=Lax` Cookie，**尚未加 CSRF token**；与 Day 2 一致，归入 Day 7 加固
- 标签的创建是「写文章时顺带创建」，因此输入错别字会静默产生一个新标签，后台目前只能重命名/删除，没有合并标签功能
- 分类页/标签页是普通分页列表，没有做「按年份归档」或「标签云按热度加权」的展示

### 下一步（Day 4）

关键词搜索：搜索页与搜索接口，标题/摘要/正文匹配，结果高亮与空结果提示，
并考虑与分类、标签筛选组合使用。

---

## Day 4（2026-09-29）· 关键词搜索

### 本次新增功能

**搜索实现（无新表）**

- 匹配范围是**标题 / 摘要 / 正文**三列，`LIKE` 子串匹配 + 参数绑定，**数据层零新表、零新依赖**
- 关键词按空白拆成多个词，**词与词之间是「且」**：`博客 日志` 要求两个词都出现，
  单个词只要命中三列中任意一列即可，避免多词搜索返回一大堆不相关结果
- 用户输入里的 `%` `_` `\` 全部转义并配 `ESCAPE`：搜「100%」就是找字面量 `100%`，
  不会被当成通配符（`100_` 不再等价于「100 加任意一个字符」）
- 相关度排序：**命中标题的词数 → 命中摘要的词数 → 发布时间倒序**，
  标题里有关键词的文章一定排在只在正文里出现的文章之前
- 关键词长度上限 `SITE_SEARCH_MAX_LENGTH`（默认 64）在服务层集中校验，超长直接 400；
  页码非法一律静默回落到第 1 页（与首页、分类页行为一致，不把 400 摔给翻页的用户）

**搜索页 `/search`**

- 表单含关键词输入框、分类下拉、标签下拉，可与关键词**组合筛选**（`?category=` / `?tag=`），
  并提供「清除筛选」链接
- 结果卡片展示高亮后的标题与正文片段；高亮用 `<mark>` 包裹，**先按原文切分、再分别做 HTML 转义**，
  所以既不会漏掉 `a&b` 这类含特殊字符的关键词，也不会把用户输入里的 `<script>` 注入页面
- 结果片段优先取「命中的那一段」：摘要命中就展示摘要，否则从正文里截取**首次命中位置附近**的上下文，
  让用户一眼看出为什么这篇会被搜出来
- 三种状态各有明确提示：未输入关键词 → 引导输入；有命中 → 显示总数并分页；无命中 → 空结果提示 +
  分类/标签浏览入口
- 翻页链接完整保留关键词与筛选条件；越界页码回落到最后一页
- 筛选条件（分类/标签）不存在时返回 404，而不是渲染一个空列表掩盖输入错误

**搜索接口 `/api/search`**

- 与搜索页共用同一套服务层实现，返回 JSON：`query` / `submitted` / `filters` / `total` / `pagination` / `items`
- `items` 里同时给出纯文本 `title` 与「已转义 + 已高亮」的 `titleHtml` / `excerptHtml`，
  前端脚本可直接渲染高亮，无需自己再实现一遍匹配逻辑
- 只返回已发布文章；参数错误走全局错误处理器返回 JSON 错误体（`/api/*` 不会被塞 HTML 错误页）

**为什么没有第 4 个迁移文件**

搜索不需要新表，也不需要新索引：`LIKE '%关键词%'` 无法命中 B-tree 索引，
加索引解决不了问题。数据量到「全文检索」量级时更合适的做法是
SQLite FTS5 + `trigram` 分词（对中文子串搜索友好），但会引入虚拟表、同步触发器与
另一套 MATCH 语法，对当前规模属于过度设计，因此本轮刻意不做，见「已知限制」。

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `src/lib/like.js` | `LIKE` 通配符（`%` `_` `\`）转义与「包含」pattern 构造 |
| `src/lib/highlight.js` | 关键词拆分、HTML 转义、`<mark>` 高亮、命中位置附近的片段截取 |
| `src/services/search.service.js` | 关键词归一化与长度校验、分类/标签筛选解析、结果片段选择、分页编排 |
| `src/repositories/posts.repository.js` | 新增 `buildSearchClause` 与 `countPublishedBySearch` / `findPublishedPageBySearch`（含相关度 ORDER BY） |
| `src/validation/search-input.js` | 查询参数清洗与归一化（zod：字符串收敛、页码回落） |
| `src/routes/search.routes.js` | 搜索页路由与 JSON 搜索接口 |
| `src/services/posts.service.js` | 抽出 `markdownToPlainText` 供摘要与搜索片段复用；`paginatePublished` 对外导出，`decorate` 支持按需带出正文纯文本 |
| `src/views/pages/search.ejs`、`src/views/partials/search-form.ejs` | 搜索页与可复用搜索表单（关键词 + 分类/标签筛选） |
| `src/views/partials/header.ejs` | 站点头部增加「搜索」入口 |
| `public/styles.css` | 搜索表单、筛选器、`<mark>` 高亮样式 |
| `src/config.js`、`.env.example` | 新增 `SITE_SEARCH_MAX_LENGTH`（8-200，默认 64）集中校验 |
| `src/app.js` | 挂载搜索路由（页面 + `/api/search`） |
| `tests/highlight.test.js`、`tests/search.test.js`、`tests/search-api.test.js`、`tests/helpers/search-fixtures.js` | 纯函数 9 个 + 页面 13 个 + 接口 6 个用例（新增 28 个）与搜索固定数据 |

不引入任何新的第三方依赖：LIKE 转义、分词、高亮、片段截取全部用 `node:` 内置能力与既有 zod 实现。

### 验证结果

- `npm run migrate` → `["001_init.sql","002_admin.sql","003_taxonomy.sql"]`，
  本轮**没有新增迁移文件**（搜索复用 `posts` 表，理由见上）
- `npm test` → **91 个用例全部通过**（Day 1 的 8 个 + Day 2 的 33 个 + Day 3 的 22 个 + Day 4 新增 28 个）
- `npm start` 后 curl 冒烟 → **58 项检查全部通过**，覆盖：首页/详情页/健康检查回归、`/search` 无关键词提示、
  `?q=迭代` 命中数与 `<mark>` 高亮、3 篇命中分 2 页且翻页链接保留关键词、越界页码回落、
  空结果提示与浏览入口、关键词 + 分类筛选、筛选条件不存在 404、超长关键词 400、
  `/api/search` 的 JSON 结构 / `submitted=false` / 404 / 400 错误体，
  以及后台联动全流程：登录 → 新建草稿（搜索不到）→ 发布（立即搜到且高亮）→ 删除（搜索恢复为空）
- 服务端结构化日志可串联全过程：`request.completed` → `auth.login.succeeded` →
  `admin.post.created` → `admin.post.status_changed` → `admin.post.deleted`
  （4 条 `request.failed` 全部来自刻意构造的 404/400 负向用例）
- 反向验证（变异测试，逐个破坏后确认用例真的会红，再恢复）：
  ① 去掉搜索 SQL 里的 `status = 'published'` → 5 个用例失败（含两个草稿不可见用例）；
  ② 去掉 `escapeLikePattern` 的转义 → 2 个用例失败（`100_` 被当成通配符）；
  ③ 去掉相关度排序里的标题命中项 → 3 个用例失败（标题命中的文章不再排第一）；恢复后 91/91 重新全绿
- 写用例过程中修正的自身错误：断言里直接写未高亮的标题（`分页测试：标题命中`）永远匹配不到，
  因为渲染出来是 `<mark>分页测试</mark>：标题命中`——这类断言必须避开被高亮切开的字符串

### 已知限制

- 用的是 `LIKE` 子串匹配，**没有分词、没有词干还原、没有同义词**：
  搜「迭代」不会命中「迭代式」以外的形态变化，也不会命中只用「每日」表述的文章
- 多关键词是「且」的关系，**没有 OR / 排除词 / 短语引号**语法；也不支持按作者、时间范围筛选
- 相关度只有「标题命中数 → 摘要命中数 → 时间」三级，**没有 TF-IDF 之类的权重**，
  也没有记录搜索词热度、没有搜索历史与联想补全
- `LIKE '%词%'` 无法使用索引，是全表扫描；当前规模（几十到几千篇）无感，
  文章量上去后应改为 FTS5 + `trigram` 分词，届时需要新增迁移与同步触发器
- 搜索页与接口是**公开无鉴权的**，且**没有限流**：恶意构造的超长/高频请求只能靠
  `SITE_SEARCH_MAX_LENGTH` 与后续 Day 7 的限流来挡
- 结果片段用固定 180 字截取，命中位置在很靠后时仍会丢掉一部分上下文；摘要与正文都未命中时
  退化为正文开头（此时列表里可能看不到高亮，只有标题能看到）

### 下一步（Day 5）

评论：游客提交评论、审核状态（待审 / 通过 / 拒绝）、后台审核列表，
以及基础防灌水（提交频率限制、字数与必填校验、蜜罐字段）。

---

## Day 5（2026-09-30）· 评论

### 本次新增功能

**数据模型（`migrations/004_comments.sql`）**

- 新增 `comments` 表：`post_id`（级联文章）、昵称 / 邮箱 / 网址、正文、状态、来源摘要、审核人与审核时间
- `status` 用 `CHECK (status IN ('pending','approved','rejected'))` 在**数据库层**兜底，
  即使服务层被绕过也写不出非法状态
- 不存明文 IP：只存 SHA-256 加盐摘要 `ip_hash`，够做「同一来源的频率限制」，不落库可反查的个人信息
- 文章删除连带清理评论（`ON DELETE CASCADE`）；管理员账号删除只置空 `moderated_by`（`SET NULL`），
  历史审核记录不丢
- 三个索引分别服务于：前台按文章取已通过评论、后台按状态筛选、防灌水按来源统计

**前台**

- 文章详情页底部新增评论区：已通过评论列表（昵称可带外链、时间、正文保留换行）+ 提交表单
- 首页卡片与详情页 meta 显示「N 条评论」，只统计**已通过**的评论
- 提交成功后跳回 `?comment=submitted#comments` 并提示「通过审核后会显示在这里」；
  校验失败则**原地渲染详情页**并保留已填内容（评论表单在正文下方，跳走会丢输入）
- 评论正文不做 Markdown，走 EJS 的 `<%= %>` 转义，`<script>` 只会显示成文本

**后台审核**

- 新增 `/admin/comments`：待审排在最前，支持 `?status=pending|approved|rejected` 筛选与分页，
  显示各状态计数、所属文章链接、来源标识与审核人
- 一键「通过 / 拒绝」，以及带确认的删除；操作后回到列表并保留当前筛选条件
- 后台首页新增「评论审核（N 待审）」入口角标，待审不会被忽略
- 审核写入 `moderated_at` 与 `moderated_by`；**不允许改回「待审」**（避免列表状态漂移）

**业务规则**

- 新评论一律是 `pending`，前台完全不可见；只有通过审核才展示（草稿、已拒绝同理不展示）
- 只有**已发布**文章能评论：草稿与不存在的文章提交评论返回 404

**基础防灌水（四道关卡，按成本从低到高）**

1. **蜜罐字段**：表单里有一个 CSS 隐藏、对屏幕阅读器不可见的 `homepage` 输入框，
   真人不会填，填了即判定为脚本。命中时**对外伪装成成功**（303 + 成功提示）但**不落库**，
   让脚本以为得手而不再换策略重试
2. **必填与字数校验**：昵称必填（≤40），邮箱可选但必须合法，网址必须以 `http(s)://` 开头；
   正文长度由 `COMMENT_MIN_LENGTH` / `COMMENT_MAX_LENGTH` 约束
3. **外链数量上限**：正文里的 `http(s)` 链接超过 `COMMENT_MAX_LINKS` 视为推广垃圾，返回 400
4. **频率限制 + 重复内容**：同一来源（IP 摘要）在 `COMMENT_RATE_WINDOW_MINUTES` 窗口内
   最多提交 `COMMENT_RATE_LIMIT` 条，超出返回 **429**；窗口内重复提交完全相同的内容返回 **409**。
   时间窗口由 SQLite 的 `datetime('now', '-10 minutes')` 计算，不混用 JS 时间格式；
   限流按来源统计而非按文章，**换一篇文章也绕不过**

### 主要文件

| 文件 | 作用 |
| --- | --- |
| `migrations/004_comments.sql` | `comments` 表、CHECK 约束与三个索引 |
| `src/config.js` | 新增 `COMMENT_MIN_LENGTH` / `COMMENT_MAX_LENGTH` / `COMMENT_RATE_LIMIT` / `COMMENT_RATE_WINDOW_MINUTES` / `COMMENT_MAX_LINKS` 集中校验（含 min < max 交叉校验） |
| `src/errors.js` | 新增 `TooManyRequestsError`（429 / `rate_limited`） |
| `src/lib/ip.js` | 来源 IP 的加盐 SHA-256 摘要，只用于限流 |
| `src/lib/comment-text.js` | 正文换行归一化与外链计数 |
| `src/repositories/comments.repository.js` | 评论 SQL：前台查询、批量计数、后台分页、审核、限流与重复检测 |
| `src/services/comments.service.js` | 提交流程、四道防灌水规则、审核列表、通过/拒绝/删除 |
| `src/validation/comment-input.js` | 评论表单 zod 校验，错误映射到具体表单项 |
| `src/routes/comments.routes.js` | 游客提交路由 + `renderPostPage`（详情页 GET 与提交失败回填共用） |
| `src/routes/site.routes.js` | 详情页改走 `renderPostPage` 并透传 `?comment=submitted` |
| `src/routes/admin.routes.js` | `/admin/comments` 审核列表、通过/拒绝、删除；后台首页注入待审计数 |
| `src/views/pages/post.ejs` | 评论区：列表 + 表单 + 蜜罐字段 |
| `src/views/pages/admin/comments.ejs` | 后台审核列表 |
| `src/views/pages/admin/dashboard.ejs`、`src/views/pages/home.ejs` | 待审入口角标；首页评论数 |
| `src/services/posts.service.js`、`src/repositories/posts.repository.js` | 列表/详情挂载已通过评论数（批量查询，避免 N+1） |
| `src/db/seed.js` | 示例评论：覆盖待审 / 已通过 / 已拒绝，含一条 4 外链的垃圾样本；幂等 |
| `public/styles.css` | 评论区、评论表单、蜜罐隐藏、状态徽章、后台审核列表样式 |
| `.env.example` | 5 个评论相关配置项的说明与默认值 |
| `tests/comments.test.js`、`tests/admin-comments.test.js`、`tests/comment-antispam.test.js`、`tests/helpers/isolated-app.js` | 前台 12 + 后台 10 + 防灌水 5 个用例（新增 27 个）与独立进程/独立配置的测试脚手架 |

不引入任何新的第三方依赖：IP 摘要用 `node:crypto`，正文处理与外链统计用正则，校验复用已有的 zod。

### 验证结果

- `npm run migrate` → `["001_init.sql","002_admin.sql","003_taxonomy.sql","004_comments.sql"]`，
  重复执行不重跑（幂等）
- `npm test` → **118 个用例全部通过**（Day 1 的 8 + Day 2 的 33 + Day 3 的 22 + Day 4 的 28 + Day 5 新增 27）
- `npm start` 后 curl 冒烟 → **58 项检查全部通过**，覆盖：健康检查、首页/详情页回归、
  已通过评论可见且待审/已拒绝不可见、评论数显示、提交成功 303 + 重定向 + 落库 + 待审不可见、
  昵称/字数/邮箱/网址/外链五类校验、蜜罐伪成功且不落库、重复内容 409、频率限制 429、
  未登录 302、错误口令 401、正确口令 303 + `HttpOnly; SameSite=Lax` Cookie、
  审核页渲染与状态筛选、后台首页角标、通过（前台立即可见）、拒绝（前台不可见）、
  改回待审 400、删除（条数减少）、登出后会话立即失效
- 服务端结构化日志可串联全过程：`comment.submitted` → `comment.spam_rejected` →
  `auth.login.succeeded` → `admin.comment.moderated` ×2 → `admin.comment.deleted`
- 反向验证（变异测试，逐个破坏后确认用例真的会红，再恢复）：
  ① 去掉前台评论查询的 `status = 'approved'` → 5 个用例失败（待审/已拒绝评论泄漏到前台）；
  ② 去掉频率限制判断 → 2 个用例失败（超限不再 429）；
  ③ 去掉蜜罐判定 → 1 个用例失败（脚本评论被写库）；恢复后 118/118 重新全绿
- 实现过程中发现并修复的真实缺陷：表单里的蜜罐字段名是 `homepage`，
  服务层却读 `input.honeypot`，导致蜜罐**完全失效**（评论被正常写库）。
  是「蜜罐命中未落库」这条断言把它逼出来的——在路由层做了显式字段映射

### 已知限制

- 评论是**平铺列表，没有楼层回复**（无 `parent_id`），也没有点赞、编辑与邮件通知
- 限流按 IP 摘要统计，同一 NAT / 代理出口下的正常用户会被一起限流；
  且它记在进程内 SQLite 里，多实例部署时各实例独立计数（真正的限流归入 Day 7）
- 时间窗口靠 SQLite 的 `datetime('now')`，重启服务不会清空额度（因为落在库里），
  但改配置窗口需要重启才生效
- 后台写操作仍只依赖 `SameSite=Lax` Cookie，**尚未加 CSRF token**；
  评论提交接口也**没有图形验证码**，蜜罐只能挡住低级脚本（均归入 Day 7 加固）
- 没有评论分页：单篇文章最多展示 200 条已通过评论（超出的不显示）
- 邮箱与网址目前只做格式校验，**不做邮箱验证**，邮箱也不在前台展示（仅后台可见）
- 拒绝评论不会通知提交者，也没有「拒绝原因」字段

### 下一步（Day 6）

站点体验：归档页（按年份/月份）、RSS、sitemap、SEO meta 与站点配置页。
