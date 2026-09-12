import { describe, expect, it } from "bun:test";
import { resolveCorsOrigin } from "../register-middlewares";

const SITE = "https://blog.example.com";

describe("resolveCorsOrigin", () => {
    it("echoes an allow-listed origin", () => {
        expect(resolveCorsOrigin("https://app.example.com", SITE, ["https://app.example.com"])).toBe(
            "https://app.example.com",
        );
    });

    it("rejects an origin that is not allow-listed", () => {
        expect(resolveCorsOrigin("https://evil.example.com", SITE, ["https://app.example.com"])).toBeUndefined();
    });

    it("never echoes an arbitrary origin when no allow list is configured", () => {
        expect(resolveCorsOrigin("https://evil.example.com", SITE, [])).toBeUndefined();
    });

    it("allows same-origin requests when no allow list is configured", () => {
        expect(resolveCorsOrigin(SITE, SITE, [])).toBe(SITE);
    });

    it("treats a different port as a different origin", () => {
        expect(resolveCorsOrigin("https://blog.example.com:8080", SITE, [])).toBeUndefined();
    });

    it("treats a different scheme as a different origin", () => {
        expect(resolveCorsOrigin("http://blog.example.com", SITE, [])).toBeUndefined();
    });

    it("supports several allow-listed origins", () => {
        const allowList = ["https://a.example.com", "https://b.example.com"];
        expect(resolveCorsOrigin("https://b.example.com", SITE, allowList)).toBe("https://b.example.com");
        expect(resolveCorsOrigin("https://c.example.com", SITE, allowList)).toBeUndefined();
    });

    it("rejects a malformed origin", () => {
        expect(resolveCorsOrigin("not a url", SITE, [])).toBeUndefined();
    });

    it("rejects an allow-listed origin that does not match exactly", () => {
        expect(resolveCorsOrigin("https://app.example.com/", SITE, ["https://app.example.com"])).toBeUndefined();
    });
});
