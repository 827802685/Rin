import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { postsRepository } from "../repositories/posts.repository.js";
import { NotFoundError } from "../errors.js";

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

/** 纯文本摘要：去掉 Markdown 标记后截断。 */
export function buildExcerpt(markdown, maxLength = 120) {
  const text = (markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function decorate(row, { withContent = false } = {}) {
  const html = renderMarkdown(row.content_md);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || buildExcerpt(row.content_md),
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? row.created_at,
    readingMinutes: estimateReadingMinutes(row.content_md),
    contentHtml: withContent ? html : undefined,
  };
}

/**
 * 文章服务层：承载分页、详情查询等业务规则，不依赖 HTTP 请求/响应对象。
 */
export const postsService = {
  listPublished({ page = 1, pageSize = 10 } = {}) {
    const safePageSize = Math.min(Math.max(Number.parseInt(pageSize, 10) || 10, 1), 50);
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const total = postsRepository.countPublished();
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const currentPage = Math.min(safePage, totalPages);
    const rows = postsRepository.findPublishedPage({
      limit: safePageSize,
      offset: (currentPage - 1) * safePageSize,
    });

    return {
      items: rows.map((row) => decorate(row)),
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

  getPublishedBySlug(slug) {
    if (!slug || typeof slug !== "string") {
      throw new NotFoundError("文章不存在");
    }
    const row = postsRepository.findPublishedBySlug(slug);
    if (!row) {
      throw new NotFoundError(`文章不存在：${slug}`);
    }
    return decorate(row, { withContent: true });
  },
};
