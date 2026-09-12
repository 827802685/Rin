import { cors } from "hono/cors";
import { timing } from "hono/timing";
import { authMiddleware, initContainerMiddleware } from "./hono-middleware";
import type { RinApp } from "./app-types";

/**
 * Comma separated list of origins allowed to make cross-site requests.
 * When unset the API only answers same-origin browser requests.
 */
const CORS_ORIGIN_ENV_KEY = "CORS_ORIGIN";

function readEnvValue(env: Env | undefined, key: string): string | undefined {
    if (!env) {
        return undefined;
    }

    const value = (env as unknown as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
}

function parseAllowList(raw: string | undefined): string[] {
    if (!raw) {
        return [];
    }

    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

/**
 * Decides the `Access-Control-Allow-Origin` value.
 *
 * Echoing the request origin back while `credentials: true` is set lets any
 * site read authenticated responses, so an origin is only echoed when it is on
 * the allow list (`CORS_ORIGIN`), or when it is the site itself (same-origin).
 * Returning `undefined` makes Hono omit the CORS headers entirely.
 */
export function resolveCorsOrigin(origin: string, requestUrl: string, allowList: string[]): string | undefined {
    if (allowList.length > 0) {
        return allowList.includes(origin) ? origin : undefined;
    }

    // Compare full origins so scheme and port differences count as cross-site.
    let requestOrigin: string;
    try {
        requestOrigin = new URL(requestUrl).origin;
    } catch {
        return undefined;
    }

    return origin === requestOrigin ? origin : undefined;
}

export function registerMiddlewares(app: RinApp) {
    app.use(
        "*",
        cors({
            origin: (origin, c) => resolveCorsOrigin(
                origin,
                c.req.url,
                parseAllowList(readEnvValue(c.env, CORS_ORIGIN_ENV_KEY)),
            ),
            allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            allowHeaders: ["content-type", "authorization", "x-csrf-token"],
            maxAge: 600,
            credentials: true,
        }),
    );

    app.use("*", timing({ totalDescription: "" }));
    app.use("*", initContainerMiddleware);
    app.use("*", authMiddleware);
}
