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

        // `x-forwarded-for` may be a comma separated chain; the left-most entry
        // is the original client.
        const first = value.split(",")[0]?.trim();
        if (first) {
            return first;
        }
    }

    return UNKNOWN_IP;
}
