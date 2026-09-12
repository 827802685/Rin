import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { SEOService } from "../seo";
import type { Variables } from "../../core/hono-types";
import { cleanupTestDB, setupTestApp } from "../../../tests/fixtures";

describe("SEOService", () => {
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const ctx = await setupTestApp(SEOService);
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;

        sqlite.exec(`
            INSERT INTO users (id, username, avatar, openid) VALUES (1, 'testuser', 'avatar.png', 'gh_test')
        `);
        sqlite.exec(`
            INSERT INTO feeds (id, title, content, summary, uid, draft, listed, created_at, updated_at) VALUES
                (1, 'Published Feed', '# Hello', 'Summary 1', 1, 0, 1, unixepoch(), unixepoch()),
                (2, 'Draft Feed', 'Draft content', '', 1, 1, 1, unixepoch(), unixepoch()),
                (3, 'Unlisted Feed', 'Hidden', '', 1, 0, 0, unixepoch(), unixepoch())
        `);
        sqlite.exec(`
            INSERT INTO hashtags (id, name) VALUES (1, 'Cloudflare'), (2, 'Rin')
        `);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    describe("GET /sitemap.xml", () => {
        it("lists only published and listed articles", async () => {
            const res = await app.request("/sitemap.xml", { method: "GET" }, env);

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toBe("application/xml; charset=UTF-8");

            const text = await res.text();
            expect(text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
            expect(text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
            expect(text).toContain("<loc>http://localhost/feed/1</loc>");
            expect(text).not.toContain("/feed/2");
            expect(text).not.toContain("/feed/3");
        });

        it("includes the home page and tag pages", async () => {
            const res = await app.request("/sitemap.xml", { method: "GET" }, env);
            const text = await res.text();

            expect(text).toContain("<loc>http://localhost/</loc>");
            expect(text).toContain("<loc>http://localhost/hashtag/Cloudflare</loc>");
            expect(text).toContain("<loc>http://localhost/hashtag/Rin</loc>");
        });

        it("emits a lastmod timestamp for articles", async () => {
            const res = await app.request("/sitemap.xml", { method: "GET" }, env);
            const text = await res.text();

            expect(text).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}T/);
        });
    });

    describe("GET /robots.txt", () => {
        it("allows crawling and points at the sitemap", async () => {
            const res = await app.request("/robots.txt", { method: "GET" }, env);

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");

            const text = await res.text();
            expect(text).toContain("User-agent: *");
            expect(text).toContain("Allow: /");
            expect(text).toContain("Disallow: /admin");
            expect(text).toContain("Sitemap: http://localhost/sitemap.xml");
        });
    });
});
