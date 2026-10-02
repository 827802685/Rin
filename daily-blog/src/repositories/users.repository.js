import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

const COLUMNS = "id, username, password_hash, last_login_at, created_at, updated_at";

/**
 * 管理员账号仓储层：只负责 SQL 与数据映射，不含密码策略。
 */
export const usersRepository = {
  findByUsername(username) {
    return safeRun("users.findByUsername", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM admin_users WHERE username = ?`).get(username),
    );
  },

  findById(id) {
    return safeRun("users.findById", () =>
      getDb().prepare(`SELECT ${COLUMNS} FROM admin_users WHERE id = ?`).get(id),
    );
  },

  count() {
    return safeRun("users.count", () =>
      getDb().prepare("SELECT COUNT(*) AS total FROM admin_users").get().total,
    );
  },

  insert({ username, passwordHash }) {
    return safeRun("users.insert", () =>
      getDb()
        .prepare(
          `INSERT INTO admin_users (username, password_hash, updated_at)
           VALUES (?, ?, datetime('now'))`,
        )
        .run(username, passwordHash).lastInsertRowid,
    );
  },

  updatePasswordHash(id, passwordHash) {
    return safeRun("users.updatePasswordHash", () =>
      getDb()
        .prepare(
          `UPDATE admin_users
           SET password_hash = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(passwordHash, id).changes,
    );
  },

  touchLastLogin(id) {
    return safeRun("users.touchLastLogin", () =>
      getDb()
        .prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?")
        .run(id).changes,
    );
  },
};
