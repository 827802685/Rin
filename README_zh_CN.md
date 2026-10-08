![封面](./docs/docs/public/rin-logo.png)

[English](./README.md) | 简体中文

![GitHub commit activity](https://img.shields.io/github/commit-activity/w/openRin/Rin?style=for-the-badge)
![GitHub branch check runs](https://img.shields.io/github/check-runs/openRin/Rin/main?style=for-the-badge)
![GitHub top language](https://img.shields.io/github/languages/top/openRin/Rin?style=for-the-badge)
![GitHub License](https://img.shields.io/github/license/openRin/Rin?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/openRin/Rin/deploy.yml?style=for-the-badge)

[![Discord](https://img.shields.io/badge/Discord-openRin-red?style=for-the-badge&color=%236e7acc)](https://discord.gg/JWbSTHvAPN)
[![Telegram](https://img.shields.io/badge/Telegram-openRin-red?style=for-the-badge&color=%233390EC)](https://t.me/openRin)

## 项目简介

Rin 是一个基于 Cloudflare 开发者平台构建的现代化、无服务器博客系统：一个 Worker 同时承载 API 与作为静态资源打包的前端，D1 作为 SQLite 数据库，R2（或任意兼容 S3 的存储）负责对象存储。仅需一个指向 Cloudflare 的域名即可部署你的个人博客，无需服务器运维。

## 在线演示

https://xeu.life

## 功能特性

- **用户认证与管理**：支持 GitHub OAuth 登录。首个注册用户自动成为管理员，后续用户作为普通成员加入。
- **内容创作**：通过丰富的编辑器撰写和编辑文章。
- **实时自动保存**：本地草稿实时自动保存，不同文章之间互不干扰。
- **隐私控制**：可将文章标记为“仅自己可见”，用作私有草稿或个人笔记，并支持跨设备同步。
- **图片管理**：通过拖放或粘贴上传图片至兼容 S3 的存储（如 Cloudflare R2），并自动生成链接。
- **自定义别名**：为文章设置友好的 URL，例如 `https://yourblog.com/about`。
- **不公开文章**：可选择将文章隐藏于首页列表之外。
- **友情链接**：添加友博客链接，后端每 20 分钟自动检查链接可用性并更新状态。
- **评论系统**：支持回复评论，并具备评论删除管理功能。
- **Webhook 通知**：通过可配置的 Webhook 接收新评论的实时提醒。
- **特色图片**：自动识别文章内首张图片，并将其作为列表页的封面图展示。
- **标签解析**：输入如 `#博客 #Cloudflare` 的标签文本，自动解析并展示为标签。
- **类型安全**：通过 `@rin/api` 包在客户端和服务器之间共享 TypeScript 类型，实现端到端类型安全。
- ……更多功能请访问 https://xeu.life 探索。

## 文档

### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/openRin/Rin.git && cd Rin

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的配置信息

# 4. 启动开发服务器
bun run dev
```

`bun run dev` 会先由 `.env.local` 生成 `wrangler.toml`、`.dev.vars`、`client/.env`，
再执行本地数据库迁移，然后同时启动 Vite 与 `wrangler dev`。开发入口默认是
http://localhost:11498 （用 `--port` 可覆盖），`/api` 请求会被代理到下一个端口
（默认 11499）上的 Worker。

### 测试

测试按工作区组织，请进入对应目录运行：

```bash
# 服务器测试（bun:test）
cd server && bun run test

# 客户端测试（vitest）
cd client && bun run test

# 类型检查 + 构建
bun run check
bun run build
```

> 在仓库根目录执行 `bun run test` 实际跑的是 `bun test`，它会把客户端的 Vitest 用例
> 也在没有 jsdom 的环境下收集执行并失败。请用上文的分工作区命令（CI 也是如此）。

### 一键部署

使用一条命令即可把站点部署到 Cloudflare：

```bash
# 前端构建 + 以静态资源形式随 Worker 一起部署
bun run deploy

# 仅部署后端（跳过前端构建）
bun cli/bin/rin.ts deploy --server

# 仅部署前端：作为 Cloudflare Pages 项目（assets 模式之外的可选路径）
bun cli/bin/rin.ts deploy --client

# 预览部署（附带 observability，不注册 cron 触发器）
bun cli/bin/rin.ts deploy --preview
```

**必需的环境变量：**

- `CLOUDFLARE_API_TOKEN` - 您的 Cloudflare API 令牌
- `CLOUDFLARE_ACCOUNT_ID` - 您的 Cloudflare 帐户 ID

**可选的环境变量：**

- `WORKER_NAME` - 后端工作进程名称（默认值：`rin-server`）
- `DB_NAME` - D1 数据库名称（默认值：`rin`）
- `TASK_QUEUE_NAME` - AI 摘要 / 缓存任务队列名称（默认值：`<WORKER_NAME>-tasks`）
- `R2_BUCKET_NAME` - R2 存储桶名称。设置后，部署会自动推导对应的 `S3_*` 配置；未设置时，不会自动选择任何 bucket。

部署脚本将自动执行以下操作：

- 自动检测并创建 D1 数据库（如果不存在）
- 自动创建任务队列及其 Worker 消费者（如果不存在）
- 仅在显式设置 `R2_BUCKET_NAME` 时，自动推导对应的 `S3_*` 存储配置
- 构建前端，并把 `./dist/client` 作为 Worker 的 `[assets]`（`binding = "ASSETS"`）
  一起部署，由同一个 Worker 提供页面与 API
- 生成 `wrangler.toml`（含 `TASK_QUEUE` 生产者/消费者与 Workers AI 的 `AI` 绑定），
  并按 `info` 表中记录的版本号执行 `server/sql` 里待应用的迁移
- 将敏感环境变量同步为 Worker secrets

### GitHub Actions Workflows

存储库包含多个自动化工作流程：

- **`ci.yml`** - 每次推送/PR 都会运行类型检查和格式验证
- **`test.yml`** - 分别在独立任务中运行服务器（`bun:test`）与客户端（`vitest`）测试，
  另含类型检查、构建、格式检查与覆盖率上传
- **`build.yml`** - 构建项目（前端 + `wrangler deploy --dry-run`）
- **`deploy.yml`** - 执行 `bun run deploy`：部署单个 Worker，前端作为其静态资源
- **`docs.yml`** - 构建 `docs/` 下的 Rspress 文档并发布到 GitHub Pages
  （仓库里唯一真正使用 Pages 的地方）
- **`release.yml`**、**`clean.yml`** - 版本发布与 Cloudflare 资源清理

**必备变量 (Repository Settings → Secrets and variables → Actions):**

- `CLOUDFLARE_API_TOKEN` - 您的 Cloudflare API 令牌，需包含 Workers、D1、Queue 权限
- `CLOUDFLARE_ACCOUNT_ID` - 您的 Cloudflare 帐户 ID

**可选配置(Repository Settings → Secrets and variables → Variables):**

- `WORKER_NAME`, `DB_NAME`, `TASK_QUEUE_NAME` - 资源名称
- `NAME`, `DESCRIPTION`, `AVATAR` - 站点配置
- `R2_BUCKET_NAME` - 要使用的特定 R2 存储桶

完整文档请访问 https://docs.openrin.org。

## 社区与支持

- 加入我们的 https://discord.gg/JWbSTHvAPN 参与讨论或获取帮助。
- 关注 https://t.me/openRin 频道获取最新动态。
- 发现 Bug 或有功能建议？欢迎在 GitHub 上提交 Issue。

## Star 历史

<a href="https://star-history.com/#openRin/Rin&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openRin/Rin&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=openRin/Rin&type=Date" />
   <img alt="Star 历史图表" src="https://api.star-history.com/svg?repos=openRin/Rin&type=Date" />
 </picture>
</a>

## 参与贡献

我们欢迎各种形式的贡献——代码、文档、设计和想法。请查阅我们的[贡献指南](https://docs.openrin.org/guide/contribution.html)，一起参与 Rin 的构建！

## License

```
MIT License

Copyright (c) 2024 Xeu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
