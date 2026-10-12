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
export async function getGitHubSettings(
  serverConfig: CacheImpl,
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

  private async getFileSha(path: string): Promise<string | null> {
    const url = `${this.apiBase}/repos/${this.settings.owner}/${this.settings.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${this.settings.branch}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `token ${this.settings.token}`,
        Accept: "application/vnd.github.v3+json",
      },
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
        headers: {
          Authorization: `token ${this.settings.token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
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
    if (this.settings.cdnBaseUrl) {
      return `${this.settings.cdnBaseUrl.replace(/\/+$/, "")}/${path}`;
    }
    return `https://cdn.jsdelivr.net/gh/${this.settings.owner}/${this.settings.repo}@${this.settings.branch}/${path}`;
  }

  /**
   * 把站内媒体引用（相对 /blob/ 或本站 S3 host 的图片）重写为 CDN 地址，
   * 使加载文章时直接使用 GitHub CDN。
   */
  rewriteMediaToCdn(content: string, storageHosts: string[]): string {
    const cdnBase = (this.settings.cdnBaseUrl || "")
      ? this.settings.cdnBaseUrl!.replace(/\/+$/, "")
      : `https://cdn.jsdelivr.net/gh/${this.settings.owner}/${this.settings.repo}@${this.settings.branch}`;

    return content.replace(
      /(!\[[^\]]*\]\()\s*<?([^)\s]+)>?/g,
      (match, prefix, url) => {
        const rewritten = rewriteSingleMediaUrl(url, cdnBase, storageHosts);
        return rewritten === null ? match : `${prefix}${rewritten}`;
      },
    );
  }
}

function rewriteSingleMediaUrl(
  url: string,
  cdnBase: string,
  storageHosts: string[],
): string | null {
  // 站内 /blob/<key> 引用
  if (url.startsWith("/blob/")) {
    return `${cdnBase}/media/${url.slice("/blob/".length)}`;
  }

  // 本站存储域名下的对象
  for (const host of storageHosts) {
    if (!host || !url.startsWith(host)) continue;
    const key = url.slice(host.length).replace(/^\/+/, "");
    return `${cdnBase}/media/${key}`;
  }

  return null; // 外链或不认识的地址保持原样
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

interface ExportableFeed {
  id: number;
  title: string | null;
  content: string;
  summary?: string | null;
  alias?: string | null;
  createdAt: Date;
}

/** 文章序列化为统一编码的 frontmatter Markdown（推送同步与 Actions 拉取共用） */
export function buildPostMarkdown(feed: ExportableFeed): { path: string; markdown: string } {
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
    feed.summary ? `summary: ${JSON.stringify(feed.summary)}` : null,
    feed.alias ? `alias: ${JSON.stringify(feed.alias)}` : null,
    `date: ${feed.createdAt.toISOString()}`,
    "---",
    "",
  ].filter((line): line is string => line !== null);

  return { path, markdown: `${lines.join("\n")}${feed.content}` };
}

export function buildMomentMarkdown(moment: { id: number; content: string; createdAt: Date }): {
  path: string;
  markdown: string;
} {
  const path = getGitHubPath("moment", { id: moment.id, date: moment.createdAt });
  const frontmatter = ["---", `id: ${moment.id}`, `date: ${moment.createdAt.toISOString()}`, "---", ""].join("\n");
  return { path, markdown: `${frontmatter}${moment.content}` };
}

/**
 * 把一条博客文章序列化为带 frontmatter 的 Markdown 并上传
 */
export async function syncFeedToGitHub(
  client: GitHubClient,
  feed: {
    id: number;
    title: string;
    content: string;
    summary?: string;
    alias?: string;
    createdAt: Date;
  },
): Promise<boolean> {
  const { path, markdown } = buildPostMarkdown(feed);

  return client.uploadFile({
    path,
    content: markdown,
    message: `sync: post ${feed.alias || feed.id}`,
  });
}

