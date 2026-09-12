import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { API_PATHS, ROOT_PATHS } from "@rin/api";
import { registerRoutes } from "../register-routes";
import type { Variables } from "../hono-types";
import type { RinApp } from "../app-types";

interface RegisteredRoute {
    method: string;
    path: string;
}

function collectRoutes(app: RinApp): RegisteredRoute[] {
    return (app as unknown as Hono).routes
        .filter((route) => route.path !== "/*")
        .map((route) => ({
            method: route.method.toUpperCase(),
            path: route.path,
        }));
}

/**
 * Compares a Hono route pattern (`/feed/:id`, `/blob/*`) against a concrete
 * request path. Segments are compared one by one; `:param` matches any single
 * segment and a trailing `*` matches the remainder.
 */
function pathMatches(routePath: string, requestPath: string): boolean {
    const routeSegments = routePath.split("/").filter(Boolean);
    const requestSegments = requestPath.split("/").filter(Boolean);

    const endsWithWildcard = routeSegments[routeSegments.length - 1] === "*";
    if (endsWithWildcard) {
        const fixed = routeSegments.slice(0, -1);
        if (requestSegments.length < fixed.length) {
            return false;
        }
        return fixed.every((segment, index) => segment.startsWith(":") || segment === requestSegments[index]);
    }

    if (routeSegments.length !== requestSegments.length) {
        return false;
    }

    return routeSegments.every(
        (segment, index) => segment.startsWith(":") || segment === requestSegments[index],
    );
}

function matches(routes: RegisteredRoute[], method: string, path: string): boolean {
    const wanted = method.toUpperCase();

    return routes.some(
        (route) =>
            pathMatches(route.path, path) &&
            (route.method === wanted || route.method === "ALL"),
    );
}

// Builder functions take different shapes (ids, names, config types, file
// names). Try each shape and accept the path if any of them is routable.
const CANDIDATE_ARGUMENTS = [42, "cloudflare", "server", "hello", "rss.xml", "images/a.png"];

function expand(value: unknown): string[] {
    if (typeof value !== "function") {
        return [String(value)];
    }

    const fn = value as (arg: never) => string;
    const results = new Set<string>();

    for (const arg of CANDIDATE_ARGUMENTS) {
        try {
            const result = fn(arg as never);
            if (typeof result === "string") {
                results.add(result);
            }
        } catch {
            // try the next argument shape
        }
    }

    if (results.size === 0) {
        throw new Error("Could not expand an API_PATHS builder");
    }

    return [...results];
}

/** Requests hit the app with the `/api` prefix already stripped. */
function toAppPath(path: string): string {
    return path.startsWith("/api") ? path.slice("/api".length) || "/" : path;
}

function isRouted(routes: RegisteredRoute[], path: string, methods: string[]): boolean {
    const appPath = toAppPath(path);
    return methods.some((method) => matches(routes, method, appPath));
}

describe("API_PATHS", () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>() as unknown as RinApp;
    registerRoutes(app);
    const routes = collectRoutes(app);
    const anyMethod = ["GET", "POST", "PUT", "DELETE"];

    it("registers a non-empty route table", () => {
        expect(routes.length).toBeGreaterThan(20);
    });

    it("every documented path exists on the server", () => {
        const missing: string[] = [];

        for (const [key, value] of Object.entries(API_PATHS)) {
            const candidates = expand(value);
            if (!candidates.some((path) => isRouted(routes, path, anyMethod))) {
                missing.push(`${key}: ${candidates.join(" | ")}`);
            }
        }

        expect(missing).toEqual([]);
    });

    it("keeps every api path prefixed with /api", () => {
        const unprefixed = Object.entries(API_PATHS)
            .flatMap(([key, value]) => expand(value).map((path) => [key, path] as const))
            // RSS documents live at the site root, not under /api.
            .filter(([key, path]) => key !== "RSS_GET" && !path.startsWith("/api/"))
            .map(([key, path]) => `${key}: ${path}`);

        expect(unprefixed).toEqual([]);
    });

    it("no longer references the removed /ai-config endpoints", () => {
        expect(Object.keys(API_PATHS)).not.toContain("AI_CONFIG_GET");
        expect(Object.keys(API_PATHS)).not.toContain("AI_CONFIG_UPDATE");
    });

    it("documents the root level feed and SEO documents", () => {
        for (const [key, path] of Object.entries(ROOT_PATHS)) {
            const reachable = isRouted(routes, path, ["GET", "POST"]);
            expect(reachable, `${key}: ${path} is not routed`).toBe(true);
        }
    });
});
