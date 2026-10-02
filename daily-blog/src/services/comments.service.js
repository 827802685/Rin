import { config } from "../config.js";
import {
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
} from "../errors.js";
import { commentsRepository } from "../repositories/comments.repository.js";
import { postsRepository } from "../repositories/posts.repository.js";
import { countLinks, normalizeCommentText } from "../lib/comment-text.js";

export const COMMENT_STATUSES = Object.freeze(["pending", "approved", "rejected"]);
export const COMMENT_STATUS_LABELS = Object.freeze({
  pending: "待审",
  approved: "已通过",
  rejected: "已拒绝",
});

const NAME_MAX_LENGTH = 40;
const EMAIL_MAX_LENGTH = 120;
const URL_MAX_LENGTH = 200;
const USER_AGENT_MAX_LENGTH = 300;

/** 前台一次最多展示的评论数：评论不做翻页，但要有上限，避免单篇文章刷爆页面。 */
const FRONTEND_LIMIT = 200;

const ADMIN_PAGE_SIZE_MAX = 100;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeId(id) {
  const parsed = Number.parseInt(id, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new NotFoundError("评论不存在");
  }
  return parsed;
}

function normalizeStatus(status) {
  if (!COMMENT_STATUSES.includes(status)) {
    throw new ValidationError(`评论状态只能是 ${COMMENT_STATUSES.join(" / ")}，当前值：${status}`);
  }
  return status;
}

/** 时间窗口交给 SQLite 计算：`datetime('now', '-10 minutes')`。 */
function rateWindowModifier() {
  return `-${config.comments.rateWindowMinutes} minutes`;
}

function decorate(row) {
  return {
    id: row.id,
    postId: row.post_id,
    authorName: row.author_name,
    authorEmail: row.author_email,
    authorUrl: row.author_url,
    content: row.content,
    status: row.status,
    statusLabel: COMMENT_STATUS_LABELS[row.status] ?? row.status,
    createdAt: row.created_at,
    moderatedAt: row.moderated_at,
    ipHash: row.ip_hash,
  };
}

function decorateForAdmin(row) {
  return {
    ...decorate(row),
    post: {
      id: row.post_id,
      title: row.post_title,
      slug: row.post_slug,
      status: row.post_status,
      url: `/posts/${encodeURIComponent(row.post_slug)}`,
    },
    moderator: row.moderator_username ?? null,
  };
}

/**
 * 评论服务层：承载「提交 → 待审 → 审核」的业务规则与基础防灌水。
 * 不依赖 HTTP 请求/响应对象：来源 IP 的摘要与 UA 由路由层传入。
 */
