import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * 备份与恢复的核心逻辑（放在 lib 而不是 scripts，是为了能被测试直接调用）。
 *
 * 为什么用 `VACUUM INTO` 而不是 `cp data/blog.db`：
 * 1. WAL 模式下最新数据还留在 `blog.db-wal` 里，直接复制主库文件会拿到旧快照；
 * 2. VACUUM INTO 由 SQLite 自己保证一致性，并且顺带整理碎片，产物通常更小；
 * 3. 目标文件存在时会直接失败，天然避免「覆盖掉昨天的备份」。
 */

/** 备份文件名：blog-20261003-021500.db，按本地时间命名，排序即时间序。 */
export function backupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("");
  const clock = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  return `blog-${stamp}-${clock}.db`;
}

/** 单引号在 SQL 字符串字面量里要转义：备份路径来自配置，必须防注入。 */
function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 备份文件清单，按时间倒序（最新在前）。 */
export function listBackups(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * 校验一个文件确实是可用的一致性 SQLite 库。
 * 恢复前必须做这一步：拿一个截断的或损坏的文件覆盖生产库，损失不可挽回。
 */
export function verifyBackupFile(file) {
  if (!fs.existsSync(file)) {
    return { ok: false, reason: `备份文件不存在：${file}` };
  }
  let db;
  try {
    db = new Database(file, { readonly: true });
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      return { ok: false, reason: `完整性校验未通过：${integrity}` };
    }
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    if (!tables.includes("posts")) {
      return { ok: false, reason: "文件里没有 posts 表，可能不是本项目的数据库" };
    }
    return { ok: true, tables };
  } catch (error) {
    return { ok: false, reason: `无法作为 SQLite 数据库打开：${error.message}` };
  } finally {
    db?.close();
  }
}

/** 保留最近 keep 份，删除更旧的。返回被删除的文件名。 */
export function pruneBackups(dir, keep) {
  const backups = listBackups(dir);
  if (keep <= 0 || backups.length <= keep) {
    return [];
  }
  return backups.slice(keep).map((item) => {
    fs.rmSync(item.path, { force: true });
    return item.name;
  });
}

/**
 * 执行一次备份。
 * 同源同秒重复执行时自动追加序号，不会因为文件已存在而失败。
 */
export function createBackup({ dbPath, dir, keep = 0, now = new Date() }) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`源数据库不存在：${dbPath}`);
  }
  ensureDir(dir);

  let target = path.join(dir, backupFileName(now));
  let suffix = 0;
  while (fs.existsSync(target)) {
    suffix += 1;
    target = path.join(dir, backupFileName(now).replace(/\.db$/, `-${suffix}.db`));
  }

  const source = new Database(dbPath, { readonly: true });
  try {
    // VACUUM INTO 会连同 WAL 里尚未合并的内容一起写进新文件，产物是自洽的完整快照。
    source.exec(`VACUUM INTO ${sqlQuote(path.resolve(target))}`);
  } finally {
    source.close();
  }

  const pruned = keep > 0 ? pruneBackups(dir, keep) : [];
  const stat = fs.statSync(target);
  return {
    name: path.basename(target),
    path: target,
    sizeBytes: stat.size,
    pruned,
    remaining: listBackups(dir).length,
  };
}

/**
 * 用备份覆盖当前数据库。
 *
 * 安全顺序：先校验备份 → 再给当前库做一份「恢复前快照」→ 最后才覆盖。
 * 任何一步失败都不会动到 dbPath，避免「备份坏了、库也没了」。
 */
export function restoreBackup({ dbPath, backupFile, dir, safetyBackup = true }) {
  const verified = verifyBackupFile(backupFile);
  if (!verified.ok) {
    throw new Error(verified.reason);
  }

  let safety = null;
  if (safetyBackup && fs.existsSync(dbPath)) {
    ensureDir(dir);
    // VACUUM INTO 遇到已存在的文件会直接报错，而「同一秒内恢复两次」是完全可能的
    // （脚本连着跑、用例连着跑），因此这里也要像正式备份一样做重名避让。
    const base = `pre-restore-${backupFileName().replace(/^blog-/, "")}`;
    let target = path.join(dir, base);
    let suffix = 0;
    while (fs.existsSync(target)) {
      suffix += 1;
      target = path.join(dir, base.replace(/\.db$/, `-${suffix}.db`));
    }
    const source = new Database(dbPath, { readonly: true });
    try {
      source.exec(`VACUUM INTO ${sqlQuote(path.resolve(target))}`);
    } finally {
      source.close();
    }
    safety = target;
  }

  // 先删掉 WAL 与 SHM：留着旧日志去配新库文件，SQLite 会认为数据文件损坏。
  for (const suffix of ["-wal", "-shm"]) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
  fs.copyFileSync(backupFile, dbPath);

  return { restoredFrom: backupFile, safetyBackup: safety, dbPath };
}
