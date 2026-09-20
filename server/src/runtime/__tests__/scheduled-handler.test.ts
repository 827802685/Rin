import { beforeEach, describe, expect, it, mock } from "bun:test";

import { handleScheduled, type ScheduledTaskModules } from "../scheduled-handler";
import { createMockEnv } from "../../../tests/fixtures";

const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
} as unknown as ExecutionContext;

type TaskMocks = {
    friendCrontab: ReturnType<typeof mock>;
    rssCrontab: ReturnType<typeof mock>;
    cleanupRateLimits: ReturnType<typeof mock>;
};

// The tasks are injected rather than module-mocked: Bun keeps `mock.module`
// overrides for the rest of the process, so stubbing these modules here would
// silently replace the real implementations for every later test file.
function createTaskMocks(): TaskMocks {
    return {
        friendCrontab: mock(async () => {}),
        rssCrontab: mock(async () => {}),
        cleanupRateLimits: mock(async () => {}),
    };
}

describe("handleScheduled", () => {
    let tasks: TaskMocks;

    beforeEach(() => {
        tasks = createTaskMocks();
    });

    async function run() {
        return handleScheduled(null, createMockEnv(), ctx, tasks as unknown as ScheduledTaskModules);
    }

    it("runs every scheduled task", async () => {
        await run();

        expect(tasks.friendCrontab).toHaveBeenCalled();
        expect(tasks.rssCrontab).toHaveBeenCalled();
        expect(tasks.cleanupRateLimits).toHaveBeenCalled();
    });

    it("passes the 24h retention window to the rate limit cleanup", async () => {
        await run();

        expect(tasks.cleanupRateLimits).toHaveBeenCalledWith(expect.anything(), 60 * 60 * 24);
    });

    it("keeps running the remaining tasks when the friend check fails", async () => {
        // Friend links are third party sites, so this is the task most likely to
        // throw — it must not take the RSS build down with it.
        tasks.friendCrontab.mockImplementation(async () => {
            throw new Error("friend unreachable");
        });

        await expect(run()).resolves.toBeUndefined();

        expect(tasks.rssCrontab).toHaveBeenCalled();
        expect(tasks.cleanupRateLimits).toHaveBeenCalled();
    });

    it("still runs the cleanup when the RSS build fails", async () => {
        tasks.rssCrontab.mockImplementation(async () => {
            throw new Error("storage offline");
        });

        await expect(run()).resolves.toBeUndefined();

        expect(tasks.friendCrontab).toHaveBeenCalled();
        expect(tasks.cleanupRateLimits).toHaveBeenCalled();
    });
});
