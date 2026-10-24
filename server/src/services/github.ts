import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, CacheImpl, DB, Variables } from "../core/hono-types";
import { feeds, moments } from "../db/schema";
import { getStorageObject } from "../utils/storage";

// GitHub API 客户端配置
export interface GitHubSettings {
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  token: string;
  cdnBaseUrl?: string;
}

// GitHub contents API 单文件上限（1 MiB，官方限制）
export const GITHUB_MAX_FILE_BYTES = 1024 * 1024;

/** 外链图超过 1 MiB：Worker 推不动，也不该把整张下载进内存 */
export const REMOTE_IMAGE_TOO_LARGE = "too-large" as const;
export type RemoteImage = ArrayBuffer | typeof REMOTE_IMAGE_TOO_LARGE | null;

/**
 * 已确认进入内容仓库的媒体 key 清单（JSON 数组）。
 *
 * CDN 重写必须以此为据：rewriteMediaToCdn 过去无条件把站内媒体换成 jsDelivr 地址，
 * 而同步是每天一次的，于是「上传后到下次同步之间」以及「超过 1 MiB 被跳过的媒体」
 * 全都会被指到仓库里根本不存在的文件上，图片直接裂开。宁可走本站存储慢一点，
 * 也不能给出必然 404 的地址。
 */
export const GITHUB_SYNCED_MEDIA_KEY = "github.synced_media";

// 最近一次同步的分段耗时（JSON）。自定义域约 30 秒切断上游、手动同步的响应常常回不来，
// 只能把这轮真实花在哪落库，再从 D1 直读。
export const GITHUB_SYNC_TIMING_KEY = "github.last_sync_timing";

// 清单只用于「这个 key 在不在仓库里」的判断，留最近的一批即可，避免无限膨胀
const MAX_SYNCED_MEDIA_KEYS = 2000;

/**
 * 已确认镜像进内容仓库的「外链图片」源标识清单（JSON 数组）。
 * 与 github.synced_media 分开：后者 key 是站内存储对象名，这里 key 是外链规范化后的
 * owner/repo/ref/path 标识，两者共同决定渲染时哪些图片链接能改写成 CDN。
 */
export const GITHUB_MIRRORED_IMAGES_KEY = "github.mirrored_images";

// 外链图片镜像上限，同样防清单无限膨胀
const MAX_MIRRORED_IMAGES = 2000;

/**
 * jsDelivr 对单个 GitHub 包有 50 MiB 总量上限，超过就整个仓库 403（连正文都取不到）。
 * 图床里的截图动辄 10 MB，镜像几篇就会逼近这个墙，所以默认改用无该限制的 Statically；
 * 仍可用设置页 github.cdn_base_url 覆盖。
 */
export const DEFAULT_CDN_BASE = "https://cdn.statically.io/gh";

function cdnBaseFor(settings: GitHubSettings): string {
  if (settings.cdnBaseUrl) {
    return settings.cdnBaseUrl.replace(/\/+$/, "");
  }
  return `${DEFAULT_CDN_BASE}/${settings.owner}/${settings.repo}/${settings.branch}`;
}

interface GitHubFileMeta {
  path: string;
  content: string | ArrayBuffer;
  message: string;
}

interface GitHubContentResponse {
  sha: string;
}

interface GitHubCommitResponse {
  commit: {
    sha: string;
    html_url: string;
  };
}

// Workers runtime 没有 Buffer，用 TextEncoder + btoa 做 base64
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** 统一的体积口径：二进制看 byteLength，文本看 UTF-8 编码后的字节数 */
export function getContentByteLength(content: string | ArrayBuffer): number {
  if (content instanceof ArrayBuffer) {
    return content.byteLength;
  }
  return new TextEncoder().encode(content).length;
}

export type ContentType = "post" | "moment" | "about" | "media";

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 内容类型 -> GitHub 仓库目录，统一编码为 UTF-8 Markdown（带 frontmatter）
 *
 * posts/<年>/<月>/<slug>.md       博客文章
 * moments/<年>/<月>/moment-<id>.md 动态
 * about/<slug>.md                 介绍页
 * media/<文件名>                   图片等媒体
 */
export function getGitHubPath(
  type: ContentType,
  meta: { id?: number; title?: string; date?: Date; filename?: string },
): string {
  const date = meta.date || new Date();
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");

  switch (type) {
    case "post": {
      const slug = meta.title ? slugifyTitle(meta.title) : "";
      return `posts/${year}/${month}/${slug || `post-${meta.id}`}.md`;
    }
    case "moment":
      return `moments/${year}/${month}/moment-${meta.id}.md`;
    case "about":
      return `about/${meta.filename || "intro"}.md`;
    case "media":
      return `media/${meta.filename || "unknown"}`;
  }
}

/**
 * 读取 GitHub 集成配置：设置页（serverConfig）优先，环境变量兜底。
 * 与 AGENTS.md 的配置优先级约定一致。
 */
