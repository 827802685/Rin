import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Variables } from "../core/hono-types";
import { feeds, moments } from "../db/schema";
import { bindTagToPost } from "./tag";
import { clearFeedCache } from "./clear-feed-cache";

/**
 * blog-markdown 导入器（P0）
 *
 * 把用户账号下 `blog-markdown` 仓库（纯 Markdown 文件库）映射进 Rin 的 feeds / moments：
 *   posts 目录下的 Markdown        -> feeds（自有文章，享受原生能力）
 *   blog 目录下的 Markdown         -> feeds（页面/随笔，无 frontmatter 时取文件名/首 H1 当标题）
 *   moments 目录下的 Markdown      -> moments
 *   media 目录                     -> 仅收集正文中的媒体引用，供外部重写（上传 R2 后替换）
 *   openlist 目录                  -> 忽略（自定义文本）
 *
 * 解析逻辑保持纯函数、可独立测试；Hono 服务仅负责鉴权、DB 写入与缓存失效。
 */

export interface FeedInput {
    title: string;
    content: string;
    summary: string;
    alias?: string;
    slug?: string;
    category?: string;
    cover?: string;
    tags: string[];
    draft: boolean;
    listed: boolean;
    createdAt: Date;
}

export interface MomentInput {
    content: string;
    createdAt: Date;
}

export interface TransformResult {
    feeds: FeedInput[];
    moments: MomentInput[];
    mediaRefs: string[];
    skipped: { path: string; reason: string }[];
}

/** 极简 frontmatter 解析（key: value 逐行，支持双/单引号包裹）。不引入额外依赖。 */
export function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
    const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!fmMatch) return { data: {}, content: raw };
    const data: Record<string, string> = {};
    for (const line of fmMatch[1].split("\n")) {
        const m = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
        if (!m) continue;
        let value = m[2].trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        data[m[1]] = value;
    }
    return { data, content: raw.slice(fmMatch[0].length) };
}

export function slugify(title: string): string {
    return title
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "");
}

/** 从正文提取 #标签（排除代码块内的井号）。 */
export function extractHashtags(content: string): string[] {
    const tags = new Set<string>();
    const codeBlocks = new Set<string>();
    content.replace(/```[\s\S]*?```/g, (b) => {
        codeBlocks.add(b);
        return "";
    });
    let rest = content;
    for (const b of codeBlocks) rest = rest.replace(b, "");
    const re = /(?:^|\s)#([\p{L}\p{N}_\-]+)/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest))) tags.add(m[1]);
    return [...tags];
}

const MEDIA_RE = /gh\.zjkl0330\.dpdns\.org\/827802685\/blog-markdown\/raw\/main\/media\/([A-Za-z0-9_+/=]+)(?:\.[a-zA-Z0-9]+)?/g;

/** 收集正文中出现的 blog-markdown 媒体引用（base64 key）。 */
export function collectMediaRefs(content: string): string[] {
    const refs = new Set<string>();
    let m: RegExpExecArray | null;
    MEDIA_RE.lastIndex = 0;
    while ((m = MEDIA_RE.exec(content))) refs.add(m[1]);
    return [...refs];
}

/** 把正文里的 blog-markdown 媒体 URL 重写成目标地址（上传 R2 后调用）。 */
export function rewriteMediaUrls(
    content: string,
    rewriter: (key: string, ext: string) => string,
): string {
    return content.replace(
        /(gh\.zjkl0330\.dpdns\.org\/827802685\/blog-markdown\/raw\/main\/media\/)([A-Za-z0-9_+/=]+)(\.[a-zA-Z0-9]+)?/g,
        (_full, _prefix, key, ext) => rewriter(key, (ext || "").replace(/^\./, "")),
    );
}

function firstImageUrl(content: string): string | undefined {
    const m = content.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
    return m ? m[1] : undefined;
}

