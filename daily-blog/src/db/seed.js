import { getDb } from "./index.js";

/** 示例文章：仅在 posts 表为空时写入，供最小可运行版本直接查看效果。
 *  daysAgo 用于生成不同的发布时间，保证列表排序稳定可预期。 */
export const seedPosts = [
  {
    slug: "hello-daily-blog",
    title: "第一天：搭起能跑起来的最小博客",
    summary: "项目骨架、文章数据模型、列表页与详情页，一次交付即可访问。",
    daysAgo: 0,
    content_md: `## 今天做了什么

第一天只做一件事：**让博客能跑起来并且看得见**。

- 建立分层结构：路由 → 服务 → 仓储
- 用 SQLite 落库，迁移脚本可重复执行
- 首页文章列表 + 文章详情页
- 健康检查、结构化日志、统一错误页

## 接下来

后台管理与文章编辑会放在第二天，分类标签、搜索、评论依次排期。

> 每次迭代结束都保证：能启动、页面可访问、核心流程走得通。
`,
  },
  {
    slug: "why-daily-iteration",
    title: "为什么选择每日迭代",
    summary: "把大目标切成每天一个可交付的小目标，降低半成品风险。",
    daysAgo: 1,
    content_md: `## 小步快跑

一个完整的博客涉及认证、编辑器、搜索、评论、后台配置等大量模块。
一次性铺开很容易出现「每个模块都写了一半」的情况。

每日迭代的约束是：**每天结束时必须有一个能运行的版本**。

1. 当天目标清晰，范围可控
2. 当天验收：启动、访问、核心操作
3. 当天记录：新增内容、涉及文件、已知限制、下一步

## 累积演进

每天的功能都建立在昨天可运行的版本之上，
因此仓库里不会出现无法运行的分支。
`,
  },
  {
    slug: "engineering-baseline",
    title: "工程底线：配置、日志与错误处理",
    summary: "在写业务之前先把配置校验、结构化日志、类型化错误搭好。",
    daysAgo: 2,
    content_md: `## 配置集中管理

所有配置来自环境变量，启动时集中校验，缺项直接退出，避免带着错误配置运行。

## 结构化日志

每条日志是一行 JSON，带 requestId，便于按请求串联。

## 类型化错误

\`\`\`js
throw new NotFoundError("文章不存在");
\`\`\`

错误处理器统一把错误渲染成错误页或 JSON，客户端不会看到堆栈。
`,
  },
];

/** 示例分类：中文名称刻意搭配英文 slug，另一种风格（纯中文 slug）见 seedTags 的「迭代」。 */
export const seedCategories = [
  { slug: "daily-iteration", name: "每日迭代", description: "以「每天一个可交付小目标」推进的实践记录。" },
  { slug: "engineering", name: "工程实践", description: "配置、日志、错误处理等基础设施与工程习惯。" },
];

/** 示例标签：其中「迭代」故意用中文作为 slug，用于验证中文 slug 在 URL 里同样可用。 */
export const seedTags = [
  { slug: "迭代", name: "迭代" },
  { slug: "methodology", name: "方法论" },
  { slug: "engineering-practice", name: "工程实践" },
  { slug: "architecture", name: "架构设计" },
];

/** 示例文章 → 分类/标签的关联，按 slug 显式指定，避免中文名称带来的歧义。 */
const SEED_LINKS = [
  { postSlug: "hello-daily-blog", categorySlug: "daily-iteration", tagSlugs: ["迭代", "architecture"] },
  { postSlug: "why-daily-iteration", categorySlug: "daily-iteration", tagSlugs: ["迭代", "methodology"] },
  {
    postSlug: "engineering-baseline",
    categorySlug: "engineering",
    tagSlugs: ["engineering-practice", "architecture"],
  },
];

/**
 * 写入示例分类、标签并关联到示例文章。
 * 幂等且不覆盖人工改动：已存在的分类/标签不重建，已有分类的文章不会被重新指派。
 */
function seedTaxonomy(db) {
  const insertCategory = db.prepare(
    `INSERT INTO categories (slug, name, description)
     VALUES (@slug, @name, @description)
     ON CONFLICT(slug) DO NOTHING`,
  );
  const insertTag = db.prepare(
    `INSERT INTO tags (slug, name) VALUES (@slug, @name) ON CONFLICT(slug) DO NOTHING`,
  );
  const findCategory = db.prepare("SELECT id FROM categories WHERE slug = ?");
  const findTag = db.prepare("SELECT id FROM tags WHERE slug = ?");
  const findPost = db.prepare("SELECT id FROM posts WHERE slug = ?");
  const linkCategory = db.prepare(
    `INSERT INTO post_categories (post_id, category_id) VALUES (?, ?)
     ON CONFLICT(post_id) DO NOTHING`,
  );
  const linkTag = db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)");

  const run = db.transaction(() => {
    for (const category of seedCategories) {
      insertCategory.run(category);
    }
    for (const tag of seedTags) {
      insertTag.run(tag);
    }

    let linkedCategories = 0;
    let linkedTags = 0;
    for (const link of SEED_LINKS) {
      const post = findPost.get(link.postSlug);
      if (!post) {
        continue;
      }
      const category = findCategory.get(link.categorySlug);
      if (category && linkCategory.run(post.id, category.id).changes > 0) {
        linkedCategories += 1;
      }
      for (const tagSlug of link.tagSlugs) {
        const tag = findTag.get(tagSlug);
        if (tag && linkTag.run(post.id, tag.id).changes > 0) {
          linkedTags += 1;
        }
      }
    }

    return { linkedCategories, linkedTags };
  });

  return run();
}

export function seed(db = getDb()) {
  const insert = db.prepare(
    `INSERT INTO posts (slug, title, summary, content_md, status, author, published_at)
     VALUES (@slug, @title, @summary, @content_md, 'published', 'admin',
             datetime('now', @offset))
     ON CONFLICT(slug) DO NOTHING`,
  );

  const existing = db.prepare("SELECT COUNT(*) AS total FROM posts").get().total;
  let inserted = 0;

  if (existing === 0) {
    const insertAll = db.transaction((posts) => {
      for (const post of posts) {
        insert.run({ ...post, offset: `-${post.daysAgo} days` });
      }
    });
    insertAll(seedPosts);
    inserted = seedPosts.length;
  }

  // 分类与标签的示例数据独立于文章：即使文章早已存在，重复执行也只是补齐缺失的关联。
  const taxonomy = seedTaxonomy(db);

  return { inserted, skipped: existing, taxonomy };
}
