/* rin-live2d Service Worker
 * 目的：把体积巨大的 Live2D 模型（moc3 / 贴图等，通常近百 MB）缓存进浏览器本地
 * Cache Storage，从而在重新进入页面时不再重复下载，实现“类手机本地缓存”的效果。
 *
 * 策略：cache-first。命中缓存直接返回（不进网络），未命中再从网络下载并回写缓存。
 * 仅缓存 Live2D 模型资源，不影响页面 navigations / API / 其它静态资源。
 */

const CACHE_NAME = "rin-live2d-v1";

// Live2D 模型资源的特征（默认走 GitHub 加速代理的 827802685/Live2D 仓库）
const MODEL_ORIGINS = [
  "raw-githubusercontent-com-gh.zjkl0330.dpdns.org",
  "827802685.github.io",
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
];

function isLive2dAsset(url) {
  const u = new URL(url);
  if (MODEL_ORIGINS.includes(u.host) && u.pathname.includes("/Live2D/")) {
    // 尽量只缓存模型文件，避免把无关页面缓存进来
    return /model\/furina\/|\.moc3$|\.model3\.json$|texture|\.png$|\.motion3\.json$|\.physics3\.json$|\.cdi3\.json$|\.exp3\.json$/.test(u.pathname);
  }
  return false;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // 清理旧版本缓存
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (!isLive2dAsset(url)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 命中缓存：直接返回（离线/重进均不重下）
      const cached = await cache.match(event.request, { ignoreVary: true });
      if (cached) {
        return cached;
      }
      // 未命中：网络下载 + 回写缓存
      try {
        const resp = await fetch(event.request);
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          // 异步回写，不阻塞响应返回
          cache.put(event.request, copy).catch(() => {});
        }
        return resp;
      } catch (e) {
        // 网络失败且有旧缓存则回退
        return cached || new Response("network error", { status: 503 });
      }
    })(),
  );
});

// 供页面手动触发缓存（例如首次加载后立即预取，避免下次进入才开始下载）
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CACHE_LIVE2D") {
    const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.all(
          urls.map(async (u) => {
            try {
              const resp = await fetch(u);
              if (resp.status === 200) cache.put(u, resp);
            } catch (e) {
              /* ignore */
            }
          }),
        );
      })(),
    );
    event.ports[0] && event.ports[0].postMessage({ ok: true });
  }
});