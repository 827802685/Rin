import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

/**
 * 会话仓储层：id 为会话令牌的 SHA-256 摘要，令牌明文不落库。
 * expires_at 与 SQLite 的 datetime('now')（UTC）保持同一格式，便于直接用 SQL 比较。
 */
export const sessionsRepository = {
  insert({ id, userId, ttlHours, userAgent = "" }) {
    return safeRun("sessions.insert", () =>
      getDb()
        .prepare(
          `INSERT INTO admin_sessions (id, user_id, user_agent, expires_at)
           VALUES (?, ?, ?, datetime('now', ?))`,
        )
        .run(id, userId, userAgent, `+${ttlHours} hours`).lastInsertRowid,
    );
  },

  /** 查询未过期的会话并带上账号信息。 */
  findValidById(id) {
    return safeRun("sessions.findValidById", () =>
      getDb()
        .prepare(
          `SELECT s.id            AS session_id,
                  s.expires_at    AS session_expires_at,
                  u.id            AS user_id,
                  u.username      AS username,
                  u.last_login_at AS last_login_at
           FROM admin_sessions s
           JOIN admin_users u ON u.id = s.user_id
           WHERE s.id = ? AND s.expires_at > datetime('now')`,
        )
        .get(id),
    );
  },

  deleteById(id) {
    return safeRun("sessions.deleteById", () =>
      getDb().prepare("DELETE FROM admin_sessions WHERE id = ?").run(id).changes,
    );
  },

  deleteByUserId(userId) {
    return safeRun("sessions.deleteByUserId", () =>
      getDb().prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(userId).changes,
    );
  },

  /** 清理过期会话，避免表无限增长；登录时顺带执行。 */
  deleteExpired() {
    return safeRun("sessions.deleteExpired", () =>
      getDb().prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run()
        .changes,
    );
  },
};
