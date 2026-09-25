import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const PUBLISHED_COLUMNS = `
  id, slug, title, summary, content_md, status, author,
  created_at, updated_at, published_at
`;

/**
 * 文章仓储层：只负责 SQL 与数据映射，不含业务规则。
 */
export const postsRepository = {
  countPublished() {
    return safeRun("countPublished", () =>
      getDb().prepare("SELECT COUNT(*) AS total FROM posts WHERE status = 'published'").get().total,
    );
  },

  findPublishedPage({ limit, offset }) {
    return safeRun("findPublishedPage", () =>
      getDb()
        .prepare(
          `SELECT ${PUBLISHED_COLUMNS}
           FROM posts
           WHERE status = 'published'
           ORDER BY COALESCE(published_at, created_at) DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(limit, offset),
    );
  },

  findPublishedBySlug(slug) {
    return safeRun("findPublishedBySlug", () =>
      getDb()
        .prepare(`SELECT ${PUBLISHED_COLUMNS} FROM posts WHERE slug = ? AND status = 'published'`)
        .get(slug),
    );
  },
};
