import { describe, expect, it } from "bun:test";
import { describeIssues, parseSchema, t } from "../schema-validator";
import {
    commentCreateSchema,
    feedCreateSchema,
    feedSetTopSchema,
    friendCreateSchema,
    friendUpdateSchema,
    loginSchema,
    momentCreateSchema,
} from "../schemas";

describe("parseSchema", () => {
    it("accepts a valid object", () => {
        const result = parseSchema<{ content: string }>(momentCreateSchema, { content: "hello" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.content).toBe("hello");
        }
    });

    it("rejects a missing required field", () => {
        const result = parseSchema(momentCreateSchema, {});
        expect(result.success).toBe(false);
    });

    it("reports the path of the offending field", () => {
        const result = parseSchema(momentCreateSchema, {});
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.issues[0]?.path).toBe("$.content");
        }
    });

    it("rejects a wrong type", () => {
        const result = parseSchema(momentCreateSchema, { content: 42 });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.issues[0]?.message).toContain("expected string");
        }
    });

    it("enforces minLength", () => {
        expect(parseSchema(momentCreateSchema, { content: "" }).success).toBe(false);
        expect(parseSchema(momentCreateSchema, { content: "a" }).success).toBe(true);
    });

    it("allows optional fields to be absent", () => {
        const schema = t.Object({ name: t.String(), note: t.String({ optional: true }) });
        expect(parseSchema(schema, { name: "x" }).success).toBe(true);
    });

    it("validates nested objects", () => {
        const schema = t.Object({ user: t.Object({ id: t.Number() }) });
        expect(parseSchema(schema, { user: { id: 1 } }).success).toBe(true);

        const bad = parseSchema(schema, { user: { id: "one" } });
        expect(bad.success).toBe(false);
        if (!bad.success) {
            expect(bad.issues[0]?.path).toBe("$.user.id");
        }
    });

    it("validates every array item", () => {
        const result = parseSchema(feedCreateSchema, {
            title: "t",
            content: "c",
            draft: false,
            listed: true,
            tags: ["ok", 7],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.issues[0]?.path).toBe("$.tags[1]");
        }
    });

    it("rejects non-finite numbers", () => {
        const schema = t.Object({ count: t.Number() });
        expect(parseSchema(schema, { count: Number.NaN }).success).toBe(false);
        expect(parseSchema(schema, { count: 3 }).success).toBe(true);
    });

    it("rejects a non-object payload", () => {
        expect(parseSchema(momentCreateSchema, "nope").success).toBe(false);
        expect(parseSchema(momentCreateSchema, null).success).toBe(false);
    });

    it("skips file fields, which the multipart handler validates", () => {
        const schema = t.Object({ data: t.File() });
        expect(parseSchema(schema, { data: new Blob(["x"]) }).success).toBe(true);
    });

    it("rejects a blank feed title or content", () => {
        const base = { draft: false, listed: true, tags: [] };
        expect(parseSchema(feedCreateSchema, { ...base, title: "", content: "c" }).success).toBe(false);
        expect(parseSchema(feedCreateSchema, { ...base, title: "t", content: "" }).success).toBe(false);
        expect(parseSchema(feedCreateSchema, { ...base, title: "t", content: "c" }).success).toBe(true);
    });

    it("requires a numeric top value", () => {
        expect(parseSchema(feedSetTopSchema, { top: 0 }).success).toBe(true);
        expect(parseSchema(feedSetTopSchema, { top: 3 }).success).toBe(true);
        expect(parseSchema(feedSetTopSchema, {}).success).toBe(false);
        expect(parseSchema(feedSetTopSchema, { top: "1" }).success).toBe(false);
    });

    it("enforces the friend link length limits", () => {
        const valid = {
            name: "a".repeat(20),
            desc: "d".repeat(100),
            avatar: "https://example.com/a.png",
            url: "https://example.com",
        };
        expect(parseSchema(friendCreateSchema, valid).success).toBe(true);
        expect(parseSchema(friendCreateSchema, { ...valid, name: "a".repeat(21) }).success).toBe(false);
        expect(parseSchema(friendCreateSchema, { ...valid, desc: "d".repeat(101) }).success).toBe(false);
        expect(parseSchema(friendCreateSchema, { ...valid, url: "u".repeat(101) }).success).toBe(false);
        expect(parseSchema(friendCreateSchema, { ...valid, avatar: "" }).success).toBe(false);
    });

    it("treats every friend update field as optional", () => {
        expect(parseSchema(friendUpdateSchema, {}).success).toBe(true);
        expect(parseSchema(friendUpdateSchema, { accepted: 1 }).success).toBe(true);
        expect(parseSchema(friendUpdateSchema, { accepted: "1" }).success).toBe(false);
        expect(parseSchema(friendUpdateSchema, { name: null }).success).toBe(true);
    });

    it("requires a non-empty username and password", () => {
        expect(parseSchema(loginSchema, { username: "u", password: "p" }).success).toBe(true);
        expect(parseSchema(loginSchema, { username: "", password: "p" }).success).toBe(false);
        expect(parseSchema(loginSchema, { username: "u" }).success).toBe(false);
    });

    it("leaves unknown keys untouched", () => {
        const result = parseSchema<Record<string, unknown>>(commentCreateSchema, {
            content: "hi",
            somethingElse: true,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.somethingElse).toBe(true);
        }
    });
});

describe("describeIssues", () => {
    it("falls back to a generic message", () => {
        expect(describeIssues([])).toBe("Invalid request");
    });

    it("joins path and message", () => {
        expect(describeIssues([{ path: "$.content", message: "is required" }])).toBe(
            "$.content is required",
        );
    });
});
