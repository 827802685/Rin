import test from "node:test";
import assert from "node:assert/strict";
import { testDbPath } from "./helpers/app.js";

const { hashPassword, verifyPassword, authService } =
  await import("../src/services/auth.service.js");
const { usersRepository } = await import("../src/repositories/users.repository.js");
const { sessionsRepository } = await import("../src/repositories/sessions.repository.js");
const { getDb } = await import("../src/db/index.js");

test("测试使用独立数据库，不与开发库混用", () => {
  assert.match(testDbPath, /data[\\/]test-\d+\.db$/);
  assert.doesNotMatch(testDbPath, /blog\.db$/);
});

test("hashPassword 生成的哈希包含参数且每次盐值不同", () => {
  const first = hashPassword("same-password");
  const second = hashPassword("same-password");

  assert.match(first, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(first, second, "相同密码两次哈希不应相同");
});

test("verifyPassword 只接受正确密码", () => {
  const hash = hashPassword("correct-horse");

  assert.equal(verifyPassword("correct-horse", hash), true);
  assert.equal(verifyPassword("correct-horse ", hash), false);
  assert.equal(verifyPassword("", hash), false);
});

test("verifyPassword 对非法或缺失的哈希返回 false 而不是抛错", () => {
  for (const value of ["", "plain-text", "scrypt$1$2$3", null, undefined, "bcrypt$abc"]) {
    assert.equal(verifyPassword("whatever", value), false);
  }
});

test("会话令牌以摘要形式落库，且明文不出现", () => {
  const user = usersRepository.findByUsername("admin");
  const { token, maxAgeSeconds } = authService.createSession({ userId: user.id });

  assert.ok(token.length >= 40);
  assert.equal(maxAgeSeconds, 2 * 60 * 60);

  const stored = getDb().prepare("SELECT id FROM admin_sessions").all().map((row) => row.id);
  assert.ok(stored.length > 0);
  assert.equal(stored.includes(token), false, "数据库中不应出现令牌明文");
});

test("resolveSession 能取回账号，destroySession 后立即失效", () => {
  const user = usersRepository.findByUsername("admin");
  const { token } = authService.createSession({ userId: user.id, userAgent: "node:test" });

  const session = authService.resolveSession(token);
  assert.ok(session);
  assert.equal(session.user.username, "admin");
  assert.ok(session.expiresAt);

  assert.equal(authService.destroySession(token), 1);
  assert.equal(authService.resolveSession(token), null);
});

test("过期会话不被接受，且会被清理", () => {
  const user = usersRepository.findByUsername("admin");
  // 直接写入一条已过期的会话，模拟“签发后放到过期”的状态。
  getDb()
    .prepare(
      `INSERT INTO admin_sessions (id, user_id, user_agent, expires_at)
       VALUES (?, ?, ?, datetime('now', '-1 hours'))`,
    )
    .run("expired-session-hash", user.id, "node:test");

  assert.equal(sessionsRepository.findValidById("expired-session-hash"), undefined);

  sessionsRepository.deleteExpired();
  const remaining = getDb()
    .prepare("SELECT COUNT(*) AS total FROM admin_sessions WHERE id = ?")
    .get("expired-session-hash").total;
  assert.equal(remaining, 0);
});

test("非法令牌不会解析出会话", () => {
  for (const value of [null, undefined, "", "not-a-token", 42]) {
    assert.equal(authService.resolveSession(value), null);
  }
  assert.equal(authService.destroySession("not-a-token"), 0);
});
