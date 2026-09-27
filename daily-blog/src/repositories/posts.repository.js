import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = `
  id, slug, title, summary, content_md, status, author,
  created_at, updated_at, published_at
`;

/**
 * 文章仓储层：只负责 SQL 与数据映射，不含业务规则。
 * status 取值由服务层校验后再传入，因此这里可以安全地拼接 SQL 片段。
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
          `SELECT ${COLUMNS}
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
        .prepare(`SELECT ${COLUMNS} FROM posts WHERE slug = ? AND status = 'published'`)
        .get(slug),
    );
  },

  // ---------- 以下为 Day 2 后台管理新增：草稿可见，因此查询不再过滤 status ----------

  /** 后台列表：status 为 null 时返回全部（含草稿）。 */
  countForAdmin({ status = null } = {}) {
    return safeRun("countForAdmin", () => {
      if (status) {
        return getDb()
          .prepare("SELECT COUNT(*) AS total FROM posts WHERE status = ?")
          .get(status).total;
      }
      return getDb().prepare("SELECT COUNT(*) AS total FROM posts").get().total;
    });
  },

  /** 各状态计数，用于后台概览。 */
  countByStatus() {
    return safeRun("countByStatus", () => {
      const rows = getDb()
        .prepare("SELECT status, COUNT(*) AS total FROM posts GROUP BY status")
        .all();
      const counts = { draft: 0, published: 0, total: 0 };
      for (const row of rows) {
        if (row.status in counts) {
          counts[row.status] = row.total;
        }
        counts.total += row.total;
      }
      return counts;
    });
  },

  findAdminPage({ limit, offset, status = null }) {
    return safeRun("findAdminPage", () =>
      getDb()
        .prepare(
          `SELECT ${COLUMNS}
           FROM posts
           WHERE (@status IS NULL OR status = @status)
           ORDER BY updated_at DESC, id DESC
           LIMIT @limit OFFSET @offset`,
        )
        .all({ limit, offset, status: status ?? null }),
    );
  },

  findById(id) {
    return safeRun("findById", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM posts WHERE id = ?`).get(id),
    );
  },

  /** 判断 slug 是否被占用；excludeId 用于编辑时排除自己。 */
  slugExists(slug, excludeId = null) {
    return safeRun("slugExists", () => {
      if (excludeId === null || excludeId === undefined) {
        return Boolean(getDb().prepare("SELECT 1 AS ok FROM posts WHERE slug = ?").get(slug));
      }
      return Boolean(
        getDb()
          .prepare("SELECT 1 AS ok FROM posts WHERE slug = ? AND id <> ?")
          .get(slug, excludeId),
      );
    });
  },

  insert({ slug, title, summary, contentMd, status, author }) {
    return safeRun("insert", () => {
      const result = getDb()
        .prepare(
          `INSERT INTO posts (slug, title, summary, content_md, status, author, published_at)
           VALUES (@slug, @title, @summary, @contentMd, @status, @author,
                   CASE WHEN @status = 'published' THEN datetime('now') ELSE NULL END)`,
        )
        .run({ slug, title, summary, contentMd, status, author });
      return result.lastInsertRowid;
    });
  },

  updateById(id, { slug, title, summary, contentMd, author }) {
    return safeRun("updateById", () =>
      getDb()
        .prepare(
          `UPDATE posts
           SET slug = @slug,
               title = @title,
               summary = @summary,
               content_md = @contentMd,
               author = @author,
               updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({ id, slug, title, summary, contentMd, author }).changes,
    );
  },

  /**
   * 切换草稿/发布状态。
   * 首次发布时写入 published_at；重新发布不覆盖已有时间，保证列表排序稳定。
   * 转回草稿时保留 published_at，作为该文章的首次发布时间。
   */
  updateStatus(id, status) {
    return safeRun("updateStatus", () => {
      if (status === "published") {
        return getDb()
          .prepare(
            `UPDATE posts
             SET status = 'published',
                 published_at = COALESCE(published_at, datetime('now')),
                 updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(id).changes;
      }
      return getDb()
        .prepare(
          `UPDATE posts
           SET status = 'draft',
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(id).changes;
    });
  },

  deleteById(id) {
    return safeRun("deleteById", () =>
      getDb().prepare("DELETE FROM posts WHERE id = ?").run(id).changes,
    );
  },
};