/** 这两个清单只需要读配置，兼容 CacheImpl 与配置路由的窄 reader */
export type GitHubConfigReader = { get(key: string): Promise<unknown> };

export async function getGitHubSettings(
  serverConfig: GitHubConfigReader,
  env: Env,
): Promise<GitHubSettings | null> {
  const [enabled, owner, repo, branch, token, cdnBaseUrl] = await Promise.all([
    serverConfig.get("github.enabled"),
    serverConfig.get("github.repo_owner"),
    serverConfig.get("github.repo_name"),
    serverConfig.get("github.repo_branch"),
    serverConfig.get("github.pat"),
    serverConfig.get("github.cdn_base_url"),
  ]);

  const finalOwner = String(owner ?? env.GITHUB_REPO_OWNER ?? "").trim();
  const finalRepo = String(repo ?? env.GITHUB_REPO_NAME ?? "").trim();
  const finalToken = String(token ?? env.GITHUB_PAT ?? "").trim();
  const finalBranch = String(branch ?? env.GITHUB_REPO_BRANCH ?? "main").trim() || "main";
  const finalCdn = String(cdnBaseUrl ?? env.GITHUB_CDN_BASE_URL ?? "").trim();

  const flagEnabled = enabled === true || enabled === "true";
  // 未显式开启且没有配置仓库时视为未启用
  if (!flagEnabled || !finalOwner || !finalRepo || !finalToken) {
    return null;
  }

  return {
    enabled: true,
    owner: finalOwner,
    repo: finalRepo,
    branch: finalBranch,
    token: finalToken,
    cdnBaseUrl: finalCdn || undefined,
  };
}

/**
 * GitHub API 客户端（contents API，单文件上限 1 MiB）
 */
export class GitHubClient {
  private apiBase = "https://api.github.com";

  constructor(private settings: GitHubSettings) {}

  /** 同步所有者（用于判定「自有仓库」外链图片） */
  get owner(): string {
    return this.settings.owner;
  }

