import { describe, expect, it } from "bun:test";
import { getClientIP } from "../request";

/**
 * `getClientIP` only needs the header lookup, so a plain object is enough and
 * keeps the suite independent of the Hono fixtures.
 */
function requestWith(headers: Record<string, string>) {
    return {
        req: {
            header: (name: string) => headers[name.toLowerCase()],
        },
    } as never;
}

describe("getClientIP", () => {
    it("prefers cf-connecting-ip, which Cloudflare rewrites on every request", () => {
        const ip = getClientIP(
            requestWith({
                "cf-connecting-ip": "203.0.113.7",
                "x-forwarded-for": "198.51.100.1",
            })
        );

        expect(ip).toBe("203.0.113.7");
    });

    it("keeps cf-connecting-ip even when a client spoofs x-forwarded-for", () => {
        const ip = getClientIP(
            requestWith({
                "cf-connecting-ip": "203.0.113.7",
                "x-forwarded-for": "1.2.3.4, 5.6.7.8",
            })
        );

        expect(ip).toBe("203.0.113.7");
    });

    it("falls back to x-real-ip", () => {
        expect(getClientIP(requestWith({ "x-real-ip": "198.51.100.9" }))).toBe("198.51.100.9");
    });

    it("falls back to x-forwarded-for when nothing more specific is present", () => {
        expect(getClientIP(requestWith({ "x-forwarded-for": "198.51.100.10" }))).toBe("198.51.100.10");
    });

    it("takes the right-most x-forwarded-for entry, not the spoofable left-most one", () => {
        // The left-most entry is whatever the caller sent: without this rule a
        // client mints a fresh rate-limit bucket per request by prepending a
        // random address, which defeats the login and AI-chat throttles.
        const ip = getClientIP(requestWith({ "x-forwarded-for": "1.2.3.4, 198.51.100.11" }));

        expect(ip).toBe("198.51.100.11");
        expect(ip).not.toBe("1.2.3.4");
    });

    it("reads a long proxy chain from the inside out", () => {
        const ip = getClientIP(
            requestWith({ "x-forwarded-for": "1.2.3.4, 198.51.100.12, 203.0.113.9" })
        );

        expect(ip).toBe("203.0.113.9");
    });

    it("trims surrounding whitespace in the chain", () => {
        expect(getClientIP(requestWith({ "x-forwarded-for": "  198.51.100.13  " }))).toBe(
            "198.51.100.13"
        );
    });

    it("skips empty entries instead of returning an empty identifier", () => {
        expect(getClientIP(requestWith({ "x-forwarded-for": " , , " }))).toBe("unknown");
    });

    it("keeps IPv6 addresses intact", () => {
        expect(getClientIP(requestWith({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    });

    it("reports a stable placeholder when no header is available", () => {
        expect(getClientIP(requestWith({}))).toBe("unknown");
    });

    it("ignores an empty header rather than returning an empty identifier", () => {
        expect(getClientIP(requestWith({ "cf-connecting-ip": "" }))).toBe("unknown");
    });
});
