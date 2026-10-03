import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createIsolatedApp } from "./helpers/isolated-app.js";

/**
 * 多实例启动：两个进程对着同一个库文件同时起来。
 *
 * 这类缺陷只在「同时」这个条件下出现——单实例跑一万次也碰不到，
 * 所以用例必须是真的两个进程，不能用「连着调两次」糊弄过去。
 */

const ROOT = path.join(import.meta.dirname, "..");

function runChild(script, env = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: ROOT, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr: String(stderr ?? "") });
      },
    );
  });
}

function removeDb(file) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {}
  }
}

test("两个实例同时首次启动：迁移不会互相撞车", async () => {
  const dbPath = `./data/test-${process.pid}-multi-migrate.db`;
  removeDb(dbPath);

  // 起跑线：两个进程都在同一刻开始跑迁移，否则谁先谁后就不叫并发了，
  // 而「错开一点点」恰好是这类竞态缺陷最擅长的藏身之处。
  const script = `
    while (Date.now() < Number(process.env.START_AT)) {}
    const { getDb, closeDb } = await import('./src/db/index.js');
    getDb();
    closeDb();
  `;
  const startAt = String(Date.now() + 1500);
  const results = await Promise.all([
    runChild(script, { DB_PATH: dbPath, START_AT: startAt }),
    runChild(script, { DB_PATH: dbPath, START_AT: startAt }),
  ]);

  try {
    assert.equal(results[0].code, 0, `实例 1 启动失败：${results[0].stderr}`);
    assert.equal(results[1].code, 0, `实例 2 启动失败：${results[1].stderr}`);

    const db = new Database(dbPath, { readonly: true });
    const versions = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => row.version);
    db.close();

    // 每份迁移只记一次：撞车的话要么进程崩了，要么这里出现重复行。
    assert.equal(new Set(versions).size, versions.length);
    assert.ok(versions.length >= 6, `迁移应当全部执行，实际：${versions.join(",")}`);
    assert.ok(versions.includes("006_rate_limit.sql"));
  } finally {
    removeDb(dbPath);
  }
});

test("两个实例同时启动：管理员账号引导不会让后者崩溃", async () => {
  const dbPath = `./data/test-${process.pid}-multi-admin.db`;
  removeDb(dbPath);

  const script = `
    const { getDb, closeDb } = await import('./src/db/index.js');
    const { authService } = await import('./src/services/auth.service.js');
    getDb();
    console.log(JSON.stringify(authService.ensureAdminFromEnv()));
    closeDb();
  `;
  const env = {
    DB_PATH: dbPath,
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "multi-instance-password",
  };
  const results = await Promise.all([runChild(script, env), runChild(script, env)]);

  try {
    // 崩溃现场是 UNIQUE constraint failed: admin_users.username。
    assert.equal(results[0].code, 0, `实例 1 启动失败：${results[0].stderr}`);
    assert.equal(results[1].code, 0, `实例 2 启动失败：${results[1].stderr}`);

    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT id, username FROM admin_users").all();
    db.close();
    assert.equal(rows.length, 1, "同名账号只能有一行");
    assert.equal(rows[0].username, "admin");
  } finally {
    removeDb(dbPath);
  }
});

// ---------- 仓储层：upsert 本身 ----------

const { app: _app, db } = await createIsolatedApp({
  tag: "multi-upsert",
  env: { ADMIN_PASSWORD: "test-password-123" },
});
void _app;

const { usersRepository } = await import("../src/repositories/users.repository.js");

test("同名账号重复写入时是更新而不是报错", () => {
  db.prepare("DELETE FROM admin_users WHERE username = ?").run("race-user");

  const firstId = usersRepository.upsert({ username: "race-user", passwordHash: "hash-1" });
  const secondId = usersRepository.upsert({ username: "race-user", passwordHash: "hash-2" });

  const row = db
    .prepare("SELECT id, password_hash FROM admin_users WHERE username = ?")
    .get("race-user");
  assert.equal(row.password_hash, "hash-2", "后写的一次生效");
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM admin_users WHERE username = ?").get("race-user")
      .total,
    1,
    "不能出现两行同名账号",
  );
  assert.equal(secondId, firstId, "更新时回到同一条记录");
});
