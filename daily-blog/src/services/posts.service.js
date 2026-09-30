import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { postsRepository } from "../repositories/posts.repository.js";
import { commentsRepository } from "../repositories/comments.repository.js";
import { taxonomyService } from "./taxonomy.service.js";
import { withTransaction } from "../db/transaction.js";
import { slugifyText, timestampSlug } from "../lib/slug.js";
import { NotFoundError, ValidationError, ConflictError } from "../errors.js";

export const POST_STATUSES = Object.freeze(["draft", "published"]);
export const POST_STATUS_LABELS = Object.freeze({ draft: "草稿", published: "已发布" });

/** Markdown 渲染（渲染后做 HTML 白名单清洗，防止脚本注入）。 */
export function renderMarkdown(markdown) {
  const raw = marked.parse(markdown ?? "", { async: false, gfm: true, breaks: false });
  return sanitizeHtml(raw, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr", "blockquote", "pre", "code",
      "ul", "ol", "li", "strong", "em", "del", "a", "img", "table",
      "thead", "tbody", "tr", "th", "td", "span",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "title"],
      code: ["class"],
      span: ["class"],
      th: ["align"],
      td: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
      }),
    },
  });
}

/** 把 Markdown 压成纯文本：去掉代码块、图片、链接语法与标记符号。 */
export function markdownToPlainText(markdown) {
  return (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 纯文本摘要：去掉 Markdown 标记后截断。 */
export function buildExcerpt(markdown, maxLength = 120) {
  const text = markdownToPlainText(markdown);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

/** 阅读时长估算（中文按 300 字/分钟）。 */
export function estimateReadingMinutes(markdown) {
  const chars = (markdown ?? "").replace(/\s+/g, "").length;
  return Math.max(1, Math.round(chars / 300));
}

/** 由标题生成 URL 友好的 slug；非 ASCII 标题（如纯中文）会得到空串，交由调用方兜底。 */
export function slugifyTitle(title, maxLength = 80) {
  return slugifyText(title, maxLength);
}

function decorate(
  row,
  {
    withContent = false,
    withContentText = false,
    category = null,
    tags = [],
    commentCount = 0,
  } = {},
) {
  const html = renderMarkdown(row.content_md);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || buildExcerpt(row.content_md),
    status: row.status,
    statusLabel: POST_STATUS_LABELS[row.status] ?? row.status,
    isDraft: row.status === "draft",
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? row.created_at,
    readingMinutes: estimateReadingMinutes(row.content_md),
    category,
    tags,
    // 只统计已通过审核的评论，待审与已拒绝对前台不可见。
    commentCount,
    contentHtml: withContent ? html : undefined,
    contentMd: withContent ? row.content_md : undefined,
    // 搜索结果需要在正文片段里定位关键词，但不值得为此渲染整篇 HTML
    contentText: withContentText ? markdownToPlainText(row.content_md) : undefined,
    // 后台编辑页需要「原样」的摘要，避免把自动生成的摘要回填进表单后再存库
    summaryRaw: withContent ? row.summary : undefined,
  };
}

/** 批量补齐列表页文章的分类与标签，避免每条文章单独查询（N+1）。 */
function attachTaxonomyRows(rows) {
  const ids = rows.map((row) => row.id);
  const categoryByPost = new Map();
  for (const row of postsRepository.findCategoriesByPostIds(ids)) {
    categoryByPost.set(row.post_id, { id: row.category_id, slug: row.slug, name: row.name });
  }

  const tagsByPost = new Map();
  for (const row of postsRepository.findTagsByPostIds(ids)) {
    if (!tagsByPost.has(row.post_id)) {
      tagsByPost.set(row.post_id, []);
    }
    tagsByPost.get(row.post_id).push({ id: row.tag_id, slug: row.slug, name: row.name });
  }

  return { categoryByPost, tagsByPost };
}

/** 批量补齐列表页文章的已通过评论数，避免逐篇查询（N+1）。 */
function attachCommentCounts(rows) {
  const counts = new Map();
  for (const row of commentsRepository.countApprovedByPostIds(rows.map((row) => row.id))) {
    counts.set(row.post_id, row.total);
  }
  return counts;
}

/** 单篇文章的分类与标签。 */
function loadTaxonomy(postId) {
  const [categoryRow] = postsRepository.findCategoriesByPostIds([postId]);
  return {
    category: categoryRow
      ? { id: categoryRow.category_id, slug: categoryRow.slug, name: categoryRow.name }
      : null,
    tags: postsRepository
      .findTagsByPostIds([postId])
      .map((row) => ({ id: row.tag_id, slug: row.slug, name: row.name })),
  };
}

/**
 * 前台列表页通用分页：首页、分类页、标签页、搜索页共用同一套页码归一化与计数逻辑，
 * 保证各处行为完全一致（超范围页码回落到最后一页、每页条数上下限一致）。
 */
export function paginatePublished(page, pageSize, { count, fetchPage, decorateOptions = {} }) {
  const safePageSize = Math.min(Math.max(Number.parseInt(pageSize, 10) || 10, 1), 50);
  const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
  const total = count();
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const currentPage = Math.min(safePage, totalPages);
  const rows = fetchPage({ limit: safePageSize, offset: (currentPage - 1) * safePageSize });
  const { categoryByPost, tagsByPost } = attachTaxonomyRows(rows);
  const commentCounts = attachCommentCounts(rows);

  return {
    items: rows.map((row) =>
      decorate(row, {
        ...decorateOptions,
        category: categoryByPost.get(row.id) ?? null,
        tags: tagsByPost.get(row.id) ?? [],
        commentCount: commentCounts.get(row.id) ?? 0,
      }),
    ),
    pagination: {
      page: currentPage,
      pageSize: safePageSize,
      total,
      totalPages,
      hasPrev: currentPage > 1,
      hasNext: currentPage < totalPages,
    },
  };
}

function normalizeId(id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new NotFoundError("文章不存在");
  }
  return parsed;
}

function normalizeStatus(status) {
  if (!POST_STATUSES.includes(status)) {
    throw new ValidationError(`文章状态只能是 ${POST_STATUSES.join(" / ")}，当前值：${status}`);
  }
  return status;
}

/**
 * 确定最终 slug：
 * - 用户显式填写：被占用直接 409，不做隐式改名（避免写出与预期不符的链接）；
 * - 留空自动生成：中文标题退化为 post-日期-随机串，冲突时追加序号。
 */
function resolveSlug({ slug, title, excludeId = null }) {
  const provided = String(slug ?? "").trim();
  if (provided) {
    if (postsRepository.slugExists(provided, excludeId)) {
      throw new ConflictError(`slug 已被其他文章占用：${provided}`);
    }
    return provided;
  }

  // 中文标题（如「第 2 天」）会被 slugify 削成 "2" 这类无意义片段，
  // 因此要求自动 slug 至少含一个字母，否则退化为时间戳 slug。
  const candidate = slugifyTitle(title);
  const base = /[a-z]/.test(candidate) ? candidate : timestampSlug();
  let resolved = base;
  let attempt = 1;
  while (postsRepository.slugExists(resolved, excludeId)) {
    attempt += 1;
    if (attempt > 50) {
      throw new ConflictError("自动生成 slug 连续冲突，请手动填写 slug");
    }
    resolved = `${base}-${attempt}`;
  }
  return resolved;
}

function normalizeInput(input = {}) {
  const title = String(input.title ?? "").trim();
  if (!title) {
    throw new ValidationError("标题不能为空");
  }
  const contentMd = String(input.content ?? input.contentMd ?? "");
  if (!contentMd.trim()) {
    throw new ValidationError("正文不能为空");
  }
  return {
    title,
    contentMd,
    summary: String(input.summary ?? "").trim(),
    author: String(input.author ?? "").trim() || "admin",
    status: normalizeStatus(input.status ?? "draft"),
    slug: String(input.slug ?? "").trim(),
    // 分类由服务层校验存在性；标签在这里只做拆分与去重（会顺带创建不存在的标签）。
    categoryId: input.categoryId === "" || input.categoryId === undefined ? null : input.categoryId,
    tagNames: taxonomyService.parseTagInput(input.tags ?? ""),
  };
}

/**
 * 文章服务层：承载分页、详情查询、后台管理与草稿发布等业务规则，
 * 不依赖 HTTP 请求/响应对象。
 */
export const postsService = {
  listPublished({ page = 1, pageSize = 10 } = {}) {
    return paginatePublished(page, pageSize, {
      count: () => postsRepository.countPublished(),
      fetchPage: ({ limit, offset }) => postsRepository.findPublishedPage({ limit, offset }),
    });
  },

  getPublishedBySlug(slug) {
    if (!slug || typeof slug !== "string") {
      throw new NotFoundError("文章不存在");
    }
    const row = postsRepository.findPublishedBySlug(slug);
    if (!row) {
      throw new NotFoundError(`文章不存在：${slug}`);
    }
    const { category, tags } = loadTaxonomy(row.id);
    return decorate(row, {
      withContent: true,
      category,
      tags,
      commentCount: commentsRepository.countApprovedByPostId(row.id),
    });
  },

  // ---------- Day 3：按分类 / 标签浏览 ----------

  /** 分类页：该分类下的已发布文章，支持分页。分类不存在时 404。 */
  listByCategorySlug(slug, { page = 1, pageSize = 10 } = {}) {
    const category = taxonomyService.getCategoryBySlug(slug);
    return {
      category,
      ...paginatePublished(page, pageSize, {
        count: () => postsRepository.countPublishedByCategorySlug(category.slug),
        fetchPage: ({ limit, offset }) =>
          postsRepository.findPublishedPageByCategorySlug({ slug: category.slug, limit, offset }),
      }),
    };
  },

  /** 标签页：该标签下的已发布文章，支持分页。标签不存在时 404。 */
  listByTagSlug(slug, { page = 1, pageSize = 10 } = {}) {
    const tag = taxonomyService.getTagBySlug(slug);
    return {
      tag,
      ...paginatePublished(page, pageSize, {
        count: () => postsRepository.countPublishedByTagSlug(tag.slug),
        fetchPage: ({ limit, offset }) =>
          postsRepository.findPublishedPageByTagSlug({ slug: tag.slug, limit, offset }),
      }),
    };
  },

  // ---------- Day 2：后台管理 ----------

  countByStatus() {
    return postsRepository.countByStatus();
  },

  /** 后台列表：草稿与已发布都在内，支持按状态筛选与分页。 */
  listForAdmin({ page = 1, pageSize = 20, status = null } = {}) {
    const safePageSize = Math.min(Math.max(Number.parseInt(pageSize, 10) || 20, 1), 100);
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const filter = status ? normalizeStatus(status) : null;

    const total = postsRepository.countForAdmin({ status: filter });
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const currentPage = Math.min(safePage, totalPages);
    const rows = postsRepository.findAdminPage({
      limit: safePageSize,
      offset: (currentPage - 1) * safePageSize,
      status: filter,
    });
    const { categoryByPost, tagsByPost } = attachTaxonomyRows(rows);

    return {
      counts: postsRepository.countByStatus(),
      statusFilter: filter,
      items: rows.map((row) =>
        decorate(row, {
          category: categoryByPost.get(row.id) ?? null,
          tags: tagsByPost.get(row.id) ?? [],
        }),
      ),
      pagination: {
        page: currentPage,
        pageSize: safePageSize,
        total,
        totalPages,
        hasPrev: currentPage > 1,
        hasNext: currentPage < totalPages,
      },
    };
  },

  /** 按 id 取文章（含草稿），供后台编辑页使用。 */
  getById(id) {
    const row = postsRepository.findById(normalizeId(id));
    if (!row) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }
    const { category, tags } = loadTaxonomy(row.id);
    return decorate(row, { withContent: true, category, tags });
  },

  createPost(input) {
    const data = normalizeInput(input);
    const slug = resolveSlug({ slug: data.slug, title: data.title });
    // 文章主体与分类/标签一起写，任一失败则整体回滚，不留下半成品。
    return withTransaction(() => {
      const id = postsRepository.insert({
        slug,
        title: data.title,
        summary: data.summary,
        contentMd: data.contentMd,
        status: data.status,
        author: data.author,
      });
      taxonomyService.savePostTaxonomy(id, {
        categoryId: data.categoryId,
        tagNames: data.tagNames,
      });
      return this.getById(id);
    });
  },

  updatePost(id, input) {
    const postId = normalizeId(id);
    const existing = postsRepository.findById(postId);
    if (!existing) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }

    const data = normalizeInput(input);
    const slug = resolveSlug({ slug: data.slug, title: data.title, excludeId: postId });

    return withTransaction(() => {
      postsRepository.updateById(postId, {
        slug,
        title: data.title,
        summary: data.summary,
        contentMd: data.contentMd,
        author: data.author,
      });
      taxonomyService.savePostTaxonomy(postId, {
        categoryId: data.categoryId,
        tagNames: data.tagNames,
      });
      return this.getById(postId);
    });
  },

  /**
   * 切换草稿/发布状态：状态未变化时直接返回，避免无意义地刷新 updated_at。
   */
  setStatus(id, status) {
    const postId = normalizeId(id);
    const nextStatus = normalizeStatus(status);
    const existing = postsRepository.findById(postId);
    if (!existing) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }
    if (existing.status !== nextStatus) {
      postsRepository.updateStatus(postId, nextStatus);
    }
    return this.getById(postId);
  },

  removePost(id) {
    const postId = normalizeId(id);
    const changes = postsRepository.deleteById(postId);
    if (changes === 0) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }
    return { id: postId, deleted: changes };
  },

  /** 编辑页实时预览：复用详情页同一套渲染与清洗逻辑，保证预览即所得。 */
  previewHtml(markdown) {
    return renderMarkdown(markdown ?? "");
  },
};
