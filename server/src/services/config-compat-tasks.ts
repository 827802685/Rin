import { desc, eq } from "drizzle-orm";
import type { CacheImpl, DB } from "../core/hono-types";
import { feeds } from "../db/schema";
import { syncFeedAISummaryQueueState } from "./feed-ai-summary";
import { clearFeedCache } from "./feed";
import { contentHasImagesMissingMetadata } from "../utils/image";
import { getAIConfig } from "../utils/db-config";
import {
  extractMirrorableImageSources,
  getGitHubSettings,
  getMirroredImageKeys,
} from "./github";

type ConfigReader = {
  get(key: string): Promise<unknown>;
};

type CompatFeedRow = {
  id: number;
  content: string;
  ai_summary: string;
  ai_summary_status: string;
  draft: number;
  listed: number;
};

function isAISummaryBackfillEligible(feed: {
  draft: number;
  ai_summary: string;
  ai_summary_status: string;
}) {
  if (feed.draft === 1) {
    return false;
  }

  if (feed.ai_summary.trim().length > 0) {
    return false;
  }

  return feed.ai_summary_status !== "pending" && feed.ai_summary_status !== "processing";
}

function isAISummaryForceBackfillEligible(feed: {
  draft: number;
  ai_summary_status: string;
}) {
  if (feed.draft === 1) {
    return false;
  }

  return feed.ai_summary_status !== "pending" && feed.ai_summary_status !== "processing";
}

export async function buildCompatTasksResponse(db: DB, serverConfig: ConfigReader, env: Env) {
  const aiConfig = await getAIConfig(serverConfig);
  const items = await db.query.feeds.findMany({
    columns: {
      id: true,
      content: true,
      ai_summary: true,
      ai_summary_status: true,
      draft: true,
      listed: true,
    },
  });

  return {
    generatedAt: new Date().toISOString(),
    aiSummary: {
      enabled: aiConfig.enabled,
      queueConfigured: Boolean(env.TASK_QUEUE),
      eligible: items.filter(isAISummaryBackfillEligible).length,
      forceEligible: items.filter(isAISummaryForceBackfillEligible).length,
    },
    blurhash: {
      eligible: items.filter((item) => contentHasImagesMissingMetadata(item.content)).length,
    },
    githubImage: await buildGithubImageTask(db, serverConfig, env, items),
  };
}

/**
 * 外链图片镜像的就绪度。口径与 github 同步任务保持一致：
 * 只统计「已发布且列出」的文章 + 全部动态里引用的自有仓库外链图，
 * 已镜像 = 仓库里确实有这个文件（Worker 推送或 Actions 提交都算）。
 * 未配置集成时 configured=false，界面据此说明「取不到」而不是报 0。
 */
async function buildGithubImageTask(
  db: DB,
  serverConfig: ConfigReader,
  env: Env,
  feedRows: CompatFeedRow[],
) {
  const settings = await getGitHubSettings(serverConfig, env).catch(() => null);
  if (!settings) {
    return { configured: false, total: 0, mirrored: 0, pending: 0 };
  }

  const moments = await db.query.moments.findMany({ columns: { content: true } });
  const sources = new Set<string>();
  for (const feed of feedRows) {
    if (feed.draft === 1 || feed.listed !== 1) {
      continue;
    }
    for (const key of extractMirrorableImageSources(feed.content, settings.owner).keys()) {
      sources.add(key);
    }
  }
  for (const moment of moments) {
    for (const key of extractMirrorableImageSources(moment.content, settings.owner).keys()) {
      sources.add(key);
    }
  }

  const mirroredKeys = await getMirroredImageKeys(serverConfig);
  const mirrored = [...sources].filter((key) => mirroredKeys.has(key)).length;

  return { configured: true, total: sources.size, mirrored, pending: sources.size - mirrored };
}

export async function runCompatAISummaryBackfill(
  db: DB,
  cache: CacheImpl,
  serverConfig: ConfigReader,
  env: Env,
  force = false,
) {
  const aiConfig = await getAIConfig(serverConfig);
  if (!aiConfig.enabled) {
    throw new Error("AI summary is not enabled");
  }
  if (!env.TASK_QUEUE) {
    throw new Error("TASK_QUEUE binding is not configured");
  }

  const items = await db.query.feeds.findMany({
    columns: {
      id: true,
      alias: true,
      updatedAt: true,
      ai_summary: true,
      ai_summary_status: true,
      draft: true,
    },
    orderBy: [desc(feeds.updatedAt)],
  });

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const eligible = force
      ? isAISummaryForceBackfillEligible(item)
      : isAISummaryBackfillEligible(item);

    if (!eligible) {
      skipped += 1;
      continue;
    }

    const result = await syncFeedAISummaryQueueState(db, serverConfig, env, item.id, {
      draft: false,
      updatedAt: item.updatedAt,
      resetSummary: true,
    });
    await clearFeedCache(cache, item.id, item.alias, item.alias);

    // Only count what really reached the queue, otherwise the UI reports a
    // successful backfill for feeds that were marked as failed again.
    if (result.queued) {
      queued += 1;
    } else if (result.status === "failed") {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    queued,
    skipped,
    failed,
    forced: force,
  };
}

export async function listBlurhashCompatCandidates(db: DB) {
  const items = await db.query.feeds.findMany({
    columns: {
      id: true,
      title: true,
      content: true,
    },
    orderBy: [desc(feeds.updatedAt)],
  });

  return {
    generatedAt: new Date().toISOString(),
    items: items.filter((item) => contentHasImagesMissingMetadata(item.content)),
  };
}

export async function applyBlurhashCompatUpdate(db: DB, cache: CacheImpl, feedId: number, content: string) {
  const feed = await db.query.feeds.findFirst({
    where: eq(feeds.id, feedId),
    columns: {
      id: true,
      alias: true,
      content: true,
    },
  });

  if (!feed) {
    throw new Error("Feed not found");
  }

  if (feed.content === content) {
    return { updated: false };
  }

  await db.update(feeds).set({ content }).where(eq(feeds.id, feed.id));
  await clearFeedCache(cache, feed.id, feed.alias, feed.alias);

  return { updated: true };
}
