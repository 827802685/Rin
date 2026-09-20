import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { SearchService } from "../feed";
import type { Variables } from "../../core/hono-types";
import { cleanupTestDB, createTestUser, setupTestApp, type TestCacheImpl } from "../../../tests/fixtures";

interface SearchResponse {
    size: number;
    data: Array<{ id: number; title: string; avatar?: string | null }>;
    hasNext: boolean;
}

function insertFeed(sqlite: Database, id: number, title: string, content: string, draft = 0, listed = 1) {
    sqlite.exec(
        `INSERT INTO feeds (id, title, content, summary, uid, draft, listed, created_at, updated_at)
         VALUES (${id}, '${title}', '${content}', '', 1, ${draft}, ${listed}, unixepoch(), unixepoch())`,
    );
}

describe("SearchService", () => {
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let clientConfig: TestCacheImpl;

    beforeEach(async () => {
        const ctx = await setupTestApp(SearchService);
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        clientConfig = ctx.clientConfig;
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

    async function searchAsAdmin(keyword: string, query = ""): Promise<SearchResponse> {
        const res = await app.request(`/${encodeURIComponent(keyword)}${query}`, {
            method: "GET",
            headers: { Authorization: "Bearer mock_token_1" },
        }, env);
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

    it("hides unlisted articles from visitors, matching the list, RSS and sitemap", async () => {
        insertFeed(sqlite, 1, "Public one", "shared body", 0, 1);
        insertFeed(sqlite, 2, "Unlisted one", "shared body", 0, 0);

        const result = await search("shared");
        expect(result.data.map((feed) => feed.id)).toEqual([1]);
    });

    it("still lets admins find unlisted articles", async () => {
        insertFeed(sqlite, 1, "Public one", "shared body", 0, 1);
        insertFeed(sqlite, 2, "Unlisted one", "shared body", 0, 0);

        const result = await searchAsAdmin("shared");
        expect(result.data.map((feed) => feed.id).sort()).toEqual([1, 2]);
    });

    it("does not leak admin results to visitors through the cache", async () => {
        // Caching is off by default in tests, so it has to be switched on for
        // the cross-scope cache key to matter at all.
        await clientConfig.set("cache.enabled", true);

        insertFeed(sqlite, 1, "Public one", "shared body", 0, 1);
        insertFeed(sqlite, 2, "Unlisted one", "shared body", 0, 0);

        // Warm the cache with the admin view first.
        expect((await searchAsAdmin("shared")).size).toBe(2);

        // A visitor must not get the admin's cached result back.
        const visitorResult = await search("shared");
        expect(visitorResult.data.map((feed) => feed.id)).toEqual([1]);
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

        it("reports an empty result the same way the feed list does", async () => {
            const result = await search("nothing-matches-this", "?limit=20");
            expect(result).toEqual({ size: 0, data: [], hasNext: false });
        });

        it.each([
            ["0", 20, true],
            ["-5", 20, true],
            ["abc", 20, true],
            ["20px", 20, true],
            ["100", 25, false],
        ])("uses a sane page size for limit=%s instead of an empty page with hasNext", async (limit, expectedCount, expectedHasNext) => {
            const result = await search("shared", `?limit=${limit}`);
            expect(result.size).toBe(25);
            expect(result.data.length).toBe(expectedCount);
            expect(result.hasNext).toBe(expectedHasNext);
        });

        it.each([
            ["0"],
            ["-5"],
            ["abc"],
        ])("ignores a non-positive page=%s", async (page) => {
            const result = await search("shared", `?page=${page}&limit=20`);
            expect(result.data.length).toBe(20);
            expect(result.hasNext).toBe(true);
        });
    });

    it("does not reuse one page's cache entry for another page", async () => {
        await clientConfig.set("cache.enabled", true);
        for (let id = 1; id <= 25; id += 1) {
            insertFeed(sqlite, id, `Common ${id}`, "shared body");
        }

        const first = await search("shared", "?limit=20");
        const second = await search("shared", "?page=2&limit=20");

        expect(first.data.length).toBe(20);
        expect(second.data.length).toBe(5);

        const firstIds = new Set(first.data.map((feed) => feed.id));
        expect(second.data.every((feed) => !firstIds.has(feed.id))).toBe(true);
    });
});