  /**
   * GitHub REST API 强制要求 User-Agent，缺失直接回 403「Request forbidden by
   * administrative rules」。Workers runtime 的出站 fetch 默认不带这个头，浏览器和
   * Node 会带 —— 所以本地一切正常、线上每条上传都静默失败。
   */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `token ${this.settings.token}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "rin-blog-github-sync",
      ...extra,
    };
  }

  /**
   * 只读连通性 + 写权限自检。
   *
   * 不用「写一个探针文件」的做法：GET /github/test 没有鉴权，访客也能让仓库多一次提交；
   * 只读探针既无副作用，又能把失败状态码带回来，线上排障不必依赖 wrangler tail。
   */
  async checkAccess(): Promise<{ ok: boolean; repoStatus: number; writeStatus: number }> {
    const repoUrl = `${this.apiBase}/repos/${this.settings.owner}/${this.settings.repo}`;

    const repoRes = await fetch(repoUrl, { headers: this.headers() });
    const writeRes = await fetch(`${repoUrl}/contents/.rin-permission-probe`, {
      method: "OPTIONS",
      headers: this.headers(),
    });

    return {
      ok: repoRes.ok && writeRes.status === 204,
      repoStatus: repoRes.status,
      writeStatus: writeRes.status,
    };
  }

  private async getFileSha(path: string): Promise<string | null> {
    const url = `${this.apiBase}/repos/${this.settings.owner}/${this.settings.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${this.settings.branch}`;

    const response = await fetch(url, {
      headers: this.headers(),
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      console.error(`[GitHub] HEAD contents failed (${response.status}) for ${path}`);
      throw new Error(`GitHub contents lookup failed: ${response.status}`);
    }

    const data = (await response.json()) as GitHubContentResponse;
    return data.sha ?? null;
  }

  async uploadFile(meta: GitHubFileMeta): Promise<boolean> {
    // 文本与二进制都要按实际字节数判限：Markdown 正文走 string 分支，
    // 只检查 ArrayBuffer 会让超长文章白白发一次必然被拒（422）的请求。
    const byteLength = getContentByteLength(meta.content);
    if (byteLength > GITHUB_MAX_FILE_BYTES) {
      console.warn(
        `[GitHub] Skipping ${meta.path}: ${byteLength} bytes exceeds GitHub contents API 1MiB limit`,
      );
      return false;
    }

    const url = `${this.apiBase}/repos/${this.settings.owner}/${this.settings.repo}/contents/${encodeURIComponent(meta.path).replace(/%2F/g, "/")}`;

    try {
      const sha = await this.getFileSha(meta.path);
      const content =
        meta.content instanceof ArrayBuffer
          ? bytesToBase64(new Uint8Array(meta.content))
          : textToBase64(meta.content);

      const response = await fetch(url, {
        method: "PUT",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message: meta.message,
          content,
          branch: this.settings.branch,
          ...(sha ? { sha } : {}),
        }),
      });

      if (!response.ok) {
        console.error(
          `[GitHub] upload failed (${response.status}) for ${meta.path}:`,
          await response.text(),
        );
        return false;
      }

      const result = (await response.json()) as GitHubCommitResponse;
      console.log(
        `[GitHub] uploaded ${meta.path} (commit ${result.commit.sha.slice(0, 7)})`,
      );
      return true;
    } catch (error) {
      console.error(`[GitHub] upload error for ${meta.path}:`, error);
      return false;
    }
  }

  /** 文件在 CDN 上的完整访问地址 */
  getCdnUrl(path: string): string {
    return `${cdnBaseFor(this.settings)}/${path}`;
  }

  /**
   * 从图片源 URL 拉取二进制。Worker 在 Cloudflare 边缘出网，取 GitHub raw 不受
   * 本机被封影响；取不到或非 2xx 返回 null（该图留原外链，不镜像）。
   *
   * 超过 contents API 单文件上限的直接按响应头 Content-Length 拒绝：整张下载一张
   * 10MB 的图会吃掉几十秒墙钟，把同步拖到 Cloudflare 524，而结果一定是推不进去。
   */
  async fetchRemoteImage(url: string): Promise<RemoteImage> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "rin-blog-github-sync" } });
      if (!res.ok) {
        console.warn(`[GitHub] remote image ${res.status}: ${redactUrlForLog(url)}`);
        return null;
      }
      const declared = Number(res.headers.get("content-length") ?? "");
      if (declared > GITHUB_MAX_FILE_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        return REMOTE_IMAGE_TOO_LARGE;
      }
      const bytes = await res.arrayBuffer();
      // 少数源不给 Content-Length，下载完才发现超限
      return bytes.byteLength > GITHUB_MAX_FILE_BYTES ? REMOTE_IMAGE_TOO_LARGE : bytes;
    } catch (error) {
      console.warn(`[GitHub] remote image fetch failed: ${redactUrlForLog(url)}`, error);
      return null;
    }
  }

  /** 仓库里该路径是否已存在（Worker 推送或 Actions 提交都算）。存在即视为「已入库」 */
  async remoteFileExists(path: string): Promise<boolean> {
    try {
      return (await this.getFileSha(path)) !== null;
    } catch {
      return false;
    }
  }

  /**
   * 把媒体引用重写为 CDN 地址。两类来源：
   * - 站内存储（/blob/ 或本站 S3 host）：命中 syncedKeys 才改写。
   * - 用户自有仓库的外链图片：命中 mirroredKeys（规范化源标识）才改写为 media/<哈希>.<ext>，
   *   并原样保留 `#blurhash=…` 片段。
   * 其余（第三方图、GitHub 徽章、未入库的外链）一律保持原样，裂不了图。
   * syncedKeys / mirroredKeys 为空表示尚未同步过，此时一个都不改写。
   */
  rewriteMediaToCdn(
    content: string,
    storageHosts: string[],
    syncedKeys: ReadonlySet<string>,
    mirroredKeys: ReadonlySet<string> = new Set(),
  ): string {
    const cdnBase = cdnBaseFor(this.settings);

    return content.replace(
      /(!\[[^\]]*\]\()\s*<?([^)\s]+)>?/g,
      (match, prefix, url) => {
        const internal = rewriteSingleMediaUrl(url, cdnBase, storageHosts, syncedKeys);
        if (internal !== null) {
          return `${prefix}${internal}`;
        }
        const mirrored = rewriteMirrorableImageUrl(url, cdnBase, this.settings.owner, mirroredKeys);
        return mirrored === null ? match : `${prefix}${mirrored}`;
      },
    );
  }
}

/** 外链图片源 URL -> 规范化标识 + CDN 落地路径；非用户自有 GitHub 图返回 null */
export interface MirrorableImageSource {
  /** 去片段/查询后、规范化为 raw.githubusercontent 形式的可下载地址 */
  fetchUrl: string;
  /** owner/repo/ref/path 规范化标识（进镜像清单） */
  key: string;
  /** 媒体仓内路径 media/<哈希>.<ext> */
  mediaPath: string;
  /** 原 URL 上的 #片段，重写时要拼回去 */
  fragment: string;
}

const RAW_HOST = "raw.githubusercontent.com";

/** raw 形态的 ref 可以是 refs/heads/<branch>（3 段）或 <branch|tag|sha>（1 段） */
function parseRawRefPath(rest: string[]): { ref: string; path: string } {
  const headsIdx = rest.indexOf("heads");
  const tagsIdx = rest.indexOf("tags");
  const refsIdx = rest.indexOf("refs");
  if (refsIdx === 0 && (headsIdx === 1 || tagsIdx === 1)) {
    return { ref: rest.slice(0, 3).join("/"), path: rest.slice(3).join("/") };
  }
  return { ref: rest[0] ?? "", path: rest.slice(1).join("/") };
}

