import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";

/**
 * Runs one scheduled task without letting it take the others down.
 *
 * `friendCrontab` reaches out to third party sites, so it is by far the most
 * likely to throw. Without this guard a single unreachable friend link would
 * silently skip the RSS build and the rate limit cleanup on every run.
 */
async function runScheduledTask(name: string, task: () => Promise<unknown>) {
    try {
        await task();
    } catch (error) {
        console.error(`[scheduled] ${name} failed:`, error);
    }
}

/**
 * The tasks the cron entrypoint drives, resolved lazily so a cold start does not pay
 * for modules the request path never touches.
 *
 * They are injectable because `mock.module` leaks across test files in Bun: a stubbed
 * task would silently replace the real one for every test file loaded afterwards.
 */
export type ScheduledTaskModules = {
    friendCrontab: (typeof import("../services/friends"))["friendCrontab"];
    rssCrontab: (typeof import("../services/rss"))["rssCrontab"];
    cleanupRateLimits: (typeof import("../utils/rate-limit"))["cleanupRateLimits"];
};

async function loadScheduledTaskModules(): Promise<ScheduledTaskModules> {
    const { friendCrontab } = await import("../services/friends");
    const { rssCrontab } = await import("../services/rss");
    const { cleanupRateLimits } = await import("../utils/rate-limit");

    return { friendCrontab, rssCrontab, cleanupRateLimits };
}

export async function handleScheduled(
  _controller: ScheduledController | null,
  env: Env,
  ctx: ExecutionContext,
  modules?: ScheduledTaskModules,
) {
  const schema = await import("../db/schema");
  const db = drizzle(env.DB, { schema });

  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  const { friendCrontab, rssCrontab, cleanupRateLimits } = modules ?? await loadScheduledTaskModules();

  await runScheduledTask("friendCrontab", () => friendCrontab(env, ctx, db, cache, serverConfig, clientConfig));
  await runScheduledTask("rssCrontab", () => rssCrontab(env, db));

  // Reclaim abandoned rate limit buckets (longest window is 24h).
  await runScheduledTask("cleanupRateLimits", () => cleanupRateLimits(db, 60 * 60 * 24));
}
