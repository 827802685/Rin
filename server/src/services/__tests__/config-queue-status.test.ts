import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { ConfigService } from "../config";
import { cleanupTestDB, createTestUser, setupTestApp } from "../../../tests/fixtures";

describe("ConfigService > AI summary queue status", () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  let sqlite: Database;
  let env: Env;
  const adminHeaders = { Authorization: "Bearer mock_token_1" };

  async function enableAI() {
    await ctx.serverConfig.set("ai_summary.enabled", "true");
    await ctx.serverConfig.set("ai_summary.provider", "worker-ai");
    await ctx.serverConfig.set("ai_summary.model", "llama-3-8b");
  }

  function insertFeed(
    id: number,
    overrides: Partial<{
      title: string;
      aiSummary: string;
      status: string;
      error: string;
      draft: number;
    }> = {},
  ) {
    const {
      title = `Feed ${id}`,
      aiSummary = "",
      status = "idle",
      error = "",
      draft = 0,
    } = overrides;

    sqlite
      .prepare(
        `INSERT INTO feeds (id, title, summary, ai_summary, ai_summary_status, ai_summary_error, content, listed, draft, top, uid)
         VALUES (?, ?, '', ?, ?, ?, 'content', 1, ?, 0, 1)`,
      )
      .run(id, title, aiSummary, status, error, draft);
  }

  function readFeed(id: number) {
    return sqlite
      .prepare("SELECT ai_summary_status, ai_summary_error FROM feeds WHERE id = ?")
      .get(id) as { ai_summary_status: string; ai_summary_error: string };
  }

  beforeEach(async () => {
    ctx = await setupTestApp(ConfigService);
    sqlite = ctx.sqlite;
    env = ctx.env;
    createTestUser(sqlite);
  });

  afterEach(() => {
    cleanupTestDB(sqlite);
  });

  describe("GET /queue-status", () => {
    it("requires an authenticated admin", async () => {
      const res = await ctx.app.request("/queue-status");

      expect(res.status).toBe(401);
    });

    it("counts every status and hides idle feeds from the item list", async () => {
      insertFeed(1, { status: "failed", error: "boom" });
      insertFeed(2, { status: "pending" });
      insertFeed(3, { status: "processing" });
      insertFeed(4, { status: "completed", aiSummary: "done" });
      insertFeed(5, { status: "idle" });

      const res = await ctx.app.request("/queue-status", { headers: adminHeaders });
      expect(res.status).toBe(200);

      const data = (await res.json()) as {
        queueConfigured: boolean;
        summary: Record<string, number>;
        items: Array<{ id: number; aiSummaryStatus: string; updatedAt: string }>;
      };

      expect(data.queueConfigured).toBe(true);
      expect(data.summary.failed).toBe(1);
      expect(data.summary.pending).toBe(1);
      expect(data.summary.processing).toBe(1);
      expect(data.summary.completed).toBe(1);
      expect(data.summary.idle).toBe(1);
      expect(data.items.map((item) => item.id).sort()).toEqual([1, 2, 3, 4]);
      expect(data.items.every((item) => typeof item.updatedAt === "string")).toBe(true);
    });

    it("reports an unconfigured queue when the binding is missing", async () => {
      cleanupTestDB(sqlite);
      ctx = await setupTestApp(ConfigService, { TASK_QUEUE: undefined });
      sqlite = ctx.sqlite;
      createTestUser(sqlite);

      const res = await ctx.app.request("/queue-status", { headers: adminHeaders });
      expect(res.status).toBe(200);

      const data = (await res.json()) as { queueConfigured: boolean };
      expect(data.queueConfigured).toBe(false);
    });
  });

  describe("POST /queue-status/:id/retry", () => {
    it("requeues a failed task and clears the stored error", async () => {
      await enableAI();
      insertFeed(1, { status: "failed", error: "boom" });

      const res = await ctx.app.request("/queue-status/1/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(200);
      const row = readFeed(1);
      expect(row.ai_summary_status).toBe("pending");
      expect(row.ai_summary_error).toBe("");
    });

    it("fails with the queue error instead of reporting a false success", async () => {
      await enableAI();
      insertFeed(1, { status: "failed", error: "boom" });

      let sendCalls = 0;
      env.TASK_QUEUE = {
        send: async () => {
          sendCalls += 1;
          throw new Error("queue send failed");
        },
        sendBatch: async () => {},
      } as unknown as Queue<any>;

      const res = await ctx.app.request("/queue-status/1/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(sendCalls).toBe(1);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("queue send failed");

      const row = readFeed(1);
      expect(row.ai_summary_status).toBe("failed");
      expect(row.ai_summary_error).toBe("queue send failed");
    });

    it("fails when the TASK_QUEUE binding is not configured", async () => {
      cleanupTestDB(sqlite);
      ctx = await setupTestApp(ConfigService, { TASK_QUEUE: undefined });
      sqlite = ctx.sqlite;
      createTestUser(sqlite);
      await enableAI();
      insertFeed(1, { status: "failed", error: "boom" });

      const res = await ctx.app.request("/queue-status/1/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(400);
      expect(await res.text()).toContain("TASK_QUEUE binding is not configured");
      expect(readFeed(1).ai_summary_status).toBe("failed");
    });

    it("clears the failure when AI summaries are turned off", async () => {
      insertFeed(1, { status: "failed", error: "boom" });

      const res = await ctx.app.request("/queue-status/1/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(200);
      const row = readFeed(1);
      expect(row.ai_summary_status).toBe("idle");
      expect(row.ai_summary_error).toBe("");
    });

    it("rejects feeds that are not in a failed state", async () => {
      await enableAI();
      insertFeed(1, { status: "completed", aiSummary: "done" });

      const res = await ctx.app.request("/queue-status/1/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(400);
      expect(await res.text()).toContain("Only failed AI summary tasks can be retried");
      expect(readFeed(1).ai_summary_status).toBe("completed");
    });

    it("returns 404 for an unknown feed", async () => {
      await enableAI();

      const res = await ctx.app.request("/queue-status/99/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(404);
    });

    it("rejects a non numeric feed id", async () => {
      const res = await ctx.app.request("/queue-status/abc/retry", {
        method: "POST",
        headers: adminHeaders,
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /queue-status/:id", () => {
    it("resets a completed task record back to idle", async () => {
      insertFeed(1, { status: "completed", aiSummary: "done" });

      const res = await ctx.app.request("/queue-status/1", {
        method: "DELETE",
        headers: adminHeaders,
      });

      expect(res.status).toBe(200);
      const row = readFeed(1);
      expect(row.ai_summary_status).toBe("idle");
      expect(row.ai_summary_error).toBe("");
    });

    it("refuses to delete a task that is still in flight", async () => {
      insertFeed(1, { status: "processing" });

      const res = await ctx.app.request("/queue-status/1", {
        method: "DELETE",
        headers: adminHeaders,
      });

      expect(res.status).toBe(400);
      expect(readFeed(1).ai_summary_status).toBe("processing");
    });

    it("returns 404 for an unknown feed", async () => {
      const res = await ctx.app.request("/queue-status/99", {
        method: "DELETE",
        headers: adminHeaders,
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /compat-tasks/ai-summary", () => {
    it("does not count feeds the queue rejected as queued", async () => {
      await enableAI();
      insertFeed(1);
      insertFeed(2, { status: "completed", aiSummary: "done" });

      env.TASK_QUEUE = {
        send: async () => {
          throw new Error("queue send failed");
        },
        sendBatch: async () => {},
      } as unknown as Queue<any>;

      const res = await ctx.app.request("/compat-tasks/ai-summary", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        queued: number;
        skipped: number;
        failed?: number;
        forced: boolean;
      };

      expect(data.queued).toBe(0);
      expect(data.failed).toBe(2);
      expect(data.skipped).toBe(0);
      expect(data.forced).toBe(true);
      expect(readFeed(1).ai_summary_status).toBe("failed");
    });
  });
});
