import { getDb } from "../db/index.js";
import { safeRun } from "../db/errors.js";

/**
 * 站点配置仓储层：只写 SQL。
 *
 * 刻意采用「键值对 + 只存被改过的项」的形态：
 * 表里没有的键由服务层回落到 config.js 的默认值，
 * 因此「恢复默认」就是删掉这些行，不需要写回一份默认快照。
 */
export const settingsRepository = {
  /** 全部已保存的配置项，返回 { key: value }。 */
  findAll() {
    return safeRun("settings.findAll", () => {
      const rows = getDb().prepare("SELECT key, value FROM site_settings").all();
      const map = {};
      for (const row of rows) {
        map[row.key] = row.value;
      }
      return map;
    });
  },

  /** 写入或更新一个配置项。 */
  upsert(key, value) {
    return safeRun("settings.upsert", () =>
      getDb()
        .prepare(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES (@key, @value, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        )
        .run({ key, value }).changes,
    );
  },

  /** 删除一个配置项（等价于让该项回落到默认值）。 */
  remove(key) {
    return safeRun("settings.remove", () =>
      getDb().prepare("DELETE FROM site_settings WHERE key = ?").run(key).changes,
    );
  },

  /** 清空全部覆盖值，恢复默认。 */
  removeAll() {
    return safeRun("settings.removeAll", () =>
      getDb().prepare("DELETE FROM site_settings").run().changes,
    );
  },
};