export async function syncMomentToGitHub(
  client: GitHubClient,
  moment: { id: number; content: string; createdAt: Date },
): Promise<boolean> {
  const { path, markdown } = buildMomentMarkdown(moment);

  return client.uploadFile({
    path,
    content: markdown,
    message: `sync: moment ${moment.id}`,
  });
}

export interface GitHubExportPayload {
  exportedAt: string;
  files: Array<{ path: string; content: string }>;
  media: Array<{ key: string; path: string }>;
}

/**
 * 汇总全部已发布文章、动态与站内媒体清单，供 GitHub Actions 定时拉取。
 * 拉取端只做「按 path 写文件」，编码格式的唯一来源是这里。
 */
export async function buildGitHubExport(db: DB, env: Env): Promise<GitHubExportPayload> {
  const storageHosts = getStorageHosts(env);
  const files: GitHubExportPayload["files"] = [];
  const mediaKeys = new Set<string>();

  const published = await db.query.feeds.findMany({
    where: and(eq(feeds.draft, 0), eq(feeds.listed, 1)),
  });
  for (const feed of published) {
    const { path, markdown } = buildPostMarkdown({
      id: feed.id,
      title: feed.title,
      content: feed.content,
      summary: feed.summary,
      alias: feed.alias,
      createdAt: new Date(feed.createdAt),
    });
    files.push({ path, content: markdown });
    for (const key of extractInternalMediaUrls(feed.content, storageHosts)) mediaKeys.add(key);
  }

  const allMoments = await db.query.moments.findMany();
  for (const moment of allMoments) {
    const { path, markdown } = buildMomentMarkdown({
      id: moment.id,
      content: moment.content,
      createdAt: new Date(moment.createdAt),
    });
    files.push({ path, content: markdown });
    for (const key of extractInternalMediaUrls(moment.content, storageHosts)) mediaKeys.add(key);
  }

  const media = [...mediaKeys]
    .filter(isSafeMediaKey)
    .map((key) => ({ key, path: getGitHubPath("media", { filename: key }) }));

  return { exportedAt: new Date().toISOString(), files, media };
}

/** Actions 拉取用 PAT 鉴权：Authorization: token <pat> 或 Bearer <pat> */
function extractAuthToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^(?:token|bearer)\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

export function GitHubService() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();

  // 测试 GitHub 连接与写入权限
  app.get("/test", async (c: AppContext) => {
    const client = await getClientFromContext(c);
    if (!client) {
      return c.json({ success: false, error: "GitHub integration not configured or disabled" }, 400);
    }

    const path = ".rin-test.txt";
    const success = await client.uploadFile({
      path,
      content: `Rin GitHub integration test - ${new Date().toISOString()}`,
      message: "test: verify GitHub connection",
    });

    return c.json({ success, cdnUrl: client.getCdnUrl(path) });
  });

  // 手动触发全量同步（管理员）
  app.post("/sync", async (c: AppContext) => {
    if (!c.get("admin")) {
      return c.text("Unauthorized", 401);
    }

    const client = await getClientFromContext(c);
    if (!client) {
      return c.json({ success: false, error: "GitHub integration not configured or disabled" }, 400);
    }

    // 动态导入避免 github <-> github-sync 的静态循环
    const { runGitHubSync } = await import("./github-sync");
    const stats = await runGitHubSync(client, c.get("db"), c.get("env"));

    return c.json({ success: true, stats });
  });

  // GET /export - 供 GitHub Actions 主动拉取的全量清单（PAT 鉴权，只读）
  app.get("/export", async (c: AppContext) => {
    const settings = await getGitHubSettings(c.get("serverConfig"), c.get("env"));
    if (!settings || extractAuthToken(c.req.header("Authorization")) !== settings.token) {
      return c.text("Unauthorized", 401);
    }

    const payload = await buildGitHubExport(c.get("db"), c.get("env"));
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
