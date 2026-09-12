import { describe, expect, it } from "bun:test";
import { containsLikePattern, escapeLikePattern } from "../like";

describe("escapeLikePattern", () => {
    it("escapes percent so it is matched literally", () => {
        expect(escapeLikePattern("100%")).toBe("100\\%");
    });

    it("escapes underscore so it is matched literally", () => {
        expect(escapeLikePattern("a_b")).toBe("a\\_b");
    });

    it("escapes the escape character itself", () => {
        expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    });

    it("leaves ordinary text untouched", () => {
        expect(escapeLikePattern("hello world")).toBe("hello world");
    });

    it("handles a keyword made only of wildcards", () => {
        expect(escapeLikePattern("%_%")).toBe("\\%\\_\\%");
    });
});

describe("containsLikePattern", () => {
    it("wraps the escaped keyword in wildcards", () => {
        expect(containsLikePattern("50% off")).toBe("%50\\% off%");
    });
});
