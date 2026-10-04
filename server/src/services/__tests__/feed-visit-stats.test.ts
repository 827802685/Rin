import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FeedService } from '../feed';
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Variables } from "../../core/hono-types";
import { setupTestApp, createTestUser, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';
import type { TestCacheImpl } from '../../../tests/fixtures';
import { visitStats } from '../../db/schema';

/**
 * 访客统计（PV / UV）行为测试。
 *
 * UV 由 HyperLogLog 估算，写路径在 FeedService 的 `GET /:id` 里：
 * 首次访问要创建 visit_stats 行，后续访问读回 HLL 再写回。
 * 这两条分支历史上不对称——创建分支没有把首个访客写进 HLL，
 * 导致该访客永远不被计入 UV（`pv=1` 但 `uv` 少了 1）。
 */
describe('FeedService - visit stats (PV/UV)', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let clientConfig: TestCacheImpl;

    beforeEach(async () => {
        const ctx = await setupTestApp(FeedService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        clientConfig = ctx.clientConfig;
        await createTestUser(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function createFeed(): Promise<number> {
        const res = await app.request('/', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer mock_token_1',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: 'Visit Stats Feed',
                content: 'Visit Stats Content',
                listed: true,
                draft: false,
                tags: [],
            }),
        }, env);
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        return data.insertedId as number;
    }

    async function visit(feedId: number, ip: string): Promise<{ pv: number; uv: number }> {
        const res = await app.request(`/${feedId}`, {
            method: 'GET',
            headers: { 'x-real-ip': ip },
        }, env);
        expect(res.status).toBe(200);
        const data = await res.json() as any;
        return { pv: data.pv, uv: data.uv };
    }

    async function readStats(feedId: number) {
        return db.query.visitStats.findFirst({ where: eq(visitStats.feedId, feedId) });
    }

    it('should record the first visitor so a second distinct visitor yields uv 2', async () => {
        const feedId = await createFeed();

        const first = await visit(feedId, '203.0.113.1');
        expect(first.pv).toBe(1);
        expect(first.uv).toBe(1);

        // 首个访客必须真的落进 HLL，否则第二个不同访客会被算成 uv=1
        const persisted = await readStats(feedId);
        expect(persisted).toBeTruthy();
        expect(persisted!.hllData).not.toBe('');

        const second = await visit(feedId, '203.0.113.2');
        expect(second.pv).toBe(2);
        expect(second.uv).toBe(2);
    });

    it('should count uv from the very first request when every visitor is unique', async () => {
        const feedId = await createFeed();

        const visitors = Array.from({ length: 12 }, (_, i) => `192.0.2.${i + 1}`);
        let last = { pv: 0, uv: 0 };
        for (const ip of visitors) {
            last = await visit(feedId, ip);
        }

        expect(last.pv).toBe(12);
        // 首个访客若被漏掉，这里只会得到 11
        expect(last.uv).toBe(12);
    });

    it('should keep uv stable when the same visitor returns', async () => {
        const feedId = await createFeed();

        await visit(feedId, '198.51.100.7');
        await visit(feedId, '198.51.100.7');
        const third = await visit(feedId, '198.51.100.7');

        expect(third.pv).toBe(3);
        expect(third.uv).toBe(1);
    });

    it('should not count a returning visitor twice when mixed with new ones', async () => {
        const feedId = await createFeed();

        await visit(feedId, '203.0.113.10');
        await visit(feedId, '203.0.113.11');
        await visit(feedId, '203.0.113.12');
        // 回访的是第二个访客，第一个访客此后再没出现过
        const replay = await visit(feedId, '203.0.113.11');

        expect(replay.pv).toBe(4);
        expect(replay.uv).toBe(3);
    });

    it('should not track visits when counter.enabled is false', async () => {
        await clientConfig.set('counter.enabled', false);
        const feedId = await createFeed();

        const res = await visit(feedId, '203.0.113.99');

        expect(res.pv).toBe(0);
        expect(res.uv).toBe(0);
        expect(await readStats(feedId)).toBeFalsy();
    });

    it('should fall back to UNK when no client ip header is present', async () => {
        const feedId = await createFeed();

        const anon = await app.request(`/${feedId}`, { method: 'GET' }, env);
        expect(anon.status).toBe(200);
        const anonData = await anon.json() as any;
        expect(anonData.pv).toBe(1);
        expect(anonData.uv).toBe(1);

        // 同一个 UNK 来源再访问一次，UV 不应增长
        const again = await app.request(`/${feedId}`, { method: 'GET' }, env);
        const againData = await again.json() as any;
        expect(againData.pv).toBe(2);
        expect(againData.uv).toBe(1);
    });
});