/**
 * 解析用户自有仓库的 GitHub 图片外链。支持三种写法（正文里实测都在用）：
 * - raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}（ref 常为 refs/heads/main）
 * - github.com/{owner}/{repo}/blob/{ref}/{path}?raw=true
 * - 自建反代域名（任意 host）同上两种路径形态
 * 只认 owner === syncOwner 的源：既避免镜像任意第三方图（版权/带宽），
 * 也天然排除 camo.githubusercontent 徽章与厂商按钮。镜像前还会做一次仓库存在性检查，
 * 所以「路径像」不等于「会改写」，只有真进仓的 key 才切 CDN。
 */
export function parseMirrorableImageSource(url: string, syncOwner: string): MirrorableImageSource | null {
  if (!url || !syncOwner) {
    return null;
  }

  // 去掉 #片段（含 blurhash/width/height），单独留存以便重写时拼回
  const hashIdx = url.indexOf("#");
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";
  let withoutFragment = hashIdx >= 0 ? url.slice(0, hashIdx) : url;

  let owner = "";
  let repo = "";
  let ref = "";
  let path = "";

  try {
    const u = new URL(withoutFragment);
    if (u.hostname === RAW_HOST) {
      // /{owner}/{repo}/{ref...}/{path}；ref 可能是 refs/heads/main 或单个分支/提交
      const segs = decodeURIComponent(u.pathname).replace(/^\/+/, "").split("/");
      if (segs.length < 4) return null;
      owner = segs[0];
      repo = segs[1];
      ({ ref, path } = parseRawRefPath(segs.slice(2)));
    } else if (u.hostname === "github.com") {
      const segs = decodeURIComponent(u.pathname).replace(/^\/+/, "").split("/");
      // /{owner}/{repo}/blob/{ref}/{path}
      if (segs.length < 5 || segs[2] !== "blob") return null;
      owner = segs[0];
      repo = segs[1];
      ref = segs[3];
      path = segs.slice(4).join("/");
    } else {
      // 自建反代域名：github.com 在这台机器上被 SNI 拦，正文里的图片因此写成
      // raw-githubusercontent-com-gh.<域名>/owner/repo/refs/heads/main/x.jpg
      // 和 <域名>/owner/repo/blob/main/pictures/y.jpg?raw=true 两种形态（线上实测都在用）。
      // 不认它们，这些图就进不了待镜像清单，Actions 把文件提交进仓后也永远切不到 CDN。
      const segs = decodeURIComponent(u.pathname).replace(/^\/+/, "").split("/");
      if (segs.length < 5) return null;
      owner = segs[0];
      repo = segs[1];
      if (segs[2] === "blob" || segs[2] === "raw") {
        ref = segs[3];
        path = segs.slice(4).join("/");
      } else {
        ({ ref, path } = parseRawRefPath(segs.slice(2)));
      }
    }
  } catch {
    return null;
  }

  if (owner.toLowerCase() !== syncOwner.toLowerCase() || !repo || !ref || !path) {
    return null;
  }

  const key = `${owner}/${repo}/${ref}/${path}`;
  const fetchUrl = `https://${RAW_HOST}/${owner}/${repo}/${ref}/${encodePathSegments(path)}`;
  const extMatch = /\.([a-z0-9]{1,5})$/i.exec(path);
  const ext = extMatch ? extMatch[1].toLowerCase() : "bin";
  const mediaPath = `media/${b64urlKey(key)}.${ext}`;

  return { fetchUrl, key, mediaPath, fragment };
}

