import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { logger } from "../src/logger.js";
import { closeDb } from "../src/db/index.js";
import { rateLimitService } from "../src/services/rate-limit.service.js";

/**
 * 运维清理：`npm run cleanup`
 *
 * 两件事：
 * 1. 删掉测试留下的 `data/test-*.db`（每次 npm test 按进程号生成一份，长期会堆一抽屉）；
 * 2. 清掉过期的限流命中记录（正常情况下服务自己会定期清，这里是「手动兜底」）。
 *
 * 参数：--dry-run 只看不动；--only=test-db|rate-limit 只做其中一项。
 * 注意：清理用的是 .env 里的 DB_PATH，**不会**碰测试库以外的数据。
 */

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice(7) : null;

if (only && !["test-db", "rate-limit"].includes(only)) {
  throw new Error(`--only 只支持 test-db / rate-limit，当前值：${only}`);
}

// 测试库可能散在两个目录：主库目录 + 限流共享库目录（Day 8 起可分开配）。
const dataDirs = [
  ...new Set(
    [config.dbPath, config.rateLimit.dbPath]
      .filter(Boolean)
      .map((file) => path.dirname(file)),
  ),
];
let removedFiles = [];
let removedBytes = 0;

if (only !== "rate-limit") {
  for (const dataDir of dataDirs) {
    if (!fs.existsSync(dataDir)) {
      continue;
    }
    const candidates = fs
      .readdirSync(dataDir)
      .filter((name) => /^test-.*\.db(-wal|-shm)?$/.test(name));

    for (const name of candidates) {
      const full = path.join(dataDir, name);
      const stat = fs.statSync(full);
      removedBytes += stat.size;
      removedFiles.push(name);
      if (!dryRun) {
        fs.rmSync(full, { force: true });
      }
    }
  }
}

let prunedRows = 0;
if (only !== "test-db") {
  // 用 24 小时兜底：正常的窗口最多几十分钟，能活过一天的说明服务没在清。
  // 走服务层而不是直接查主库——限流计数可能落在独立的共享库里（RATE_LIMIT_DB_PATH）。
  prunedRows = dryRun ? rateLimitService.countStale(86400) : rateLimitService.pruneStale(86400);
  closeDb();
}

logger.info("maintenance.cleanup", {
  dryRun,
  removedFiles: removedFiles.length,
  removedBytes,
  prunedRows,
});

console.log(dryRun ? "（预演模式，未改动任何文件）" : "清理完成");
console.log(`  测试数据库文件：${removedFiles.length} 个，共 ${(removedBytes / 1024).toFixed(1)} KB`);
if (removedFiles.length > 0) {
  for (const name of removedFiles.slice(0, 10)) {
    console.log(`    - ${name}`);
  }
  if (removedFiles.length > 10) {
    console.log(`    ... 其余 ${removedFiles.length - 10} 个省略`);
  }
}
console.log(`  过期限流记录：${prunedRows} 行`);
