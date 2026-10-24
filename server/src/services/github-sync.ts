import { and, eq } from "drizzle-orm";
import type { CacheImpl, DB } from "../core/hono-types";
import { feeds, moments } from "../db/schema";
import { getStorageObject } from "../utils/storage";
import {
  buildMomentMarkdown,
  buildPostMarkdown,
  extractInternalMediaUrls,
  extractMirrorableImageSources,
  getGitHubPath,
  getGitHubSettings,
  getMirroredImageKeys,
  getStorageHosts,
  getSyncedHashes,
  getSyncedMediaKeys,
  GitHubClient,
  GITHUB_MAX_FILE_BYTES,
  GITHUB_SYNC_TIMING_KEY,
  REMOTE_IMAGE_TOO_LARGE,
  isSafeMediaKey,
  type MirrorableImageSource,
  saveMirroredImageKeys,
  saveSyncedHashes,
  saveSyncedMediaKeys,
  sha256Hex,
} from "./github";

export interface FeedSyncStats {
  total: number;
  success: number;
  failed: number;
  /** 内容指纹与仓库一致，本轮没有发任何请求 */
  unchanged: number;
  /** 时间预算用尽、这轮没轮到的条数（不是失败） */
  deferredByTime: number;
}

export interface GitHubSyncStats {
  feeds: FeedSyncStats;
  moments: FeedSyncStats;
  media: {
    total: number;
    success: number;
    skipped: number;
    /** 仓库里已经有的，本轮不再重复下载/推送 */
    alreadyPresent: number;
    /** 超过 1 MiB、contents API 推不动，留给 Actions 拉取 */
    deferredToActions: number;
  };
  images: {
    total: number;
    success: number;
    alreadyPresent: number;
    deferredToActions: number;
    deferredByTime: number;
  };
  /** 时间预算用尽、本轮没收尾的部分；调用方据此决定「再来一轮」还是「今天完成」 */
  partial: boolean;
}

export interface GitHubSyncOptions {
  /**
   * 单次运行的墙钟预算（毫秒），0 表示不限。
   * 线上实测自定义域约 30 秒就切断上游（回 524，Worker 继续跑完），HTTP 触发必须留余量；
   * 预算用尽时本轮已完成的写入都已落盘，下一轮从清单继续。
   */
  budgetMs?: number;
  /** HTTP 触发的进入时刻（Date.now()），用于把鉴权/配置读取这些「预算开始前就花掉的时间」也量出来 */
  enteredAtMs?: number;
  /** 单个外部调用（GitHub 请求、对象读取）的上限；挂住的那条只算失败，不拖垮整轮 */
  itemBudgetMs?: number;
}

/**
 * 全量同步：已发布文章、动态、站内媒体，以及正文引用的「自有仓库外链图片」。
 * 供 cron（每日一次）和 POST /github/sync（手动）共用。
 *
 * 外链图片的镜像判据统一为「该 media 路径在仓库里是否存在」：
 * - Worker 能推的（≤1 MiB）当场下载并 commit；
 * - 超过 1 MiB 的 contents API 会拒，交给 Actions 拉取路径提交；
 * - 无论谁提交，下一轮存在性检查都会把它认领进镜像清单，从而完成 CDN 切换。
 * 这样清单反映的是仓库真实状态，绝不会把正文指向仓库里还不存在的文件。
 */
/** 单条记录的时间预算（毫秒）；一次挂起的外部调用不能吃掉整轮，否则必然撞上约 30 秒的切断 */
const PER_ITEM_BUDGET_MS = 8_000;

