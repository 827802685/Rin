# 迭代记录

单分支开发：所有迭代提交都放在 `iter/2026-09-25` 分支。每天结束时必须满足验收标准：**能启动、页面可访问、核心操作流程走通**。

## 整体路线图

| 天 | 主题 | 优先级 | 交付内容 | 状态 |
| --- | --- | --- | --- | --- |
| Day 1 | 最小可运行版本 | P0 | 项目骨架、文章模型、列表页、详情页、健康检查、日志与错误处理 | ✅ 已完成 |
| Day 2 | 后台管理与文章编辑 | P0 | 管理员登录、Markdown 编辑、新建/编辑/删除、草稿与发布 | ✅ 已完成 |
| Day 3 | 分类与标签 | P1 | 分类/标签数据模型、文章归类、分类页与标签页 | ⬜ 待办 |
| Day 4 | 搜索 | P1 | 关键词搜索页、搜索接口、结果高亮、空结果提示 | ⬜ 待办 |
| Day 5 | 评论 | P2 | 游客评论提交、审核状态、后台审核、基础防灌水 | ⬜ 待办 |
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
