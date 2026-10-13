import { describe, expect, it, mock } from "bun:test";
import { handleFetch, type AppResolver } from "../fetch-handler";

type StubApp = ReturnType<AppResolver>;

// The app is injected instead of module-mocked: Bun keeps `mock.module` alive
// across test files, so stubbing ../app-instance here would rewrite the module
// namespace for every later file in the same run.
function createAppStub(handler: (request: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const resolveApp: AppResolver = () =>
    ({
      fetch: async (request: Request) => {
        calls.push(request);
        return handler(request);
      },
    }) as unknown as StubApp;

  return { calls, resolveApp };
}

function createAssetEnv(assetFetch: (request: Request) => Promise<Response>) {
  return { ASSETS: { fetch: assetFetch } } as unknown as Env;
}

describe("handleFetch", () => {
  it("serves static assets directly when the asset exists", async () => {
    const { calls, resolveApp } = createAppStub(() => new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));

    const response = await handleFetch(
      new Request("http://localhost/assets/app.js"),
      createAssetEnv(assetFetch),
      resolveApp,
    );

    expect(await response.text()).toBe("asset-body");
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("routes sitemap.xml and robots.txt to the app before static assets", async () => {
    const { calls, resolveApp } = createAppStub(() => new Response("seo-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));

    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      const response = await handleFetch(
        new Request(`http://localhost${path}`),
        createAssetEnv(assetFetch),
        resolveApp,
      );

      expect(await response.text()).toBe("seo-body");
      expect(new URL(calls.at(-1)!.url).pathname).toBe(path);
    }

    // Crawler documents must never be answered by the static asset bucket.
    expect(assetFetch).toHaveBeenCalledTimes(0);
  });

  it("routes /api/blob requests to the app before static assets", async () => {
    const { calls, resolveApp } = createAppStub(() => new Response("blob-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("asset-body", { status: 404 }));

    const response = await handleFetch(
      new Request("http://localhost/api/blob/images/test.txt"),
      createAssetEnv(assetFetch),
      resolveApp,
    );

    expect(await response.text()).toBe("blob-body");
    expect(calls).toHaveLength(1);
    expect(assetFetch).toHaveBeenCalledTimes(0);
    expect(new URL(calls[0].url).pathname).toBe("/blob/images/test.txt");
  });

  it("falls back to the built-in greeting when no asset matches", async () => {
    const { calls, resolveApp } = createAppStub(() => new Response("app-body", { status: 200 }));
    const assetFetch = mock(async () => new Response("nope", { status: 404 }));

    const response = await handleFetch(
      new Request("http://localhost/plain-text"),
      createAssetEnv(assetFetch),
      resolveApp,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hi");
    expect(calls).toHaveLength(0);
  });

  it("answers a missing locale file with 404 instead of the SPA entry", async () => {
    // 只有 zh-CN/zh-TW/en/ja 四个语言包；浏览器语言为裸 zh 时就会打到这个不存在的路径。
    // 退回 index.html 会让 i18next 拿到 200 的 HTML 去 JSON.parse，故障被伪装成加载成功。
    const { calls, resolveApp } = createAppStub(() => new Response("app-body", { status: 200 }));
    const assetFetch = mock(async (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === "/"
        ? new Response("<!DOCTYPE html>", { status: 200 })
        : new Response("nope", { status: 404 });
    });

    const response = await handleFetch(
      new Request("http://localhost/locales/zh/translation.json"),
      createAssetEnv(assetFetch),
      resolveApp,
    );

    expect(response.status).toBe(404);
    // 只查过一次资源桶，没有被 SPA 兜底再查一次 index.html。
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
  });

  it("still serves an existing locale file and keeps SPA fallback for routes", async () => {
    const { resolveApp } = createAppStub(() => new Response("app-body", { status: 200 }));
    const assetFetch = mock(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/locales/zh-CN/translation.json") {
        return new Response("{}", { status: 200 });
      }
      if (path === "/") return new Response("<!DOCTYPE html>", { status: 200 });
      return new Response("nope", { status: 404 });
    });

    const hit = await handleFetch(
      new Request("http://localhost/locales/zh-CN/translation.json"),
      createAssetEnv(assetFetch),
      resolveApp,
    );
    expect(hit.status).toBe(200);
    expect(await hit.text()).toBe("{}");

    // SPA 路由兜底不受影响：无点路径仍然拿 index.html。
    const spa = await handleFetch(
      new Request("http://localhost/some/client/route"),
      createAssetEnv(assetFetch),
      resolveApp,
    );
    expect(spa.status).toBe(200);
    expect(await spa.text()).toBe("<!DOCTYPE html>");
  });
});
