import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = `
  id, post_id, author_name, author_email, author_url, content, status,
  ip_hash, user_agent, created_at, moderated_at, moderated_by
`;

/** 后台审核列表需要文章标题与审核人，因此联表补齐。 */
const ADMIN_COLUMNS = `
  c.id, c.post_id, c.author_name, c.author_email, c.author_url, c.content,
  c.status, c.ip_hash, c.user_agent, c.created_at, c.moderated_at, c.moderated_by,
  p.title AS post_title, p.slug AS post_slug, p.status AS post_status,
  u.username AS moderator_username
`;

const ADMIN_FROM = `
  FROM comments c
  JOIN posts p ON p.id = c.post_id
  LEFT JOIN admin_users u ON u.id = c.moderated_by
`;

function placeholders(count) {
  return new Array(count).fill("?").join(", ");
}

/**
 * 评论仓储层：只写 SQL，不含业务规则。
 * status 取值由服务层校验后传入；时间窗口由 SQL 的 datetime('now', 修饰符) 计算，
 * 避免把 JS 的时间格式与 SQLite 的 `YYYY-MM-DD HH:MM:SS` 混用出错。
 */
export const commentsRepository = {
  insert({ postId, authorName, authorEmail, authorUrl, content, status, ipHash, userAgent }) {
    return safeRun("comments.insert", () =>
      getDb()
        .prepare(
          `INSERT INTO comments
             (post_id, author_name, author_email, author_url, content, status, ip_hash, user_agent)
           VALUES
             (@postId, @authorName, @authorEmail, @authorUrl, @content, @status, @ipHash, @userAgent)`,
        )
        .run({
          postId,
          authorName,
          authorEmail: authorEmail ?? "",
          authorUrl: authorUrl ?? "",
          content,
          status,
          ipHash: ipHash ?? "unknown",
          userAgent: userAgent ?? "",
        }).lastInsertRowid,
    );
  },

  /** 前台详情页：某篇文章的已通过评论，按时间正序（先来后到）。 */
  findApprovedByPostId(postId, limit = 200) {
    return safeRun("comments.findApprovedByPostId", () =>
      getDb()
        .prepare(
          `SELECT ${COLUMNS}
           FROM comments
           WHERE post_id = ? AND status = 'approved'
           ORDER BY created_at ASC, id ASC
           LIMIT ?`,
        )
        .all(postId, limit),
    );
  },

  countApprovedByPostId(postId) {
    return safeRun("comments.countApprovedByPostId", () =>
      getDb()
        .prepare(
          "SELECT COUNT(*) AS total FROM comments WHERE post_id = ? AND status = 'approved'",
        )
        .get(postId).total,
    );
  },

  /** 批量统计多篇文章的已通过评论数，供列表页避免 N+1。 */
  countApprovedByPostIds(ids) {
    if (ids.length === 0) {
      return [];
    }
    return safeRun("comments.countApprovedByPostIds", () =>
      getDb()
        .prepare(
          `SELECT post_id, COUNT(*) AS total
           FROM comments
           WHERE post_id IN (${placeholders(ids.length)}) AND status = 'approved'
           GROUP BY post_id`,
        )
        .all(...ids),
    );
  },

  findById(id) {
    return safeRun("comments.findById", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM comments WHERE id = ?`).get(id),
    );
  },

  /** 后台单条：带文章标题与审核人，用于审核后回显。 */
  findAdminById(id) {
    return safeRun("comments.findAdminById", () =>
      getDb().prepare(`SELECT ${ADMIN_COLUMNS} ${ADMIN_FROM} WHERE c.id = ?`).get(id),
    );
  },

  /** 后台各状态计数，用于审核列表的概览与角标。 */
  countByStatus() {
    return safeRun("comments.countByStatus", () => {
      const rows = getDb()
        .prepare("SELECT status, COUNT(*) AS total FROM comments GROUP BY status")
        .all();
      const counts = { pending: 0, approved: 0, rejected: 0, total: 0 };
      for (const row of rows) {
        if (row.status in counts) {
          counts[row.status] = row.total;
        }
        counts.total += row.total;
      }
      return counts;
    });
  },

  countForAdmin({ status = null } = {}) {
    return safeRun("comments.countForAdmin", () => {
      if (status) {
        return getDb()
          .prepare("SELECT COUNT(*) AS total FROM comments WHERE status = ?")
          .get(status).total;
      }
      return getDb().prepare("SELECT COUNT(*) AS total FROM comments").get().total;
    });
  },

  /** 后台审核列表：待审优先排在最前，同状态内按时间倒序。 */
  findAdminPage({ limit, offset, status = null }) {
    return safeRun("comments.findAdminPage", () =>
      getDb()
        .prepare(
          `SELECT ${ADMIN_COLUMNS}
           ${ADMIN_FROM}
           WHERE (@status IS NULL OR c.status = @status)
           ORDER BY CASE c.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                    c.created_at DESC, c.id DESC
           LIMIT @limit OFFSET @offset`,
        )
        .all({ limit, offset, status: status ?? null }),
    );
  },

  /** 审核：写入新状态、审核时间与审核人。 */
  updateStatus(id, status, moderatorId = null) {
    return safeRun("comments.updateStatus", () =>
      getDb()
        .prepare(
          `UPDATE comments
           SET status = @status,
               moderated_at = datetime('now'),
               moderated_by = @moderatorId
           WHERE id = @id`,
        )
        .run({ id, status, moderatorId }).changes,
    );
  },

  deleteById(id) {
    return safeRun("comments.deleteById", () =>
      getDb().prepare("DELETE FROM comments WHERE id = ?").run(id).changes,
    );
  },

  // ---------- 防灌水相关查询 ----------

  /** 同一来源在时间窗口内已提交的评论数（不限文章，避免换文章绕开限制）。 */
  countRecentByIpHash({ ipHash, windowModifier }) {
    return safeRun("comments.countRecentByIpHash", () =>
      getDb()
        .prepare(
          `SELECT COUNT(*) AS total
           FROM comments
           WHERE ip_hash = @ipHash AND created_at >= datetime('now', @windowModifier)`,
        )
        .get({ ipHash, windowModifier }).total,
    );
  },

  /** 同一来源在窗口内是否提交过完全相同的评论内容（连点 / 脚本重复提交）。 */
  findRecentDuplicate({ ipHash, content, windowModifier }) {
    return safeRun("comments.findRecentDuplicate", () =>
      getDb()
        .prepare(
          `SELECT id
           FROM comments
           WHERE ip_hash = @ipHash AND content = @content
             AND created_at >= datetime('now', @windowModifier)
           LIMIT 1`,
        )
        .get({ ipHash, content, windowModifier }),
    );
  },
};
