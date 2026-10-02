import { logger } from "../src/logger.js";
import { getDb, closeDb } from "../src/db/index.js";
import { seed } from "../src/db/seed.js";

/** 写入示例文章（仅当 posts 表为空时）。 */
const db = getDb();
const result = seed(db);

logger.info("db.seed.completed", result);
closeDb();