function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** 规范化标识 -> URL-safe base64（UTF-8），稳定、无歧义、可含中文/空格的路径也安全 */
function b64urlKey(key: string): string {
  return bytesToBase64(new TextEncoder().encode(key))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function rewriteMirrorableImageUrl(
  url: string,
  cdnBase: string,
  syncOwner: string,
  mirroredKeys: ReadonlySet<string>,
): string | null {
  if (mirroredKeys.size === 0) {
    return null;
  }
  const parsed = parseMirrorableImageSource(url, syncOwner);
  if (!parsed || !mirroredKeys.has(parsed.key)) {
    return null;
  }
  return `${cdnBase}/${parsed.mediaPath}${parsed.fragment}`;
}

/** 日志用：外链 URL 可能含令牌式查询参数，去掉 query/fragment 只留可辨识前缀 */
function redactUrlForLog(url: string): string {
  const base = url.split(/[?#]/)[0];
  return base.length > 80 ? `${base.slice(0, 80)}…` : base;
}

/**
 * 提取正文里所有可镜像的外链图片源（去重后的规范化标识 -> 源信息）。
 * 供同步（Worker 推送小图）与导出（Actions 拉取大图）共用。
 */
export function extractMirrorableImageSources(
  content: string,
  syncOwner: string,
): Map<string, MirrorableImageSource> {
  const found = new Map<string, MirrorableImageSource>();
  const re = /!\[[^\]]*\]\(\s*<?([^)\s]+)>?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const parsed = parseMirrorableImageSource(match[1], syncOwner);
    if (parsed && !found.has(parsed.key)) {
      found.set(parsed.key, parsed);
    }
  }
  return found;
}

/**
 * 清单既可能是同步写入的 JSON 字符串，也可能是冷启动后从库里读回的数组
 * （CacheImpl 载入时对每行做了 JSON.parse）。只认其中一种会让清单在另一种
 * 形态下静默变成空集，正文于是永远不改写成 CDN。
 */
function toKeySet(raw: unknown, label: string): Set<string> {
  if (raw === null || raw === undefined) {
    return new Set();
  }
  if (Array.isArray(raw)) {
    return new Set(raw.map(String));
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
  } catch {
    console.warn(`[GitHub] ${label} is corrupted, treating as empty`);
    return new Set();
  }
}

/** 已确认镜像的规范化源标识集合；无配置/损坏时返回空集（= 一律不改写） */
export async function getMirroredImageKeys(
  serverConfig: GitHubConfigReader | undefined,
): Promise<Set<string>> {
  if (!serverConfig) {
    return new Set();
  }
  return toKeySet(await serverConfig.get(GITHUB_MIRRORED_IMAGES_KEY), "mirrored image list");
}

/** 覆盖写入已镜像清单（每天全量重扫，本轮结果就是仓库真实快照） */
export async function saveMirroredImageKeys(
  serverConfig: CacheImpl,
  keys: Iterable<string>,
): Promise<void> {
  const list = [...new Set(keys)].slice(-MAX_MIRRORED_IMAGES);
  await serverConfig.setQuick(GITHUB_MIRRORED_IMAGES_KEY, JSON.stringify(list));
}

/**
 * 已推送文件的指纹表（仓库路径 -> 内容 sha256）。
 *
 * contents API 每个文件都要「GET 拿 sha + PUT 提交」两次往返，线上实测 5 篇文章 +
 * 3 条动态光靠这段就把手动同步拖过自定义域约 30 秒的切断线。内容没变就没必要再推，
 * 本地比对指纹即可，零网络开销。
 */
export const GITHUB_SYNCED_HASHES_KEY = "github.synced_hashes";
const MAX_SYNCED_HASHES = 3000;

export async function getSyncedHashes(
  serverConfig: GitHubConfigReader | undefined,
): Promise<Map<string, string>> {
  if (!serverConfig) {
    return new Map();
  }
  const raw = await serverConfig.get(GITHUB_SYNCED_HASHES_KEY);
  if (!raw) {
    return new Map();
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return new Map();
    }
    return new Map(
      Object.entries(parsed as Record<string, unknown>).map(([path, hash]) => [path, String(hash)]),
    );
  } catch {
    console.warn("[GitHub] synced hash table is corrupted, treating as empty");
    return new Map();
  }
}

export async function saveSyncedHashes(
  serverConfig: CacheImpl,
  hashes: ReadonlyMap<string, string>,
): Promise<void> {
  const entries = [...hashes].slice(-MAX_SYNCED_HASHES);
  await serverConfig.setQuick(GITHUB_SYNCED_HASHES_KEY, JSON.stringify(Object.fromEntries(entries)));
}

/** 内容指纹：SHA-256(hex)。用于「没变化就不推」的判定。 */
export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function rewriteSingleMediaUrl(
  url: string,
  cdnBase: string,
  storageHosts: string[],
  syncedKeys: ReadonlySet<string>,
): string | null {
  const rawKey = internalMediaKey(url, storageHosts);
  if (rawKey === null) {
    return null; // 外链或不认识的地址保持原样
  }

  // 同步时按解码后的 key 记录，这里也必须解码后再比对，否则带 %20 的 URL 永远匹配不上
  if (!syncedKeys.has(decodeMediaKey(rawKey))) {
    return null;
  }

  // 拼进地址时保留原文，避免二次编码改变既有链接
  return `${cdnBase}/media/${rawKey}`;
}

/** 站内媒体 URL -> 存储 key（原样，不解码）；外链返回 null */
function internalMediaKey(url: string, storageHosts: string[]): string | null {
  if (url.startsWith("/blob/")) {
    return url.slice("/blob/".length);
  }

  for (const host of storageHosts) {
    if (!host || !url.startsWith(host)) continue;
    return url.slice(host.length).replace(/^\/+/, "");
  }

  return null;
}

