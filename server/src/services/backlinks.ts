import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Variables } from "../core/hono-types";
import { feeds } from "../db/schema";
import { resolveBacklinks } from "../utils/wikilinks";

export function BacklinksService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    // GET /backlinks/:id  —— 返回指向该文章的反链（双向链接）
    app.get("/:id", async (c) => {
        const db = c.get("db");
        const id = Number(c.req.param("id"));
        if (!Number.isInteger(id) || id <= 0) {
            return c.text("Invalid id", 400);
        }

        const feed = await db.query.feeds.findFirst({
            where: eq(feeds.id, id),
            columns: { id: true, title: true, alias: true, slug: true },
        });
        if (!feed) {
            return c.text("Not found", 404);
        }

        const backlinks = await resolveBacklinks(db, id, {
            title: feed.title ?? "",
            alias: feed.alias ?? undefined,
            slug: feed.slug ?? undefined,
        });
        return c.json(backlinks);
    });

    return app;
}