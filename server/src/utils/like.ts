const LIKE_ESCAPE_CHAR = "\\";

/**
 * Escapes LIKE wildcards so a user supplied keyword is matched literally.
 *
 * Without this, searching for `100%` would match everything (`%` is "any
 * sequence") and `_` would match any single character, which lets a crafted
 * query pull in articles that do not contain the keyword at all.
 */
export function escapeLikePattern(input: string): string {
    return input.replace(/[\\%_]/g, (match) => `${LIKE_ESCAPE_CHAR}${match}`);
}

/** Builds a "contains" LIKE pattern that treats the keyword as literal text. */
export function containsLikePattern(keyword: string): string {
    return `%${escapeLikePattern(keyword)}%`;
}

export { LIKE_ESCAPE_CHAR };
