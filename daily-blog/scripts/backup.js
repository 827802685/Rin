import { config } from "../src/config.js";
import { logger } from "../src/logger.js";
import { createBackup, listBackups } from "../src/lib/backup.js";

/**
 * 手动备份：`npm run backup`
 * 可选参数：--dir=<目录>（覆盖 BACKUP_DIR）、--keep=<份数>（覆盖 BACKUP_KEEP）。
 */
function readArg(name, fallback) {
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const dir = readArg("dir", config.backup.dir);
const keep = Number.parseInt(readArg("keep", String(config.backup.keep)), 10);

if (!Number.isInteger(keep) || keep < 1) {
  throw new Error(`--keep 必须是正整数，当前值：${readArg("keep", String(config.backup.keep))}`);
}

const result = createBackup({ dbPath: config.dbPath, dir, keep });

logger.info("db.backup.completed", {
  file: result.name,
  sizeBytes: result.sizeBytes,
  pruned: result.pruned,
  remaining: result.remaining,
});

console.log(`备份完成：${result.path}`);
console.log(`体积：${(result.sizeBytes / 1024).toFixed(1)} KB`);
if (result.pruned.length > 0) {
  console.log(`已按保留策略清理 ${result.pruned.length} 份旧备份：${result.pruned.join(", ")}`);
}
console.log(`当前共 ${result.remaining} 份备份（保留 ${keep} 份）：`);
for (const item of listBackups(dir).slice(0, 5)) {
  console.log(`  - ${item.name} (${(item.sizeBytes / 1024).toFixed(1)} KB)`);
}
