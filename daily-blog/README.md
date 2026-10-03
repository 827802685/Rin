# daily-blog · 每日迭代的博客项目

以「每天一个可交付小目标」的方式构建的个人博客。技术栈：Node.js 22 + Express 5 + SQLite（better-sqlite3）+ EJS 服务端渲染。

- 分支纪律：**全程只使用滚动工作分支 `iter`**，所有迭代提交都放在这个分支（每 5 个迭代日合并进 `main` 一次）。
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
npm run backup       # 备份数据库到 backups/（VACUUM INTO，含 WAL 未合并的内容）
npm run restore -- <备份文件名> --yes   # 从备份恢复（会先给当前库存一份快照）
npm run cleanup      # 清理测试遗留的 data/test-*.db 与过期的限流记录
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
6. `/admin/comments` 审核游客评论：通过、拒绝、删除，待审数量会显示在后台首页的入口上。

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
| `GET /admin/comments` | 评论审核列表，支持 `?status=pending\|approved\|rejected` 与 `?page=` |
| `POST /admin/comments/:id/status` | 通过 / 拒绝评论（`status=approved\|rejected`） |
| `POST /admin/comments/:id/delete` | 删除评论 |
| `GET /admin/settings` | 站点配置页（标题、描述、作者、站点地址、每页条数、RSS、收录开关） |
| `POST /admin/settings` | 保存站点配置，立即生效 |
| `POST /admin/settings/reset` | 恢复默认配置（清空自定义项） |

后台页面未登录时跳转登录页并带 `?next=`；`/admin/api/*` 未登录返回 401 JSON。

## 评论

- 文章详情页底部可以匿名评论（昵称必填，邮箱与网址选填），提交后进入**待审**，
  前台看不到；管理员在 `/admin/comments` 通过后才会公开显示。
- 只有**已发布**文章能评论；草稿与不存在的文章提交评论返回 404。
- 审核只有「通过 / 拒绝」两档，不允许改回待审；审核人与审核时间会记在评论上。
- 基础防灌水：表单蜜罐字段（填了即判定为脚本，对外伪装成功但**不落库**）、
  必填与字数校验、外链数量上限、同一来源在 `COMMENT_RATE_WINDOW_MINUTES` 分钟内
  最多提交 `COMMENT_RATE_LIMIT` 条（超出 429）、窗口内重复内容（409）。
- IP 不落库明文，只存加盐摘要用于限流。

| 端点 | 说明 |
| --- | --- |
| `POST /posts/:slug/comments` | 游客提交评论，成功跳回 `?comment=submitted#comments` |

## 归档

- `/archive` 按「年 → 月」倒序列出全部**已发布**文章，点年份进入 `/archive/:year` 只看那一年。
- 草稿不进归档：归档是给读者看的内容地图，里面每一篇都应该是点开就能读的。
- 年份不存在（那一篇都没有）返回 404；年份不是 4 位数字返回 400。

| 端点 | 说明 |
| --- | --- |
| `GET /archive` | 全站归档（按年分组，年内按月分组） |
| `GET /archive/:year` | 单年归档，例如 `/archive/2026` |

## 订阅与 SEO

- `/feed.xml` 是 RSS 2.0 订阅源，输出最近 `SITE_FEED_SIZE` 篇已发布文章（草稿绝不外泄）；
  `SITE_FEED_MODE=full` 时输出渲染后的全文，默认只输出摘要。
- `/sitemap.xml` 覆盖首页、归档（总览 + 各年份）、分类、标签与全部已发布文章；只写 `<loc>` 与 `<lastmod>`。
- `/robots.txt` 屏蔽 `/admin` 与 `/search`，并给出 sitemap 地址；开启 `SITE_ROBOTS_NOINDEX` 后整站 `Disallow: /`。
- 每个页面都输出 canonical、Open Graph、Twitter card；文章页额外输出 `article:published_time` / `article:tag`。
- canonical 与订阅源的绝对地址优先级：后台「站点地址」→ `SITE_BASE_URL` → 请求地址（Host 头会被严格校验，
  伪造的 Host 不会写进 canonical）。**反向代理后面部署必须显式配置站点地址**。

| 端点 | 说明 |
| --- | --- |
| `GET /feed.xml` | RSS 2.0 订阅源（`application/rss+xml`） |
| `GET /sitemap.xml` | 站点地图（`application/xml`） |
| `GET /robots.txt` | 爬虫规则 + sitemap 地址 |

## 站点配置

- `/admin/settings` 可以在线改站点标题、描述、默认作者、站点地址、每页条数、RSS 条数与正文方式、是否禁止收录。
- 保存后**立即生效，无需重启**；这些值存在 `site_settings` 表里，覆盖环境变量。
- 「恢复默认配置」会清空这张表，全部回落到环境变量的取值（不会写回一份默认快照）。
- `SITE_MAX_TAGS_PER_POST` 与 `SITE_SEARCH_MAX_LENGTH` 属于运行期资源约束，只由环境变量控制。

