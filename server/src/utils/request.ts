import type { AppContext } from "../core/hono-types";

const UNKNOWN_IP = "unknown";

/**
 * Best-effort client IP used for rate limiting.
 *
 * `cf-connecting-ip` is trusted when present because Cloudflare overwrites it on
 * every request; the proxy headers are only consulted as a fallback for local
 * development and non-Cloudflare deployments.
 */
export function getClientIP(c: Pick<AppContext, "req">): string {
    const headers = [
        "cf-connecting-ip",
        "x-real-ip",
        "x-forwarded-for",
    ];

    for (const header of headers) {
        const value = c.req.header(header);
        if (!value) {
            continue;
        }

        // `x-forwarded-for` is a comma separated chain that every hop appends
        // to. The left-most entry is whatever the caller sent, so reading it
        // lets any client mint a fresh rate-limit bucket per request by
        // prepending a random address. The right-most entry is the one written
        // by the proxy that actually terminated the connection, which is the
        // only part of the header the server can rely on.
        const parts = value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);

        if (parts.length === 0) {
            continue;
        }

        const candidate = header === "x-forwarded-for" ? parts[parts.length - 1]! : parts[0]!;
        if (candidate) {
            return candidate;
        }
    }

    return UNKNOWN_IP;
}
