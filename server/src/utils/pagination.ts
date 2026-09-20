export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

export interface Pagination {
    /** Zero-based page index: multiply by `limit` to get the SQL offset. */
    page: number;
    limit: number;
}

/**
 * Parse the `page` / `limit` query parameters the way every paginated endpoint
 * should: anything that is not a positive integer falls back to the default
 * instead of silently becoming `0`, a negative number or `NaN`.
 *
 * Without this, `?limit=-5` made the feed list return every row while search
 * returned a truncated slice, and `?limit=0` made both claim `hasNext: true`
 * next to an empty page.
 */
export function parsePagination(page?: string | null, limit?: string | null): Pagination {
    return {
        page: parsePositiveInt(page, 1) - 1,
        limit: clamp(parsePositiveInt(limit, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE),
    };
}

function parsePositiveInt(value: string | null | undefined, fallback: number): number {
    if (value === null || value === undefined || value.trim() === "") {
        return fallback;
    }

    // `Number` rejects trailing garbage ("20px"), which `parseInt` would accept.
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export interface Page<T> {
    data: T[];
    hasNext: boolean;
}

/**
 * Turn a `limit + 1` sized result set into a page.
 *
 * The extra row is only a "there is more" marker, so it is dropped from the
 * payload. Endpoints must share this helper, otherwise they drift apart on
 * edge cases such as an empty result set.
 */
export function toPage<T>(rows: T[], limit: number): Page<T> {
    if (rows.length > limit) {
        return { data: rows.slice(0, limit), hasNext: true };
    }

    return { data: rows, hasNext: false };
}
