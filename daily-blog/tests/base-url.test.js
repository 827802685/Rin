import test from "node:test";
import assert from "node:assert/strict";
import { joinUrl, resolveBaseUrl } from "../src/lib/base-url.js";

/** 造一个最小可用的 req：只需要 get(name) 与 protocol。 */
function fakeReq(host, protocol = "http", forwarded = undefined) {
  return {
    protocol,
    get(name) {
      if (name === "host") {
        return host;
      }
      if (name === "x-forwarded-proto") {
        return forwarded;
      }
      return undefined;
    },
  };
}

test("joinUrl 不会产生双斜杠或漏斜杠", () => {
  assert.equal(joinUrl("https://example.com/", "/posts/a"), "https://example.com/posts/a");
  assert.equal(joinUrl("https://example.com", "posts/a"), "https://example.com/posts/a");
  assert.equal(joinUrl("https://example.com", ""), "https://example.com");
});

test("配置了站点地址就一律以它为准", () => {
  const site = { baseUrl: "https://blog.example.com" };
  assert.equal(resolveBaseUrl(site, fakeReq("127.0.0.1:3000")), "https://blog.example.com");
  // 结尾斜杠要被去掉，否则会拼出 //posts 这种地址。
  assert.equal(resolveBaseUrl({ baseUrl: "https://blog.example.com/" }, null), "https://blog.example.com");
});

test("未配置时按可信的 Host 推断", () => {
  assert.equal(resolveBaseUrl({}, fakeReq("127.0.0.1:8080")), "http://127.0.0.1:8080");
  assert.equal(resolveBaseUrl({}, fakeReq("blog.example.com", "http", "https")), "https://blog.example.com");
});

test("伪造的 Host 头不会被拼进 canonical", () => {
  // Host 是客户端可控的：不校验直接拼接，攻击者就能把 canonical / RSS 链接指到任意站点。
  const injected = 'evil.example.com" onload="alert(1)';
  assert.equal(resolveBaseUrl({}, fakeReq(injected)), "http://127.0.0.1:3000");
  assert.equal(resolveBaseUrl({}, fakeReq("http://evil.example.com")), "http://127.0.0.1:3000");
  assert.equal(resolveBaseUrl({}, { get: () => undefined }), "http://127.0.0.1:3000");
});
