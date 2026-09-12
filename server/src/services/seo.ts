import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppContext, DB, Variables } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { feeds, hashtags } from "../db/schema";

/**
 * Sitemap/robots generation.
 *
 * Both documents are served from the site root (like the RSS feeds) because
 * crawlers only look for them at `https://example.com/sitemap.xml`.
 */

const SITEMAP_MAX_ENTRIES = 5000;
const SITEMAP_CACHE_SECONDS = 300;
const ROBOTS_CACHE_SECONDS = 3600;

/** Paths crawlers should not waste budget on. */
const DISALLOWED_PATHS = ["/admin", "/api", "/writing", "/profile"];

function escapeXml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function toIsoDate(value: Date | number | string | null | undefined): string {
    if (!value) {
        return new Date().toISOString();
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

interface SitemapEntry {
    loc: string;
    lastmod?: string;
}

function renderSitemap(entries: SitemapEntry[]): string {
    const urls = entries
        .map((entry) => {
            const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : "";
            return `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>${lastmod}\n  </url>`;
        })
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function renderRobots(origin: string): string {
    const disallow = DISALLOWED_PATHS.map((path) => `Disallow: ${path}`).join("\n");

    return [
        "User-agent: *",
        "Allow: /",
        disallow,
        "",
        `Sitemap: ${origin}/sitemap.xml`,
        "",
    ].join("\n");
}

async function collectSitemapEntries(db: DB, origin: string): Promise<SitemapEntry[]> {
    const entries: SitemapEntry[] = [
        { loc: `${origin}/`, lastmod: toIsoDate(new Date()) },
    ];

    const published = await db.query.feeds.findMany({
        where: and(eq(feeds.draft, 0), eq(feeds.listed, 1)),
        columns: { id: true, updatedAt: true, createdAt: true },
        orderBy: [desc(feeds.updatedAt)],
        limit: SITEMAP_MAX_ENTRIES,
    });

    for (const feed of published) {
        entries.push({
            loc: `${origin}/feed/${feed.id}`,
            lastmod: toIsoDate(feed.updatedAt ?? feed.createdAt),
        });
    }

    const tags = await db.query.hashtags.findMany({
        columns: { name: true },
        limit: SITEMAP_MAX_ENTRIES,
    });

    for (const tag of tags) {
        if (!tag.name) {
            continue;
        }
        entries.push({
            loc: `${origin}/hashtag/${encodeURIComponent(tag.name)}`,
        });
    }

    return entries.slice(0, SITEMAP_MAX_ENTRIES);
}

export function SEOService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // GET /sitemap.xml
    app.get("/sitemap.xml", async (c: AppContext) => {
        const db = c.get("db");
        const origin = new URL(c.req.url).origin;

        try {
            const entries = await profileAsync(c, "seo_sitemap_collect", () => collectSitemapEntries(db, origin));

            return c.text(renderSitemap(entries), 200, {
                "Content-Type": "application/xml; charset=UTF-8",
                "Cache-Control": `public, max-age=${SITEMAP_CACHE_SECONDS}`,
            });
        } catch (error: any) {
            console.error("[SEO] Sitemap generation failed:", error);
            return c.text(`Sitemap generation failed: ${error?.message ?? error}`, 500);
        }
    });

    // GET /robots.txt
    app.get("/robots.txt", async (c: AppContext) => {
        const origin = new URL(c.req.url).origin;

        return c.text(renderRobots(origin), 200, {
            "Content-Type": "text/plain; charset=UTF-8",
            "Cache-Control": `public, max-age=${ROBOTS_CACHE_SECONDS}`,
        });
    });

    return app;
}
