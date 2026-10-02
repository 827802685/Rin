import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";
import { closeDb } from "../src/db/index.js";
import { listBackups, restoreBackup, verifyBackupFile } from "../src/lib/backup.js";

/**
 * 从备份恢复：`npm run restore -- backups/blog-YYYYMMDD-HHMMSS.db`
 *
 * 恢复会**覆盖当前数据库**，因此：
 * 1. 没有显式 --yes 时只做预演（告诉你会用哪份、会影响什么），不写任何文件；
 * 2. 恢复前自动给当前库再存一份 pre-restore 快照，恢复错了还有后悔药；
 * 3. 备份文件先过完整性校验，坏文件不会碰到生产库。
 */

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const positional = args.filter((arg) => !arg.startsWith("--"));

if (positional.length === 0) {
  const available = listBackups(config.backup.dir);
  console.error("用法：npm run restore -- <备份文件名或路径> [--yes]");
  if (available.length > 0) {
    console.error(`\n可用备份（${config.backup.dir}）：`);
    for (const item of available.slice(0, 10)) {
      console.error(`  - ${item.name} (${(item.sizeBytes / 1024).toFixed(1)} KB)`);
    }
  } else {
    console.error(`\n${config.backup.dir} 下还没有备份，请先执行 npm run backup。`);
  }
  process.exit(1);
}

const input = positional[0];
const backupFile = path.isAbsolute(input) ? input : path.join(config.backup.dir, input);

if (process.stdin.isTTY && !confirmed) {
  console.error("恢复会覆盖当前数据库，请加 --yes 确认后再执行。");
  process.exit(1);
}

const verified = verifyBackupFile(backupFile);
if (!verified.ok) {
  console.error(`拒绝恢复：${verified.reason}`);
  process.exit(1);
}

// 恢复要替换数据文件，先关掉本进程可能持有的连接。
closeDb();

const result = restoreBackup({
  dbPath: config.dbPath,
  backupFile,
  dir: config.backup.dir,
  safetyBackup: true,
});

logger.info("db.restore.completed", {
  from: result.restoredFrom,
  safetyBackup: result.safetyBackup,
  dbPath: result.dbPath,
});

console.log(`已从 ${result.restoredFrom} 恢复数据库`);
if (result.safetyBackup) {
  console.log(`恢复前的库已另存为：${result.safetyBackup}`);
}
console.log(`当前数据库：${result.dbPath}`);
console.log(`校验通过，共 ${verified.tables.length} 张表；可执行 npm run migrate 确认结构最新。`);

if (!fs.existsSync(config.dbPath)) {
  console.error("恢复后未找到数据库文件，请检查路径配置。");
  process.exit(1);
}
