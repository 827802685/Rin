import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { AIService } from "../ai";
import {
  normalizeGeneratedTags,
  normalizeGeneratedTitle,
  processFeedAIGenerateTask,
} from "../feed-ai-generate";
import { cleanupTestDB, createTestUser, setupTestApp, TestCacheImpl } from "../../../tests/fixtures";

// AI 返回体走 extractAIText 的 response 分支
function aiEnv(response: string): Env {
  return {
    AI: { run: async () => ({ response }) },
  } as unknown as Env;
}

const VALID_RESPONSE = [
  "# 用 Rust 写博客",
  "",
  "[摘要]",
  "这是一篇关于 Rust 的摘要。",
  "",
  "[标签]",
  "rust, 博客",
  "",
  "正文第一段。",
].join("\n");

describe("processFeedAIGenerateTask", () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  let sqlite: Database;

  async function enableAI() {
    await ctx.serverConfig.set("ai_summary.enabled", "true");
    await ctx.serverConfig.set("ai_summary.provider", "worker-ai");
    await ctx.serverConfig.set("ai_summary.model", "llama-3-8b");
  }

  function readFeed(id: number) {
    return sqlite.prepare("SELECT * FROM feeds WHERE id = ?").get(id) as Record<string, any>;
  }

  function countFeeds() {
    return (sqlite.prepare("SELECT COUNT(*) AS n FROM feeds").get() as { n: number }).n;
  }

  beforeEach(async () => {
    ctx = await setupTestApp(AIService);
    sqlite = ctx.sqlite;
    createTestUser(sqlite);
    await enableAI();
  });

  afterEach(() => {
    cleanupTestDB(sqlite);
  });

  it("persists the generated post as a draft owned by the requesting user", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv(VALID_RESPONSE),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );

    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    const row = readFeed(result.feedId);
    expect(row.title).toBe("用 Rust 写博客");
    expect(row.content).toContain("正文第一段。");
    expect(row.summary).toBe("这是一篇关于 Rust 的摘要。");
    // 未经审阅的 AI 内容不能直接发布
    expect(row.draft).toBe(1);
    expect(row.listed).toBe(1);
    expect(row.top).toBe(0);
    expect(row.uid).toBe(1);
    // 生成结果自带摘要 ⇒ 不必再排一次摘要任务
    expect(row.ai_summary).toBe("这是一篇关于 Rust 的摘要。");
    expect(row.ai_summary_status).toBe("completed");
  });

  it("binds the generated tags to the new post", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv(VALID_RESPONSE),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );
    if (result.status !== "created") throw new Error("expected created");

    const bound = sqlite
      .prepare(
        `SELECT h.name FROM feed_hashtags fh JOIN hashtags h ON h.id = fh.hashtag_id
         WHERE fh.feed_id = ? ORDER BY h.name`,
      )
      .all(result.feedId) as Array<{ name: string }>;
    expect(bound.map((r) => r.name)).toEqual(["rust", "博客"]);
  });

  it("invalidates the feed list cache", async () => {
    // ctx.cache 绑了 clientConfig，默认"缓存未启用" ⇒ get/set 都是空操作，测不出清理；
    // 用一个不带 clientConfig 的实例（等价于启用状态）才能观察到前缀删除。
    const cache = new TestCacheImpl();
    await cache.set("feeds_page_1", [{ id: 1 }]);
    await cache.set("other_key", "keep me");

    await processFeedAIGenerateTask(aiEnv(VALID_RESPONSE), ctx.db, cache, ctx.serverConfig, {
      topic: "Rust",
      uid: 1,
    });

    expect(await cache.get("feeds_page_1")).toBeNull();
    expect(await cache.get("other_key")).toBe("keep me");
  });

  it("does not persist anything when the AI returns an empty response", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv(""),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );

    expect(result.status).toBe("failed");
    expect(countFeeds()).toBe(0);
  });

  it("does not persist anything when AI is disabled", async () => {
    await ctx.serverConfig.set("ai_summary.enabled", "false");

    const result = await processFeedAIGenerateTask(
      aiEnv(VALID_RESPONSE),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toContain("not enabled");
    expect(countFeeds()).toBe(0);
  });

  it("refuses to create an orphan post when the payload has no author", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv(VALID_RESPONSE),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust" },
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toContain("orphan");
    expect(countFeeds()).toBe(0);
  });

  it("refuses to create a post for a user that no longer exists", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv(VALID_RESPONSE),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 999 },
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.error).toContain("999");
    expect(countFeeds()).toBe(0);
  });

  it("trims and truncates an overlong title", async () => {
    const longTitle = `  ${"标".repeat(400)}  `;
    const result = await processFeedAIGenerateTask(
      aiEnv(`# ${longTitle}\n\n[摘要]\n摘要\n\n[标签]\ntag\n\n正文`),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );
    if (result.status !== "created") throw new Error("expected created");

    // 截断到 200 字 + 省略号，且入库的就是这个（不是被 DB 悄悄截断的原文）
    expect(result.title).toBe(`${"标".repeat(200)}…`);
    expect(readFeed(result.feedId).title).toBe(result.title);
  });

  it("keeps ai_summary idle when the generation produced no summary", async () => {
    const result = await processFeedAIGenerateTask(
      aiEnv("# 短标题\n\n只有一句正文。"),
      ctx.db,
      ctx.cache,
      ctx.serverConfig,
      { topic: "Rust", uid: 1 },
    );
    if (result.status !== "created") throw new Error("expected created");

    const row = readFeed(result.feedId);
    expect(row.summary).toBe("");
    expect(row.ai_summary_status).toBe("idle");
  });
});

