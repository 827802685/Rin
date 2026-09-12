import { describe, expect, it } from "bun:test";
import {
    PBKDF2_ITERATIONS,
    hashPassword,
    needsRehash,
    timingSafeEqual,
    verifyPassword,
} from "../password";

// Keep the iteration count low so the suite stays fast; the algorithm and the
// storage format are what matter here.
const TEST_ITERATIONS = 1000;

async function legacySha256(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

describe("hashPassword", () => {
    it("produces a salted pbkdf2 hash with a random salt", async () => {
        const first = await hashPassword("correct horse battery staple", TEST_ITERATIONS);
        const second = await hashPassword("correct horse battery staple", TEST_ITERATIONS);

        expect(first.startsWith("pbkdf2$")).toBe(true);
        expect(first).not.toBe(second);
    });

    it("embeds the iteration count in the stored value", async () => {
        const hash = await hashPassword("secret", TEST_ITERATIONS);
        expect(hash.split("$")[1]).toBe(String(TEST_ITERATIONS));
    });

    it("defaults to the production iteration count", async () => {
        const hash = await hashPassword("secret");
        expect(hash.split("$")[1]).toBe(String(PBKDF2_ITERATIONS));
    });
});

describe("verifyPassword", () => {
    it("accepts the correct password", async () => {
        const hash = await hashPassword("s3cret-pass", TEST_ITERATIONS);
        expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
    });

    it("rejects a wrong password", async () => {
        const hash = await hashPassword("s3cret-pass", TEST_ITERATIONS);
        expect(await verifyPassword("wrong-pass", hash)).toBe(false);
    });

    it("rejects empty and missing stored values", async () => {
        expect(await verifyPassword("anything", "")).toBe(false);
        expect(await verifyPassword("anything", undefined)).toBe(false);
        expect(await verifyPassword("anything", null)).toBe(false);
    });

    it("rejects malformed pbkdf2 payloads", async () => {
        expect(await verifyPassword("x", "pbkdf2$notanumber$c2FsdA$aGFzaA")).toBe(false);
        expect(await verifyPassword("x", "pbkdf2$1000$!!!$???")).toBe(false);
    });

    it("still verifies legacy unsalted sha-256 digests", async () => {
        const legacy = await legacySha256("legacy-pass");
        expect(await verifyPassword("legacy-pass", legacy)).toBe(true);
        expect(await verifyPassword("other-pass", legacy)).toBe(false);
    });

    it("rejects unknown hash formats", async () => {
        expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    });
});

describe("needsRehash", () => {
    it("flags legacy digests and missing values", async () => {
        expect(needsRehash(await legacySha256("x"))).toBe(true);
        expect(needsRehash(null)).toBe(true);
        expect(needsRehash(undefined)).toBe(true);
    });

    it("accepts pbkdf2 hashes", async () => {
        expect(needsRehash(await hashPassword("x", TEST_ITERATIONS))).toBe(false);
    });
});

describe("timingSafeEqual", () => {
    it("compares equal sequences", () => {
        expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it("compares different sequences", () => {
        expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    });

    it("compares different lengths", () => {
        expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });

    it("handles empty input", () => {
        expect(timingSafeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
    });
});
