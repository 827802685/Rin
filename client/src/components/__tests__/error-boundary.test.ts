import { describe, expect, it } from "vitest";
import {
    getUserFriendlyMessage,
    isAuthError,
    isNetworkError,
    isNotFoundError,
    parseApiError,
} from "../error-boundary";

describe("parseApiError", () => {
    it("unwraps a server error envelope", () => {
        const parsed = parseApiError({
            error: { message: "Nope", code: "FORBIDDEN", status: 403, requestId: "req-1" },
        });

        expect(parsed.message).toBe("Nope");
        expect(parsed.code).toBe("FORBIDDEN");
        expect(parsed.status).toBe(403);
        expect(parsed.requestId).toBe("req-1");
        expect(parsed.severity).toBe("medium");
    });

    it("reads a plain Error", () => {
        const parsed = parseApiError(new Error("boom"));
        expect(parsed.message).toBe("boom");
    });

    it("accepts a string", () => {
        expect(parseApiError("plain failure").message).toBe("plain failure");
    });

    it("falls back for unknown values", () => {
        const parsed = parseApiError(undefined);
        expect(parsed.message).toBe("An unexpected error occurred");
        expect(parsed.severity).toBe("high");
    });

    it("ranks server failures above client failures", () => {
        expect(parseApiError({ error: { message: "x", status: 500 } }).severity).toBe("high");
        expect(parseApiError({ error: { message: "x", status: 404 } }).severity).toBe("medium");
        expect(parseApiError({ error: { message: "x", status: 200 } }).severity).toBe("low");
    });
});

describe("error classifiers", () => {
    it("detects network failures", () => {
        expect(isNetworkError({ status: 0 })).toBe(true);
        expect(isNetworkError({ message: "Failed to fetch" })).toBe(true);
        expect(isNetworkError({ message: "something else" })).toBe(false);
        expect(isNetworkError(null)).toBe(false);
    });

    it("detects auth failures", () => {
        expect(isAuthError({ status: 401 })).toBe(true);
        expect(isAuthError({ code: "TOKEN_EXPIRED" })).toBe(true);
        expect(isAuthError({ status: 500 })).toBe(false);
        expect(isAuthError("nope")).toBe(false);
    });

    it("detects not-found failures", () => {
        expect(isNotFoundError({ status: 404 })).toBe(true);
        expect(isNotFoundError({ code: "RESOURCE_NOT_FOUND" })).toBe(true);
        expect(isNotFoundError({ status: 403 })).toBe(false);
    });
});

describe("getUserFriendlyMessage", () => {
    it("maps auth codes", () => {
        expect(getUserFriendlyMessage({ error: { code: "TOKEN_EXPIRED" } })).toBe(
            "Please sign in to continue",
        );
    });

    it("maps permission codes", () => {
        expect(getUserFriendlyMessage({ error: { code: "PERMISSION_DENIED" } })).toBe(
            "You do not have permission to perform this action",
        );
    });

    it("maps rate limiting", () => {
        expect(getUserFriendlyMessage({ error: { code: "RATE_LIMITED" } })).toBe(
            "Too many requests. Please try again later",
        );
    });

    it("falls back to the server message when the code is unknown", () => {
        expect(getUserFriendlyMessage({ error: { code: "WHATEVER", message: "Custom" } })).toBe("Custom");
    });
});
