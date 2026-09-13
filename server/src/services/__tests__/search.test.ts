import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { SearchService } from "../feed";
import type { Variables } from "../../core/hono-types";
import { cleanupTestDB, createTestUser, setupTestApp } from "../../../tests/fixtures";

interface SearchResponse {
    size: number;
    data: Array<{ id: number; title: string; avatar?: string | null }>;
    hasNext: boolean;
}

function insertFeed(sqlite: Database, id: number, title: string, content: string, draft = 0) {
    sqlite.exec(
        `INSERT INTO feeds (id, title, content, summary, uid, draft, listed, created_at, updated_at)
         VALUES (${id}, '${title}', '${content}', '', 1, ${draft}, 1, unixepoch(), unixepoch())`,
    );
}

describe("SearchService", () => {
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const ctx = await setupTestApp(SearchService);
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        await createTestUser(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function search(keyword: string, query = ""): Promise<SearchResponse> {
        const res = await app.request(`/${encodeURIComponent(keyword)}${query}`, { method: "GET" }, env);
        expect(res.status).toBe(200);
        return (await res.json()) as SearchResponse;
    }

    it("matches titles", async () => {
        insertFeed(sqlite, 1, "Cloudflare Workers", "body one");
        insertFeed(sqlite, 2, "Something else", "body two");

        const result = await search("Cloudflare");
        expect(result.size).toBe(1);
        expect(result.data[0]?.id).toBe(1);
    });

    it("hides drafts from anonymous visitors", async () => {
        insertFeed(sqlite, 1, "Published", "body", 0);
        insertFeed(sqlite, 2, "Hidden draft", "body", 1);

        const result = await search("body");
        expect(result.data.map((feed) => feed.id)).toEqual([1]);
    });

    it("returns an empty result for a blank keyword", async () => {
        insertFeed(sqlite, 1, "Anything", "body");
        expect((await search("   ")).size).toBe(0);
    });

    it("treats % as a literal instead of a wildcard", async () => {
        insertFeed(sqlite, 1, "Save 100% today", "body");
        insertFeed(sqlite, 2, "Completely different", "body");

        const result = await search("%");
        // Unescaped, `%` becomes "match anything" and both feeds come back.
        expect(result.data.map((feed) => feed.id)).toEqual([1]);
    });

    it("treats _ as a literal instead of a single-character wildcard", async () => {
        insertFeed(sqlite, 1, "snake_case_name", "body");
        insertFeed(sqlite, 2, "snakeXcaseXname", "body");

        const result = await search("_");
        expect(result.data.map((feed) => feed.id)).toEqual([1]);
    });

    it("exposes avatar so cards render the same as in the feed list", async () => {
        insertFeed(sqlite, 1, "With cover", "![cover](https://example.com/a.png)\n\ntext");

        const result = await search("With cover");
        expect(result.data[0]?.avatar).toBe("https://example.com/a.png");
    });

    describe("pagination", () => {
        beforeEach(() => {
            for (let id = 1; id <= 25; id += 1) {
                insertFeed(sqlite, id, `Common ${id}`, "shared body");
            }
        });

        it("reports the total size alongside the page", async () => {
            const result = await search("shared", "?limit=20");
            expect(result.size).toBe(25);
            expect(result.data.length).toBe(20);
            expect(result.hasNext).toBe(true);
        });

        it("returns the remainder on the last page", async () => {
            const result = await search("shared", "?page=2&limit=20");
            expect(result.data.length).toBe(5);
            expect(result.hasNext).toBe(false);
        });

        it("returns no data past the last page", async () => {
            const result = await search("shared", "?page=3&limit=20");
            expect(result.size).toBe(25);
            expect(result.data).toEqual([]);
            expect(result.hasNext).toBe(false);
        });
    });
});
