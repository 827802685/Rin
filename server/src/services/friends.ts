import { eq, isNotNull, ne, and } from "drizzle-orm";
import { Hono } from "hono";
import {
    describeIssues,
    friendCreateSchema,
    friendUpdateSchema,
    parseSchema,
} from "@rin/api";
import type { AppContext, CacheImpl, DB } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import * as schema from "../db/schema";
import { friends } from "../db/schema";
import { notify } from "../utils/webhook";
import { resolveWebhookConfig } from "./config-helpers";

export function FriendService(): Hono {
    const app = new Hono();

    // GET /friend
    app.get('/', async (c: AppContext) => {
        const admin = c.get('admin');
        const uid = c.get('uid');
        const db = c.get('db');
        
        const friend_list = await profileAsync(c, 'friend_list_db', () => (admin
            ? db.query.friends.findMany({
                orderBy: (friends: any, { asc, desc }: { asc: any, desc: any }) => [
                    desc(friends.sort_order), 
                    asc(friends.createdAt)
                ]
            })
            : db.query.friends.findMany({
                where: eq(friends.accepted, 1),
                orderBy: (friends: any, { asc, desc }: { asc: any, desc: any }) => [
                    desc(friends.sort_order), 
                    asc(friends.createdAt)
                ]
            })));
            
        const apply_list = uid ? await profileAsync(c, 'friend_apply_lookup', () => db.query.friends.findFirst({ where: eq(friends.uid, uid) })) : null;
        return c.json({ friend_list, apply_list });
    });

    // GET /friend/circle —— 友链动态聚合（朋友圈）
    // 拉取每个配置了 rss 的友链站点的订阅源，解析出最新文章，按站点聚合返回。
    // 结果内存缓存 30 分钟，避免每次访问都打满出站请求。
    const CIRCLE_TTL_MS = 30 * 60 * 1000;
    const CIRCLE_FETCH_TIMEOUT_MS = 6000;
    const CIRCLE_ITEMS_PER_SITE = 5;
    let circleCache: { at: number; data: unknown } | null = null;

    app.get('/circle', async (c: AppContext) => {
        if (circleCache && Date.now() - circleCache.at < CIRCLE_TTL_MS) {
            return c.json(circleCache.data);
        }

        const db = c.get('db');
        const list = await profileAsync(c, 'circle_db', () => db.query.friends.findMany({
            where: and(eq(friends.accepted, 1), isNotNull(friends.rss), ne(friends.rss, '')),
            orderBy: (friends: any, { desc, asc }: { desc: any, asc: any }) => [desc(friends.sort_order), asc(friends.createdAt)],
        }));

        const sites = await Promise.all(list.map(async (friend: typeof friends.$inferSelect) => {
            const items = await fetchFeedItems(friend.rss as string, CIRCLE_FETCH_TIMEOUT_MS, CIRCLE_ITEMS_PER_SITE);
            return {
                id: friend.id,
                name: friend.name,
                avatar: friend.avatar,
                url: friend.url,
                items,
            };
        }));

        const data = { sites, updated_at: new Date().toISOString() };
        circleCache = { at: Date.now(), data };
        return c.json(data);
    });

    // POST /friend
    app.post('/', async (c: AppContext) => {
        const admin = c.get('admin');
        const uid = c.get('uid');
        const username = c.get('username');
        const db = c.get('db');
        const env = c.get('env');
        const clientConfig = c.get('clientConfig');
        const serverConfig = c.get('serverConfig');
        const body = await profileAsync(c, 'friend_create_parse', () => c.req.json());

        const enable = await profileAsync(c, 'friend_create_config', () => clientConfig.getOrDefault('friend_apply_enable', true));
        if (!enable && !admin) {
            return c.text('Friend Link Apply Disabled', 403);
        }

        const parsed = parseSchema<{ name: string; desc: string; avatar: string; url: string }>(
            friendCreateSchema,
            body,
        );
        if (!parsed.success) {
            return c.text(describeIssues(parsed.issues), 400);
        }

        const { name, desc, avatar, url } = parsed.data;

        if (!uid) {
            return c.text('Unauthorized', 401);
        }
        
        if (!admin) {
            const exist = await profileAsync(c, 'friend_create_existing', () => db.query.friends.findFirst({ where: eq(friends.uid, uid) }));
            if (exist) {
                return c.text('Already sent', 400);
            }
        }
        
        const accepted = admin ? 1 : 0;
        await profileAsync(c, 'friend_create_insert', () => db.insert(friends).values({
            name, desc, avatar, url, uid: uid, accepted
        }));

        if (!admin) {
            const {
                webhookUrl,
                webhookMethod,
                webhookContentType,
                webhookHeaders,
                webhookBodyTemplate,
            } = await profileAsync(c, 'friend_create_webhook_config', () => resolveWebhookConfig(serverConfig, env));
            const frontendUrl = new URL(c.req.url).origin;
            const content = `${frontendUrl}/friends\n${username} 申请友链: ${name}\n${desc}\n${url}`;
            await profileAsync(c, 'friend_create_notify', () => notify(
                webhookUrl || "",
                {
                    event: "friend.created",
                    message: content,
                    title: name,
                    url: `${frontendUrl}/friends`,
                    username: username || "",
                    content: url,
                    description: desc,
                },
                {
                    method: webhookMethod,
                    contentType: webhookContentType,
                    headers: webhookHeaders,
                    bodyTemplate: webhookBodyTemplate,
                },
            ));
        }
        return c.text('OK');
    });

    // PUT /friend/:id
    app.put('/:id', async (c: AppContext) => {
        const admin = c.get('admin');
        const uid = c.get('uid');
        const username = c.get('username');
        const db = c.get('db');
        const env = c.get('env');
        const clientConfig = c.get('clientConfig');
        const serverConfig = c.get('serverConfig');
        const id = c.req.param('id');
        const body = await profileAsync(c, 'friend_update_parse', () => c.req.json());
        
        const enable = await profileAsync(c, 'friend_update_config', () => clientConfig.getOrDefault('friend_apply_enable', true));
        if (!enable && !admin) {
            return c.text('Friend Link Apply Disabled', 403);
        }
        
        if (!uid) {
            return c.text('Unauthorized', 401);
        }
        
        const exist = await profileAsync(c, 'friend_update_lookup', () => db.query.friends.findFirst({ where: eq(friends.id, parseInt(id)) }));
        if (!exist) {
            return c.text('Not found', 404);
        }
        
        if (!admin && exist.uid !== uid) {
            return c.text('Permission denied', 403);
        }

        const parsed = parseSchema<{
            name?: string;
            desc?: string;
            avatar?: string;
            url?: string;
            rss?: string;
            accepted?: number;
            sort_order?: number;
        }>(friendUpdateSchema, body);
        if (!parsed.success) {
            return c.text(describeIssues(parsed.issues), 400);
        }

        const { name, desc, avatar, url, rss, accepted, sort_order } = parsed.data;

        let finalAccepted = accepted;
        let finalSortOrder = sort_order;
        
        if (!admin) {
            finalAccepted = 0;
            finalSortOrder = undefined;
        }
        
        function wrap(s: string | undefined) {
            return s ? s.length === 0 ? undefined : s : undefined;
        }
        
        await profileAsync(c, 'friend_update_db', () => db.update(friends).set({
            name: wrap(name),
            desc: wrap(desc),
            avatar: wrap(avatar),
            url: wrap(url),
            rss: wrap(rss),
            accepted: finalAccepted === undefined ? undefined : finalAccepted,
            sort_order: finalSortOrder === undefined ? undefined : finalSortOrder,
        }).where(eq(friends.id, parseInt(id))));
        
        if (!admin) {
            const {
                webhookUrl,
                webhookMethod,
                webhookContentType,
                webhookHeaders,
                webhookBodyTemplate,
            } = await profileAsync(c, 'friend_update_webhook_config', () => resolveWebhookConfig(serverConfig, env));
            const frontendUrl = new URL(c.req.url).origin;
            const content = `${frontendUrl}/friends\n${username} 更新友链: ${name}\n${desc}\n${url}`;
            await profileAsync(c, 'friend_update_notify', () => notify(
                webhookUrl || "",
                {
                    event: "friend.updated",
                    message: content,
                    title: name,
                    url: `${frontendUrl}/friends`,
                    username: username || "",
                    content: url,
                    description: desc,
                },
                {
                    method: webhookMethod,
                    contentType: webhookContentType,
                    headers: webhookHeaders,
                    bodyTemplate: webhookBodyTemplate,
                },
            ));
        }
        return c.text('OK');
    });

    // DELETE /friend/:id
    app.delete('/:id', async (c: AppContext) => {
        const admin = c.get('admin');
        const uid = c.get('uid');
        const db = c.get('db');
        const id = c.req.param('id');
        
        if (!uid) {
            return c.text('Unauthorized', 401);
        }
        
        const exist = await profileAsync(c, 'friend_delete_lookup', () => db.query.friends.findFirst({ where: eq(friends.id, parseInt(id)) }));
        if (!exist) {
            return c.text('Not found', 404);
        }
        
        if (!admin && exist.uid !== uid) {
            return c.text('Permission denied', 403);
        }
        
        await profileAsync(c, 'friend_delete_db', () => db.delete(friends).where(eq(friends.id, parseInt(id))));
        return c.text('OK');
    });

    return app;
}