async function withTimeout<T>(work: Promise<T>, label: string, ms = PER_ITEM_BUDGET_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runGitHubSync(
  client: GitHubClient,
  db: DB,
  env: Env,
  serverConfig?: CacheImpl,
  options: GitHubSyncOptions = {},
): Promise<GitHubSyncStats> {
  const budgetMs = options.budgetMs ?? 0;
  // 预算从「进入处理函数」起算，而不是从同步函数起算：GitHub 配置读取和清单加载
  // 也花真实时间，只掐同步内部那段照样会撞上域名约 30 秒的切断。
  const enteredAt = options.enteredAtMs ?? Date.now();
  const startedAt = Date.now();
  const outOfBudget = () => budgetMs > 0 && Date.now() - enteredAt > budgetMs;
  const itemMs = options.itemBudgetMs ?? PER_ITEM_BUDGET_MS;

  // 分段墙钟耗时 + 当前阶段名，每进一个阶段就落一次库（github.last_sync_timing）。
  // 线上实测：自定义域约 30 秒切断上游后整个调用就没了，只在收尾写这一行永远看不到，
  // 边跑边写才能事后从 D1 直读出它到底停在哪一段、那一段花了多久。
  const timings: Record<string, number> = { pre: Date.now() - enteredAt };
  // 单条失败不能拖垮整批（线上就栽过一次：一条抛错让收尾的清单落盘全没执行）
  const errors: string[] = [];
  const noteError = (where: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[GitHub Sync] ${where} failed:`, error);
    if (errors.length < 12) errors.push(`${where}: ${message.slice(0, 160)}`);
  };
  let markAt = Date.now();
  // 正在处理的那一条（图片/文章/媒体 key）。调用被切断时，这一项就是「卡在哪」的证据。
  let note = "boot";
  const writeTiming = async (running: string) => {
    if (!serverConfig) {
      return;
    }
    try {
      await serverConfig.setQuick(
        GITHUB_SYNC_TIMING_KEY,
        JSON.stringify({
          at: new Date().toISOString(),
          budgetMs,
          elapsedMs: Date.now() - enteredAt,
          running,
          note,
          partial: stats.partial,
          errors,
          stats,
          ...timings,
        }),
      );
    } catch {
      // 诊断信息写不进去不该影响同步本身
    }
  };
  const stage = async (done: string, running: string) => {
    const now = Date.now();
    timings[done] = (timings[done] ?? 0) + (now - markAt);
    markAt = now;
    await writeTiming(running);
  };
  /** 所有出网调用都套上单条上限：GitHub 偶尔挂住一个请求，不能让它把整轮拖到被切断 */
  const guard = <T,>(work: Promise<T>, label: string) => withTimeout(work, label, itemMs);

  const stats: GitHubSyncStats = {
    feeds: { total: 0, success: 0, failed: 0, unchanged: 0, deferredByTime: 0 },
    moments: { total: 0, success: 0, failed: 0, unchanged: 0, deferredByTime: 0 },
    media: { total: 0, success: 0, skipped: 0, alreadyPresent: 0, deferredToActions: 0 },
    images: { total: 0, success: 0, alreadyPresent: 0, deferredToActions: 0, deferredByTime: 0 },
    partial: false,
  };

  const storageHosts = getStorageHosts(env);
  const owner = client.owner;
  await writeTiming("setup");

  // 1. 读取内容（先取全量，镜像先于推送，使本轮新入库的小图能立刻在正文里切成 CDN）
  const published = await db.query.feeds.findMany({
    where: and(eq(feeds.draft, 0), eq(feeds.listed, 1)),
  });
  const allMoments = await db.query.moments.findMany();
  stats.feeds.total = published.length;
  stats.moments.total = allMoments.length;

  const mediaKeys = new Set<string>();
  const sources = new Map<string, MirrorableImageSource>();
  for (const feed of published) {
    for (const key of extractInternalMediaUrls(feed.content, storageHosts)) mediaKeys.add(key);
    for (const [k, s] of extractMirrorableImageSources(feed.content, owner)) if (!sources.has(k)) sources.set(k, s);
  }
  for (const moment of allMoments) {
    for (const key of extractInternalMediaUrls(moment.content, storageHosts)) mediaKeys.add(key);
    for (const [k, s] of extractMirrorableImageSources(moment.content, owner)) if (!sources.has(k)) sources.set(k, s);
  }

  // 2. 外链图片镜像：先认领「仓库里已有」的，再尝试推「能推的（≤1MiB）」
  await stage("setup", "images");
  const mirrored = await getMirroredImageKeys(serverConfig);
  // 每认领/推成一张就落盘：524 或异常中断不会把本轮进度丢掉
  const persistMirrored = async () => {
    if (serverConfig) await saveMirroredImageKeys(serverConfig, mirrored);
  };
  stats.images.total = sources.size;
  for (const [key, src] of sources) {
    if (mirrored.has(key)) {
      stats.images.alreadyPresent++;
      continue;
    }
    if (outOfBudget()) {
      stats.images.deferredByTime++;
      stats.partial = true;
      continue;
    }
    try {
      note = `image ${key}`;
      if (await guard(client.remoteFileExists(src.mediaPath), `存在性检查 ${key}`)) {
        // Actions 上一轮已提交，或人工放进来的：认领即可，不必重复下载
        mirrored.add(key);
        stats.images.alreadyPresent++;
        await persistMirrored();
        continue;
      }
      const image = await guard(client.fetchRemoteImage(src.fetchUrl), `下载外链图 ${key}`);
      if (image === null) {
        continue; // 取不到，留原外链
      }
      if (image === REMOTE_IMAGE_TOO_LARGE || image.byteLength > GITHUB_MAX_FILE_BYTES) {
        // contents API 硬上限，Worker 推不动；等 Actions 拉取路径提交
        stats.images.deferredToActions++;
        continue;
      }
      const ok = await guard(
        client.uploadFile({
          path: src.mediaPath,
          content: image,
          message: `sync: image ${key}`,
        }),
        `推送外链图 ${key}`,
      );
      if (ok) {
        mirrored.add(key);
        stats.images.success++;
        await persistMirrored();
      }
    } catch (error) {
      noteError(`image ${key}`, error);
    }
  }

  // 3. 用最终镜像/入库清单改写正文（仓库里也存 CDN 直链，与站点渲染口径一致）
  const syncedKeys = await getSyncedMediaKeys(serverConfig);
  const hashes = await getSyncedHashes(serverConfig);
  const persistHashes = async () => {
    if (serverConfig) await saveSyncedHashes(serverConfig, hashes);
  };
  await stage("images", "feeds");
  const rewriter = (content: string) =>
    client.rewriteMediaToCdn(content, storageHosts, syncedKeys, mirrored);

  // 4. 推送文章、动态（内容指纹没变就不推：每个文件都要 GET sha + PUT 两次 GitHub 往返，
  //    全量重推就是手动同步被 30 秒切断线干掉的直接原因）
  for (const feed of published) {
    if (outOfBudget()) {
      stats.feeds.deferredByTime = published.length - stats.feeds.success - stats.feeds.failed - stats.feeds.unchanged;
      stats.partial = true;
      break;
    }
    note = `feed ${feed.id} 组装`;
    await writeTiming("feeds");
    try {
      const { path, markdown } = buildPostMarkdown(
        {
          id: feed.id,
          title: feed.title ?? `post-${feed.id}`,
          content: feed.content,
          summary: feed.summary || undefined,
          alias: feed.alias ?? undefined,
          createdAt: new Date(feed.createdAt),
        },
        rewriter,
      );
      const hash = await sha256Hex(markdown);
      if (hashes.get(path) === hash) {
        stats.feeds.unchanged++;
        continue;
      }
      note = `feed ${feed.id} 推送 ${path}`;
      await writeTiming("feeds");
      const ok = await guard(
        client.uploadFile({
          path,
          content: markdown,
          message: `sync: post ${feed.alias || feed.id}`,
        }),
        `推送文章 ${feed.id}`,
      );
      if (ok) {
        stats.feeds.success++;
        hashes.set(path, hash);
        await persistHashes();
      } else {
        stats.feeds.failed++;
      }
    } catch (error) {
      noteError(`feed ${feed.id}`, error);
      stats.feeds.failed++;
    }
  }

  await stage("feeds", "moments");
  for (const moment of allMoments) {
    if (outOfBudget()) {
      stats.moments.deferredByTime = allMoments.length - stats.moments.success - stats.moments.failed - stats.moments.unchanged;
      stats.partial = true;
      break;
    }
    note = `moment ${moment.id}`;
    try {
      const { path, markdown } = buildMomentMarkdown(
        { id: moment.id, content: moment.content, createdAt: new Date(moment.createdAt) },
        rewriter,
      );
      const hash = await sha256Hex(markdown);
      if (hashes.get(path) === hash) {
        stats.moments.unchanged++;
        continue;
      }
      await writeTiming("moments");
      const ok = await guard(
        client.uploadFile({
          path,
          content: markdown,
          message: `sync: moment ${moment.id}`,
        }),
        `推送动态 ${moment.id}`,
      );
      if (ok) {
        stats.moments.success++;
        hashes.set(path, hash);
        await persistHashes();
      } else {
        stats.moments.failed++;
      }
    } catch (error) {
      noteError(`moment ${moment.id}`, error);
      stats.moments.failed++;
    }
  }

  // 5. 站内媒体文件（GitHub contents API 限单文件 1 MiB）
  await stage("moments", "media");
  stats.media.total = mediaKeys.size;
  const syncedMedia: string[] = [];
  for (const key of mediaKeys) {
    if (outOfBudget()) {
      stats.partial = true;
      break;
    }
    if (!isSafeMediaKey(key)) {
      console.warn(`[GitHub Sync] skip unsafe media key: ${key}`);
      stats.media.skipped++;
      continue;
    }
    if (syncedKeys.has(key)) {
      // 上一轮（或 Actions）已经推进仓库了：重复下载+重复推送是手动同步超时的主要来源
      stats.media.alreadyPresent++;
      continue;
    }
    try {
      note = `media ${key}`;
      await writeTiming("media");
      const object = await guard(getStorageObject(env, key), `读站内媒体 ${key}`);
      if (!object) {
        stats.media.skipped++;
        continue;
      }
      const declaredSize = Number(object.headers.get("Content-Length") ?? 0);
      if (declaredSize > GITHUB_MAX_FILE_BYTES) {
        // contents API 单文件 1 MiB 硬上限，大媒体不下载直接留给 Actions
        stats.media.deferredToActions++;
        continue;
      }
      const buffer = await guard(object.arrayBuffer(), `读取媒体内容 ${key}`);
      const path = getGitHubPath("media", { filename: key });
      const ok = await guard(
        client.uploadFile({ path, content: buffer, message: `sync: media ${key}` }),
        `推送站内媒体 ${key}`,
      );
      if (ok) {
        stats.media.success++;
        syncedMedia.push(key);
      } else {
        stats.media.skipped++;
      }
    } catch (error) {
      noteError(`media ${key}`, error);
      stats.media.skipped++;
    }
  }

  // 只有真正进仓的 key 才允许被重写到 CDN；失败/跳过的继续走本站存储
  await stage("media", "persist");
  if (serverConfig) {
    await saveSyncedMediaKeys(serverConfig, [...syncedKeys, ...syncedMedia]);
    await saveMirroredImageKeys(serverConfig, mirrored);
  }
  await stage("persist", "done");

  console.log("[GitHub Sync] done:", JSON.stringify(stats));
  return stats;
}

/**
 * 每日 cron 入口。仓库 cron 每 20 分钟触发一次，这里用 serverConfig 记录
 * 上次同步日期，保证实际每天只全量同步一次（2026-10-18 用户定的口径：不要更频繁）。
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
  const stats = await runGitHubSync(client, db, env, serverConfig, { budgetMs: 480_000 });

  const attempted =
    stats.feeds.total + stats.moments.total + stats.media.total + stats.images.total;
  // 「未变动」计入成功：内容指纹让同一天的第二次扫描一个请求都不发，
  // 若把它当成失败就永远记不上今天，于是每 20 分钟重扫一次，等于把日频闸门形同虚设。
  const succeeded =
    stats.feeds.success + stats.feeds.unchanged + stats.moments.success + stats.moments.unchanged +
    stats.media.success + stats.images.success + stats.images.alreadyPresent;
  // 整轮一个都没成功（token 失效、网络中断等）时不记今天，
  // 否则当天再也不会重试，故障要等到第二天才被发现。
  if (attempted > 0 && succeeded === 0) {
    console.warn(
      `[GitHub Sync] nothing synced for ${today} (${JSON.stringify(stats)}), will retry on next cron run`,
    );
    return;
  }
  // 时间预算没收尾同样不记今天，让 20 分钟后的下一次 tick 接着做。
  if (stats.partial) {
    console.warn(`[GitHub Sync] ${today} ran out of budget, retrying on next cron run`);
    return;
  }

  await serverConfig.set("github.last_sync_date", today);
}
