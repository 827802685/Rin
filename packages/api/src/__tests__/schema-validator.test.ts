import { describe, expect, it } from "bun:test";
import { describeIssues, parseSchema, t } from "../schema-validator";
import {
    commentCreateSchema,
    feedCreateSchema,
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
