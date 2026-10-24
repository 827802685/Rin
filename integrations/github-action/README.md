# GitHub Actions 主动拉取同步

绕开 GitHub contents API 单文件 1 MiB 限制的推荐方案：不再由 Worker 往仓库推文件，
而是让内容仓库的 GitHub Actions 每天定时调用站点只读接口
`GET /api/github/export`，把文章、动态和全部媒体（含视频）拉下来，用 `git push` 入库。

## 仓库目录结构（与 Worker 推送同步完全一致）

```text
posts/<年>/<月>/<slug>.md        博客文章
moments/<年>/<月>/moment-<id>.md 动态
about/<slug>.md                  介绍页
media/<存储 key>                  图片、文件、视频
media/<源标识哈希>.<ext>           正文里指向你自己 GitHub 仓库的外链图片
```

外链图片镜像：正文中形如
`https://raw.githubusercontent.com/<你的 owner>/<repo>/<ref>/<path>`
或 `https://github.com/<你的 owner>/<repo>/blob/<ref>/<path}?raw=true` 的图片，
会被复制进本仓库 `media/`（文件名取源标识的 URL-safe base64，中文与空格路径同样安全）。
只有文件真的进了仓库，下一轮才会把正文改写成 CDN 地址，且原 URL 上的
`#blurhash=…&width=…&height=…` 片段会原样保留。第三方域名（含 camo 徽章）一律不动。

CDN 默认用 `https://cdn.statically.io/gh/<owner>/<repo>/<branch>/…`。
不用 jsDelivr 是实测结论：jsDelivr 对单仓库有 50 MB 上限，图片仓一旦超限就整仓 403，
会把所有文章的图一起打挂。想换别的 CDN，在设置页「CDN 基址」（`github.cdn_base_url`）
填自己的地址即可。

Markdown 的 frontmatter 编码（UTF-8，`id/title/summary/alias/date`）由服务端统一生成，
拉取端只按清单里的 `path` 原样写文件，两种同步方式产出的文件逐字节一致、可并存。

## 配置步骤

1. 网站设置页启用 GitHub 集成，填好仓库信息与 PAT（`github.enabled` 必须显式打开，
   否则导出接口会返回 401）。
2. 把本目录两个文件复制到你的**内容仓库**：
   - `sync-from-rin.mjs` → `scripts/sync-from-rin.mjs`
   - `rin-sync.yml` → `.github/workflows/rin-sync.yml`
3. 在内容仓库 Settings → Secrets and variables → Actions 里配置：
   - **Variables** `RIN_SITE_URL`：站点地址，如 `https://blog.example.com`
   - **Secrets** `RIN_GITHUB_PAT`：与设置页相同的 PAT（只用于调用导出接口鉴权，
     不写进任何文件；推送用的是 workflow 自带的 `GITHUB_TOKEN`，
     需要 `permissions: contents: write`）
4. Actions 页面手动运行一次 `从 Rin 拉取内容` 验证，之后每天 02:10（北京时间）自动执行。

## 与 Worker 每日推送同步的关系

两者可并存（结果幂等）。若只想走 Actions：把设置页的 GitHub 开关保持打开（导出接口
依赖它做鉴权），Worker 侧每日 cron 推送会照常执行，但它对超过 1 MiB 的媒体只会跳过并计数，
所以大文件场景以 Actions 为准；小文件两边写入的内容相同，不会产生差异。
外链图片同理：≤1 MiB 由 Worker 当场提交，更大的写在导出清单的 `images` 里，
由本脚本 `downloadImages()` 抓下来用 git 提交；下一轮同步的存在性检查会把它认领进镜像清单，
正文随即切成 CDN。

## 已知边界

- Workers 免费计划单个响应体上限 100 MiB，超过约 100 MiB 的单个视频仍需 Git LFS
  （GitHub 对非 LFS 文件超过 100 MiB 会直接拒绝 push，50 MiB 起报警告）。
- 导出接口只含已发布且未隐藏的文章（`draft = 0 且 listed = 1`）与全部动态，
  鉴权使用与设置页相同的 PAT，任何读取都走 HTTPS。
