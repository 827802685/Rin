import { randomBytes } from "node:crypto";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { postsRepository } from "../repositories/posts.repository.js";
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

/** 由标题生成 URL 友好的 slug；非 ASCII 标题（如纯中文）会得到空串，交由调用方兜底。 */
export function slugifyTitle(title, maxLength = 80) {
  return String(title ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

function timestampSlug() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `post-${stamp}-${randomBytes(3).toString("hex")}`;
}

function decorate(row, { withContent = false } = {}) {
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
    contentHtml: withContent ? html : undefined,
    contentMd: withContent ? row.content_md : undefined,
    // 后台编辑页需要「原样」的摘要，避免把自动生成的摘要回填进表单后再存库
    summaryRaw: withContent ? row.summary : undefined,
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
  };
}

/**
 * 文章服务层：承载分页、详情查询、后台管理与草稿发布等业务规则，
 * 不依赖 HTTP 请求/响应对象。
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

    return {
      counts: postsRepository.countByStatus(),
      statusFilter: filter,
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

  /** 按 id 取文章（含草稿），供后台编辑页使用。 */
  getById(id) {
    const row = postsRepository.findById(normalizeId(id));
    if (!row) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }
    return decorate(row, { withContent: true });
  },

  createPost(input) {
    const data = normalizeInput(input);
    const slug = resolveSlug({ slug: data.slug, title: data.title });
    const id = postsRepository.insert({
      slug,
      title: data.title,
      summary: data.summary,
      contentMd: data.contentMd,
      status: data.status,
      author: data.author,
    });
    return this.getById(id);
  },

  updatePost(id, input) {
    const postId = normalizeId(id);
    const existing = postsRepository.findById(postId);
    if (!existing) {
      throw new NotFoundError(`文章不存在：id=${id}`);
    }

    const data = normalizeInput(input);
    const slug = resolveSlug({ slug: data.slug, title: data.title, excludeId: postId });

    postsRepository.updateById(postId, {
      slug,
      title: data.title,
      summary: data.summary,
      contentMd: data.contentMd,
      author: data.author,
    });

    return this.getById(postId);
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
