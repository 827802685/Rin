import fs from "node:fs";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";
import { getDb, closeDb } from "../src/db/index.js";
import { seed } from "../src/db/seed.js";
import { authService } from "../src/services/auth.service.js";

/** 重置本地数据库：删除库文件后重新迁移并填充示例数据。 */
for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${config.dbPath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
  }
}

const db = getDb();
const result = seed(db);
const adminBootstrap = authService.ensureAdminFromEnv();
logger.info("db.reset.completed", {
  dbPath: config.dbPath,
  ...result,
  admin: adminBootstrap.enabled ? adminBootstrap.username : "disabled",
});
closeDb();