| 端点 | 说明 |
| --- | --- |
| `GET /admin/settings` | 站点配置页 |
| `POST /admin/settings` | 保存配置（校验失败 400 并回填输入） |
| `POST /admin/settings/reset` | 恢复默认配置 |

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

## 搜索

- `/search` 是搜索页：一个输入框 + 分类/标签两个筛选下拉，可组合使用；结果里的关键词用 `<mark>` 高亮。
- `/api/search` 是同功能的 JSON 接口，与页面共用同一套服务层实现。
- 匹配范围是**标题、摘要、正文**；**多个关键词用空格分隔，需要同时命中**（`博客 日志` 会同时要求两个词出现）。
- 结果按相关度排序：标题里命中越多越靠前，其次看摘要，最后按发布时间。
- 关键词里的 `%` `_` 按字面量处理（不会被当成 SQL 通配符）；**草稿永远不会出现在搜索结果里**。
- 空结果会给提示与「按分类 / 标签浏览」入口；筛选用的分类/标签不存在时返回 404。
- 关键词超长（默认 64 字，可配）返回 400。

| 端点 | 说明 |
| --- | --- |
| `GET /search` | 搜索页，参数 `?q=`（关键词）、`?page=`、`?category=`、`?tag=` |
| `GET /api/search` | 搜索接口，返回 JSON（含 `titleHtml` / `excerptHtml` 高亮片段） |

## 安全与限流（Day 7）

**写请求必须有 CSRF 令牌。** 令牌由中间件按请求签发、写入 HttpOnly Cookie，
表单里回传同一个值（`<input type="hidden" name="_csrf">`），或用 `X-CSRF-Token` 头
（后台预览这类 fetch 走头）。三者不一致即 403：`表单已过期或来源不可信`。
游客的评论表单同样受保护——攻击者读不到也写不进受害者的 Cookie，构造不出能匹配的表单。

**响应头默认全开**：`nosniff`、`X-Frame-Options: DENY`、严格 CSP、
`Referrer-Policy`、`Permissions-Policy`、COOP/CORP，并去掉 `X-Powered-By`。
CSP 里**没有** `unsafe-inline`：为此 Day 2-6 写在标签上的 `onsubmit="return confirm(...)"`
全部改成了 `data-confirm` 属性 + 外部脚本。
`Strict-Transport-Security` 只在请求确实走 HTTPS（含 `X-Forwarded-Proto: https`）时发送，
且需要先配置 `SECURITY_HSTS_MAX_AGE`。

**限流分两个桶**，命中一律 429 + `Retry-After`：

| 桶 | 覆盖范围 | 默认额度 | 说明 |
| --- | --- | --- | --- |
| `general` | 全站（静态资源除外） | 300 次 / 60 秒 | 挡脚本扫站；样式与脚本**不**占额度，否则打开一个后台页就耗掉十几次 |
| `login` | `POST /admin/login` | 10 次 / 10 分钟 | 登录成功会清零该来源的失败计数，不惩罚刚登录成功的人 |

计数落在 SQLite（`rate_limit_hits`），重启不清零；来源只存加盐 SHA-256 摘要，库里没有明文 IP。
响应带 `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`。

## 反向代理与多实例（Day 8）

**部署在代理后面必须配 `TRUST_PROXY`，否则限流会把所有访客算成同一个来源**（代理地址），
一个人的额度耗尽，所有人一起 429。

| 取值 | 含义 | 何时用 |
| --- | --- | --- |
| 留空 / `false` / `0` | 不信任任何代理（默认） | 直接暴露在公网、本机开发 |
| `1`、`2`… | 信任这么多跳 | **推荐**：一层 Nginx / Caddy 填 `1`，两层填 `2` |
| `127.0.0.1,10.0.0.0/8,loopback` | 只信任列表里的地址 | 代理地址固定时最精确 |
| `true` | 信任 `X-Forwarded-For` 最左侧 | 只在确认前置网关会覆写客户端自带的 XFF 时用 |

跳数要**等于代理层数**：`X-Forwarded-For: 客户端, 代理1` 配 `1` 只拿到 `代理1`。
客户端自己加一段伪造地址骗不过跳数（多出来的那段会被忽略），但 `true` 会认最左侧，因此可被伪造。

配完之后用 `curl /health` 现场确认，它会回传本实例的解析结果：

```jsonc
{
  "status": "ok",
  "instanceId": "web-1",          // 多实例时区分进程
  "trustProxy": { "enabled": true, "mode": "hops", "label": "1 跳" },
  "clientIp": "203.0.113.9",      // 本请求被解析成哪个客户端
  "rateLimit": { "store": "sqlite", "shared": true, "dbPath": "./data/rate-limit.db" }
}
```

多实例部署还需要两件事：

1. **共享限流额度**：把 `RATE_LIMIT_DB_PATH` 指向同一个库文件（同一主机上的多个实例即可共享；
   SQLite 的跨进程锁负责并发写）。`RATE_LIMIT_STORE=memory` 则退回进程内计数，重启清零、实例间不共享。
