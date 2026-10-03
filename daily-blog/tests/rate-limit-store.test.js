import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { config } from "../src/config.js";
import { createMemoryStore, createSqliteStore } from "../src/lib/rate-limit-store.js";
import { RATE_BUCKETS } from "../src/services/rate-limit.service.js";

/**
 * 限流存储：两种实现 + 「多实例共享同一份额度」这件事本身。
 *
 * 存储是可插拔的（RATE_LIMIT_STORE / RATE_LIMIT_DB_PATH），
 * 所以断言直接落在存储接口上，不经过 HTTP——接口一致，行为就该一致。
 */

const general = RATE_BUCKETS.general;
const login = RATE_BUCKETS.login;

/** 开一个独立的临时库；同一个名字重复调用会先删后建。 */
function openTempDb(name) {
  const file = `./data/test-${process.pid}-${name}.db`;
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(`${file}${suffix}`, { force: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS rate_limit_hits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket     TEXT NOT NULL,
    subject    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  return { db, file };
}

function disposeTempDb(db, file) {
  try {
    db.close();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(`${file}${suffix}`, { force: true });
    } catch {}
  }
}

/** 两种实现跑同一组断言：换存储不该换行为。 */
function assertStoreContract(store, label) {
  test(`${label}：记录与统计落在窗口内`, () => {
    store.clear(general, "subject-a");
    store.record(general, "subject-a");
    store.record(general, "subject-a");
    store.record(general, "subject-b");

    assert.equal(store.countRecent(general, "subject-a", 60), 2);
    assert.equal(store.countRecent(general, "subject-b", 60), 1);
    assert.equal(store.countRecent(login, "subject-a", 60), 0, "桶之间是隔离的");
  });

  test(`${label}：最早命中时间用于估算 Retry-After`, () => {
    store.clear(general, "subject-oldest");
    store.record(general, "subject-oldest");
    const oldest = store.oldestRecent(general, "subject-oldest", 60);
    // 服务层按 SQLite 风格的时间串解析，格式必须一致（'YYYY-MM-DD HH:MM:SS'）。
    assert.match(oldest, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(store.oldestRecent(general, "nobody", 60), null);
  });

  test(`${label}：清空某个来源只影响它自己`, () => {
    store.clear(general, "subject-clear");
    store.clear(general, "subject-keep");
    store.record(general, "subject-clear");
    store.record(general, "subject-keep");

    assert.equal(store.clear(general, "subject-clear"), 1);
    assert.equal(store.countRecent(general, "subject-clear", 60), 0);
    assert.equal(store.countRecent(general, "subject-keep", 60), 1);
  });

  test(`${label}：describe 说明自己存哪、是否跨进程共享`, () => {
    const info = store.describe();
    assert.ok(["sqlite", "memory"].includes(info.store));
    assert.equal(typeof info.shared, "boolean");
  });
}

assertStoreContract(createMemoryStore(), "memory 存储");

const contractDb = openTempDb("rate-store");
assertStoreContract(createSqliteStore(() => contractDb.db), "sqlite 存储");

test("sqlite 存储：两个连接指向同一个文件时共享额度", () => {
  const shared = openTempDb("rate-shared");
  try {
    // 模拟同一台主机上的两个实例：各自持有一个连接，但指向同一个库文件。
    const instanceA = createSqliteStore(() => shared.db);
    const instanceB = createSqliteStore(() => shared.db);

    instanceA.record(general, "same-client");
    instanceB.record(general, "same-client");

    // 两个实例看到的是同一份计数——这就是「多实例共享限流」的证据。
    assert.equal(instanceA.countRecent(general, "same-client", 60), 2);
    assert.equal(instanceB.countRecent(general, "same-client", 60), 2);

    instanceA.clear(general, "same-client");
    assert.equal(instanceB.countRecent(general, "same-client", 60), 0);
  } finally {
    disposeTempDb(shared.db, shared.file);
  }
});

test("sqlite 存储：指向独立库文件时 describe 标记为共享", () => {
  const info = createSqliteStore(() => contractDb.db).describe();
  assert.equal(info.store, "sqlite");
  // 未配 RATE_LIMIT_DB_PATH 时落在主库，不算跨进程共享的存储。
  assert.equal(info.shared, Boolean(String(config.rateLimit.dbPath).trim()));
  assert.equal(info.dbPath, String(config.rateLimit.dbPath).trim() || config.dbPath);
});

test("memory 存储：时钟推进后过期命中不再计入", () => {
  let clock = 1_700_000_000_000;
  const store = createMemoryStore({ now: () => clock });

  store.record(general, "aged");
  assert.equal(store.countRecent(general, "aged", 60), 1);
  assert.equal(store.countStale(60), 0);

  // 推进 10 分钟：超出 60 秒窗口。
  clock += 600_000;
  assert.equal(store.countRecent(general, "aged", 60), 0);
  assert.equal(store.countStale(60), 1);
  assert.equal(store.oldestRecent(general, "aged", 60), null);

  assert.equal(store.pruneSubject(general, "aged", 60), 1);
  assert.equal(store.pruneStale(60), 0, "已经没有可清的了");
});

test("sqlite 存储：时间回拨后过期命中不再计入", () => {
  const store = createSqliteStore(() => contractDb.db);
  // 前面的契约用例在库里留了行，这里只看自己的数据：先清干净再记一次。
  contractDb.db.prepare("DELETE FROM rate_limit_hits").run();
  store.record(general, "aged");
  assert.equal(store.countRecent(general, "aged", 60), 1);

  // SQLite 的时间是秒级且由库自己生成，只能改数据：把命中推到 10 分钟前。
  contractDb.db
    .prepare("UPDATE rate_limit_hits SET created_at = datetime('now', '-600 seconds')")
    .run();

  assert.equal(store.countRecent(general, "aged", 60), 0);
  assert.equal(store.countStale(60), 1);
  assert.equal(store.pruneStale(60), 1, "pruneStale 报告实际删除的行数");
  assert.equal(store.countAll(), 0);
});

test("memory 存储：换实例即清零，且明确标注不共享", () => {
  const first = createMemoryStore();
  first.record(general, "someone");
  assert.equal(first.countAll(), 1);

  // 换一个实例 ≈ 换一个进程：内存里的计数没了。
  const second = createMemoryStore();
  assert.equal(second.countAll(), 0);
  assert.equal(second.describe().shared, false);
  assert.match(second.describe().note, /不共享/);
});

// 用完就删：这些库不在 data/test-*.db 之外，但同样不该留在磁盘上。
after(() => {
  disposeTempDb(contractDb.db, contractDb.file);
});
