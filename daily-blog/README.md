# daily-blog · 每日迭代的博客项目

以「每天一个可交付小目标」的方式构建的个人博客。技术栈：Node.js 22 + Express 5 + SQLite（better-sqlite3）+ EJS 服务端渲染。

- 分支纪律：**全程只使用一个分支 `iter/2026-09-25`**，所有提交都放在这个分支里。
- 迭代记录：见 [ITERATIONS.md](./ITERATIONS.md)。

## 快速开始

```bash
cd daily-blog
npm install          # 安装依赖
cp .env.example .env # 可选：按需修改配置（不提交 .env）
npm run migrate      # 执行数据库迁移（启动时也会自动执行）
npm run seed         # 写入 3 篇示例文章 + 示例分类标签（已存在时只补齐缺失的关联）
npm start            # 启动服务，默认 http://127.0.0.1:3000
```

其他命令：

```bash
npm run dev          # 开发模式（文件变化自动重启）
npm run reset        # 删除本地库文件并重新迁移 + 填充示例数据 + 同步管理员账号
npm test             # 运行全部测试（node:test + supertest）
```

## 后台管理

1. 在 `daily-blog/.env` 中设置 `ADMIN_USERNAME` 与 `ADMIN_PASSWORD`（至少 8 位），然后 `npm start`；
   启动时会按这两个值自动创建或同步管理员账号，**改密码 = 改 `.env` 后重启**。
2. 访问 <http://127.0.0.1:3000/admin/login> 登录（未设置 `ADMIN_PASSWORD` 时后台登录关闭，前台不受影响）。
3. `/admin` 是文章列表（草稿与已发布都在内），可新建、编辑、删除，并一键切换「发布 / 转为草稿」。
4. `/admin/taxonomy` 管理分类与标签：新建、重命名、调整 slug、删除，并显示各分类/标签的文章数。
5. 编辑器支持 Markdown 实时预览（复用前台同一套渲染与清洗规则）与 `Ctrl / Cmd + S` 保存，
   并可选择分类、填写标签（标签不存在会自动创建）。

草稿在前台完全不可见：首页列表与 `/posts/:slug` 详情页都只返回已发布文章。

| 端点 | 说明 |
| --- | --- |
| `GET /admin/login` | 登录页 |
| `POST /admin/login` | 校验口令并写入会话 Cookie |
| `POST /admin/logout` | 删除服务端会话并清除 Cookie |
| `GET /admin` | 后台文章列表，支持 `?status=draft\|published` 与 `?page=` |
| `GET /admin/posts/new`、`POST /admin/posts` | 新建文章 |
| `GET /admin/posts/:id/edit`、`POST /admin/posts/:id` | 编辑文章 |
| `POST /admin/posts/:id/status` | 切换草稿 / 发布（`status=draft\|published`） |
| `POST /admin/posts/:id/delete` | 删除文章 |
| `GET /admin/taxonomy` | 分类与标签管理页 |
| `POST /admin/taxonomy/categories`、`POST /admin/taxonomy/categories/:id` | 新建 / 重命名分类 |
| `POST /admin/taxonomy/categories/:id/delete` | 删除分类（分类下仍有文章时返回 409） |
| `POST /admin/taxonomy/tags`、`POST /admin/taxonomy/tags/:id` | 新建 / 重命名标签 |
| `POST /admin/taxonomy/tags/:id/delete` | 删除标签（同时解除与文章的关联，不删除文章） |
| `POST /admin/api/preview` | 编辑页 Markdown 预览接口，返回清洗后的 HTML |

后台页面未登录时跳转登录页并带 `?next=`；`/admin/api/*` 未登录返回 401 JSON。

## 分类与标签

- 分类是「多对一」归属：一篇文章至多属于一个分类；标签是「多对多」标记，一篇文章可以有多个。
- 前台提供 `/categories`（分类总览）、`/categories/:slug`、`/tags`（标签总览）、`/tags/:slug`；
  首页与文章详情页都会展示分类与标签，并链接到对应页面。