describe("generated content normalization", () => {
  it("collapses whitespace and rejects blank titles", () => {
    expect(normalizeGeneratedTitle("  标题 \n 第二行 ")).toBe("标题 第二行");
    expect(normalizeGeneratedTitle("   ")).toBeNull();
    expect(normalizeGeneratedTitle(null)).toBeNull();
    expect(normalizeGeneratedTitle(undefined)).toBeNull();
  });

  it("dedupes, trims and caps generated tags", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    expect(normalizeGeneratedTags(tags)).toHaveLength(8);

    expect(normalizeGeneratedTags(["  rust ", "rust", "", "   ", "博客"])).toEqual(["rust", "博客"]);
    expect(normalizeGeneratedTags(["x".repeat(50)])).toEqual(["x".repeat(32)]);
    expect(normalizeGeneratedTags(null)).toEqual([]);
    expect(normalizeGeneratedTags(["ok", 42, { a: 1 }])).toEqual(["ok"]);
  });
});

describe("POST /ai/generate-blog", () => {
  it("carries the author into the queued task payload", async () => {
    const sent: unknown[] = [];
    const ctx = await setupTestApp(AIService, {
      TASK_QUEUE: {
        send: async (message: unknown) => {
          sent.push(message);
        },
        sendBatch: async () => {},
      } as unknown as Queue<any>,
    });
    createTestUser(ctx.sqlite);
    await ctx.serverConfig.set("ai_summary.enabled", "true");
    await ctx.serverConfig.set("ai_summary.provider", "worker-ai");
    await ctx.serverConfig.set("ai_summary.model", "llama-3-8b");

    try {
      const res = await ctx.app.request("/generate-blog", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mock_token_1",
        },
        body: JSON.stringify({ topic: "Rust", keywords: ["rust"] }),
      });

      expect(res.status).toBe(200);
      expect(sent).toHaveLength(1);
      // 没有 uid 的消息在消费端会被拒（见上面的 orphan 用例），所以路由必须带上
      expect((sent[0] as { payload: { uid?: number } }).payload.uid).toBe(1);
    } finally {
      cleanupTestDB(ctx.sqlite);
    }
  });
});
