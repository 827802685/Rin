import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "../../db/schema";
import { feeds, users } from "../../db/schema";
import { extractWikiLinks, resolveBacklinks } from "../wikilinks";

function createTestDB() {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, openid TEXT NOT NULL, avatar TEXT, password TEXT, permission INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE feeds (
            id INTEGER PRIMARY KEY, alias TEXT, title TEXT, summary TEXT DEFAULT '', ai_summary TEXT DEFAULT '', ai_summary_status TEXT DEFAULT '', ai_summary_error TEXT DEFAULT '',
            content TEXT NOT NULL, listed INTEGER DEFAULT 1, draft INTEGER DEFAULT 1, top INTEGER DEFAULT 0,
            slug TEXT, cover TEXT, category TEXT, likes INTEGER DEFAULT 0 NOT NULL, uid INTEGER, created_at INTEGER, updated_at INTEGER
        );
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
        { id: 1, title: "A", content: "see [[B]] and [[C|alias]]", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 2, title: "B", alias: "bee", content: "body", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 3, title: "C", content: "body", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 0 },
        { id: 4, title: "B", content: "draft body", uid: 1, createdAt: new Date(now), updatedAt: new Date(now), listed: 1, draft: 1 },
    ]);
});

afterEach(() => sqlite.close());

describe("extractWikiLinks", () => {
    it("parses [[Target]] and [[Target|Alias]]", () => {
        expect(extractWikiLinks("see [[Note A]] and [[Note B|link]]")).toEqual(["Note A", "Note B"]);
    });
    it("returns empty when no links", () => {
        expect(extractWikiLinks("plain text")).toEqual([]);
    });
    it("dedupes case-insensitively", () => {
        expect(extractWikiLinks("[[A]] [[a]] [[A]]")).toEqual(["A"]);
    });
});

describe("resolveBacklinks", () => {
    it("finds published feeds linking to the target by title or alias", async () => {
        const bl = await resolveBacklinks(db as any, 2, { title: "B", alias: "bee" });
        const ids = bl.map((b) => b.id).sort();
        expect(ids).toEqual([1]); // f1 links via [[B]] and [[bee]]
    });
    it("excludes drafts and self", async () => {
        const bl = await resolveBacklinks(db as any, 2, { title: "B", alias: "bee" });
        expect(bl.map((b) => b.id)).not.toContain(4); // draft
        expect(bl.map((b) => b.id)).not.toContain(2); // self
    });
    it("returns empty when no identifiers", async () => {
        const bl = await resolveBacklinks(db as any, 1, {});
        expect(bl).toEqual([]);
    });
});
