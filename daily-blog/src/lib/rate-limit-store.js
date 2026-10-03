import { config } from "../config.js";
import { getRateLimitDb } from "../db/index.js";
import { createRateLimitRepository } from "../repositories/rate-limit.repository.js";

/**
 * 限流存储的两种实现，由 `RATE_LIMIT_STORE` 选择。
 *
 * | 取值 | 存哪 | 特点 |
 * | --- | --- | --- |
 * | `sqlite`（默认） | SQLite，默认主库，可配 `RATE_LIMIT_DB_PATH` 指向独立共享库 | 重启不清零；同一主机多实例共享一个文件时**额度共享** |
 * | `memory` | 进程内 Map | 零 IO、零文件；重启即清零，**多实例之间不共享** |
 *
 * 为什么要有 memory：单实例的无状态部署（容器只读文件系统、临时实例）下，
 * 为一个辅助功能开一个可写文件是额外负担；同时也是「换存储」的接口样板——
 * 想接 Redis 之类的外部共享存储时，照着这个接口实现一份即可，
 * 服务层与中间件一行都不用改。
 *
 * 接口（服务层只用这几个方法）：
 *   record / countRecent / oldestRecent / pruneSubject / clear / pruneStale / countAll / describe
 * 其中 `oldestRecent` 必须返回 SQLite 风格的时间串（'YYYY-MM-DD HH:MM:SS'，UTC），
 * 服务层统一按这个格式解析后算 Retry-After。
 */

/** 毫秒时间戳 → SQLite 风格的 UTC 时间串。 */
function toSqliteUtc(ms) {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** SQLite 实现：把仓储层包一层，只是多了 `describe()`。 */
export function createSqliteStore(dbGetter = getRateLimitDb) {
  const repository = createRateLimitRepository(dbGetter);
  return {
    kind: "sqlite",
    ...repository,
    describe() {
      const configured = String(config.rateLimit.dbPath ?? "").trim();
      return {
        store: "sqlite",
        // 指向独立文件才算「跨进程共享」；落在主库里时只有本进程/同库实例在用。
        shared: Boolean(configured) && configured !== config.dbPath,
        dbPath: configured || config.dbPath,
      };
    },
  };
}

/**
 * 进程内实现：Map<bucket|subject, 毫秒时间戳[]>。
 *
 * `now` 可注入：SQLite 的时间是秒级精度，进程内存是毫秒级，
 * 想让「刚好在窗口边界上」的行为可测，只能把时钟交给用例控制。
 */
export function createMemoryStore({ now = () => Date.now() } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  const keyOf = (bucket, subject) => `${bucket}|${subject}`;

  const recent = (bucket, subject, windowSeconds) => {
    const cutoff = now() - Math.max(0, windowSeconds) * 1000;
    const list = hits.get(keyOf(bucket, subject)) ?? [];
    return list.filter((ts) => ts > cutoff);
  };

  return {
    kind: "memory",
    record(bucket, subject) {
      const key = keyOf(bucket, subject);
      const list = hits.get(key) ?? [];
      list.push(now());
      hits.set(key, list);
    },
    countRecent(bucket, subject, windowSeconds) {
      return recent(bucket, subject, windowSeconds).length;
    },
    oldestRecent(bucket, subject, windowSeconds) {
      const list = recent(bucket, subject, windowSeconds);
      return list.length ? toSqliteUtc(Math.min(...list)) : null;
    },
    pruneSubject(bucket, subject, windowSeconds) {
      const key = keyOf(bucket, subject);
      const before = hits.get(key)?.length ?? 0;
      const kept = recent(bucket, subject, windowSeconds);
      if (kept.length === 0) {
        hits.delete(key);
      } else {
        hits.set(key, kept);
      }
      return before - kept.length;
    },
    clear(bucket, subject) {
      const before = hits.get(keyOf(bucket, subject))?.length ?? 0;
      hits.delete(keyOf(bucket, subject));
      return before;
    },
    pruneStale(windowSeconds) {
      const cutoff = now() - Math.max(0, windowSeconds) * 1000;
      let removed = 0;
      for (const [key, list] of hits) {
        const kept = list.filter((ts) => ts > cutoff);
        removed += list.length - kept.length;
        if (kept.length === 0) {
          hits.delete(key);
        } else {
          hits.set(key, kept);
        }
      }
      return removed;
    },
    countStale(windowSeconds) {
      const cutoff = now() - Math.max(0, windowSeconds) * 1000;
      let total = 0;
      for (const list of hits.values()) {
        total += list.filter((ts) => ts <= cutoff).length;
      }
      return total;
    },
    countAll() {
      let total = 0;
      for (const list of hits.values()) {
        total += list.length;
      }
      return total;
    },
    describe() {
      return {
        store: "memory",
        shared: false,
        dbPath: null,
        note: "进程内计数，重启清零，多实例之间不共享",
      };
    },
  };
}

let current = null;

/** 按配置取当前生效的存储；进程内只建一次。 */
export function getRateLimitStore() {
  if (current) {
    return current;
  }
  current = config.rateLimit.store === "memory" ? createMemoryStore() : createSqliteStore();
  return current;
}

/** 测试用例切换实现用：换掉单例，避免上一个用例的存储泄漏到下一個。 */
export function setRateLimitStore(store) {
  current = store;
}