function decodeMediaKey(key: string): string {
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/** 读取已确认入库的媒体 key 集合；无配置/损坏时返回空集（= 一律不改写） */
export async function getSyncedMediaKeys(
  serverConfig: CacheImpl | undefined,
): Promise<Set<string>> {
  if (!serverConfig) {
    return new Set();
  }

  return toKeySet(await serverConfig.get(GITHUB_SYNCED_MEDIA_KEY), "synced media list");
}

/**
 * 覆盖写入已入库清单。用覆盖而非累加：同步是每天一次的全量扫描，本轮成功列表
 * 就是仓库当前内容的真实快照；累加会让换仓库/换 CDN 后仍指向旧地址。
 * 失败模式是「退回本站存储」，比 404 安全。
 */
export async function saveSyncedMediaKeys(
  serverConfig: CacheImpl,
  keys: Iterable<string>,
): Promise<void> {
  const list = [...new Set(keys)].slice(-MAX_SYNCED_MEDIA_KEYS);
  await serverConfig.setQuick(GITHUB_SYNCED_MEDIA_KEY, JSON.stringify(list));
}

/** 追加单个已确认入库的 key（GitHub Actions 拉取路径用） */
export async function markMediaSynced(
  serverConfig: CacheImpl,
  key: string,
): Promise<void> {
  const keys = await getSyncedMediaKeys(serverConfig);
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  await saveSyncedMediaKeys(serverConfig, keys);
}

/**
 * 从文章内容中提取站内媒体引用（/blob/... 或本站存储域名）
 */
export function extractInternalMediaUrls(content: string, storageHosts: string[]): string[] {
  const found = new Set<string>();
  const imageRe = /!\[[^\]]*\]\(\s*<?([^)\s]+)>?/g;
  let match: RegExpExecArray | null;

  const addKey = (rawKey: string) => {
    try {
      found.add(decodeURIComponent(rawKey));
    } catch {
      found.add(rawKey);
    }
  };

  while ((match = imageRe.exec(content)) !== null) {
    const url = match[1];
    if (url.startsWith("/blob/")) {
      addKey(url.slice("/blob/".length));
      continue;
    }
    for (const host of storageHosts) {
      if (host && url.startsWith(host)) {
        addKey(url.slice(host.length).replace(/^\/+/, ""));
        break;
      }
    }
  }

  return [...found];
}

/** 媒体 key 会被拉取端拼进文件路径，必须排除越界写入 */
export function isSafeMediaKey(key: string): boolean {
  return (
    key.length > 0 &&
    !key.startsWith("/") &&
    !key.includes("..") &&
    !key.includes("\0") &&
    !/^[a-zA-Z]:/.test(key)
  );
}

export function getStorageHosts(env: Env): string[] {
  const publicBase = (env.S3_ACCESS_HOST || env.S3_ENDPOINT || "").replace(/\/+$/, "");
  return publicBase ? [publicBase] : [];
}

/**
 * 内容仓库是公开的：正文一旦进仓就进 git 历史，事后清理要重写历史并让所有 fork
 * 同步，所以必须在序列化这一层挡住密钥。文章和 AI 摘要里都可能带出配置值
 * （教程正文写环境变量、截图说明抄了令牌），故两条同步路径共用这里。
 *
 * 只针对「密钥形态」下刀，不碰邮箱 / URL / 用户名这类正常内容。
 */
const SECRET_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  {
    // PEM 私钥整块
    label: "private_key",
    re: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/g,
  },
  { label: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g },
  {
    label: "cf_token",
    re: /\b(?:cfat_[A-Za-z0-9_]{16,}|v4\.[0-9a-f]{20,}\.[0-9a-f]{20,}\.[0-9a-f]{20,})\b/gi,
  },
  { label: "aws_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  // JWT 三段式（本站的 rin_auth_token 就是它）
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    // key: value / key=value / "KEY": "value" 形式的赋值。
    // 值要求 12 字符以上：真实凭据都远长于此，而 "password: \"123\"" 这类示例、
    // `tokenizer = "gpt2"` 这种恰好含 token 的普通标识符都不该被误伤。
    label: "assigned_secret",
    re: /\b([A-Za-z0-9_]*(?:secret|token|password|passwd|pwd|api_?key|access_?key|private_?key|session_?key|client_?secret)[A-Za-z0-9_]*)(\s*[:=]\s*)["']?[^\s"'&,;)\]}]{12,}["']?/gi,
  },
  {
    label: "auth_header",
    re: /\b(authorization)(\s*[:=]\s*)["']?(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{10,}["']?/gi,
  },
];

const REDACTED_MARK = "[已脱敏]";

/** 返回脱敏后的文本与命中的类别（不含任何原值，供日志核对） */
export function redactSecrets(text: string): { text: string; hits: string[] } {
  if (!text) {
    return { text, hits: [] };
  }

  const hits: string[] = [];
  let out = text;

  for (const { label, re } of SECRET_PATTERNS) {
    // 赋值类要保留键名和分隔符，读者才知道是哪一项被挡掉了
    const isAssignment = label === "assigned_secret" || label === "auth_header";
    const replaced = out.replace(re, (match, g1?: string, g2?: string) => {
      if (!hits.includes(label)) hits.push(label);
      return isAssignment ? `${g1 ?? ""}${g2 ?? ""}${REDACTED_MARK}` : REDACTED_MARK;
    });
    out = replaced;
  }

  return { text: out, hits };
}

