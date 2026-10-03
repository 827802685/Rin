import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createIsolatedApp } from "./helpers/isolated-app.js";
import { parseTrustProxy } from "../src/lib/trust-proxy.js";
import { normalizeIp, clientSubject } from "../src/lib/client-ip.js";
import { hashIp } from "../src/lib/ip.js";

/**
 * 反向代理支持：客户端地址到底被解析成谁。
 *
 * 断言走 `GET /health` 的 `clientIp` 字段——它是唯一直接暴露解析结果的端点，
 * 也是「我配的 TRUST_PROXY 到底生效了没有」的现场证据。
 *
 * 为什么在同一个 app 上改 `app.set("trust proxy", ...)`：
 * 配置项是进程级只读的（ESM 模块一旦导入就固化），一个测试文件只能有一种配置。
 * 而 Express 的 `trust proxy` setter 会即时重算解析函数，
 * 于是同一个进程里就能逐个验证 off / 1 跳 / 2 跳 / all 四种口径。
 */

// ---------- 1. 纯函数：配置解析 ----------

test("未配置 / off / 0 一律不信任代理", () => {
  for (const raw of ["", "false", "off", "no", "0"]) {
    const parsed = parseTrustProxy(raw);
    assert.equal(parsed.enabled, false, `${raw} 应当解析为不信任`);
    assert.equal(parsed.value, false);
    assert.equal(parsed.mode, "off");
  }
  assert.equal(parseTrustProxy(undefined).enabled, false);
});

test("true / on 解析为信任最左侧", () => {
  for (const raw of ["true", "on", "yes", "all"]) {
    const parsed = parseTrustProxy(raw);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.value, true);
    assert.equal(parsed.mode, "all");
  }
});

test("数字解析为跳数", () => {
  const parsed = parseTrustProxy("2");
  assert.equal(parsed.value, 2);
  assert.equal(parsed.mode, "hops");
  assert.match(parsed.label, /2 跳/);
});

test("逗号分隔列表解析为可信地址（支持 IP / CIDR / 关键字）", () => {
  const parsed = parseTrustProxy("127.0.0.1, 10.0.0.0/8, loopback");
  assert.equal(parsed.mode, "list");
  assert.deepEqual(parsed.value, ["127.0.0.1", "10.0.0.0/8", "loopback"]);

  const single = parseTrustProxy("10.0.0.1");
  assert.equal(single.value, "10.0.0.1", "只有一个地址时不必包成数组");
});

test("越界或非法取值直接抛错，不带着错误配置启动", () => {
  assert.equal(parseTrustProxy("0").enabled, false, "0 等于关闭，不是越界");
  assert.throws(() => parseTrustProxy("33"), /必须在 1-32/);
  assert.throws(() => parseTrustProxy("999.999.999.999"), /不是合法的 IP/);
  assert.throws(() => parseTrustProxy("10.0.0.0/99"), /不是合法的 IP/);
  assert.throws(() => parseTrustProxy("随便写的"), /不是合法的 IP/);
  assert.throws(() => parseTrustProxy(","), /无法解析/);
});

test("IPv6 与 IPv6 CIDR 可以写进可信列表", () => {
  assert.equal(parseTrustProxy("fd00::/8").mode, "list");
  assert.equal(parseTrustProxy("2001:db8::1").mode, "list");
  assert.throws(() => parseTrustProxy("2001:db8::1/999"), /不是合法的 IP/);
});

// ---------- 2. 应用行为：四种口径 ----------

const { app } = await createIsolatedApp({
  tag: "trust-proxy",
  withSeed: true,
  // 额度给足：本文件只关心「算成哪个来源」，不想被限流打断。
  env: { TRUST_PROXY: "1", CSRF_ENABLED: "false", RATE_LIMIT_MAX: "500" },
});

/** 按给定的 trust proxy 设置请求一次健康检查，返回解析出的客户端地址。 */
async function ipUnder(setting, forwardedFor) {
  app.set("trust proxy", setting);
  const req = request(app).get("/health");
  if (forwardedFor !== null) {
    req.set("X-Forwarded-For", forwardedFor);
  }
  const res = await req;
  assert.equal(res.status, 200);
  return res.body.clientIp;
}