export const commentsService = {
  /** 前台详情页：已通过评论，按时间正序。 */
  listApprovedForPost(postId, { limit = FRONTEND_LIMIT } = {}) {
    return commentsRepository.findApprovedByPostId(normalizeId(postId), limit).map(decorate);
  },

  countApprovedForPost(postId) {
    return commentsRepository.countApprovedByPostId(normalizeId(postId));
  },

  /** 批量统计列表页文章的已通过评论数，返回 Map，避免逐篇查询。 */
  countApprovedByPostIds(ids) {
    const counts = new Map();
    for (const row of commentsRepository.countApprovedByPostIds(ids)) {
      counts.set(row.post_id, row.total);
    }
    return counts;
  },

  /**
   * 游客提交评论。
   *
   * 防灌水的四道关卡，按成本从低到高排列：
   * ① 蜜罐字段（真人看不见，填了即脚本）→ 伪成功但不落库，避免脚本据此调整策略；
   * ② 必填与字数校验、外链数量上限；
   * ③ 同一来源在窗口期内的提交条数上限；
   * ④ 同一来源在窗口期内重复提交相同内容。
   *
   * 新评论一律是 pending，前台不可见，必须后台审核通过后才展示。
   */
  submit(input = {}, context = {}) {
    if (String(input.honeypot ?? "").trim() !== "") {
      return { id: null, status: null, spam: true, reason: "honeypot" };
    }

    const postId = normalizeId(input.postId);
    const post = postsRepository.findById(postId);
    if (!post || post.status !== "published") {
      throw new NotFoundError("文章不存在或未发布，无法评论");
    }

    const authorName = String(input.authorName ?? "").trim();
    if (!authorName) {
      throw new ValidationError("请填写昵称");
    }
    if (authorName.length > NAME_MAX_LENGTH) {
      throw new ValidationError(`昵称最长 ${NAME_MAX_LENGTH} 个字符`);
    }

    const authorEmail = String(input.authorEmail ?? "").trim();
    if (authorEmail.length > EMAIL_MAX_LENGTH) {
      throw new ValidationError(`邮箱最长 ${EMAIL_MAX_LENGTH} 个字符`);
    }
    if (authorEmail && !EMAIL_PATTERN.test(authorEmail)) {
      throw new ValidationError("邮箱格式不正确");
    }

    const authorUrl = String(input.authorUrl ?? "").trim();
    if (authorUrl.length > URL_MAX_LENGTH) {
      throw new ValidationError(`网址最长 ${URL_MAX_LENGTH} 个字符`);
    }
    if (authorUrl && !/^https?:\/\//i.test(authorUrl)) {
      throw new ValidationError("网址必须以 http:// 或 https:// 开头");
    }

    const { minLength, maxLength, maxLinks } = config.comments;
    const content = normalizeCommentText(input.content);
    if (content.length < minLength) {
      throw new ValidationError(`评论内容至少 ${minLength} 个字符`);
    }
    if (content.length > maxLength) {
      throw new ValidationError(`评论内容最长 ${maxLength} 个字符`);
    }

    const links = countLinks(content);
    if (links > maxLinks) {
      throw new ValidationError(
        maxLinks === 0
          ? "评论内容不允许包含链接"
          : `评论内容最多包含 ${maxLinks} 条链接，当前 ${links} 条`,
      );
    }

    const ipHash = String(context.ipHash ?? "").trim() || "unknown";
    const userAgent = String(context.userAgent ?? "").slice(0, USER_AGENT_MAX_LENGTH);
    const windowModifier = rateWindowModifier();

    const duplicate = commentsRepository.findRecentDuplicate({
      ipHash,
      content,
      windowModifier,
    });
    if (duplicate) {
      throw new ConflictError("你刚刚已经提交过这条评论了，请勿重复提交");
    }

    const recent = commentsRepository.countRecentByIpHash({ ipHash, windowModifier });
    if (recent >= config.comments.rateLimit) {
      throw new TooManyRequestsError(
        `提交过于频繁：${config.comments.rateWindowMinutes} 分钟内最多提交 ${config.comments.rateLimit} 条评论，请稍后再试`,
      );
    }

    const id = commentsRepository.insert({
      postId,
      authorName,
      authorEmail,
      authorUrl,
      content,
      status: "pending",
      ipHash,
      userAgent,
    });

    return { id, status: "pending", spam: false };
  },

  // ---------- 后台审核 ----------

  countByStatus() {
    return commentsRepository.countByStatus();
  },

  /** 后台审核列表：支持按状态筛选与分页。 */
  listForAdmin({ page = 1, pageSize = 20, status = null } = {}) {
    const safePageSize = Math.min(
      Math.max(Number.parseInt(pageSize, 10) || 20, 1),
      ADMIN_PAGE_SIZE_MAX,
    );
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const filter = status ? normalizeStatus(status) : null;

    const total = commentsRepository.countForAdmin({ status: filter });
    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const currentPage = Math.min(safePage, totalPages);
    const rows = commentsRepository.findAdminPage({
      limit: safePageSize,
      offset: (currentPage - 1) * safePageSize,
      status: filter,
    });

    return {
      counts: commentsRepository.countByStatus(),
      statusFilter: filter,
      items: rows.map(decorateForAdmin),
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

  /** 审核：只允许在「通过 / 拒绝」之间切换，不允许改回待审（避免列表状态漂移）。 */
  moderate(id, status, moderatorId = null) {
    const commentId = normalizeId(id);
    const nextStatus = normalizeStatus(status);
    if (nextStatus === "pending") {
      throw new ValidationError("审核结果只能是 通过 或 拒绝");
    }

    const existing = commentsRepository.findById(commentId);
    if (!existing) {
      throw new NotFoundError(`评论不存在：id=${id}`);
    }

    commentsRepository.updateStatus(commentId, nextStatus, moderatorId);
    return decorateForAdmin(commentsRepository.findAdminById(commentId));
  },

  remove(id) {
    const commentId = normalizeId(id);
    const changes = commentsRepository.deleteById(commentId);
    if (changes === 0) {
      throw new NotFoundError(`评论不存在：id=${id}`);
    }
    return { id: commentId, deleted: changes };
  },
};
