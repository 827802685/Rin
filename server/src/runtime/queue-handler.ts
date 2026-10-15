import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";
import { isQueueTask, FEED_AI_SUMMARY_TASK, FEED_AI_GENERATE_TASK } from "../queue";
import { processFeedAISummaryTask } from "../services/feed-ai-summary";
import { clearFeedCache } from "../services/feed";
import { processFeedAIGenerateTask } from "../services/feed-ai-generate";

export async function handleQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
) {
  const schema = await import("../db/schema");
  const db = drizzle(env.DB, { schema });
  const serverConfig = new CacheImpl(db, env, "server.config", "database");
  const clientConfig = new CacheImpl(db, env, "client.config", "database");
  const cache = new CacheImpl(db, env, "cache", undefined, clientConfig);

  for (const message of batch.messages) {
    const body = message.body;
    if (!isQueueTask(body)) {
      message.ack();
      continue;
    }

    switch (body.type) {
      case FEED_AI_SUMMARY_TASK:
        await processFeedAISummaryTask(
          env,
          db,
          cache,
          serverConfig,
          body.payload,
          clearFeedCache,
        );
        message.ack();
        break;
      
      case FEED_AI_GENERATE_TASK:
        // 生成的结果落成草稿（此前只 console.log 标题，文章根本不入库）
        try {
          const blogResult = await processFeedAIGenerateTask(
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
        } catch (error) {
          // 单条消息失败不能让整批重试到 max_retries：失败原因已经落日志，直接 ack。
          console.error(
            "[Queue] Blog generation crashed:",
            error instanceof Error ? error.message : String(error),
          );
        }
        message.ack();
        break;
      
      default:
        message.ack();
        break;
    }
  }
}
