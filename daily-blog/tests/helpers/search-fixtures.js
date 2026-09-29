import { getDb } from "../../src/db/index.js";

/**
 * 搜索用例的固定数据（只写入测试库）。
 *
 * 覆盖这几类场景，避免用例依赖示例文章的措辞：
 * - 关键词分别落在标题 / 摘要 / 正文，用于验证相关度排序；
 * - 一篇草稿，用于验证草稿绝不出现在搜索结果里；
 * - 标题里含 `<script>`，用于验证结果渲染做了 HTML 转义；
 * - 标题含 `%`，用于验证 LIKE 通配符被按字面量处理；
 * - 一篇可动态上下架的文章，用于验证「转草稿后立即搜不到」。
 */
const SEARCH_FIXTURES = [
  {
    slug: "search-fixture-title",
    title: "分页测试：标题命中",
    summary: "这篇的关键词写在标题里。",
    contentMd: "正文里带 独占词乙，用于验证多关键词之间是「且」的关系。",
    status: "published",
    publishedAt: "2026-09-20 10:00:00",
  },
  {
    slug: "search-fixture-summary",
    title: "摘要才有词",
    summary: "这条的分页测试写在摘要里。",
    contentMd: "这段正文只有普通内容。",
    status: "published",
    publishedAt: "2026-09-21 10:00:00",
  },
  {
    slug: "search-fixture-body",
    title: "只在正文里",
    summary: "摘要也不含目标词。",
    contentMd: "真正的分页测试出现在正文里。",
    status: "published",
    publishedAt: "2026-09-22 10:00:00",
  },
  {
    slug: "search-fixture-draft",
    title: "分页测试：草稿不该出现",
    summary: "草稿内容。",
    contentMd: "分页测试 正文。",
    status: "draft",
    publishedAt: null,
  },
  {
    slug: "search-fixture-escaped",
    title: "安全演示 <script>alert(1)</script>",
    summary: "标题里带尖括号。",
    contentMd: "这里讲脚本注入的防护与转义。",
    status: "published",
    publishedAt: "2026-09-23 10:00:00",
  },
  {
    slug: "search-fixture-percent",
    title: "进度 100% 完成",
    summary: "含百分号的标题。",
    contentMd: "进度条走到 100% 之后结束。",
    status: "published",
    publishedAt: "2026-09-24 10:00:00",
  },
  {
    slug: "search-fixture-retract",
    title: "临时下架测试",
    summary: "用来验证草稿与发布的切换。",
    contentMd: "临时下架测试的正文。",
    status: "published",
    publishedAt: "2026-09-25 10:00:00",
  },
];

/** 写入固定数据，并给「标题命中」这篇挂上分类与标签，用于筛选组合的用例。 */
export function createSearchFixtures() {
  const db = getDb();

  const insertPost = db.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, status, author, published_at)
     VALUES (@slug, @title, @summary, @contentMd, @status, 'admin', @publishedAt)
     ON CONFLICT(slug) DO NOTHING`,
  );

  const insertAll = db.transaction(() => {
    for (const fixture of SEARCH_FIXTURES) {
      insertPost.run(fixture);
    }
  });
  insertAll();

  const post = db.prepare("SELECT id FROM posts WHERE slug = ?").get("search-fixture-title");
  const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get("daily-iteration");
  const tag = db.prepare("SELECT id FROM tags WHERE slug = ?").get("architecture");

  if (post && category) {
    db.prepare(
      "INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)",
    ).run(post.id, category.id);
  }
  if (post && tag) {
    db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)").run(
      post.id,
      tag.id,
    );
  }
}

/** 切换固定数据的发布状态，用于验证草稿与搜索结果的联动。 */
export function setFixtureStatus(slug, status) {
  getDb().prepare("UPDATE posts SET status = ? WHERE slug = ?").run(status, slug);
}