function firstH1(content: string): string | undefined {
    const m = content.match(/^\s*#\s+(.+)$/m);
    return m ? m[1].trim() : undefined;
}

function fileNameTitle(path: string): string {
    const base = path.split("/").pop() || path;
    return base.replace(/\.(md|markdown|txt)$/i, "");
}

/** 从 posts/<year>/<month>/<name>.md 推断日期（失败回退当前时间）。 */
function dateFromPath(path: string, fallback: Date): Date {
    const m = path.match(/(\d{4})[\\/](\d{1,2})[\\/]/);
    if (m) {
        const y = Number(m[1]);
        const mo = Math.min(12, Math.max(1, Number(m[2])));
        const d = new Date(Date.UTC(y, mo - 1, 1));
        if (!Number.isNaN(d.getTime())) return d;
    }
    return fallback;
}

export function transformPost(path: string, raw: string, now: Date = new Date()): FeedInput {
    const { data, content } = parseFrontmatter(raw);
    const title = data.title || firstH1(content) || fileNameTitle(path);
    const summary = data.summary || "";
    const alias = data.alias || undefined;
    const slug = data.slug || data.alias || slugify(title);
    const category = data.category || undefined;
    const createdAt = data.date ? new Date(data.date) : dateFromPath(path, now);
    return {
        title,
        content,
        summary,
        alias,
        slug,
        category,
        cover: firstImageUrl(content),
        tags: extractHashtags(content),
        draft: false,
        listed: true,
        createdAt: Number.isNaN(createdAt.getTime()) ? now : createdAt,
    };
}

export function transformMoment(path: string, raw: string, now: Date = new Date()): MomentInput {
    const { data, content } = parseFrontmatter(raw);
    const createdAt = data.date ? new Date(data.date) : dateFromPath(path, now);
    return {
        content,
        createdAt: Number.isNaN(createdAt.getTime()) ? now : createdAt,
    };
}

/** 主入口：把文件树（path -> 原文）转换为可插入的 feeds / moments 计划。 */
export function transformBlogMarkdown(
    files: Record<string, string>,
    now: Date = new Date(),
): TransformResult {
    const result: TransformResult = { feeds: [], moments: [], mediaRefs: [], skipped: [] };
    const media = new Set<string>();

    for (const [path, raw] of Object.entries(files)) {
        const norm = path.replace(/\\/g, "/");
        if (norm.startsWith("openlist/")) continue;
        if (norm.startsWith("media/")) continue;

        if (/^moments\//i.test(norm)) {
            result.moments.push(transformMoment(norm, raw, now));
            continue;
        }
        if (/^(posts|blog)\//i.test(norm)) {
            if (!raw || raw.trim().length === 0) {
                result.skipped.push({ path: norm, reason: "empty" });
                continue;
            }
            const feed = transformPost(norm, raw, now);
            for (const ref of collectMediaRefs(feed.content)) media.add(ref);
            result.feeds.push(feed);
            continue;
        }
        // 其它顶层文件（README 等）忽略
    }

    result.mediaRefs = [...media];
    return result;
}

export function MarkdownImportService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    // POST /import/markdown
    app.post("/markdown", async (c) => {
        const db = c.get("db");
        const cache = c.get("cache");
        const admin = c.get("admin");
        const uid = c.get("uid");

        if (!admin) {
            return c.text("Permission denied", 403);
        }

        const body = (await c.req.json()) as {
            files?: Record<string, string>;
            mediaBaseUrl?: string;
        };

        if (!body.files || Object.keys(body.files).length === 0) {
            return c.text("files is required", 400);
        }

        const plan = transformBlogMarkdown(body.files);

        const mediaBaseUrl = body.mediaBaseUrl;
        if (mediaBaseUrl) {
            for (const feed of plan.feeds) {
                feed.content = rewriteMediaUrls(feed.content, (key, ext) =>
                    ext ? `${mediaBaseUrl}/${key}.${ext}` : `${mediaBaseUrl}/${key}`,
                );
                const rewrittenCover = feed.cover
                    ? rewriteMediaUrls(feed.cover, (key, ext) =>
                          ext ? `${mediaBaseUrl}/${key}.${ext}` : `${mediaBaseUrl}/${key}`,
                      )
                    : undefined;
                if (rewrittenCover) feed.cover = rewrittenCover;
            }
        }

        let success = 0;
        let skipped = 0;
        const skippedList: { title: string; reason: string }[] = [];

        for (const item of plan.feeds) {
            const exist = await db.query.feeds.findFirst({
                where: eq(feeds.title, item.title),
            });
            if (exist) {
                skippedList.push({ title: item.title, reason: "title exists" });
                skipped++;
                continue;
            }
            const inserted = await db.insert(feeds).values({
                title: item.title,
                content: item.content,
                summary: item.summary,
                alias: item.alias,
                slug: item.slug,
                cover: item.cover,
                category: item.category,
                uid: uid ?? 1,
                listed: item.listed ? 1 : 0,
                draft: item.draft ? 1 : 0,
                createdAt: item.createdAt,
                updatedAt: item.createdAt,
            }).returning({ insertedId: feeds.id });

            if (item.tags.length > 0) {
                await bindTagToPost(db, inserted[0].insertedId, item.tags);
            }
            await clearFeedCache(cache, inserted[0].insertedId, item.alias || null, null);
            success++;
        }

        let momentsSuccess = 0;
        for (const m of plan.moments) {
            await db.insert(moments).values({
                content: m.content,
                uid: uid ?? 1,
                createdAt: m.createdAt,
                updatedAt: m.createdAt,
            });
            momentsSuccess++;
        }

        return c.json({
            success,
            skipped,
            skippedList,
            moments: momentsSuccess,
            mediaRefs: plan.mediaRefs,
        });
    });

    return app;
}