2. **会话与配置**：会话、站点配置、文章数据都在库里，多实例天然一致；CSRF 用双提交 Cookie，无服务端状态。

Nginx 参考：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host              $host;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

同时建议显式设置 `SITE_BASE_URL`（canonical / RSS / sitemap 用），
不要靠请求头推断——容器内部地址会被写进站点地图。

## 备份与恢复

- `npm run backup` 用 SQLite 的 `VACUUM INTO` 生成 `backups/blog-YYYYMMDD-HHMMSS.db`。
  **不用 `cp data/blog.db`**：WAL 模式下最新数据还在 `-wal` 里，直接复制主库拿到的是旧快照。
- 超过 `BACKUP_KEEP`（默认 10）份会自动删掉最旧的；同一秒重复备份会自动加序号，不会互相覆盖。
- `npm run restore -- <文件名> --yes` 的**执行顺序是安全的**：
  先校验备份完整性（坏文件根本碰不到生产库）→ 再给当前库存一份 `pre-restore-*` 快照 → 最后才覆盖。
  没加 `--yes` 时只打印用法和可用备份，不动任何文件。
- 备份产物目录 `backups/` 已被 gitignore。

`npm run cleanup` 负责清理测试遗留的 `data/test-*.db`（测试进程退出时也会自行删除）
与过期的限流记录；加 `--dry-run` 可先看会删什么。

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
│   ├── lib/               # 通用小工具（Cookie 读写、slug 生成、LIKE 转义、搜索高亮、IP 摘要与客户端地址、评论正文处理、XML、绝对地址、CSRF 令牌、备份与恢复、限流存储）
│   ├── repositories/      # 数据访问层（只写 SQL）
│   ├── services/          # 业务规则层（不依赖 HTTP 对象）
│   ├── validation/        # 请求表单校验（zod）
│   ├── routes/            # 路由层（解析请求 → 调用服务 → 渲染）
│   ├── middlewares/       # 请求上下文、安全响应头、限流、CSRF、会话与鉴权、404、全局错误处理
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
| `SITE_SEARCH_MAX_LENGTH` | `64` | 搜索关键词长度上限（8-200），超出返回 400 |
| `SITE_BASE_URL` | `http://127.0.0.1:3000` | 站点对外地址（canonical / RSS / sitemap 用）；留空则按请求推断 |
| `TRUST_PROXY` | 空 | 信任的代理跳数 / 可信地址列表（默认不信任，见「反向代理与多实例」） |
| `INSTANCE_ID` | `pid-<进程号>` | 实例标识，多实例部署时区分进程（日志与 `/health`） |
| `RATE_LIMIT_STORE` | `sqlite` | 限流存储：`sqlite` / `memory`（进程内，不共享） |
| `RATE_LIMIT_DB_PATH` | 空 | 限流独立库文件；留空用主库，多实例指向同一文件即共享额度 |
| `SITE_FEED_SIZE` | `20` | RSS 输出的已发布文章条数（1-100） |
| `SITE_FEED_MODE` | `summary` | RSS 正文输出方式：`summary` / `full` |
| `SITE_ROBOTS_NOINDEX` | `false` | 全站禁止搜索引擎收录（noindex + `Disallow: /`） |
| `COMMENT_MIN_LENGTH` | `2` | 评论正文长度下限（1-100） |
| `COMMENT_MAX_LENGTH` | `1000` | 评论正文长度上限（20-5000） |
| `COMMENT_RATE_LIMIT` | `3` | 同一来源在窗口期内最多提交的评论数（1-50），超出 429 |
| `COMMENT_RATE_WINDOW_MINUTES` | `10` | 频率限制窗口（1-1440 分钟） |
| `COMMENT_MAX_LINKS` | `3` | 单条评论允许的外链数（0-10），超出 400 |
| `RATE_LIMIT_ENABLED` | `true` | 是否启用全局限流（限流按 `req.ip` 分来源，代理后面请配 `TRUST_PROXY`） |
| `RATE_LIMIT_MAX` | `300` | 全局额度：同一来源在窗口内的请求数（1-100000） |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | 全局限流窗口（1-86400 秒） |
| `LOGIN_RATE_MAX` | `10` | 登录额度：同一来源在窗口内的登录尝试数（1-1000） |
| `LOGIN_RATE_WINDOW_MINUTES` | `10` | 登录限流窗口（1-1440 分钟），登录成功即清零 |
| `SECURITY_HEADERS_ENABLED` | `true` | 安全响应头总开关（关掉后一个都不发） |
| `SECURITY_HSTS_MAX_AGE` | `0` | HSTS 的 max-age（秒），0 = 不发送；仅 HTTPS 请求下生效 |
| `CSRF_ENABLED` | `true` | CSRF 防护开关（自动化测试可关） |
| `CSRF_COOKIE_NAME` | `daily_blog_csrf` | 令牌 Cookie 名 |
| `BACKUP_DIR` | `./backups` | 备份产物目录 |
| `BACKUP_KEEP` | `10` | 备份保留份数（1-500），超出删最旧的 |
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