export async function friendCrontab(
    env: Env,
    ctx: ExecutionContext,
    db: DB,
    cache: CacheImpl,
    serverConfig: CacheImpl,
    clientConfig: CacheImpl
) {
    const enable = await serverConfig.getOrDefault('friend_crontab', true);
    const ua = await serverConfig.get('friend_ua') || 'Rin-Check/0.1.0';
    
    if (!enable) {
        console.info('friend crontab disabled');
        return;
    }
    
    const friend_list = await db.query.friends.findMany();
    console.info(`total friends: ${friend_list.length}`);
    
    let health = 0;
    let unhealthy = 0;
    
    for (const friend of friend_list) {
        console.info(`checking ${friend.name}: ${friend.url}`);
        try {
            const response = await fetch(new Request(friend.url, { 
                method: 'GET', 
                headers: { 'User-Agent': ua } 
            }));
            console.info(`response status: ${response.status}`);
            console.info(`response statusText: ${response.statusText}`);
            
            if (response.ok) {
                ctx.waitUntil(db.update(schema.friends).set({ health: "" }).where(eq(schema.friends.id, friend.id)));
                health++;
            } else {
                ctx.waitUntil(db.update(schema.friends).set({ health: `${response.status}` }).where(eq(schema.friends.id, friend.id)));
                unhealthy++;
            }
        } catch (e: any) {
            console.error(e.message);
            ctx.waitUntil(db.update(schema.friends).set({ health: e.message }).where(eq(schema.friends.id, friend.id)));
            unhealthy++;
        }
    }
    
    console.info(`update friends health done. Total: ${health + unhealthy}, Healthy: ${health}, Unhealthy: ${unhealthy}`);
}