test("应用按配置设置 trust proxy（配置与框架之间的那根线）", async () => {
  const { createApp } = await import("../src/app.js");
  const fresh = createApp();
  // 本文件的 TRUST_PROXY=1；漏掉 app.set 时这里会拿到 false，
  // 而下面那些显式设置 trust proxy 的用例反而照样能过——这条断言就是补这个洞的。
  assert.equal(fresh.get("trust proxy"), 1);
});

test("不信任代理时忽略 X-Forwarded-For", async () => {
  assert.equal(await ipUnder(false, "203.0.113.9"), "127.0.0.1");
});

test("一层代理配 1 跳：取到 XFF 里的真实客户端", async () => {
  // 语义（与 proxy-addr 实现一致，别凭直觉写断言）：
  // 地址序列是 [TCP 对端, XFF 从右往左第 1 个, 第 2 个, ...]，
  // 「信任 n 跳」= 取第 n 个。n 层代理就要配 n，XFF 里有 n 段，取到最左的真实客户端。
  assert.equal(await ipUnder(1, "203.0.113.9"), "203.0.113.9");
});

test("两级代理只配 1 跳：取到的是中间代理而不是客户端", async () => {
  // 这正是「跳数配错」的现场表现：页面能开、日志正常，但所有人都被记成同一个地址。
  assert.equal(await ipUnder(1, "203.0.113.9, 198.51.100.7"), "198.51.100.7");
});

test("两级代理配 2 跳：取到最左侧的真实客户端", async () => {
  assert.equal(await ipUnder(2, "203.0.113.9, 198.51.100.7"), "203.0.113.9");
});

test("跳数模式下客户端自己加的一段 XFF 骗不到身份", async () => {
  // 攻击者伪造一个「更左」的地址；跳数只认第 n 个，多出来的那段被忽略。
  assert.equal(await ipUnder(2, "1.1.1.1, 203.0.113.9, 198.51.100.7"), "203.0.113.9");
});

test("TRUST_PROXY=true 时最左侧说了算，因此可被伪造（文档化的已知风险）", async () => {
  assert.equal(await ipUnder(true, "1.1.1.1, 203.0.113.9"), "1.1.1.1");
});

test("只信任可信列表里的代理地址", async () => {
  // 列表必须包含 TCP 对端（本机回环）与代理地址，缺一个就解析不到客户端。
  assert.equal(
    await ipUnder(["loopback", "10.0.0.1"], "203.0.113.9, 10.0.0.1"),
    "203.0.113.9",
  );
  // 少了 TCP 对端：最左侧的代理被当成不可信，取到的仍然是本机地址。
  assert.equal(await ipUnder(["10.0.0.1"], "203.0.113.9, 10.0.0.1"), "127.0.0.1");
});

test("健康检查同时报告本实例的运行形态", async () => {
  app.set("trust proxy", 1);
  const res = await request(app).get("/health");
  assert.equal(res.body.status, "ok");
  assert.ok(res.body.instanceId, "多实例部署时靠它区分是哪个进程");
  assert.equal(res.body.trustProxy.enabled, true);
  assert.equal(res.body.rateLimit.store, "sqlite");
  assert.equal(res.body.rateLimit.shared, false, "默认落在主库，不是独立共享库");
});

// ---------- 3. 归一化：同一个来源只能有一个身份 ----------

test("IPv4 映射地址与 IPv6 回环归一化成同一个来源", () => {
  assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::1"), "127.0.0.1");
  assert.equal(normalizeIp("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp(""), "unknown");

  // 双栈监听下同一个浏览器可能被记成两种形态，归一化后必须是同一个身份，
  // 否则一个人能拿到双倍额度。
  const ipv4 = clientSubject({ ip: "127.0.0.1" });
  assert.equal(clientSubject({ ip: "::ffff:127.0.0.1" }), ipv4);
  assert.equal(clientSubject({ ip: "::1" }), ipv4);
  // 完全拿不到地址时退化成一个固定的匿名身份（而不是 undefined 之类的随机值）。
  assert.equal(clientSubject({}), hashIp("unknown"));
});
