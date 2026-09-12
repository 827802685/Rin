export interface ReadingStats {
  /** Number of counted words/characters. */
  words: number;
  /** Estimated reading time in minutes, always at least 1. */
  minutes: number;
  /** True when the article is short enough that the estimate rounds to 1 minute. */
  short: boolean;
}

// eslint-disable-next-line no-misleading-character-class
const CJK_PATTERN = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
const LATIN_WORD_PATTERN = /[A-Za-z0-9]+(?:['’’-][A-Za-z0-9]+)*/g;

// Mixed CJK/Latin reading speed used by most blog engines.
const WORDS_PER_MINUTE = 350;

function stripCodeBlocks(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ");
}

/**
 * Counts CJK characters plus Latin words so a mixed-language article gets a
 * sensible estimate. Fenced code blocks are excluded because they are skimmed
 * rather than read linearly.
 */
export function estimateReading(content: string): ReadingStats {
  if (!content) {
    return { words: 0, minutes: 1, short: true };
  }

  const plain = stripCodeBlocks(content)
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  const cjkCount = plain.match(CJK_PATTERN)?.length ?? 0;
  const latinCount = plain.match(LATIN_WORD_PATTERN)?.length ?? 0;
  const words = cjkCount + latinCount;

  if (words === 0) {
    return { words: 0, minutes: 1, short: true };
  }

  const minutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { words, minutes, short: minutes <= 1 };
}
