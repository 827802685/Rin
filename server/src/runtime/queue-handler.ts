import { drizzle } from "drizzle-orm/d1";
import { CacheImpl } from "../utils/cache";
import { isQueueTask, FEED_AI_SUMMARY_TASK, FEED_AI_GENERATE_TASK } from "../queue";
import { processFeedAISummaryTask } from "../services/feed-ai-summary";
import { clearFeedCache } from "../services/feed";
import { generateBlogPost } from "../utils/ai";

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
        // AI 博文生成任务 - 这里只是示例，实际需要将结果保存到数据库或发送到其他地方
        const blogResult = await generateBlogPost(env, serverConfig, body.payload);
        if (blogResult.error) {
          console.error("[Queue] Blog generation failed:", blogResult.error);
        } else {
          console.log(`[Queue] Blog generated: ${blogResult.title}`);
          // TODO: 将生成的博客保存到数据库（需要额外的逻辑）
        }
        message.ack();
        break;
      
      default:
        message.ack();
        break;
    }
  }
}
