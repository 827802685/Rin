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

  /**
   * 创建或同步账号，一条语句完成。
   *
   * 为什么是 upsert 而不是「先查再插」：多实例同时启动时，两个进程都会查到
   * 「账号不存在」，然后抢着 INSERT，后到的那个直接撞 UNIQUE 约束崩在启动阶段
   * （Day 8 的双实例冒烟就是这么挂的）。把冲突交给数据库裁决，谁先谁后都不影响结果。
   */
  upsert({ username, passwordHash }) {
    return safeRun("users.upsert", () =>
      getDb()
        .prepare(
          `INSERT INTO admin_users (username, password_hash, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(username) DO UPDATE SET
             password_hash = excluded.password_hash,
             updated_at = datetime('now')`,
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
