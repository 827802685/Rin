// 从 Rin 站点主动拉取全部内容并写入当前仓库（供 GitHub Actions 定时执行）。
// 零依赖，Node 20+。清单与 Markdown 编码格式全部由服务端 /api/github/export 决定，
// 本脚本只负责「按 path 写文件 + 下载媒体」，保证与 Worker 推送同步的格式一致。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const site = (process.env.RIN_SITE_URL || "").replace(/\/+$/, "");
const pat = process.env.RIN_GITHUB_PAT || "";
const targetRoot = process.env.RIN_SYNC_DIR || ".";

if (!site || !pat) {
  console.error("缺少环境变量：RIN_SITE_URL 或 RIN_GITHUB_PAT");
  process.exit(1);
}

const headers = { Authorization: `token ${pat}` };
const rootAbs = path.resolve(targetRoot);

function resolveInside(rel) {
  const abs = path.resolve(rootAbs, rel);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error(`非法路径（越出仓库目录）：${rel}`);
  }
  return abs;
}

async function fetchExport() {
  const res = await fetch(`${site}/api/github/export`, { headers });
  if (res.status === 401) {
    throw new Error("鉴权失败（401）：请确认站点已启用 GitHub 集成，且 RIN_GITHUB_PAT 与设置页里的 PAT 一致");
  }
  if (!res.ok) {
    throw new Error(`拉取清单失败：HTTP ${res.status}`);
  }
  return res.json();
}

async function writeTextFiles(files) {
  for (const file of files) {
    const abs = resolveInside(file.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, file.content, "utf8");
  }
}

// git 提交二进制没有 contents API 的 1MiB 限制，视频等超过 1MiB 的媒体也能存
async function downloadMedia(media) {
  let ok = 0;
  let skipped = 0;
  for (const item of media) {
    const abs = resolveInside(item.path);
    const url = `${site}/api/github/export/media?key=${encodeURIComponent(item.key)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      skipped++;
      console.warn(`跳过媒体 ${item.key}：HTTP ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    ok++;
  }
  return { ok, skipped };
}

// 正文引用的自有仓库外链图片：git 提交不受 contents API 1MiB 限制，10MB 截图也能搬进仓
async function downloadImages(images) {
  let ok = 0;
  let skipped = 0;
  for (const item of images) {
    let url;
    try {
      url = new URL(item.fetchUrl);
    } catch {
      skipped++;
      console.warn(`跳过非法图片源：${item.source}`);
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      skipped++;
      continue;
    }
    const abs = resolveInside(item.path);
    const res = await fetch(url, { headers: { "User-Agent": "rin-blog-github-sync" } });
    if (!res.ok) {
      skipped++;
      console.warn(`跳过图片 ${item.source}：HTTP ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    ok++;
  }
  return { ok, skipped };
}

const payload = await fetchExport();
await mkdir(rootAbs, { recursive: true });
await writeTextFiles(payload.files ?? []);
const media = await downloadMedia(payload.media ?? []);
const images = await downloadImages(payload.images ?? []);

console.log(
  `同步完成：文本 ${payload.files?.length ?? 0} 篇，` +
  `媒体成功 ${media.ok} / 跳过 ${media.skipped}，` +
  `图片成功 ${images.ok} / 跳过 ${images.skipped}（清单生成于 ${payload.exportedAt}）`,
);
