import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = "id, slug, name, description, created_at, updated_at";

/**
 * 分类仓储层：只写 SQL。
 * 计数区分两种口径：前台只统计已发布文章，后台统计全部（含草稿）。
 */
export const categoriesRepository = {
  /** 按名称排序返回全部分类；status 为 'published' 时只统计已发布文章数。 */
  listWithCounts({ status = null } = {}) {
    return safeRun("categories.listWithCounts", () =>
      getDb()
        .prepare(
          `SELECT c.id, c.slug, c.name, c.description, c.created_at, c.updated_at,
                  COUNT(p.id) AS post_count
           FROM categories c
           LEFT JOIN post_categories pc ON pc.category_id = c.id
           LEFT JOIN posts p ON p.id = pc.post_id AND (@status IS NULL OR p.status = @status)
           GROUP BY c.id
           ORDER BY c.name COLLATE NOCASE ASC, c.id ASC`,
        )
        .all({ status: status ?? null }),
    );
  },

  findById(id) {
    return safeRun("categories.findById", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM categories WHERE id = ?`).get(id),
    );
  },

  findBySlug(slug) {
    return safeRun("categories.findBySlug", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM categories WHERE slug = ?`).get(slug),
    );
  },

  findByName(name) {
    return safeRun("categories.findByName", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM categories WHERE name = ?`).get(name),
    );
  },

  slugExists(slug, excludeId = null) {
    return safeRun("categories.slugExists", () => {
      if (excludeId === null || excludeId === undefined) {
        return Boolean(getDb().prepare("SELECT 1 AS ok FROM categories WHERE slug = ?").get(slug));
      }
      return Boolean(
        getDb()
          .prepare("SELECT 1 AS ok FROM categories WHERE slug = ? AND id <> ?")
          .get(slug, excludeId),
      );
    });
  },

  /** 该分类下的文章数（含草稿），用于删除前的占用检查。 */
  countPosts(id) {
    return safeRun("categories.countPosts", () =>
      getDb()
        .prepare("SELECT COUNT(*) AS total FROM post_categories WHERE category_id = ?")
        .get(id).total,
    );
  },

  insert({ slug, name, description }) {
    return safeRun("categories.insert", () =>
      getDb()
        .prepare(
          "INSERT INTO categories (slug, name, description) VALUES (@slug, @name, @description)",
        )
        .run({ slug, name, description }).lastInsertRowid,
    );
  },

  updateById(id, { slug, name, description }) {
    return safeRun("categories.updateById", () =>
      getDb()
        .prepare(
          `UPDATE categories
           SET slug = @slug, name = @name, description = @description, updated_at = datetime('now')
           WHERE id = @id`,
        )
        .run({ id, slug, name, description }).changes,
    );
  },

  deleteById(id) {
    return safeRun("categories.deleteById", () =>
      getDb().prepare("DELETE FROM categories WHERE id = ?").run(id).changes,
    );
  },
};
