import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { processFeedAISummaryTask } from "../feed-ai-summary";
import { feeds } from "../../db/schema";
import { createMockDB, TestCacheImpl } from "../../../tests/fixtures";

/**
 * Covers the state a feed row is left in after `processFeedAISummaryTask` runs.
 *
 * These cases need a real database because the whole point is what ends up in
 * `feeds.ai_summary_status` — the queue entrypoint only logs, so a wrong status
 * is only observable on the row itself.
 */
describe("processFeedAISummaryTask > 终态落库", () => {
  let ctx: ReturnType<typeof createMockDB>;
  let cache: TestCacheImpl;
  let serverConfig: TestCacheImpl;

  const env = {
    AI: undefined,
  } as unknown as Env;

  beforeEach(() => {
    ctx = createMockDB();
    cache = new TestCacheImpl();
    serverConfig = new TestCacheImpl();
    ctx.sqlite.exec(
      `INSERT INTO feeds (id, title, content, uid, draft, listed, ai_summary_status, updated_at)
       VALUES (1, 't', 'content', 1, 0, 1, 'pending', 1700000000)`,
    );
  });

  function updatedAtUnix() {
    return 1700000000;
  }

  async function statusOf(id: number) {
    const row = await ctx.db.query.feeds.findFirst({ where: eq(feeds.id, id) });
    return row?.ai_summary_status;
  }

  async function errorOf(id: number) {
    const row = await ctx.db.query.feeds.findFirst({ where: eq(feeds.id, id) });
    return row?.ai_summary_error;
  }

  it("摘要生成抛错时落到 failed，而不是卡在 processing", async () => {
    // Regression: the row was committed to "processing" before the AI call, and a
    // throw escaped all the way out of the task. The admin UI then showed
    // "generating" forever and nothing could re-queue it.
    await serverConfig.set("ai_summary.enabled", "true", false);

    await processFeedAISummaryTask(
      env,
      ctx.db as never,
      cache as never,
      serverConfig as never,
      { feedId: 1, expectedUpdatedAtUnix: updatedAtUnix() },
      async () => {},
      async () => {
        throw new Error("config store unreachable");
      },
    );

    expect(await statusOf(1)).toBe("failed");
    expect(await errorOf(1)).toBe("config store unreachable");
  });

  it("抛的是非 Error 时也记录成可读字符串", async () => {
    await serverConfig.set("ai_summary.enabled", "true", false);

    await processFeedAISummaryTask(
      env,
      ctx.db as never,
      cache as never,
      serverConfig as never,
      { feedId: 1, expectedUpdatedAtUnix: updatedAtUnix() },
      async () => {},
      async () => {
        throw "boom";
      },
    );

    expect(await statusOf(1)).toBe("failed");
    expect(await errorOf(1)).toBe("boom");
  });

  it("成功时仍写 completed 与摘要（新分支没有改变原行为）", async () => {
    await serverConfig.set("ai_summary.enabled", "true", false);

    await processFeedAISummaryTask(
      env,
      ctx.db as never,
      cache as never,
      serverConfig as never,
      { feedId: 1, expectedUpdatedAtUnix: updatedAtUnix() },
      async () => {},
      async () => ({ summary: "生成的摘要", skipped: false }),
    );

    expect(await statusOf(1)).toBe("completed");
    const row = await ctx.db.query.feeds.findFirst({ where: eq(feeds.id, 1) });
    expect(row?.ai_summary).toBe("生成的摘要");
  });

  it("AI 未启用时回到 idle，不写错误", async () => {
    await serverConfig.set("ai_summary.enabled", "false", false);

    await processFeedAISummaryTask(
      env,
      ctx.db as never,
      cache as never,
      serverConfig as never,
      { feedId: 1, expectedUpdatedAtUnix: updatedAtUnix() },
      async () => {},
      async () => ({ summary: null, skipped: true }),
    );

    expect(await statusOf(1)).toBe("idle");
  });
});
