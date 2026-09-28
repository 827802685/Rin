import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = "id, slug, name, created_at, updated_at";

/** 标签仓储层：只写 SQL。计数口径与分类一致（前台已发布 / 后台全部）。 */
export const tagsRepository = {
  listWithCounts({ status = null } = {}) {
    return safeRun("tags.listWithCounts", () =>
      getDb()
        .prepare(
          `SELECT t.id, t.slug, t.name, t.created_at, t.updated_at,
                  COUNT(p.id) AS post_count
           FROM tags t
           LEFT JOIN post_tags pt ON pt.tag_id = t.id
           LEFT JOIN posts p ON p.id = pt.post_id AND (@status IS NULL OR p.status = @status)
           GROUP BY t.id
           ORDER BY t.name COLLATE NOCASE ASC, t.id ASC`,
        )
        .all({ status: status ?? null }),
    );
  },

  findById(id) {
    return safeRun("tags.findById", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM tags WHERE id = ?`).get(id),
    );
  },

  findBySlug(slug) {
    return safeRun("tags.findBySlug", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM tags WHERE slug = ?`).get(slug),
    );
  },

  findByName(name) {
    return safeRun("tags.findByName", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM tags WHERE name = ?`).get(name),
    );
  },

  slugExists(slug, excludeId = null) {
    return safeRun("tags.slugExists", () => {
      if (excludeId === null || excludeId === undefined) {
        return Boolean(getDb().prepare("SELECT 1 AS ok FROM tags WHERE slug = ?").get(slug));
      }
      return Boolean(
        getDb().prepare("SELECT 1 AS ok FROM tags WHERE slug = ? AND id <> ?").get(slug, excludeId),
      );
    });
  },

  countPosts(id) {
    return safeRun("tags.countPosts", () =>
      getDb().prepare("SELECT COUNT(*) AS total FROM post_tags WHERE tag_id = ?").get(id).total,
    );
  },

  insert({ slug, name }) {
    return safeRun("tags.insert", () =>
      getDb()
        .prepare("INSERT INTO tags (slug, name) VALUES (@slug, @name)")
        .run({ slug, name }).lastInsertRowid,
    );
  },

  updateById(id, { slug, name }) {
    return safeRun("tags.updateById", () =>
      getDb()
        .prepare(
          "UPDATE tags SET slug = @slug, name = @name, updated_at = datetime('now') WHERE id = @id",
        )
        .run({ id, slug, name }).changes,
    );
  },

  deleteById(id) {
    return safeRun("tags.deleteById", () =>
      getDb().prepare("DELETE FROM tags WHERE id = ?").run(id).changes,
    );
  },
};
