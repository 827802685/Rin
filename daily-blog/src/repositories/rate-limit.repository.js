import { getDb } from "../db/index.js";

/**
 * 限流命中的 SQL。
 *
 * 时间窗口一律交给 SQLite 的 datetime() 计算，不把 JS 的 Date 传进来：
 * 表里的时间列是 'YYYY-MM-DD HH:MM:SS'（UTC，秒级），拿 JS 时间戳去比永远比不对。
 *
 * 这里导出的是**工厂**而不是单例：Day 8 起限流计数可以落到独立的共享库
 * （多实例共用一份额度），也可以落到进程内存（见 src/lib/rate-limit-store.js）。
 * 默认实例仍然走主库，行为与 Day 7 完全一致。
 */

/** @param {() => import('better-sqlite3').Database} dbGetter */
export function createRateLimitRepository(dbGetter = getDb) {
  return {
    /** 窗口内的命中次数。 */
    countRecent(bucket, subject, windowSeconds) {
      const row = dbGetter()
        .prepare(
          `SELECT COUNT(*) AS total
             FROM rate_limit_hits
            WHERE bucket = ?
              AND subject = ?
              AND created_at >= datetime('now', ?)`,
        )
        .get(bucket, subject, `-${Math.max(0, Math.floor(windowSeconds))} seconds`);
      return row?.total ?? 0;
    },

    /** 窗口内最早一次命中的时间，用于估算额度恢复时刻（Retry-After）。 */
    oldestRecent(bucket, subject, windowSeconds) {
      const row = dbGetter()
        .prepare(
          `SELECT MIN(created_at) AS oldest
             FROM rate_limit_hits
            WHERE bucket = ?
              AND subject = ?
              AND created_at >= datetime('now', ?)`,
        )
        .get(bucket, subject, `-${Math.max(0, Math.floor(windowSeconds))} seconds`);
      return row?.oldest ?? null;
    },

    record(bucket, subject) {
      dbGetter()
        .prepare("INSERT INTO rate_limit_hits (bucket, subject) VALUES (?, ?)")
        .run(bucket, subject);
    },

    /** 删掉某个来源在该桶里的过期行：让单个来源的行数始终收敛在「额度 + 1」附近。 */
    pruneSubject(bucket, subject, windowSeconds) {
      return dbGetter()
        .prepare(
          `DELETE FROM rate_limit_hits
            WHERE bucket = ?
              AND subject = ?
              AND created_at < datetime('now', ?)`,
        )
        .run(bucket, subject, `-${Math.max(0, Math.floor(windowSeconds))} seconds`).changes;
    },

    /** 清空某个来源在某个桶里的全部命中（登录成功后清零失败计数）。 */
    clear(bucket, subject) {
      return dbGetter()
        .prepare("DELETE FROM rate_limit_hits WHERE bucket = ? AND subject = ?")
        .run(bucket, subject).changes;
    },

    /**
     * 清掉全部过期行。不同来源各占一行这一天敌是「换 IP 扫」，
     * 定期清理让表不会随来源数量无限增长。
     */
    pruneStale(windowSeconds) {
      return dbGetter()
        .prepare("DELETE FROM rate_limit_hits WHERE created_at < datetime('now', ?)")
        .run(`-${Math.max(0, Math.floor(windowSeconds))} seconds`).changes;
    },

    /** 已过期的行数（清理脚本的 --dry-run 预演用）。 */
    countStale(windowSeconds) {
      return dbGetter()
        .prepare(
          "SELECT COUNT(*) AS total FROM rate_limit_hits WHERE created_at < datetime('now', ?)",
        )
        .get(`-${Math.max(0, Math.floor(windowSeconds))} seconds`)?.total ?? 0;
    },

    countAll() {
      return dbGetter().prepare("SELECT COUNT(*) AS total FROM rate_limit_hits").get()?.total ?? 0;
    },
  };
}

/** 默认实例：主库。 */
export const rateLimitRepository = createRateLimitRepository();
