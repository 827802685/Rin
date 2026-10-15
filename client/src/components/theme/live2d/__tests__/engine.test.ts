import { describe, expect, it } from "vitest";
import {
  ENGINE_FILES,
  LOCAL_ENGINE_DIST,
  REMOTE_ENGINE_DIST,
  enginePathsFor,
  isEngineAssetResponse,
  pickEngineRoot,
} from "../engine";

// 只喂给判定函数一个最小的 Response 形状，不需要真 fetch
const res = (status: number, contentType: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Headers({ "content-type": contentType }),
});

describe("enginePathsFor", () => {
  it("把根地址拼成插件需要的六个资源 URL", () => {
    expect(enginePathsFor("https://cdn.example/dist/")).toEqual({
      css: "https://cdn.example/dist/waifu.css",
      script: "https://cdn.example/dist/waifu-tips.js",
      tips: "https://cdn.example/dist/waifu-tips.json",
      cubism2: "https://cdn.example/dist/live2d.min.js",
      cubism5: "https://cdn.example/dist/live2dcubismcore.min.js",
      chunk: "https://cdn.example/dist/chunk/index2.js",
    });
  });

  it("根地址缺尾斜杠时补齐", () => {
    expect(enginePathsFor("http://localhost:11499").script).toBe("http://localhost:11499/waifu-tips.js");
  });
});

describe("isEngineAssetResponse", () => {
  it("接受真正的 JS/CSS 资源（含大小写与带参数写法）", () => {
    expect(isEngineAssetResponse(res(200, "application/javascript"), "js")).toBe(true);
    expect(isEngineAssetResponse(res(200, "text/javascript; charset=utf-8"), "js")).toBe(true);
    expect(isEngineAssetResponse(res(200, "application/ecmascript"), "js")).toBe(true);
    expect(isEngineAssetResponse(res(200, "text/css"), "css")).toBe(true);
  });

  it("拒绝 SPA 兜底页与非 2xx", () => {
    // 产物里缺文件时，静态资源兜底会把 index.html 原样返回（状态仍是 200）。
    // 认下来就等于把一个 HTML 当 <script type=module> 加载，看板娘直接不出现。
    expect(isEngineAssetResponse(res(200, "text/html; charset=utf-8"), "js")).toBe(false);
    expect(isEngineAssetResponse(res(404, "application/javascript"), "js")).toBe(false);
    expect(isEngineAssetResponse(res(200, "text/html"), "css")).toBe(false);
  });

  it("JSON 资源按 JSON 判（waifu-tips.json 走同一条规则）", () => {
    expect(isEngineAssetResponse(res(200, "application/json"), "json")).toBe(true);
    expect(isEngineAssetResponse(res(200, "text/html"), "json")).toBe(false);
  });
});

describe("pickEngineRoot", () => {
  it("同源镜像可用时用同源根", async () => {
    const root = await pickEngineRoot({ origin: "https://blog.example", check: async () => true });
    expect(root).toBe(`https://blog.example${LOCAL_ENGINE_DIST}`);
  });

  it("同源取不到时回退远端 github.io", async () => {
    const root = await pickEngineRoot({ origin: "https://blog.example", check: async () => false });
    expect(root).toBe(REMOTE_ENGINE_DIST);
  });

  it("探测抛错（离线/被拦）也回退远端，不让看板娘直接消失", async () => {
    const root = await pickEngineRoot({
      origin: "https://blog.example",
      check: async () => {
        throw new Error("offline");
      },
    });
    expect(root).toBe(REMOTE_ENGINE_DIST);
  });

  it("主脚本可用但样式表取不到时也回退远端（插件缺样式一样残）", async () => {
    const asked: string[] = [];
    await pickEngineRoot({
      origin: "https://blog.example",
      check: async (url) => {
        asked.push(url);
        return !url.endsWith("waifu.css");
      },
    });
    expect(asked).toEqual([
      `https://blog.example${LOCAL_ENGINE_DIST}waifu-tips.js`,
      `https://blog.example${LOCAL_ENGINE_DIST}waifu.css`,
    ]);
  });

  it("主脚本取不到时不再探样式表（直接回退远端）", async () => {
    const asked: string[] = [];
    await pickEngineRoot({
      origin: "https://blog.example",
      check: async (url) => {
        asked.push(url);
        return !url.endsWith("waifu-tips.js");
      },
    });
    expect(asked).toEqual([`https://blog.example${LOCAL_ENGINE_DIST}waifu-tips.js`]);
  });
});

describe("ENGINE_FILES", () => {
  it("包含渲染器互相 import 的两个 chunk（目录结构不能改）", () => {
    expect(ENGINE_FILES).toContain("chunk/index.js");
    expect(ENGINE_FILES).toContain("chunk/index2.js");
    expect(ENGINE_FILES).toContain("waifu-tips.js");
    expect(ENGINE_FILES).toHaveLength(7);
  });
});
