export const FEED_AI_SUMMARY_TASK = "feed.ai-summary.generate" as const;
export const FEED_AI_GENERATE_TASK = "feed.ai-generate.create" as const;

export type FeedAISummaryStatus =
  | "idle"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface FeedAISummaryTaskPayload {
  feedId: number;
  expectedUpdatedAt?: string;
  expectedUpdatedAtUnix?: number;
}

export interface FeedAISummaryTask {
  type: typeof FEED_AI_SUMMARY_TASK;
  payload: FeedAISummaryTaskPayload;
}

// AI 博文生成任务
export interface FeedAIGenerateTaskPayload {
  topic?: string;        // 主题（可选）
  keywords?: string[];   // 关键词
  style?: "technical" | "casual" | "tutorial" | "review"; // 文章风格
  maxLength?: number;    // 最大字数
}

export interface FeedAIGenerateTask {
  type: typeof FEED_AI_GENERATE_TASK;
  payload: FeedAIGenerateTaskPayload;
}

export type QueueTask = FeedAISummaryTask | FeedAIGenerateTask;

export function createFeedAISummaryTask(
  payload: FeedAISummaryTaskPayload,
): FeedAISummaryTask {
  return {
    type: FEED_AI_SUMMARY_TASK,
    payload,
  };
}

export function createFeedAIGenerateTask(
  payload: FeedAIGenerateTaskPayload,
): FeedAIGenerateTask {
  return {
    type: FEED_AI_GENERATE_TASK,
    payload,
  };
}

export function isQueueTask(value: unknown): value is QueueTask {
  if (!value || typeof value !== "object") {
    return false;
  }

  const task = value as Partial<QueueTask>;
  
  // Check AI summary task
  if (task.type === FEED_AI_SUMMARY_TASK) {
    const payload = task.payload as Partial<FeedAISummaryTaskPayload> | undefined;
    return (
      Boolean(payload) &&
      typeof payload?.feedId === "number" &&
      (
        typeof payload?.expectedUpdatedAtUnix === "number" ||
        typeof payload?.expectedUpdatedAt === "string"
      )
    );
  }
  
  // Check AI generate task
  if (task.type === FEED_AI_GENERATE_TASK) {
    const payload = task.payload as Partial<FeedAIGenerateTaskPayload> | undefined;
    return Boolean(payload) && (
      typeof payload?.topic === "string" ||
      (Array.isArray(payload?.keywords) && payload!.keywords!.length > 0)
    );
  }

  return false;
}
