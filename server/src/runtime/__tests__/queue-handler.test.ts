import { describe, expect, it, mock } from "bun:test";

import { handleQueue, type QueueTaskModules } from "../queue-handler";
import {
  createFeedAIGenerateTask,
  createFeedAISummaryTask,
  FEED_AI_GENERATE_TASK,
  FEED_AI_SUMMARY_TASK,
  } from "../../queue";
import type { FeedAIGenerateResult } from "../../services/feed-ai-generate";
import { createMockEnv } from "../../../tests/fixtures";

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

type FakeMessage = {
  id: string;
  body: unknown;
  acked: boolean;
  ack(): void;
  retry(): void;
};

function makeMessage(id: string, body: unknown): FakeMessage {
  const message: FakeMessage = {
    id,
    body,
    acked: false,
    ack() {
      message.acked = true;
    },
    retry() {
      throw new Error("unexpected retry()");
    },
  };
  return message;
}

function makeBatch(messages: FakeMessage[]) {
  return {
    queue: "rin-tasks",
    messages,
    ackAll() {
      for (const message of messages) message.ack();
    },
    retryAll() {
      throw new Error("unexpected retryAll()");
    },
  } as unknown as MessageBatch<unknown>;
}

// The processors are injected rather than module-mocked: Bun keeps `mock.module`
// overrides for the rest of the process, so stubbing them here would silently
// replace the real implementations for every later test file.
function createModules(overrides: Partial<QueueTaskModules> = {}): QueueTaskModules {
  return {
    processFeedAISummaryTask: mock(async () => {}),
    processFeedAIGenerateTask: mock(
      async (): Promise<FeedAIGenerateResult> => ({
        status: "created",
        feedId: 7,
        title: "generated",
        tags: [],
      }),
    ),
    clearFeedCache: mock(async () => {}),
    ...overrides,
  };
}

const summaryBody = createFeedAISummaryTask({ feedId: 1, expectedUpdatedAtUnix: 1 });
const generateBody = createFeedAIGenerateTask({ topic: "rin" });

describe("handleQueue", () => {
  it("acks unknown messages without running any processor", async () => {
    const modules = createModules();
    const message = makeMessage("m1", { type: "something.else", payload: {} });

    await handleQueue(makeBatch([message]), createMockEnv(), ctx, modules);

    expect(message.acked).toBe(true);
    expect(modules.processFeedAISummaryTask).not.toHaveBeenCalled();
    expect(modules.processFeedAIGenerateTask).not.toHaveBeenCalled();
  });

  it("dispatches an AI summary task with its payload", async () => {
    const modules = createModules();
    const message = makeMessage("m1", summaryBody);

    await handleQueue(makeBatch([message]), createMockEnv(), ctx, modules);

    expect(modules.processFeedAISummaryTask).toHaveBeenCalledTimes(1);
    const args = (modules.processFeedAISummaryTask as ReturnType<typeof mock>).mock
      .calls[0] as unknown[];
    expect(args[4]).toEqual(summaryBody.payload);
    expect(message.acked).toBe(true);
  });

  it("dispatches an AI generate task with its payload", async () => {
    const modules = createModules();
    const message = makeMessage("m1", generateBody);

    await handleQueue(makeBatch([message]), createMockEnv(), ctx, modules);

    expect(modules.processFeedAIGenerateTask).toHaveBeenCalledTimes(1);
    const args = (modules.processFeedAIGenerateTask as ReturnType<typeof mock>).mock
      .calls[0] as unknown[];
    expect(args[4]).toEqual(generateBody.payload);
    expect(message.acked).toBe(true);
  });

  it("keeps processing the rest of the batch when a summary task throws", async () => {
    // Regression: an unguarded throw aborted the loop, so every message behind
    // the broken one was never attempted in this delivery and the whole batch
    // was redelivered until max_retries gave up.
    const modules = createModules({
      processFeedAISummaryTask: mock(async (...args: unknown[]) => {
        if ((args[4] as { feedId: number }).feedId === 1) {
          throw new Error("db offline");
        }
      }),
    });
    const broken = makeMessage("m1", summaryBody);
    const behind = makeMessage(
      "m2",
      createFeedAISummaryTask({ feedId: 2, expectedUpdatedAtUnix: 2 }),
    );

    await expect(
      handleQueue(makeBatch([broken, behind]), createMockEnv(), ctx, modules),
    ).resolves.toBeUndefined();

    expect(modules.processFeedAISummaryTask).toHaveBeenCalledTimes(2);
  });

  it("acks the failing message too, instead of redelivering the batch", async () => {
    const modules = createModules({
      processFeedAISummaryTask: mock(async () => {
        throw new Error("deterministic failure");
      }),
    });
    const message = makeMessage("m1", summaryBody);

    await handleQueue(makeBatch([message]), createMockEnv(), ctx, modules);

    expect(message.acked).toBe(true);
  });

  it("keeps processing the rest of the batch when a generate task throws", async () => {
    const modules = createModules({
      processFeedAIGenerateTask: mock(async () => {
        throw new Error("ai gateway down");
      }),
    });
    const first = makeMessage("m1", generateBody);
    const second = makeMessage("m2", summaryBody);

    await expect(
      handleQueue(makeBatch([first, second]), createMockEnv(), ctx, modules),
    ).resolves.toBeUndefined();

    expect(modules.processFeedAIGenerateTask).toHaveBeenCalledTimes(1);
    expect(modules.processFeedAISummaryTask).toHaveBeenCalledTimes(1);
  });

  it("runs the two task types independently in one batch", async () => {
    const modules = createModules();

    await handleQueue(
      makeBatch([makeMessage("m1", summaryBody), makeMessage("m2", generateBody)]),
      createMockEnv(),
      ctx,
      modules,
    );

    expect(modules.processFeedAISummaryTask).toHaveBeenCalledTimes(1);
    expect(modules.processFeedAIGenerateTask).toHaveBeenCalledTimes(1);
  });

  it("ignores a task whose payload fails validation", async () => {
    const modules = createModules();
    const message = makeMessage("m1", { type: FEED_AI_SUMMARY_TASK, payload: { feedId: "1" } });

    await handleQueue(makeBatch([message]), createMockEnv(), ctx, modules);

    expect(message.acked).toBe(true);
    expect(modules.processFeedAISummaryTask).not.toHaveBeenCalled();
    expect(modules.processFeedAIGenerateTask).not.toHaveBeenCalled();
  });

  it("recognizes the generate task type constant", () => {
    expect(generateBody.type).toBe(FEED_AI_GENERATE_TASK);
    expect(summaryBody.type).toBe(FEED_AI_SUMMARY_TASK);
  });
});
