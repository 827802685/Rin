import { eq, lt, sql } from "drizzle-orm";
import type { DB } from "../core/hono-types";
import { rateLimits } from "../db/schema";

export interface RateLimitResult {
    allowed: boolean;
    limit: number;
    remaining: number;
    /** Unix seconds at which the current window rolls over. */
    resetAt: number;
}

export interface RateLimitOptions {
    /** Stable scope identifier, e.g. `login` or `ai-chat`. */
    scope: string;
    /** Subject being limited, e.g. an IP address or a user id. */
    identifier: string;
    /** Maximum number of allowed hits inside one window. */
    limit: number;
    /** Window length in seconds. */
    windowSeconds: number;
    /** Injectable clock, mainly for tests. */
    now?: Date;
}

function buildBucketKey(scope: string, identifier: string, windowStart: number) {
    return `${scope}:${identifier}:${windowStart}`;
}

/**
 * Fixed-window counter backed by D1.
 *
 * The increment is a single `INSERT ... ON CONFLICT DO UPDATE` statement so
 * concurrent requests cannot lose counts. Windows roll over by encoding the
 * window start into the bucket key, which means stale buckets simply stop being
 * read and are reclaimed by `cleanupRateLimits`.
 *
 * Returns `allowed: true` when the counter could not be read (for example when
 * the table is missing on a database that has not been migrated yet) so a
 * storage failure never turns into a site-wide outage.
 */
export async function consumeRateLimit(db: DB, options: RateLimitOptions): Promise<RateLimitResult> {
    const { scope, identifier, limit, windowSeconds } = options;
    const now = options.now ?? new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
    const bucketKey = buildBucketKey(scope, identifier, windowStart);

    try {
        const touchedAt = new Date(nowSeconds * 1000);

        await db
            .insert(rateLimits)
            .values({
                bucketKey,
                windowStart,
                count: 1,
                updatedAt: touchedAt,
            })
            .onConflictDoUpdate({
                target: rateLimits.bucketKey,
                set: {
                    count: sql`${rateLimits.count} + 1`,
                    updatedAt: touchedAt,
                },
            });

        const rows = await db
            .select({ count: rateLimits.count })
            .from(rateLimits)
            .where(eq(rateLimits.bucketKey, bucketKey))
            .limit(1);

        const count = rows[0]?.count ?? 1;

        return {
            allowed: count <= limit,
            limit,
            remaining: Math.max(0, limit - count),
            resetAt: windowStart + windowSeconds,
        };
    } catch (error) {
        console.error("Rate limit tracking failed", error);
        return {
            allowed: true,
            limit,
            remaining: limit,
            resetAt: windowStart + windowSeconds,
        };
    }
}

/** Removes rate limit buckets that have been idle for longer than `maxAgeSeconds`. */
export async function cleanupRateLimits(db: DB, maxAgeSeconds: number, now: Date = new Date()) {
    const threshold = Math.floor(now.getTime() / 1000) - maxAgeSeconds;

    try {
        await db.delete(rateLimits).where(lt(rateLimits.updatedAt, new Date(threshold * 1000)));
    } catch (error) {
        console.error("Rate limit cleanup failed", error);
    }
}
