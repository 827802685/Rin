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
npm run seed         # 写入 3 篇示例文章（posts 表为空时才写入）
npm start            # 启动服务，默认 http://127.0.0.1:3000
```

其他命令：

```bash
npm run dev          # 开发模式（文件变化自动重启）
npm run reset        # 删除本地库文件并重新迁移 + 填充示例数据
npm test             # 运行全部测试（node:test + supertest）
```

## 目录结构

```text
daily-blog/
├── migrations/            # SQL 迁移，按文件名顺序执行，可重复运行
├── public/                # 静态资源（样式）
├── scripts/               # 迁移 / 填充 / 重置脚本
├── src/
│   ├── app.js             # 应用组装：中间件与路由注册
│   ├── server.js          # 进程入口：监听端口 + 优雅停机
│   ├── config.js          # 集中配置，启动时校验
│   ├── logger.js          # 结构化 JSON 日志（带 requestId）
│   ├── errors.js          # 类型化错误体系
│   ├── db/                # 数据库连接、迁移执行、示例数据
│   ├── repositories/      # 数据访问层（只写 SQL）
│   ├── services/          # 业务规则层（不依赖 HTTP 对象）
│   ├── routes/            # 路由层（解析请求 → 调用服务 → 渲染）
│   ├── middlewares/       # 请求上下文、404、全局错误处理
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
| `SITE_PAGE_SIZE` | `10` | 列表每页文章数 |

配置缺失或取值非法时，进程在启动阶段直接退出，不会带着错误配置继续运行。

## 健康检查

| 端点 | 说明 |
| --- | --- |
| `GET /health` | 存活探针，返回进程运行时长与 requestId |
| `GET /ready` | 就绪探针，额外执行一次数据库查询 |
