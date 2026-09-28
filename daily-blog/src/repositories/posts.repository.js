import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = `
  id, slug, title, summary, content_md, status, author,
  created_at, updated_at, published_at
`;

/** 需要 JOIN 分类/标签时使用带表别名的列名。 */
const COLUMNS_ALIASED = `
  p.id, p.slug, p.title, p.summary, p.content_md, p.status, p.author,
  p.created_at, p.updated_at, p.published_at
`;

const PUBLISHED_ORDER = "ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC";

function placeholders(count) {
  return new Array(count).fill("?").join(", ");
}

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

  // ---------- Day 3：分类与标签 ----------

  /**
   * 按 slug 分页查询某个分类下的已发布文章。
   * 分类不存在时返回空列表，由服务层负责区分「分类不存在」与「分类下暂无文章」。
   */
  countPublishedByCategorySlug(slug) {
    return safeRun("countPublishedByCategorySlug", () =>
      getDb()
        .prepare(
          `SELECT COUNT(*) AS total
           FROM posts p
           JOIN post_categories pc ON pc.post_id = p.id
           JOIN categories c ON c.id = pc.category_id
           WHERE p.status = 'published' AND c.slug = ?`,
        )
        .get(slug).total,
    );
  },

  findPublishedPageByCategorySlug({ slug, limit, offset }) {
    return safeRun("findPublishedPageByCategorySlug", () =>
      getDb()
        .prepare(
          `SELECT ${COLUMNS_ALIASED}
           FROM posts p
           JOIN post_categories pc ON pc.post_id = p.id
           JOIN categories c ON c.id = pc.category_id
           WHERE p.status = 'published' AND c.slug = ?
           ${PUBLISHED_ORDER}
           LIMIT ? OFFSET ?`,
        )
        .all(slug, limit, offset),
    );
  },

  countPublishedByTagSlug(slug) {
    return safeRun("countPublishedByTagSlug", () =>
      getDb()
        .prepare(
          `SELECT COUNT(*) AS total
           FROM posts p
           JOIN post_tags pt ON pt.post_id = p.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE p.status = 'published' AND t.slug = ?`,
        )
        .get(slug).total,
    );
  },

  findPublishedPageByTagSlug({ slug, limit, offset }) {
    return safeRun("findPublishedPageByTagSlug", () =>
      getDb()
        .prepare(
          `SELECT ${COLUMNS_ALIASED}
           FROM posts p
           JOIN post_tags pt ON pt.post_id = p.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE p.status = 'published' AND t.slug = ?
           ${PUBLISHED_ORDER}
           LIMIT ? OFFSET ?`,
        )
        .all(slug, limit, offset),
    );
  },

  /** 批量取出这批文章的分类，避免列表页逐条查询（N+1）。 */
  findCategoriesByPostIds(ids) {
    if (ids.length === 0) {
      return [];
    }
    return safeRun("findCategoriesByPostIds", () =>
      getDb()
        .prepare(
          `SELECT pc.post_id, c.id AS category_id, c.slug, c.name
           FROM post_categories pc
           JOIN categories c ON c.id = pc.category_id
           WHERE pc.post_id IN (${placeholders(ids.length)})`,
        )
        .all(...ids),
    );
  },

  /** 批量取出这批文章的标签，避免列表页逐条查询（N+1）。 */
  findTagsByPostIds(ids) {
    if (ids.length === 0) {
      return [];
    }
    return safeRun("findTagsByPostIds", () =>
      getDb()
        .prepare(
          `SELECT pt.post_id, t.id AS tag_id, t.slug, t.name
           FROM post_tags pt
           JOIN tags t ON t.id = pt.tag_id
           WHERE pt.post_id IN (${placeholders(ids.length)})
           ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`,
        )
        .all(...ids),
    );
  },

  /** 设置文章分类；categoryId 为 null 表示清除分类。 */
  setCategory(postId, categoryId) {
    return safeRun("setCategory", () => {
      if (categoryId === null || categoryId === undefined) {
        return getDb().prepare("DELETE FROM post_categories WHERE post_id = ?").run(postId).changes;
      }
      return getDb()
        .prepare(
          `INSERT INTO post_categories (post_id, category_id)
           VALUES (@postId, @categoryId)
           ON CONFLICT(post_id) DO UPDATE SET category_id = excluded.category_id`,
        )
        .run({ postId, categoryId }).changes;
    });
  },

  findTagIdsByPostId(postId) {
    return safeRun("findTagIdsByPostId", () =>
      getDb()
        .prepare("SELECT tag_id FROM post_tags WHERE post_id = ? ORDER BY tag_id ASC")
        .all(postId)
        .map((row) => row.tag_id),
    );
  },

  /** 整体替换文章标签：先清空再写入，调用方负责包在事务里。 */
  clearTags(postId) {
    return safeRun("clearTags", () =>
      getDb().prepare("DELETE FROM post_tags WHERE post_id = ?").run(postId).changes,
    );
  },

  addTag(postId, tagId) {
    return safeRun("addTag", () =>
      getDb()
        .prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)")
        .run(postId, tagId).changes,
    );
  },
};