/** 序列化前统一过一遍，并把命中类别记到日志（只记类别，绝不记原值） */
function redactForExport(text: string, what: string): string {
  const { text: safe, hits } = redactSecrets(text);
  if (hits.length) {
    console.warn(`[GitHub] redacted ${hits.join(",")} in ${what}`);
  }
  return safe;
}

interface ExportableFeed {
  id: number;
  title: string | null;
  content: string;
  summary?: string | null;
  alias?: string | null;
  createdAt: Date;
}

/** 镜像改写器：把已入库的外链/站内媒体 URL 换成 CDN；缺省恒等 */
type ImageRewriter = (content: string) => string;
const identityRewriter: ImageRewriter = (c) => c;

/** 文章序列化为统一编码的 frontmatter Markdown（推送同步与 Actions 拉取共用） */
export function buildPostMarkdown(
  feed: ExportableFeed,
  imageRewriter: ImageRewriter = identityRewriter,
): { path: string; markdown: string } {
  const title = feed.title ?? `post-${feed.id}`;
  const path = getGitHubPath("post", {
    id: feed.id,
    title: feed.alias || title,
    date: feed.createdAt,
  });

  const lines = [
    "---",
    `id: ${feed.id}`,
    `title: ${JSON.stringify(title)}`,
    feed.summary ? `summary: ${JSON.stringify(redactForExport(imageRewriter(feed.summary), `post ${feed.id} summary`))}` : null,
    feed.alias ? `alias: ${JSON.stringify(feed.alias)}` : null,
    `date: ${feed.createdAt.toISOString()}`,
    "---",
    "",
  ].filter((line): line is string => line !== null);

  const body = redactForExport(imageRewriter(feed.content), `post ${feed.id} content`);
  return { path, markdown: `${lines.join("\n")}${body}` };
}

export function buildMomentMarkdown(
  moment: { id: number; content: string; createdAt: Date },
  imageRewriter: ImageRewriter = identityRewriter,
): {
  path: string;
  markdown: string;
} {
  const path = getGitHubPath("moment", { id: moment.id, date: moment.createdAt });
  const frontmatter = ["---", `id: ${moment.id}`, `date: ${moment.createdAt.toISOString()}`, "---", ""].join("\n");
  return { path, markdown: `${frontmatter}${redactForExport(imageRewriter(moment.content), `moment ${moment.id}`)}` };
}

/** Actions 主动拉取的全量清单：文章/动态文件 + 站内媒体 key + 待镜像外链图片 */
export interface GitHubExportPayload {
  exportedAt: string;
  files: Array<{ path: string; content: string }>;
  media: Array<{ key: string; path: string }>;
  /**
   * 用户自有仓库的外链图片：拉取端按 fetchUrl 下载、写入 path（git 提交不受 1 MiB 限）。
   * path 与站点渲染改写后的 CDN 目标一致，媒体落地后下一轮同步即完成 CDN 切换。
   */
  images: Array<{ source: string; fetchUrl: string; path: string }>;
}

/**
 * 汇总全部已发布文章、动态、站内媒体与待镜像外链清单，供 GitHub Actions 定时拉取。
 * 拉取端只做「按 path 写文件 + 按 fetchUrl 下载图片」，编码格式的唯一来源是这里。
 */
export async function buildGitHubExport(
  db: DB,
  env: Env,
  serverConfig?: CacheImpl,
): Promise<GitHubExportPayload> {
  const storageHosts = getStorageHosts(env);
  const files: GitHubExportPayload["files"] = [];
  const mediaKeys = new Set<string>();
  const images = new Map<string, { source: string; fetchUrl: string; path: string }>();

  // 已入库（站内媒体 + 已镜像外链）才改写为 CDN；本轮新镜像、Actions 即将写入的，
  // 要等下一轮存在性检查进 mirroredKeys 才切 CDN —— 宁可暂留外链，也不指向还不存在的文件。
  let rewriter: ImageRewriter = identityRewriter;
  const settings = serverConfig ? await getGitHubSettings(serverConfig, env) : null;
  if (settings) {
    const client = new GitHubClient(settings);
    const [syncedKeys, mirroredKeys] = await Promise.all([
      getSyncedMediaKeys(serverConfig),
      getMirroredImageKeys(serverConfig),
    ]);
    rewriter = (content) => client.rewriteMediaToCdn(content, storageHosts, syncedKeys, mirroredKeys);
  }

  const collectImages = (content: string) => {
    if (!settings) return;
    for (const [key, src] of extractMirrorableImageSources(content, settings.owner)) {
      if (!images.has(key)) {
        images.set(key, { source: key, fetchUrl: src.fetchUrl, path: src.mediaPath });
      }
    }
  };

  const published = await db.query.feeds.findMany({
    where: and(eq(feeds.draft, 0), eq(feeds.listed, 1)),
  });
  for (const feed of published) {
    const { path, markdown } = buildPostMarkdown(
      {
        id: feed.id,
        title: feed.title,
        content: feed.content,
        summary: feed.summary,
        alias: feed.alias,
        createdAt: new Date(feed.createdAt),
      },
      rewriter,
    );
    files.push({ path, content: markdown });
    for (const key of extractInternalMediaUrls(feed.content, storageHosts)) mediaKeys.add(key);
    collectImages(feed.content);
  }

  const allMoments = await db.query.moments.findMany();
  for (const moment of allMoments) {
    const { path, markdown } = buildMomentMarkdown(
      { id: moment.id, content: moment.content, createdAt: new Date(moment.createdAt) },
      rewriter,
    );
    files.push({ path, content: markdown });
    for (const key of extractInternalMediaUrls(moment.content, storageHosts)) mediaKeys.add(key);
    collectImages(moment.content);
  }

  const media = [...mediaKeys]
    .filter(isSafeMediaKey)
    .map((key) => ({ key, path: getGitHubPath("media", { filename: key }) }));

  return { exportedAt: new Date().toISOString(), files, media, images: [...images.values()] };
}

