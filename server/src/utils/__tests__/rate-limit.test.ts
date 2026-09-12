import { beforeEach, describe, expect, it } from "bun:test";
import { cleanupTestDB, createMockDB } from "../../../tests/fixtures";
import { cleanupRateLimits, consumeRateLimit } from "../rate-limit";

describe("consumeRateLimit", () => {
    // Matches the convention used by the other server tests: the fixture
    // returns a bun:sqlite database, which is structurally close enough to the
    // D1 driver for these queries but not type identical.
    let db: any;
    let sqlite: ReturnType<typeof createMockDB>["sqlite"];

    beforeEach(() => {
        const mock = createMockDB();
        db = mock.db;
        sqlite = mock.sqlite;
    });

    it("allows requests under the limit and counts down the remaining budget", async () => {
        const base = { scope: "login", identifier: "203.0.113.1", limit: 3, windowSeconds: 60 };

        const first = await consumeRateLimit(db, base);
        expect(first.allowed).toBe(true);
        expect(first.remaining).toBe(2);

        const second = await consumeRateLimit(db, base);
        expect(second.allowed).toBe(true);
        expect(second.remaining).toBe(1);
    });

    it("blocks once the limit is exceeded", async () => {
        const base = { scope: "login", identifier: "203.0.113.2", limit: 2, windowSeconds: 60 };

        await consumeRateLimit(db, base);
        await consumeRateLimit(db, base);
        const third = await consumeRateLimit(db, base);

        expect(third.allowed).toBe(false);
        expect(third.remaining).toBe(0);
        expect(third.limit).toBe(2);
    });

    it("keeps scopes and identifiers isolated", async () => {
        const shared = { limit: 1, windowSeconds: 60 };

        await consumeRateLimit(db, { ...shared, scope: "login", identifier: "203.0.113.3" });
        const otherScope = await consumeRateLimit(db, { ...shared, scope: "ai-chat", identifier: "203.0.113.3" });
        const otherIdentity = await consumeRateLimit(db, { ...shared, scope: "login", identifier: "203.0.113.4" });

        expect(otherScope.allowed).toBe(true);
        expect(otherIdentity.allowed).toBe(true);
    });

    it("starts a fresh counter when the window rolls over", async () => {
        const base = { scope: "login", identifier: "203.0.113.5", limit: 1, windowSeconds: 60 };

        const before = await consumeRateLimit(db, { ...base, now: new Date("2026-01-01T00:00:00Z") });
        expect(before.allowed).toBe(true);

        const blocked = await consumeRateLimit(db, { ...base, now: new Date("2026-01-01T00:00:30Z") });
        expect(blocked.allowed).toBe(false);

        const after = await consumeRateLimit(db, { ...base, now: new Date("2026-01-01T00:01:01Z") });
        expect(after.allowed).toBe(true);
        expect(after.remaining).toBe(0);
    });

    it("reports when the current window resets", async () => {
        const result = await consumeRateLimit(db, {
            scope: "ai-chat",
            identifier: "203.0.113.6",
            limit: 5,
            windowSeconds: 60,
            now: new Date("2026-01-01T00:00:10Z"),
        });

        expect(result.resetAt).toBe(Math.floor(new Date("2026-01-01T00:01:00Z").getTime() / 1000));
    });

    it("fails open when the table is unavailable", async () => {
        sqlite.exec("DROP TABLE rate_limits");

        const result = await consumeRateLimit(db, {
            scope: "login",
            identifier: "203.0.113.7",
            limit: 1,
            windowSeconds: 60,
        });

        expect(result.allowed).toBe(true);
        cleanupTestDB(sqlite);
    });
});

describe("cleanupRateLimits", () => {
    it("removes stale buckets and keeps fresh ones", async () => {
        const { db, sqlite } = createMockDB() as { db: any; sqlite: ReturnType<typeof createMockDB>["sqlite"] };
        const now = new Date("2026-01-01T00:05:00Z");

        await consumeRateLimit(db, { scope: "login", identifier: "stale", limit: 5, windowSeconds: 60, now: new Date("2026-01-01T00:00:00Z") });
        await consumeRateLimit(db, { scope: "login", identifier: "fresh", limit: 5, windowSeconds: 60, now });

        await cleanupRateLimits(db, 120, now);

        const staleAgain = await consumeRateLimit(db, { scope: "login", identifier: "stale", limit: 5, windowSeconds: 60, now });
        expect(staleAgain.remaining).toBe(4);

        cleanupTestDB(sqlite);
    });
});
