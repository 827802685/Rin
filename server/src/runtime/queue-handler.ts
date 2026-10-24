import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";
import { isQueueTask, FEED_AI_SUMMARY_TASK, FEED_AI_GENERATE_TASK } from "../queue";

/**
 * Runs one queue message without letting it take the rest of the batch down.
 *
 * `handleQueue` awaits every message in order, so an unguarded throw aborts the
 * loop: the messages after it are never attempted in this delivery, and because
 * the handler rejected, Cloudflare redelivers the whole batch. One permanently
 * broken message therefore starves every other message behind it until
 * `max_retries` is exhausted, and then they are dropped.
 *
 * The failure is logged and the message is still acked: the processors write
 * their own failure state onto the row, and there is nothing a redelivery could
 * do about a deterministic error anyway.
 */
async function runQueueTask(messageId: string, task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    console.error(
      `[Queue] message ${messageId} failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * The task processors the queue entrypoint drives, injected rather than
 * module-mocked: Bun keeps `mock.module` overrides for the rest of the process,
 * so stubbing them here would silently replace the real implementations for
 * every test file loaded afterwards.
 */
export type QueueTaskModules = {
  processFeedAISummaryTask: (typeof import("../services/feed-ai-summary"))["processFeedAISummaryTask"];
  processFeedAIGenerateTask: (typeof import("../services/feed-ai-generate"))["processFeedAIGenerateTask"];
  clearFeedCache: (typeof import("../services/feed"))["clearFeedCache"];
};

async function loadQueueTaskModules(): Promise<QueueTaskModules> {
  const { processFeedAISummaryTask } = await import("../services/feed-ai-summary");
  const { processFeedAIGenerateTask } = await import("../services/feed-ai-generate");
  const { clearFeedCache } = await import("../services/feed");

  return { processFeedAISummaryTask, processFeedAIGenerateTask, clearFeedCache };
}

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
  modules?: QueueTaskModules,
) {
  const schema = await import("../db/schema");
  const db = drizzle(env.DB, { schema });
  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config", "database");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  const {
    processFeedAISummaryTask: runSummary,
    processFeedAIGenerateTask: runGenerate,
    clearFeedCache: clearCache,
  } = modules ?? await loadQueueTaskModules();

  for (const message of batch.messages) {
    const body = message.body;
    if (!isQueueTask(body)) {
      message.ack();
      continue;
    }

    switch (body.type) {
      case FEED_AI_SUMMARY_TASK:
        await runQueueTask(message.id, () =>
          runSummary(
            env,
            db,
            cache,
            serverConfig,
            body.payload,
            clearCache,
          ),
        );
        message.ack();
        break;

      case FEED_AI_GENERATE_TASK:
        // 生成的结果落成草稿（此前只 console.log 标题，文章根本不入库）
        await runQueueTask(message.id, async () => {
          const blogResult = await runGenerate(
            env,
            db,
            cache,
            serverConfig,
            body.payload,
          );
          if (blogResult.status === "created") {
            console.log(
              `[Queue] AI draft created: #${blogResult.feedId} ${blogResult.title}`,
            );
          } else {
            console.error("[Queue] Blog generation failed:", blogResult.error);
          }
        });
        message.ack();
        break;

      default:
        message.ack();
        break;
    }
  }
}
