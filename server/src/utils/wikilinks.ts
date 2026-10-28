import { and, eq, ne, or, sql } from "drizzle-orm";
import type { DB } from "../core/hono-types";
import { feeds } from "../db/schema";

/**
 * 双向链接（wikilinks）：从正文解析 `[[目标]]` 或 `[[目标|显示名]]` 语法，
 * 并反向查找「指向本文」的其它文章，形成反链（backlinks）。
 * 这是笔记类博客的差异化能力，与扁平 hashtags 互补。
 */

/** 解析正文中的 [[Target]] / [[Target|Alias]]，返回目标标题/别名列表（去重）。 */
export function extractWikiLinks(content: string): string[] {
    const links: string[] = [];
    const seen = new Set<string>();
    const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
        const target = m[1].trim();
        if (target && !seen.has(target.toLowerCase())) {
            seen.add(target.toLowerCase());
            links.push(target);
        }
    }
    return links;
}

function likeEscape(s: string): string {
    return s.replace(/[\\%_[\]]/g, (c) => "\\" + c);
}

export interface Backlink {
    id: number;
    title: string;
    slug: string | null;
    summary: string;
}

/**
 * 反链解析：返回正文含 `[[本文标题]]` / `[[本文别名]]` / `[[本文slug]]` 的已发布文章。
 * 通过 LIKE 精确匹配 `[[标识符]]`（对 [ % _ 转义，ESCAPE '\'）。
 */
export async function resolveBacklinks(
    db: DB,
    selfId: number,
    identifiers: { title?: string; alias?: string; slug?: string },
): Promise<Backlink[]> {
    const patterns: any[] = [];
    for (const v of [identifiers.title, identifiers.alias, identifiers.slug]) {
        if (!v) continue;
        const lit = likeEscape(`[[${v}]]`);
        patterns.push(sql`${feeds.content} LIKE ${"%" + lit + "%"} ESCAPE '\\'`);
    }
    if (patterns.length === 0) return [];

    const rows = await db
        .select({ id: feeds.id, title: feeds.title, slug: feeds.slug, summary: feeds.summary })
        .from(feeds)
        .where(and(eq(feeds.draft, 0), eq(feeds.listed, 1), ne(feeds.id, selfId), or(...patterns)));

    return rows.map((r) => ({ id: r.id, title: r.title ?? "", slug: r.slug ?? null, summary: r.summary }));
}
