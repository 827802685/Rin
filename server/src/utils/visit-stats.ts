import { and, eq, sql } from "drizzle-orm";
import { visitStats } from "../db/schema";
import { HyperLogLog } from "./hyperloglog";

/**
 * 访客计数（PV / UV）的写入门面。
 *
 * UV 用 HyperLogLog 估算，寄存器整体序列化成 `visit_stats.hll_data` 一列，
 * 所以「加一个访客」只能 read-modify-write：读回 blob → add → 写回。
 * 两个请求并发打到同一篇文章时，它们读到的是同一份旧 blob，各自加上自己那一个访客后
 * 无条件写回，后写的会把先写的整份覆盖掉 —— PV 少加、UV 少算（丢失更新）。
 *
 * 这里用两条手段消除它：
 *   1. PV 走 SQL 层的 `pv + 1`，不依赖读到的旧值；
 *   2. HLL 写回带 CAS 条件 `hll_data = <读到的旧值>`，条件不成立说明有人抢先写过，
 *      重新读、重新加、再写（CAS 失败的表现是 RETURNING 返回空数组）。
 */

export const VISIT_STATS_MAX_ATTEMPTS = 5;

export interface VisitCounterResult {
    pv: number;
    uv: number;
}

function isUniqueConstraintError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /constraint failed|UNIQUE|SQLITE_CONSTRAINT/i.test(message);
}

/**
 * 把一次访问计入 `visit_stats`，返回计数后的 PV / UV。
 *
 * @param db       Drizzle 实例（`c.get('db')`）
 * @param feedId   文章 id
 * @param visitorKey 访客标识（目前是 IP）
 */
export async function recordVisit(db: any, feedId: number, visitorKey: string): Promise<VisitCounterResult> {
    for (let attempt = 1; attempt <= VISIT_STATS_MAX_ATTEMPTS; attempt++) {
        const stats = await db.query.visitStats.findFirst({
            where: eq(visitStats.feedId, feedId),
        });

        if (!stats) {
            const hll = new HyperLogLog();
            hll.add(visitorKey);

            try {
                await db.insert(visitStats).values({
                    feedId,
                    pv: 1,
                    hllData: hll.serialize(),
                });
            } catch (error) {
                // 并发请求抢先建了这一行：回到循环顶部改走更新分支，
                // 而不是让这一次访问整体 500。
                if (attempt === VISIT_STATS_MAX_ATTEMPTS || !isUniqueConstraintError(error)) {
                    throw error;
                }
                continue;
            }

            return { pv: 1, uv: Math.round(hll.count()) };
        }

        const previousHllData = typeof stats.hllData === "string" ? stats.hllData : "";
        const hll = new HyperLogLog(previousHllData);
        hll.add(visitorKey);
        const nextHllData = hll.serialize();

        // 最后一次尝试不再带 CAS 条件：宁可退化成一次覆盖写，也不要让这次访问凭空消失。
        const useCasGuard = attempt < VISIT_STATS_MAX_ATTEMPTS;

        const updated = await db
            .update(visitStats)
            .set({
                pv: sql`${visitStats.pv} + 1`,
                hllData: nextHllData,
                updatedAt: new Date(),
            })
            .where(
                useCasGuard
                    ? and(eq(visitStats.feedId, feedId), eq(visitStats.hllData, previousHllData))
                    : eq(visitStats.feedId, feedId)
            )
            .returning({ pv: visitStats.pv });

        if (updated.length === 0) {
            continue;
        }

        return { pv: Number(updated[0].pv), uv: Math.round(hll.count()) };
    }

    // 理论上到不了这里（最后一次尝试不带 CAS，必然命中一行）。
    const final = await db.query.visitStats.findFirst({ where: eq(visitStats.feedId, feedId) });
    if (!final) {
        return { pv: 1, uv: 1 };
    }

    const hll = new HyperLogLog(typeof final.hllData === "string" ? final.hllData : "");
    return { pv: Number(final.pv), uv: Math.round(hll.count()) };
}
