import { logger } from "../src/logger.js";
import { getDb, closeDb } from "../src/db/index.js";

/** 执行数据库迁移，打印本次实际执行的迁移文件。 */
const db = getDb();
const applied = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();

logger.info("db.migrate.completed", {
  versions: applied.map((row) => row.version),
});

closeDb();
