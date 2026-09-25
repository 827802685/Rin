# 迭代记录

单分支开发：所有迭代提交都放在 `iter/2026-09-25` 分支。每天结束时必须满足验收标准：**能启动、页面可访问、核心操作流程走通**。

## 整体路线图

| 天 | 主题 | 优先级 | 交付内容 | 状态 |
| --- | --- | --- | --- | --- |
| Day 1 | 最小可运行版本 | P0 | 项目骨架、文章模型、列表页、详情页、健康检查、日志与错误处理 | ✅ 已完成 |
| Day 2 | 后台管理与文章编辑 | P0 | 管理员登录、Markdown 编辑、新建/编辑/删除、草稿与发布 | ⬜ 待办 |
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
