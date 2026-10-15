import { eq } from "drizzle-orm";
import { feeds, users } from "../db/schema";
import type { CacheImpl, DB } from "../core/hono-types";
import type { FeedAIGenerateTaskPayload } from "../queue";
import { generateBlogPost } from "../utils/ai";
import { bindTagToPost } from "./tag";

type ConfigReader = {
  get(key: string): Promise<unknown>;
};

export type FeedAIGenerateResult =
  | { status: "created"; feedId: number; title: string; tags: string[] }
  | { status: "failed"; error: string };

// 标题上限：AI 偶尔会把整段话当标题（实测出现过 90+ 字的"标题"），
// 超长标题会把列表卡片和 <title> 撑坏，超出部分直接截断。
const MAX_TITLE_LENGTH = 200;
// 单个标签上限与标签个数上限：AI 返回的标签是自由文本，不设限会出现几十个
// 一次性创建的 hashtag（feedHashtags 与 hashtags 两表都被写脏，且前端标签云被冲垮）。
const MAX_TAG_LENGTH = 32;
const MAX_TAGS = 8;

export function normalizeGeneratedTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TITLE_LENGTH ? `${trimmed.slice(0, MAX_TITLE_LENGTH)}…` : trimmed;
}

export function normalizeGeneratedTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH).trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * 消费 FEED_AI_GENERATE_TASK：调 AI 写一篇博文，并把结果落成**草稿**。
 *
 * 为什么必须落库：这条链路此前只 console.log 生成的标题（queue-handler 里的
 * TODO），管理员在后台触发一次生成、付了一次 AI 调用的钱，结果除了 Worker 日志
 * 什么都没留下 —— 功能等于不存在。
 *
 * 为什么落成草稿（draft=1）：内容未经人工审阅，直接发布等于把 AI 的胡说八道
 * 挂到站上；草稿在后台列表里可见可编辑，发布与否由人决定。
 *
 * uid 必须在 payload 里携带并在入库前校验：feeds.uid 是 NOT NULL 且外键指向
 * users，一旦带了个不存在的 uid 直接 INSERT，SQL 会抛错、整批消息重试到
 * max_retries 为止。所以宁可明确失败并记日志，也不猜作者。
 */
export async function processFeedAIGenerateTask(
  env: Env,
  db: DB,
  cache: CacheImpl,
  serverConfig: ConfigReader,
  payload: FeedAIGenerateTaskPayload,
): Promise<FeedAIGenerateResult> {
  const result = await generateBlogPost(env, serverConfig, payload);

  if (result.error || !result.title || !result.content) {
    return {
      status: "failed",
      error: result.error ?? "AI returned an empty blog post",
    };
  }

  const uid = typeof payload.uid === "number" && Number.isInteger(payload.uid) ? payload.uid : null;
  const author = uid
    ? await db.query.users.findFirst({ where: eq(users.id, uid) })
    : null;

  if (!author) {
    return {
      status: "failed",
      error: uid
        ? `Author ${uid} does not exist, refusing to create an orphan post`
        : "Missing author in task payload, refusing to create an orphan post",
    };
  }

  const title = normalizeGeneratedTitle(result.title);
  const content = result.content;
  if (!title) {
    return { status: "failed", error: "AI returned an empty title" };
  }

  const summary = typeof result.summary === "string" ? result.summary.trim() : "";
  const tags = normalizeGeneratedTags(result.tags);
  const date = new Date();

  const inserted = await db
    .insert(feeds)
    .values({
      title,
      content,
      summary,
      // 生成结果自带摘要，不必再排一次摘要任务（省一次 AI 调用）
      ai_summary: summary,
      ai_summary_status: summary ? "completed" : "idle",
      ai_summary_error: "",
      uid: author.id,
      listed: 1,
      draft: 1,
      top: 0,
      createdAt: date,
      updatedAt: date,
    })
    .returning({ insertedId: feeds.id });

  const feedId = inserted[0]?.insertedId;
  if (!feedId) {
    return { status: "failed", error: "Failed to insert the generated post" };
  }

  if (tags.length > 0) {
    await bindTagToPost(db, feedId, tags);
  }
  await cache.deletePrefix("feeds_");

  return { status: "created", feedId, title, tags };
}
