import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const friendCrontab = mock(async () => {});
const rssCrontab = mock(async () => {});
const cleanupRateLimits = mock(async () => {});

// The handler imports these lazily at run time, so stubbing them here is enough.
mock.module("../../services/friends", () => ({ friendCrontab }));
mock.module("../../services/rss", () => ({ rssCrontab }));
mock.module("../../utils/rate-limit", () => ({ cleanupRateLimits }));

const { handleScheduled } = await import("../scheduled-handler");
const { createMockEnv } = await import("../../../tests/fixtures");

const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
} as unknown as ExecutionContext;

describe("handleScheduled", () => {
    beforeEach(() => {
        friendCrontab.mockClear();
        rssCrontab.mockClear();
        cleanupRateLimits.mockClear();
    });

    afterEach(() => {
        friendCrontab.mockImplementation(async () => {});
    });

    it("runs every scheduled task", async () => {
        await handleScheduled(null, createMockEnv(), ctx);

        expect(friendCrontab).toHaveBeenCalled();
        expect(rssCrontab).toHaveBeenCalled();
        expect(cleanupRateLimits).toHaveBeenCalled();
    });

    it("passes the 24h retention window to the rate limit cleanup", async () => {
        await handleScheduled(null, createMockEnv(), ctx);

        expect(cleanupRateLimits).toHaveBeenCalledWith(expect.anything(), 60 * 60 * 24);
    });

    it("keeps running the remaining tasks when the friend check fails", async () => {
        // Friend links are third party sites, so this is the task most likely to
        // throw — it must not take the RSS build down with it.
        friendCrontab.mockImplementation(async () => {
            throw new Error("friend unreachable");
        });

        await expect(handleScheduled(null, createMockEnv(), ctx)).resolves.toBeUndefined();

        expect(rssCrontab).toHaveBeenCalled();
        expect(cleanupRateLimits).toHaveBeenCalled();
    });

    it("still runs the cleanup when the RSS build fails", async () => {
        rssCrontab.mockImplementation(async () => {
            throw new Error("storage offline");
        });

        await expect(handleScheduled(null, createMockEnv(), ctx)).resolves.toBeUndefined();

        expect(friendCrontab).toHaveBeenCalled();
        expect(cleanupRateLimits).toHaveBeenCalled();
    });
});
