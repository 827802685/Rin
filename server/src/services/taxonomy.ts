import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { DB, Variables } from "../core/hono-types";
import { feedHashtags, feeds } from "../db/schema";

export interface RelatedFeed {
    id: number;
    title: string;
    summary: string;
    slug: string | null;
    shared: number;
    createdAt: Date | null;
}

export interface CategoryCount {
    category: string;
    count: number;
}

/**
 * 相关文章：按「共享标签数」排序，返回与给定文章标签重合最多的已发布文章。
 * 用于文章详情页底部的「相关阅读」。
 */
export async function getRelatedFeeds(
    db: DB,
    feedId: number,
    limit = 5,
): Promise<RelatedFeed[]> {
    const own = await db
        .select({ hid: feedHashtags.hashtagId })
        .from(feedHashtags)
        .where(eq(feedHashtags.feedId, feedId));
    const tagIds = own.map((r) => r.hid);
    if (tagIds.length === 0) return [];

    const rows = await db
        .select({ feedId: feeds.id, shared: sql<number>`count(*) as shared` })
        .from(feeds)
        .innerJoin(feedHashtags, eq(feeds.id, feedHashtags.feedId))
        .where(
            and(
                inArray(feedHashtags.hashtagId, tagIds),
                ne(feeds.id, feedId),
                eq(feeds.draft, 0),
                eq(feeds.listed, 1),
            ),
        )
        .groupBy(feeds.id)
        .orderBy(desc(sql`shared`))
        .limit(limit);

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.feedId);
    const details = await db.query.feeds.findMany({
        where: inArray(feeds.id, ids),
        columns: { id: true, title: true, summary: true, slug: true, createdAt: true },
    });
    const sharedMap = new Map(rows.map((r) => [r.feedId, Number(r.shared)]));
    return details.map((d) => ({
        id: d.id,
        title: d.title ?? "",
        summary: d.summary,
        slug: d.slug ?? null,
        createdAt: d.createdAt ?? null,
        shared: sharedMap.get(d.id) ?? 0,
    }));
}

/**
 * 分类聚合：统计每个非空 category 下的已发布文章数，按数量降序。
 * 用于「分类」聚合页 / 侧栏。区别于扁平 hashtags。
 */
export async function getCategoriesWithCounts(db: DB): Promise<CategoryCount[]> {
    const rows = await db
        .select({
            category: feeds.category,
            count: sql<number>`count(*) as c`,
        })
        .from(feeds)
        .where(
            and(
                eq(feeds.draft, 0),
                eq(feeds.listed, 1),
                sql`${feeds.category} IS NOT NULL`,
            ),
        )
        .groupBy(feeds.category)
        .orderBy(desc(sql`c`));

    return rows
        .filter((r) => r.category)
        .map((r) => ({ category: r.category as string, count: Number(r.count) }));
}

export function TaxonomyService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    // GET /taxonomy/categories
    app.get("/categories", async (c) => {
        const db = c.get("db");
        const categories = await getCategoriesWithCounts(db);
        return c.json(categories);
    });

    // GET /taxonomy/related/:id
    app.get("/related/:id", async (c) => {
        const db = c.get("db");
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id <= 0) {
            return c.text("Invalid id", 400);
        }
        const related = await getRelatedFeeds(db, id);
        return c.json(related);
    });

    return app;
}
