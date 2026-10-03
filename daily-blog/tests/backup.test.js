import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  createBackup,
  listBackups,
  pruneBackups,
  verifyBackupFile,
  restoreBackup,
  backupFileName,
} from "../src/lib/backup.js";

/** 备份是纯文件操作，用一个临时目录跑，跑完自己收拾干净。 */
const workDir = path.join("data", `backup-test-${process.pid}`);
const sourcePath = path.join(workDir, "source.db");
const backupDir = path.join(workDir, "backups");

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(backupDir, { recursive: true });

const source = new Database(sourcePath);
source.exec(`
  CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL);
  INSERT INTO posts (title, status) VALUES ('备份前的文章', 'published');
`);
source.close();

function postTitles() {
  const db = new Database(sourcePath, { readonly: true });
  const titles = db.prepare("SELECT title FROM posts ORDER BY id").all().map((row) => row.title);
  db.close();
  return titles;
}

test("备份文件名按时间戳生成", () => {
  const name = backupFileName(new Date(2026, 9, 3, 2, 15, 0));
  assert.equal(name, "blog-20261003-021500.db");
});

test("备份产物是完整可用的 SQLite 库", () => {
  const result = createBackup({ dbPath: sourcePath, dir: backupDir });

  assert.ok(fs.existsSync(result.path));
  assert.ok(result.sizeBytes > 0);

  const verified = verifyBackupFile(result.path);
  assert.equal(verified.ok, true, verified.reason);
  assert.ok(verified.tables.includes("posts"));
});

test("同一秒内重复备份不会互相覆盖", () => {
  const now = new Date();
  const first = createBackup({ dbPath: sourcePath, dir: backupDir, now });
  const second = createBackup({ dbPath: sourcePath, dir: backupDir, now });

  assert.notEqual(first.name, second.name);
  assert.ok(fs.existsSync(first.path));
  assert.ok(fs.existsSync(second.path));
});

test("备份清单按时间倒序，最新在前", () => {
  const items = listBackups(backupDir);
  assert.ok(items.length >= 2);
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(items[i - 1].mtimeMs >= items[i].mtimeMs);
  }
});

test("保留策略只留最近 N 份", () => {
  const kept = pruneBackups(backupDir, 2);
  const remaining = listBackups(backupDir);

  assert.ok(kept.length > 0, "应当清理掉超出保留份数的旧备份");
  assert.equal(remaining.length, 2);
});

test("非 SQLite 文件被判为不可用，且不会被恢复", () => {
  const broken = path.join(workDir, "broken.db");
  fs.writeFileSync(broken, "this is not a database");

  const verified = verifyBackupFile(broken);
  assert.equal(verified.ok, false);

  assert.throws(
    () => restoreBackup({ dbPath: path.join(workDir, "victim.db"), backupFile: broken, dir: backupDir }),
    /不是|无法|不存在|未通过/,
  );
});

test("结构损坏的库即使能打开也会被拒绝", () => {
  // 关键场景：文件头还完整、能被 SQLite 打开，但页面数据已经坏了。
  // 只做「能不能打开」的判断会把这种文件当成可用备份，恢复后等于第二次事故。
  const damaged = path.join(workDir, "damaged.db");
  const seed = new Database(damaged);
  seed.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
  const insert = seed.prepare("INSERT INTO posts (title) VALUES (?)");
  for (let i = 0; i < 500; i += 1) {
    insert.run(`文章 ${i}`);
  }
  seed.close();

  const bytes = fs.readFileSync(damaged);
  bytes.fill(0x41, Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 500);
  fs.writeFileSync(damaged, bytes);

  const verified = verifyBackupFile(damaged);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /完整性校验/);
});

test("缺少 posts 表的库不会被误当成备份", () => {
  const foreign = path.join(workDir, "foreign.db");
  const db = new Database(foreign);
  db.exec("CREATE TABLE something_else (id INTEGER PRIMARY KEY)");
  db.close();

  const verified = verifyBackupFile(foreign);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /posts/);
});

test("恢复会把数据还原到备份时点", () => {
  const backup = createBackup({ dbPath: sourcePath, dir: backupDir });

  // 备份之后继续写数据，制造「需要回滚」的局面。
  const mutate = new Database(sourcePath);
  mutate.exec("INSERT INTO posts (title, status) VALUES ('备份后才写的文章', 'draft')");
  mutate.close();
  assert.deepEqual(postTitles(), ["备份前的文章", "备份后才写的文章"]);

  const result = restoreBackup({ dbPath: sourcePath, backupFile: backup.path, dir: backupDir });

  assert.equal(result.dbPath, sourcePath);
  assert.deepEqual(postTitles(), ["备份前的文章"], "恢复后应当只剩备份里那一篇");
});

test("恢复前会先给当前库存一份快照", () => {
  const backup = createBackup({ dbPath: sourcePath, dir: backupDir });

  const mutate = new Database(sourcePath);
  mutate.exec("INSERT INTO posts (title, status) VALUES ('恢复前快照验证', 'draft')");
  mutate.close();

  const result = restoreBackup({
    dbPath: sourcePath,
    backupFile: backup.path,
    dir: backupDir,
    safetyBackup: true,
  });

  assert.ok(result.safetyBackup, "应当生成 pre-restore 快照");
  assert.match(path.basename(result.safetyBackup), /^pre-restore-/);
  assert.ok(fs.existsSync(result.safetyBackup));

  const snapshot = new Database(result.safetyBackup, { readonly: true });
  const titles = snapshot.prepare("SELECT title FROM posts").all().map((row) => row.title);
  snapshot.close();
  assert.ok(titles.includes("恢复前快照验证"), "快照里应当保留恢复前的数据");
});

test("恢复后的库能正常打开并通过完整性校验", () => {
  const verified = verifyBackupFile(sourcePath);
  assert.equal(verified.ok, true, verified.reason);
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});
