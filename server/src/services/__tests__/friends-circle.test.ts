import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { parseFeedItems, decodeXmlEntities, FriendService } from '../friends';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { createMockDB, setupTestApp, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';

describe('友链动态聚合：RSS/Atom 轻量解析', () => {
    it('解析 RSS 2.0（CDATA 标题 + pubDate）', () => {
        const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
    <item>
        <title><![CDATA[第一篇文章 &amp; 续]]></title>
        <link>https://a.example.com/post-1</link>
        <pubDate>Wed, 29 Oct 2026 10:00:00 GMT</pubDate>
    </item>
    <item>
        <title>旧文章</title>
        <link>https://a.example.com/post-0</link>
        <pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate>
    </item>
</channel></rss>`;
        const items = parseFeedItems(xml);
        expect(items).toHaveLength(2);
        expect(items[0].title).toBe('第一篇文章 & 续');
        expect(items[0].link).toBe('https://a.example.com/post-1');
        expect(items[0].date).toBe('2026-10-29T10:00:00.000Z');
        // 时间倒序
        expect(items[1].title).toBe('旧文章');
    });

    it('解析 Atom（entry + link href 属性 + updated）', () => {
        const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
        <title>Atom 文章</title>
        <link rel="alternate" href="https://b.example.com/atom-post"/>
        <updated>2026-10-28T08:30:00Z</updated>
    </entry>
</feed>`;
        const items = parseFeedItems(xml);
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('Atom 文章');
        expect(items[0].link).toBe('https://b.example.com/atom-post');
        expect(items[0].date).toBe('2026-10-28T08:30:00.000Z');
    });

    it('max 限制返回条数', () => {
        const blocks = Array.from({ length: 10 }, (_, i) =>
            `<item><title>t${i}</title><link>https://x/${i}</link></item>`
        ).join('');
        expect(parseFeedItems(`<rss><channel>${blocks}</channel></rss>`, 5)).toHaveLength(5);
    });

    it('非法输入降级为空数组（不抛错）', () => {
        expect(parseFeedItems('')).toEqual([]);
        expect(parseFeedItems('not xml at all')).toEqual([]);
    });

    it('解码常见 XML 实体（&amp; 最后替换避免双重解码）', () => {
        expect(decodeXmlEntities('A &amp;amp; B')).toBe('A &amp; B');
        expect(decodeXmlEntities('a&lt;b&gt; &quot;quoted&quot; &#39;s&#39;')).toBe('a<b> "quoted" \'s\'');
    });
});

describe('GET /friend/circle 聚合端点', () => {
    let db: any;
    let sqlite: Database;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    const RSS_A = `<rss><channel>
        <item><title><![CDATA[A 站新文]]></title><link>https://a.example.com/1</link><pubDate>Wed, 29 Oct 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const RSS_B = `<rss><channel>
        <item><title>B 站新文</title><link>https://b.example.com/1</link><pubDate>Thu, 30 Oct 2026 09:00:00 GMT</pubDate></item>
    </channel></rss>`;

    beforeEach(async () => {
        const ctx = await setupTestApp(FriendService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        app = ctx.app;
        sqlite.exec(`
            INSERT INTO friends (id, name, avatar, url, uid, accepted, rss) VALUES
                (1, 'A 站', 'a.png', 'https://a.example.com', 1, 1, 'https://a.example.com/rss.xml'),
                (2, 'B 站', 'b.png', 'https://b.example.com', 1, 1, 'https://b.example.com/rss.xml'),
                (3, '无 RSS 站', 'c.png', 'https://c.example.com', 1, 1, NULL),
                (4, '待审站', 'd.png', 'https://d.example.com', 1, 0, 'https://d.example.com/rss.xml')
        `);
        const fetchMock = mock(async (input: any) => {
            const url = String(input);
            if (url.includes('a.example.com')) return new Response(RSS_A, { status: 200 });
            if (url.includes('b.example.com')) return new Response(RSS_B, { status: 200 });
            return new Response('error', { status: 500 });
        });
        globalThis.fetch = fetchMock as any;
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
        mock.restore();
    });

    it('只聚合已接受且配置了 rss 的友链，返回解析后的文章', async () => {
        const res = await app.request('/circle');
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.sites).toHaveLength(2);
        const siteA = data.sites.find((s: any) => s.id === 1);
        const siteB = data.sites.find((s: any) => s.id === 2);
        expect(siteA.items[0].title).toBe('A 站新文');
        expect(siteB.items[0].link).toBe('https://b.example.com/1');
        expect(data.updated_at).toBeTruthy();
    });

    it('单个站点拉取失败不影响整体（降级为空 items）', async () => {
        sqlite.exec(`UPDATE friends SET rss = 'https://broken.example.com/rss' WHERE id = 2`);
        const res = await app.request('/circle');
        const data: any = await res.json();
        expect(data.sites).toHaveLength(2);
        const siteB = data.sites.find((s: any) => s.id === 2);
        expect(siteB.items).toEqual([]);
    });
});
