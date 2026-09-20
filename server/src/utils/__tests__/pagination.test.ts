import { describe, expect, it } from "bun:test";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePagination, toPage } from "../pagination";

describe("parsePagination", () => {
    it("defaults to the first page of the default size", () => {
        expect(parsePagination(undefined, undefined)).toEqual({ page: 0, limit: DEFAULT_PAGE_SIZE });
    });

    it("turns a one-based page into a zero-based offset", () => {
        expect(parsePagination("3", "10")).toEqual({ page: 2, limit: 10 });
    });

    it.each([
        ["0", 0],
        ["-5", 0],
        ["abc", 0],
        ["", 0],
        ["1.5", 0],
    ])("falls back to the first page for page=%s", (page, expected) => {
        expect(parsePagination(page, "10").page).toBe(expected);
    });

    it.each([
        ["100", MAX_PAGE_SIZE],
        ["51", MAX_PAGE_SIZE],
    ])("clamps limit=%s to the maximum page size", (limit, expected) => {
        expect(parsePagination("1", limit).limit).toBe(expected);
    });

    it.each([
        ["0", DEFAULT_PAGE_SIZE],
        ["-5", DEFAULT_PAGE_SIZE],
        ["abc", DEFAULT_PAGE_SIZE],
        ["", DEFAULT_PAGE_SIZE],
        ["20px", DEFAULT_PAGE_SIZE],
    ])("falls back to the default page size for limit=%s", (limit, expected) => {
        // A non-positive or non-numeric limit used to reach SQL as `LIMIT 0`
        // or `LIMIT NaN`, which is how the two paginated endpoints drifted
        // apart: one answered an empty page with `hasNext: true`.
        expect(parsePagination("1", limit).limit).toBe(expected);
    });

    it("accepts a limit of exactly one", () => {
        expect(parsePagination("1", "1").limit).toBe(1);
    });
});

describe("toPage", () => {
    it("keeps a short result set as-is", () => {
        expect(toPage([1, 2, 3], 20)).toEqual({ data: [1, 2, 3], hasNext: false });
    });

    it("drops the extra row fetched to detect a next page", () => {
        expect(toPage([1, 2, 3, 4], 3)).toEqual({ data: [1, 2, 3], hasNext: true });
    });

    it("reports no next page when the result set matches the limit exactly", () => {
        expect(toPage([1, 2, 3], 3)).toEqual({ data: [1, 2, 3], hasNext: false });
    });

    it("returns an empty page for an empty result set", () => {
        expect(toPage([], 20)).toEqual({ data: [], hasNext: false });
    });
});