// ============================================================================
// 友链动态聚合（朋友圈）：轻量 RSS 2.0 / Atom 解析
// 不引入 XML 依赖——订阅源结构可预期，正则 + 状态机足够，且零包体开销。
// ============================================================================

/** 解码 XML 常见实体（含 CDATA 剥离后的残留） */
export function decodeXmlEntities(input: string): string {
    return input
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 10)))
        .replace(/&amp;/g, "&");
}

/** 提取标签内文本并解码实体（CDATA 已在上游统一剥离） */
function tagText(block: string, tag: string): string {
    const source = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] || "";
    return decodeXmlEntities(source.trim());
}

/** 解析单个 RSS/Atom 条目块的链接（Atom 用 href 属性，RSS 用标签文本） */
function entryLink(block: string): string {
    const href = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/);
    if (href) return decodeXmlEntities(href[1].trim());
    const plain = block.match(/<link[^>]*>([\s\S]*?)<\/link>/);
    return plain ? decodeXmlEntities(plain[1].trim()) : "";
}

/** 解析单个条目块的发布时间（RSS pubDate / Atom updated|published） */
function entryDate(block: string): string | null {
    const raw =
        block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1] ||
        block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/)?.[1] ||
        block.match(/<published[^>]*>([\s\S]*?)<\/published>/)?.[1] ||
        "";
    const text = decodeXmlEntities(raw.trim());
    if (!text) return null;
    const ts = Date.parse(text);
    return Number.isNaN(ts) ? null : new Date(ts).toISOString();
}

/**
 * 解析 RSS 2.0 或 Atom 订阅源，返回按时间倒序的前 max 条。
 * 解析失败（非 XML / 空源）返回空数组，不抛错——单个站点故障不影响整体聚合。
 */
export function parseFeedItems(xml: string, max: number = 5): { title: string; link: string; date: string | null }[] {
    if (!xml || !xml.includes("<")) return [];
    // 统一剥离 CDATA 包裹，避免引擎间正则解析差异（JSC 对 `!(` 后接分组有歧义）
    xml = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    const blocks = [
        ...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g),
        ...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/g),
    ].map((m) => m[0]);
    const items = blocks.map((block) => ({
        title: tagText(block, "title"),
        link: entryLink(block),
        date: entryDate(block),
    })).filter((item) => item.title || item.link);
    items.sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0));
    return items.slice(0, max);
}

/** 拉取单个订阅源并解析；任何错误都降级为空列表 */
export async function fetchFeedItems(rss: string, timeoutMs: number, max: number): Promise<{ title: string; link: string; date: string | null }[]> {
    try {
        const response = await fetch(rss, {
            headers: { "user-agent": "Rin-FriendCircle/1.0 (+rss aggregator)" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return [];
        const xml = await response.text();
        return parseFeedItems(xml, max);
    } catch {
        return [];
    }
}
