import { afterEach, describe, expect, it, mock } from "bun:test";

const getAppFetch = mock();

mock.module("../app-instance", () => ({
  getApp: () => ({
    fetch: getAppFetch,
  }),
}));

describe("handleFetch", () => {
  afterEach(() => {
    getAppFetch.mockReset();
  });

  it("serves static assets directly when the asset exists", async () => {
    getAppFetch.mockResolvedValue(new Response("app-body", { status: 200 }));

    const { handleFetch } = await import("../fetch-handler");
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));

    const response = await handleFetch(
      new Request("http://localhost/assets/app.js"),
      {
        ASSETS: {
          fetch: assetFetch,
        },
      } as unknown as Env,
    );

    expect(await response.text()).toBe("asset-body");
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(getAppFetch).toHaveBeenCalledTimes(0);
  });

  it("routes sitemap.xml and robots.txt to the app before static assets", async () => {
    getAppFetch.mockImplementation(async () => new Response("seo-body", { status: 200 }));

    const { handleFetch } = await import("../fetch-handler");
    const assetFetch = mock(async () => new Response("asset-body", { status: 200 }));

    for (const path of ["/sitemap.xml", "/robots.txt"]) {
      const response = await handleFetch(new Request(`http://localhost${path}`), {
        ASSETS: { fetch: assetFetch },
      } as unknown as Env);

      expect(await response.text()).toBe("seo-body");
      expect(new URL(getAppFetch.mock.calls.at(-1)?.[0].url).pathname).toBe(path);
    }

    // Crawler documents must never be answered by the static asset bucket.
    expect(assetFetch).toHaveBeenCalledTimes(0);
  });

  it("routes /api/blob requests to the app before static assets", async () => {
    getAppFetch.mockResolvedValue(new Response("blob-body", { status: 200 }));

    const { handleFetch } = await import("../fetch-handler");
    const assetFetch = mock(async () => new Response("asset-body", { status: 404 }));

    const response = await handleFetch(
      new Request("http://localhost/api/blob/images/test.txt"),
      {
        ASSETS: {
          fetch: assetFetch,
        },
      } as unknown as Env,
    );

    expect(await response.text()).toBe("blob-body");
    expect(getAppFetch).toHaveBeenCalledTimes(1);
    expect(assetFetch).toHaveBeenCalledTimes(0);
    expect(new URL(getAppFetch.mock.calls[0][0].url).pathname).toBe("/blob/images/test.txt");
  });
});
