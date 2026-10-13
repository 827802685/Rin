import { and, eq } from "drizzle-orm";
import type { CacheImpl, DB } from "../core/hono-types";
import { feeds, moments } from "../db/schema";
import { getStorageObject } from "../utils/storage";
import {
  extractInternalMediaUrls,
  getGitHubPath,
  getGitHubSettings,
  getStorageHosts,
  GitHubClient,
  isSafeMediaKey,
  saveSyncedMediaKeys,
  syncFeedToGitHub,
  syncMomentToGitHub,
} from "./github";

export interface GitHubSyncStats {
  feeds: { total: number; success: number; failed: number };
  moments: { total: number; success: number; failed: number };
  media: { total: number; success: number; skipped: number };
}

/**
 * 全量同步：已发布文章、动态、以及文章引用的站内媒体文件。
 * 供 cron（每日一次）和 POST /github/sync（手动）共用。
 */
export async function runGitHubSync(
  client: GitHubClient,
  db: DB,
  env: Env,
  serverConfig?: CacheImpl,
): Promise<GitHubSyncStats> {
  const stats: GitHubSyncStats = {
    feeds: { total: 0, success: 0, failed: 0 },
    moments: { total: 0, success: 0, failed: 0 },
    media: { total: 0, success: 0, skipped: 0 },
  };

  const storageHosts = getStorageHosts(env);

  // 1. 博客文章
  const published = await db.query.feeds.findMany({
    where: and(eq(feeds.draft, 0), eq(feeds.listed, 1)),
  });
  stats.feeds.total = published.length;

  const mediaKeys = new Set<string>();

  for (const feed of published) {
    const ok = await syncFeedToGitHub(client, {
      id: feed.id,
      title: feed.title ?? `post-${feed.id}`,
      content: feed.content,
      summary: feed.summary || undefined,
      alias: feed.alias ?? undefined,
      createdAt: new Date(feed.createdAt),
    });
    ok ? stats.feeds.success++ : stats.feeds.failed++;

    for (const key of extractInternalMediaUrls(feed.content, storageHosts)) {
      mediaKeys.add(key);
    }
  }

  // 2. 动态
  const allMoments = await db.query.moments.findMany();
  stats.moments.total = allMoments.length;

  for (const moment of allMoments) {
    const ok = await syncMomentToGitHub(client, {
      id: moment.id,
      content: moment.content,
      createdAt: new Date(moment.createdAt),
    });
    ok ? stats.moments.success++ : stats.moments.failed++;

    for (const key of extractInternalMediaUrls(moment.content, storageHosts)) {
      mediaKeys.add(key);
    }
  }

  // 3. 文章/动态引用的站内媒体文件（GitHub contents API 限单文件 1 MiB）
  stats.media.total = mediaKeys.size;

  const syncedMedia: string[] = [];

  for (const key of mediaKeys) {
    // 与 /export 一致：key 会被拼进仓库路径，越界的必须挡在上传之前
    if (!isSafeMediaKey(key)) {
      console.warn(`[GitHub Sync] skip unsafe media key: ${key}`);
      stats.media.skipped++;
      continue;
    }

    try {
      const object = await getStorageObject(env, key);
      if (!object) {
        stats.media.skipped++;
        continue;
      }
      const buffer = await object.arrayBuffer();
      const path = getGitHubPath("media", { filename: key });
      const ok = await client.uploadFile({
        path,
        content: buffer,
        message: `sync: media ${key}`,
      });
      if (ok) {
        stats.media.success++;
        syncedMedia.push(key);
      } else {
        stats.media.skipped++;
      }
    } catch (error) {
      console.error(`[GitHub Sync] media ${key} failed:`, error);
      stats.media.skipped++;
    }
  }

  // 只有真正进仓的 key 才允许被重写到 CDN；失败/跳过的继续走本站存储
  if (serverConfig) {
    await saveSyncedMediaKeys(serverConfig, syncedMedia);
  }

  console.log("[GitHub Sync] done:", JSON.stringify(stats));
  return stats;
}

/**
 * 每日 cron 入口。仓库 cron 每 20 分钟触发一次，这里用 serverConfig 记录
 * 上次同步日期，保证实际每天只全量同步一次。
 */
export async function githubSyncCrontab(
  env: Env,
  db: DB,
  serverConfig: CacheImpl,
): Promise<void> {
  const settings = await getGitHubSettings(serverConfig, env);
  if (!settings) {
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const lastSync = await serverConfig.get("github.last_sync_date");
  if (lastSync === today) {
    return;
  }

  console.log(`[GitHub Sync] daily sync starting for ${today}`);
  const client = new GitHubClient(settings);
  const stats = await runGitHubSync(client, db, env, serverConfig);

  // 整轮一个都没成功（token 失效、网络中断等）时不记今天，
  // 否则当天再也不会重试，故障要等到第二天才被发现。
  const attempted =
    stats.feeds.total + stats.moments.total + stats.media.total;
  const succeeded =
    stats.feeds.success + stats.moments.success + stats.media.success;
  if (attempted > 0 && succeeded === 0) {
    console.warn(
      `[GitHub Sync] nothing synced for ${today} (${JSON.stringify(stats)}), will retry on next cron run`,
    );
    return;
  }

  await serverConfig.set("github.last_sync_date", today);
}
