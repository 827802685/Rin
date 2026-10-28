![Cover](./docs/docs/public/rin-logo.png)

English | [简体中文](./README_zh_CN.md)

![GitHub commit activity](https://img.shields.io/github/commit-activity/w/openRin/Rin?style=for-the-badge)
![GitHub branch check runs](https://img.shields.io/github/check-runs/openRin/Rin/main?style=for-the-badge)
![GitHub top language](https://img.shields.io/github/languages/top/openRin/Rin?style=for-the-badge)
![GitHub License](https://img.shields.io/github/license/openRin/Rin?style=for-the-badge)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/openRin/Rin/deploy.yml?style=for-the-badge)

[![Discord](https://img.shields.io/badge/Discord-openRin-red?style=for-the-badge&color=%236e7acc)](https://discord.gg/JWbSTHvAPN)
[![Telegram](https://img.shields.io/badge/Telegram-openRin-red?style=for-the-badge&color=%233390EC)](https://t.me/openRin)

## Introduction

Rin is a modern, serverless blog platform built on Cloudflare's developer platform: a single Worker serves both the API and the built frontend as its static assets, D1 provides the SQLite database, and R2 (or any S3-compatible bucket) provides object storage. Deploy your personal blog with just a domain name pointed to Cloudflare—no server management required.

## Live Demo

https://xeu.life

## Features

- **Authentication & Management**: GitHub OAuth login. The first registered user becomes an administrator, while subsequent users join as regular members.
- **Content Creation**: Write and edit articles with a rich, intuitive editor.
- **Real-time Autosave**: Local drafts are saved automatically in real-time, with isolation between different articles.
- **Privacy Control**: Mark articles as "Visible only to me" for private drafts or personal notes, synchronized across devices.
- **Image Management**: Drag-and-drop or paste images to upload directly to S3-compatible storage (e.g., Cloudflare R2), with automatic link generation.
- **Custom Slugs**: Assign friendly URLs like `https://yourblog.com/about` using custom article aliases.
- **Unlisted Posts**: Option to keep articles out of the public homepage listing.
- **Blogroll**: Add links to friends' blogs. The backend automatically checks link availability every 20 minutes.
- **Comment System**: Reply to comments or moderate them with delete functionality.
- **Webhook Notifications**: Receive real-time alerts for new comments via configurable webhooks.
- **Featured Images**: Automatically detect the first image in an article and use it as the cover image in listings.
- **Tag Parsing**: Input tags like `#Blog #Cloudflare` and have them automatically parsed and displayed.
- **Type Safety**: End-to-end type safety with shared TypeScript types between client and server via `@rin/api` package.
- ...and more! Explore all features at https://xeu.life.

## Documentation

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/openRin/Rin.git && cd Rin

# 2. Install dependencies
bun install

# 3. Configure environment variables
cp .env.example .env.local
# Edit .env.local with your own configuration

# 4. Start the development server
bun run dev
```

`bun run dev` generates `wrangler.toml`, `.dev.vars` and `client/.env` from
`.env.local`, applies local database migrations, then runs Vite and
`wrangler dev` side by side. The development entry is
http://localhost:11498 (override with `--port`); `/api` requests are proxied to
the Worker on the next port (11499 by default).

### Testing

Tests are per workspace — run them from inside the workspace:

```bash
# Server tests (bun:test)
cd server && bun run test

# Client tests (vitest)
cd client && bun run test

# Type check + build (turbo / vite + wrangler dry-run)
bun run check
bun run build
```

> `bun run test` at the repository root runs `bun test`, which also collects the
> client's Vitest files without jsdom and fails them. Prefer the per-workspace
> commands above (this is what CI does).

### One-Command Deployment

Deploy the whole site to Cloudflare with a single command:

```bash
# Frontend build + Worker with the build as its static assets
bun run deploy

# Worker only (skips the client build)
bun cli/bin/rin.ts deploy --server

# Frontend only, as a Cloudflare Pages project (opt-in alternative to assets mode)
bun cli/bin/rin.ts deploy --client

# Preview deployment (adds observability, no cron triggers)
bun cli/bin/rin.ts deploy --preview
```

**Required environment variables:**

- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

**Optional environment variables:**

- `WORKER_NAME` - Backend worker name (default: `rin-server`)
- `DB_NAME` - D1 database name (default: `rin`)
- `TASK_QUEUE_NAME` - Queue used for AI summary / cache tasks (default: `<WORKER_NAME>-tasks`)
- `R2_BUCKET_NAME` - R2 bucket name. If set, deploy derives the matching `S3_*` values automatically. If unset, no bucket is auto-selected.

The deployment script will automatically:

- Create the D1 database if it doesn't exist
- Create the task queue and its Worker consumer if they don't exist
- Derive `S3_*` storage settings from `R2_BUCKET_NAME` only when it is explicitly set
- Build the client and deploy the Worker with `./dist/client` bound as `[assets]`
  (`binding = "ASSETS"`), so one Worker serves both pages and API
- Generate `wrangler.toml` (including the `TASK_QUEUE` producer/consumer and the
  Workers AI `AI` binding) and run the pending `server/sql` migrations, tracking the
  applied version in the `info` table
- Push secret environment variables to the Worker

### GitHub Actions Workflows

The repository includes several automated workflows:

- **`ci.yml`** - Runs type checking and formatting validation on every push/PR
- **`test.yml`** - Runs server (`bun:test`) and client (`vitest`) suites in separate
  jobs, plus type check, build, format check and coverage upload
- **`build.yml`** - Builds the project (client + `wrangler deploy --dry-run`) and, on
  completion, triggers `deploy.yml`
- **`deploy.yml`** - Runs `bun run deploy`: one Worker with the bundled frontend as
  static assets
- **`docs.yml`** - Builds the Rspress docs under `docs/` and publishes them to
  GitHub Pages (the only Pages deployment here)
- **`release.yml`**, **`clean.yml`** - Releases and teardown of Cloudflare resources

**Required secrets (Repository Settings → Secrets and variables → Actions):**

- `CLOUDFLARE_API_TOKEN` - Your Cloudflare API token with Workers, D1 and Queue permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

**Optional configuration (Repository Settings → Secrets and variables → Variables):**

- `WORKER_NAME`, `DB_NAME`, `TASK_QUEUE_NAME` - Resource names
- `NAME`, `DESCRIPTION`, `AVATAR` - Site configuration
- `R2_BUCKET_NAME` - Specific R2 bucket to use

Full documentation is available at https://docs.openrin.org.

## Community & Support

- Join our https://discord.gg/JWbSTHvAPN for discussions and help.
- Follow updates on https://t.me/openRin.
- Found a bug or have a feature request? Please open an issue on GitHub.

## Star History

<a href="https://star-history.com/#openRin/Rin&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openRin/Rin&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=openRin/Rin&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=openRin/Rin&type=Date" />
 </picture>
</a>

## Contributing

We welcome contributions of all kinds—code, documentation, design, and ideas. Please check out our [contributing guidelines](https://docs.openrin.org/en/guide/contribution.html) and join us in building Rin together!

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

## 自动迭代 (auto-iter)

本仓库由 `scripts/auto-iter/` 引擎在 `auto` 分支上每日自主迭代：同步 main → 分析状态 → 最小改动 → 构建/测试门禁 → 提交 → 每 5 次成功迭代合并回 main。定时由 GitHub Actions 工作流 `.github/workflows/auto-iterate.yml` 驱动（每天 01:00 北京）。
