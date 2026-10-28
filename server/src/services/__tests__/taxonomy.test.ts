import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../../db/schema";
import { feeds, hashtags, feedHashtags, users } from "../../db/schema";
import { getRelatedFeeds, getCategoriesWithCounts } from "../taxonomy";

function createTestDB() {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, openid TEXT NOT NULL, avatar TEXT, password TEXT, permission INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE feeds (
            id INTEGER PRIMARY KEY, alias TEXT, title TEXT, summary TEXT DEFAULT '', ai_summary TEXT DEFAULT '', ai_summary_status TEXT DEFAULT '', ai_summary_error TEXT DEFAULT '',
            content TEXT NOT NULL, listed INTEGER DEFAULT 1, draft INTEGER DEFAULT 1, top INTEGER DEFAULT 0,
            slug TEXT, cover TEXT, category TEXT, uid INTEGER, created_at INTEGER, updated_at INTEGER
        );
        CREATE TABLE hashtags (id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE feed_hashtags (id INTEGER PRIMARY KEY, feed_id INTEGER, hashtag_id INTEGER, created_at INTEGER, updated_at INTEGER);
    `);
    const db = drizzle(sqlite, { schema });
    return { db, sqlite };
}

let db: ReturnType<typeof drizzle>;
let sqlite: Database;

beforeEach(async () => {
    const t = createTestDB();
    db = t.db;
    sqlite = t.sqlite;
    await db.insert(users).values({ id: 1, username: "u", openid: "o" });
    const now = Date.now();
    await db.insert(feeds).values([
        { id: 1, title: "A", content: "a", category: "技术", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 2, title: "B", content: "b", category: "技术", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 3, title: "C", content: "c", category: "生活", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 4, title: "D", content: "d", category: "技术", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 1 },
    ]);
    const h = await db.insert(hashtags).values([{ name: "x" }, { name: "y" }, { name: "z" }]).returning({ id: hashtags.id });
    const [x, y, z] = h;
    await db.insert(feedHashtags).values([
        { feedId: 1, hashtagId: x.id },
        { feedId: 1, hashtagId: y.id },
        { feedId: 2, hashtagId: y.id },
        { feedId: 2, hashtagId: z.id },
        { feedId: 3, hashtagId: x.id },
        { feedId: 4, hashtagId: x.id },
    ]);
});

afterEach(() => sqlite.close());

describe("getRelatedFeeds", () => {
    it("returns published feeds sharing tags, excluding self and drafts", async () => {
        const related = await getRelatedFeeds(db as any, 1);
        const ids = related.map((r) => r.id);
        expect(ids).toContain(2);
        expect(ids).toContain(3);
        expect(ids).not.toContain(1); // self
        expect(ids).not.toContain(4); // draft
    });

    it("excludes drafts from related results", async () => {
        const related = await getRelatedFeeds(db as any, 3); // 与 feed1(已发布) 和 feed4(草稿) 共享标签 x
        const ids = related.map((r) => r.id);
        expect(ids).toContain(1); // 已发布，共享 x
        expect(ids).not.toContain(4); // 草稿，应排除
        expect(ids).not.toContain(3); // 自身
    });
});

describe("getCategoriesWithCounts", () => {
    it("aggregates published feeds by category, count desc, excluding drafts", async () => {
        const cats = await getCategoriesWithCounts(db as any);
        expect(cats).toEqual([
            { category: "技术", count: 2 }, // f1, f2 (f4 draft excluded)
            { category: "生活", count: 1 }, // f3
        ]);
    });

    it("excludes feeds with null category", async () => {
        const cats = await getCategoriesWithCounts(db as any);
        expect(cats.every((c) => c.category)).toBe(true);
    });
});