/** Actions 拉取用 PAT 鉴权：Authorization: token <pat> 或 Bearer <pat> */
function extractAuthToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^(?:token|bearer)\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function GitHubService() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  // 测试 GitHub 连接与写入权限（只读探针，不产生提交）
  app.get("/test", async (c: AppContext) => {
    const client = await getClientFromContext(c);
    if (!client) {
      return c.json({ success: false, error: "GitHub integration not configured or disabled" }, 400);
    }

    const probe = await client.checkAccess();
    const path = ".rin-test.txt";

    return c.json({ ...probe, cdnUrl: client.getCdnUrl(path) });
  });

  // 手动触发全量同步（管理员）
  app.post("/sync", async (c: AppContext) => {
    if (!c.get("admin")) {
      return c.text("Unauthorized", 401);
    }

    const enteredAtMs = Date.now();
    const client = await getClientFromContext(c);
    if (!client) {
      return c.json({ success: false, error: "GitHub integration not configured or disabled" }, 400);
    }

    // 动态导入避免 github <-> github-sync 的静态循环
    const { runGitHubSync } = await import("./github-sync");
    // 线上实测：自定义域约 30 秒就把上游切断并回 524（Worker 本身还在跑）。
    // 所以手动触发只跑 20 秒预算（从进入本处理函数起算），未完成部分由 stats.partial
    // 告知前端「再点一次继续」；全量交给没有 HTTP 约束的每日 cron。
    const stats = await runGitHubSync(client, c.get("db"), c.get("env"), c.get("serverConfig"), {
      budgetMs: 20_000,
      enteredAtMs,
    });

    return c.json({ success: true, stats });
  });

  // GET /export - 供 GitHub Actions 主动拉取的全量清单（PAT 鉴权，只读）
  app.get("/export", async (c: AppContext) => {
    const settings = await getGitHubSettings(c.get("serverConfig"), c.get("env"));
    if (!settings || extractAuthToken(c.req.header("Authorization")) !== settings.token) {
      return c.text("Unauthorized", 401);
    }

    const payload = await buildGitHubExport(c.get("db"), c.get("env"), c.get("serverConfig"));
    return c.json(payload);
  });

  // GET /export/media?key=... - 拉取单个站内媒体二进制（git 提交不受 contents API 1MiB 限制）
  app.get("/export/media", async (c: AppContext) => {
    const settings = await getGitHubSettings(c.get("serverConfig"), c.get("env"));
    if (!settings || extractAuthToken(c.req.header("Authorization")) !== settings.token) {
      return c.text("Unauthorized", 401);
    }

    const key = c.req.query("key") ?? "";
    if (!isSafeMediaKey(key)) {
      return c.text("Invalid key", 400);
    }

    const env = c.get("env");
    const object = await getStorageObject(env, key);
    if (!object) {
      return c.text("Not found", 404);
    }

    // 拉取端拿到二进制后会提交进内容仓库，这里记一笔：Actions 是推不回结果的，
    // 若不记录，>1 MiB（Worker 侧会被跳过）的媒体永远不会被重写到 CDN。
    await markMediaSynced(c.get("serverConfig"), decodeMediaKey(key));

    return new Response(object.body, {
      headers: {
        "Content-Type": object.headers.get("Content-Type") || "application/octet-stream",
      },
    });
  });

  return app;
}

async function getClientFromContext(c: AppContext): Promise<GitHubClient | null> {
  const settings = await getGitHubSettings(c.get("serverConfig"), c.get("env"));
  return settings ? new GitHubClient(settings) : null;
}
