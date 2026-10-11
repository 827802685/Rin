import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { HyperLogLog } from '../hyperloglog';
import { recordVisit, VISIT_STATS_MAX_ATTEMPTS } from '../visit-stats';
import { createMockDB, cleanupTestDB } from '../../../tests/fixtures';

/**
 * 访客计数写入（PV / UV）的并发正确性。
 *
 * 背景：`hll_data` 是一整份 HyperLogLog 寄存器，加一个访客只能 read-modify-write。
 * 旧实现读完旧 blob 之后无条件写回，两个请求并发时后写的会把先写的整份覆盖掉
 * —— 先到的那个访客从 UV 里消失（丢失更新），PV 也会因为 `stats.pv + 1` 少加一次。
 *
 * 这里的用例不靠真实并发去撞（单线程里撞不出来），而是**在读取与写入之间注入一次
 * 竞争写入**，把这个窗口确定性地打开：被测代码拿到的是旧 blob，而库里已经是新值。
 */
describe('recordVisit - 并发写入不丢访客', () => {
    let db: any;
    let sqlite: Database;
    let originalFindFirst: any;

    beforeEach(() => {
        const mock = createMockDB();
        db = mock.db;
        sqlite = mock.sqlite;
        sqlite.exec(`
            INSERT INTO feeds (id, title, content, uid, draft, listed)
            VALUES (1, 'Visit Feed', 'content', 1, 0, 1)
        `);
        originalFindFirst = db.query.visitStats.findFirst.bind(db.query.visitStats);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    /** 读回落库的 HLL，估算其中有多少个不同访客 */
    function persistedUv(): number {
        const row = sqlite.query('SELECT hll_data FROM visit_stats WHERE feed_id = 1').get() as any;
        if (!row) return 0;
        return Math.round(new HyperLogLog(row.hll_data as string).count());
    }

    function persistedPv(): number {
        const row = sqlite.query('SELECT pv FROM visit_stats WHERE feed_id = 1').get() as any;
        return row ? Number(row.pv) : 0;
    }

    /** 用原生 SQL 模拟「另一个请求」抢先写了一次访问 */
    function competingVisit(visitorKey: string) {
        const current = sqlite.query('SELECT hll_data FROM visit_stats WHERE feed_id = 1').get() as any;
        const hll = new HyperLogLog(current ? (current.hll_data as string) : '');
        hll.add(visitorKey);
        sqlite.exec(
            `UPDATE visit_stats SET hll_data = '${hll.serialize()}', pv = pv + 1 WHERE feed_id = 1`
        );
    }

    it('首次访问建行并计入 PV/UV', async () => {
        const first = await recordVisit(db, 1, '203.0.113.1');

        expect(first.pv).toBe(1);
        expect(first.uv).toBe(1);
        expect(persistedPv()).toBe(1);
        expect(persistedUv()).toBe(1);
    });

    it('回访不增加 UV 但增加 PV', async () => {
        await recordVisit(db, 1, '203.0.113.1');
        const again = await recordVisit(db, 1, '203.0.113.1');

        expect(again.pv).toBe(2);
        expect(again.uv).toBe(1);
    });

    it('读取被抢占后重试，两个不同访客都不丢', async () => {
        await recordVisit(db, 1, '203.0.113.1');

        let injected = false;
        db.query.visitStats.findFirst = async (...args: any[]) => {
            const row = await originalFindFirst(...args);
            if (!injected && row) {
                injected = true;
                const stale = row.hllData as string;
                // 竞争请求：在本次读取之后、写回之前把访客 B 写进库里
                competingVisit('203.0.113.2');
                // 仍然把读到的旧 blob 交回被测代码，制造 read-modify-write 竞态
                return { ...row, hllData: stale };
            }
            return row;
        };

        const result = await recordVisit(db, 1, '203.0.113.3');

        // 旧实现会拿着旧 blob 无条件覆盖，B 被抹掉 → uv 只有 2
        expect(result.uv).toBe(3);
        expect(persistedUv()).toBe(3);
        // 竞争那次 + 本次，PV 各加一次
        expect(result.pv).toBe(3);
        expect(persistedPv()).toBe(3);
    });

    it('CAS 连续失败时最终仍会落库，不会把这次访问吞掉', async () => {
        await recordVisit(db, 1, '203.0.113.1');

        // 每一次读取之后都有人抢先写：CAS 条件一直不成立
        db.query.visitStats.findFirst = async (...args: any[]) => {
            const row = await originalFindFirst(...args);
            if (row) {
                competingVisit(`198.51.100.${Math.floor(Math.random() * 200) + 1}`);
                return { ...row, hllData: row.hllData };
            }
            return row;
        };

        const result = await recordVisit(db, 1, '203.0.113.99');

        // 最后一次尝试不带 CAS 条件，必须真的写进去
        expect(result.pv).toBeGreaterThan(1);
        expect(persistedPv()).toBe(result.pv);
        expect(VISIT_STATS_MAX_ATTEMPTS).toBeGreaterThan(1);
    });

    it('并发建行撞唯一约束时改为走更新分支，不抛错', async () => {
        let injected = false;
        db.query.visitStats.findFirst = async (...args: any[]) => {
            if (!injected) {
                injected = true;
                // 竞争请求抢先把这一行建好了，被测代码仍以为不存在
                const other = new HyperLogLog();
                other.add('198.51.100.20');
                sqlite.exec(
                    `INSERT INTO visit_stats (feed_id, pv, hll_data) VALUES (1, 1, '${other.serialize()}')`
                );
                return null;
            }
            return originalFindFirst(...args);
        };

        const result = await recordVisit(db, 1, '198.51.100.21');

        // 旧实现会直接把 UNIQUE 约束错误抛出去，整个请求 500
        expect(result.pv).toBe(2);
        expect(result.uv).toBe(2);
        expect(persistedUv()).toBe(2);
    });
});
