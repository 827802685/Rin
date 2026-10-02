import { getDb } from "../../src/db/index.js";

/**
 * 归档用例的固定数据（只写入测试库）。
 *
 * 示例文章都发布于「今天附近」，无法验证跨年分组，
 * 因此这里显式构造 2024 / 2025 / 2026-01 三篇，外加一篇草稿：
 * - 三个年份用于验证「按年倒序分组」与年份页；
 * - 2026-01 与示例文章（2026-09/10）同年不同月，用于验证月份分组；
 * - 草稿用于验证归档与前台保持一致：草稿绝不出现在归档里。
 */
const ARCHIVE_FIXTURES = [
  {
    slug: "archive-fixture-2024",
    title: "2024 年写下的旧文章",
    publishedAt: "2024-03-05 09:00:00",
    status: "published",
  },
  {
    slug: "archive-fixture-2025",
    title: "2025 年写下的文章",
    publishedAt: "2025-12-20 09:00:00",
    status: "published",
  },
  {
    slug: "archive-fixture-2026-jan",
    title: "2026 年 1 月写下的文章",
    publishedAt: "2026-01-08 09:00:00",
    status: "published",
  },
  {
    slug: "archive-fixture-draft",
    title: "归档里不该出现的草稿",
    publishedAt: null,
    status: "draft",
  },
];

/** 写入归档固定数据（幂等，按 slug 去重）。 */
export function createArchiveFixtures() {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, status, author, published_at)
     VALUES (@slug, @title, '归档用例固定数据', '归档用例正文。', @status, 'admin', @publishedAt)
     ON CONFLICT(slug) DO NOTHING`,
  );

  const insertAll = db.transaction((posts) => {
    for (const post of posts) {
      insert.run(post);
    }
  });
  insertAll(ARCHIVE_FIXTURES);
}

export const ARCHIVE_DRAFT_TITLE = "归档里不该出现的草稿";
