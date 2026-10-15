// 看板娘「插件引擎」（waifu.css / waifu-tips.js / 渲染器 chunk / Cubism core）的来源解析。
//
// 为什么不再只认 github.io：这 7 个文件决定看板娘是否存在——远端不通时整个挂件不出现，
// 而对国内读者 github.io 经常连不上。构建时它们被镜像进本站产物（见 client/vite.config.ts
// 的 rinLive2dEngine），运行时先探同源、取不到再回退远端。
// 模型大文件不在这里，那套根候选见 live2d/cache.ts。
//
// 本模块顶层不碰任何浏览器 API：vite.config.ts 会在 Node 侧 import 这些常量。

export const REMOTE_ENGINE_DIST = "https://827802685.github.io/Live2D/dist/";
export const LOCAL_ENGINE_DIST = "/live2d-widget/dist/";

// 需要镜像的文件（相对引擎根）。waifu-tips.js 里 import("./chunk/index2.js")，
// chunk 里又 import("../waifu-tips.js") —— 目录结构必须原样保留，否则模块解析断掉。
export const ENGINE_FILES = [
  "waifu.css",
  "waifu-tips.js",
  "waifu-tips.json",
  "live2d.min.js",
  "live2dcubismcore.min.js",
  "chunk/index.js",
  "chunk/index2.js",
] as const;

export type EnginePaths = {
  css: string;
  script: string;
  tips: string;
  cubism2: string;
  cubism5: string;
  chunk: string;
};

export function enginePathsFor(root: string): EnginePaths {
  const base = root.endsWith("/") ? root : `${root}/`;
  const at = (file: string) => `${base}${file}`;
  return {
    css: at("waifu.css"),
    script: at("waifu-tips.js"),
    tips: at("waifu-tips.json"),
    cubism2: at("live2d.min.js"),
    cubism5: at("live2dcubismcore.min.js"),
    chunk: at("chunk/index2.js"),
  };
}

export type EngineKind = "js" | "css" | "json";

const KIND_MIME: Record<EngineKind, RegExp> = {
  js: /java|ecma/i,
  css: /text\/css/i,
  json: /json/i,
};

// 响应是不是真资源。必须判 MIME：产物里缺文件时静态资源兜底会把 index.html 原样返回
// （状态 200），认下来就等于把一段 HTML 当 <script type=module> 加载 —— 看板娘直接消失，
// 而且比回退远端更难排查。
export function isEngineAssetResponse(
  res: { ok: boolean; status: number; headers: { get(name: string): string | null } },
  kind: EngineKind,
): boolean {
  if (!res.ok || res.status < 200 || res.status >= 300) return false;
  const type = res.headers.get("content-type") || "";
  return KIND_MIME[kind].test(type);
}

export type EngineCheck = (url: string, kind: EngineKind) => Promise<boolean>;

// 同源镜像可用性：主脚本 + 样式表都取到才算可用（少一个插件就是残缺的）。
// 探到不可用就停，不浪费请求。
export async function pickEngineRoot(options: {
  origin: string;
  check: EngineCheck;
}): Promise<string> {
  const local = enginePathsFor(`${options.origin}${LOCAL_ENGINE_DIST}`);
  const probes: [string, EngineKind][] = [
    [local.script, "js"],
    [local.css, "css"],
  ];
  for (const [url, kind] of probes) {
    let usable = false;
    try {
      usable = await options.check(url, kind);
    } catch {
      usable = false;
    }
    if (!usable) return REMOTE_ENGINE_DIST;
  }
  return `${options.origin}${LOCAL_ENGINE_DIST}`;
}

// 浏览器侧默认探测：no-store，避免兜底页被 HTTP 缓存/SW 缓存住后永远判成可用。
export const defaultEngineCheck: EngineCheck = async (url, kind) => {
  const res = await fetch(url, { cache: "no-store" });
  return isEngineAssetResponse(res, kind);
};

export function pickSameOriginEngineRoot(): Promise<string> {
  return pickEngineRoot({ origin: location.origin, check: defaultEngineCheck });
}