- **前台只统计与展示已发布文章**：草稿不出现在分类页/标签页，也不计入数量。
- 在文章编辑器里：分类是单选下拉（可留空 = 不设分类），标签是逗号分隔输入框
  （支持中文逗号、顿号），填写的标签若不存在会自动创建，一篇最多 `SITE_MAX_TAGS_PER_POST` 个。
- slug 留空时自动生成：中文名称直接以中文作为 slug（URL 会被浏览器编码，但可读性好），
  英文派生不出有意义片段时退化为 `tag-20260928-a1b2c3` 这类随机串；手填 slug 冲突返回 409。
- 分类名称、标签名称都要求唯一；**分类下仍有文章（含草稿）时不允许删除**，避免文章失去归属。

| 端点 | 说明 |
| --- | --- |
| `GET /categories` | 分类总览（含各分类已发布文章数） |
| `GET /categories/:slug` | 该分类下已发布文章（支持 `?page=`） |
| `GET /tags` | 标签总览 |
| `GET /tags/:slug` | 该标签下已发布文章（支持 `?page=`） |

## 目录结构

```text
daily-blog/
├── migrations/            # SQL 迁移，按文件名顺序执行，可重复运行
├── public/                # 静态资源（样式、后台编辑器脚本）
├── scripts/               # 迁移 / 填充 / 重置脚本
├── src/
│   ├── app.js             # 应用组装：中间件与路由注册
│   ├── server.js          # 进程入口：监听端口 + 管理员账号同步 + 优雅停机
│   ├── config.js          # 集中配置，启动时校验
│   ├── logger.js          # 结构化 JSON 日志（带 requestId）
│   ├── errors.js          # 类型化错误体系
│   ├── db/                # 数据库连接、迁移执行、事务助手、示例数据
│   ├── lib/               # 通用小工具（Cookie 读写、slug 生成）
│   ├── repositories/      # 数据访问层（只写 SQL）
│   ├── services/          # 业务规则层（不依赖 HTTP 对象）
│   ├── validation/        # 请求表单校验（zod）
│   ├── routes/            # 路由层（解析请求 → 调用服务 → 渲染）
│   ├── middlewares/       # 请求上下文、会话与鉴权、404、全局错误处理
│   └── views/             # EJS 模板（layout + pages + partials）
└── tests/                 # node:test 测试用例
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DB_PATH` | `./data/blog.db` | SQLite 数据库文件路径 |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `SITE_TITLE` | `每日迭代博客` | 站点标题 |
| `SITE_DESCRIPTION` | `以每日迭代方式构建的个人博客` | 站点描述 |
| `SITE_AUTHOR` | `admin` | 默认作者 |
| `SITE_PAGE_SIZE` | `10` | 列表每页文章数（1-100，首页 / 分类页 / 标签页共用） |
| `SITE_MAX_TAGS_PER_POST` | `8` | 一篇文章最多可设置的标签数（1-50） |
| `ADMIN_USERNAME` | `admin` | 管理员用户名，3-32 位字母/数字/`_.-` |
| `ADMIN_PASSWORD` | 空 | 管理员口令，**至少 8 位**；留空则后台登录关闭 |
| `SESSION_COOKIE_NAME` | `daily_blog_admin` | 会话 Cookie 名 |
| `SESSION_TTL_HOURS` | `12` | 会话有效期（1-720 小时） |
| `SESSION_COOKIE_SECURE` | 生产环境 `true` | 是否只在 HTTPS 下发送会话 Cookie |

配置缺失或取值非法时，进程在启动阶段直接退出，不会带着错误配置继续运行。
生产环境额外强制：必须设置 `ADMIN_PASSWORD`，且不能沿用 `.env.example` 里的占位值。

## 健康检查

| 端点 | 说明 |
| --- | --- |
| `GET /health` | 存活探针，返回进程运行时长与 requestId |
| `GET /ready` | 就绪探针，额外执行一次数据库查询 |
