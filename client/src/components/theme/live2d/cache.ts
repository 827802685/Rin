// Live2D 模型源探测与本地缓存（Service Worker 预缓存）。
import { BUILTIN_MODELS, MODEL_FILES_BY_NAME } from "./models";

//
// 保存模块加载时的"原生 fetch"引用。组件挂载/切换时会短暂替换 window.fetch（为模型
// 文件做流式进度统计 + Layout 注入，见 live2d-widget.tsx 的 installProgressTracker）。
// 后台预下载模型缓存若走被替换的 window.fetch，会把预下载字节也计进页面进度，导致
// 进度虚高到 100%+ 且预下载与当前绘制模型抢带宽（表现为"卡在100%但不渲染"）。
// 因此预缓存一律走原生 fetch，完全旁路进度统计与 Layout 注入。
const nativeFetch: typeof fetch = window.fetch;

// 模型根地址候选（按模型区分）。生产环境：
//  - BCSZ1.1 已随博客打包成静态资源（见 vite.config.ts rinLive2dBundledModel），
//    优先本域本地根，毫秒级、摆脱远端 CDN；
//  - furina 的 moc3 单文件约 95MB 超 Cloudflare Pages 25MiB 限制，无法打包，只能走
//    远端模型源。优先 dpdns 加速镜像（国内直连更快、更稳），失败回退 github.io 直连。
// dev 环境统一由 vite.config.ts 的 rinLive2dLocalCdn 中间件提供本地模型文件。
export const REMOTE_CDN_CANDIDATES = [
  "https://raw-githubusercontent-com-gh.zjkl0330.dpdns.org/827802685/Live2D/refs/heads/master/",
  "https://827802685.github.io/Live2D/",
] as const;

// 各模型优先使用的本地/打包根（非远端 CDN）。BCSZ1.1 生产走随博客分发的打包根。
// 仅对内置模型生效；自定义模型不看根，直接用其配置 url（在 switchModel/prefetch 中另行处理）。
export function bundledRootFor(name: string): string {
  // furina-mini 走远端根（与引擎同仓库，全套仅约 2.4MB），本地不打包
  if (name === "furina-mini") return "";
  if (import.meta.env.DEV) return `${location.origin}/rin-live2d-cdn/`;
  return `${location.origin}/live2d-bundled/`;
}

// 模型资源目录。目录结构并不统一，拼错就是 404、缓存永远空：
//   - furina-mini（自研渲染器）：<root>furina-mini/ 直接放 js/bin/webp，没有 index.json；
//   - Cubism 模型：<root>model/<name>/ 下按 index.json 的 FileReferences 组织。
// 预取、预缓存、渲染器加载三处必须共用这一个口径，否则「明明缓存过、切换还在下载」。
export function modelAssetBase(root: string, name: string): string {
  if (name === "furina-mini") return `${root}furina-mini/`;
  return `${root}model/${name}/`;
}

// 上次探测成功的根记在 sessionStorage：同一会话里再切模型不必从头试一遍候选，
// 少一次（远端甚至要超时的）探测往返。命中记忆根后仍会做一次轻量校验，失败照旧回退。
const ROOT_MEMO_PREFIX = "rin.live2d.root:";

function readRootMemo(name: string): string {
  try {
    return sessionStorage.getItem(ROOT_MEMO_PREFIX + name) ?? "";
  } catch {
    return "";
  }
}

function writeRootMemo(name: string, root: string): void {
  try {
    sessionStorage.setItem(ROOT_MEMO_PREFIX + name, root);
  } catch {
    // ignore
  }
}

// 给渲染分支用的公开接口：furina-mini 的脚本加载要按"上次成功的根"优先，
// 否则每次切到它都会先撞一遍 dpdns 镜像的 MIME 错误。
export const readMemoizedRoot = readRootMemo;
export const rememberRoot = writeRootMemo;

// 单个根的可用性探测：furina-mini 的根下没有 model_list.json（自研渲染器的资源
// 平铺在 furina-mini/ 目录里），所以按"该根是否真有目标模型"来探，而不是按清单文件。
async function probeRoot(root: string, name: string): Promise<boolean> {
  const url =
    name === "furina-mini" ? `${root}furina-mini/furina-mini.js` : `${root}model_list.json`;
  try {
    const res = await fetch(url, { mode: "cors" });
    return res.ok;
  } catch {
    return false;
  }
}

// 探测可用的模型源：按目标模型组装候选根（本地/打包根优先），
// 依次请求探测 URL，返回第一个可用的根地址。
export async function pickCdnRoot(name: string): Promise<string> {
  const localRoot = bundledRootFor(name);
  const candidates = [...(localRoot ? [localRoot] : []), ...REMOTE_CDN_CANDIDATES];
  // 记忆根提到候选首位（仍要探测：换个网络环境它可能就挂了）
  const memo = readRootMemo(name);
  const ordered =
    memo && candidates.includes(memo) ? [memo, ...candidates.filter((r) => r !== memo)] : candidates;
  for (const root of ordered) {
    if (await probeRoot(root, name)) {
      writeRootMemo(name, root);
      return root;
    }
  }
  return ordered[0];
}

// 探测到模型根地址后立即并行预取当前模型的核心文件（moc3/贴图），
// 不等插件脚本加载；插件稍后请求同一 URL 时命中浏览器/SW 缓存。
export function prefetchModel(cdnRoot: string, name: string) {
  const base = modelAssetBase(cdnRoot, name);
  const files = MODEL_FILES_BY_NAME[name] ?? [];
  for (const file of files) {
    fetch(`${base}${file}`, { mode: "cors" }).catch(() => {
      // 预取失败不阻塞主流程
    });
  }
}

// 从模型的 index.json（FileReferences）递归收集全部资源文件的相对路径。
function collectModelFiles(manifest: unknown, out: Set<string>): void {
  if (Array.isArray(manifest)) {
    for (const item of manifest) collectModelFiles(item, out);
    return;
  }
  if (manifest && typeof manifest === "object") {
    for (const value of Object.values(manifest as Record<string, unknown>)) {
      collectModelFiles(value, out);
    }
    return;
  }
  if (
    typeof manifest === "string" &&
    /\.(moc3|model3\.json|png|jpe?g|webp|motion3\.json|physics3\.json|cdi3\.json|exp3\.json|wav|mp3)$/i.test(manifest)
  ) {
    out.add(manifest);
  }
}

// 通过 Service Worker 的 CACHE_LIVE2D 消息，把一批 URL 下载并写入本地 Cache Storage。
// 若 SW 尚未控制页面，则回退为普通 fetch（SW 的 fetch 拦截兜底也会把模型写入缓存）。
function sendCacheMessage(urls: string[]): void {
  try {
    const controller = navigator.serviceWorker?.controller;
    if (controller) {
      controller.postMessage({ type: "CACHE_LIVE2D", urls });
    }
  } catch {
    // SW 不可用则不强制
  }
}

// 对给定模型整目录预缓存：拉取 index.json → 收集全部文件 → 写入本地缓存。
// 不依赖固定文件表，能覆盖贴图/动作/物理/口型等所有资源，真正做到"下载一次不再重下"。
// 一律走 nativeFetch：旁路进度统计与 Layout 注入，避免干扰当前模型的下载进度。
//
// furina-mini 没有 index.json（自研渲染器的资源是固定四件套），走 MODEL_FILES_BY_NAME；
// 其余模型按 index.json 递归收集。两者最终都归一成 URL 列表写进 Cache Storage。
async function precacheModel(cdnRoot: string, name: string): Promise<void> {
  try {
    const base = modelAssetBase(cdnRoot, name);
    const listed = MODEL_FILES_BY_NAME[name];
    const urls: string[] = [];
    if (listed) {
      for (const f of listed) urls.push(`${base}${f}`);
    } else {
      const index = await nativeFetch(`${base}index.json`, { mode: "cors" });
      if (!index.ok) return;
      const manifest = (await index.json()) as { FileReferences?: unknown };
      const files = new Set<string>();
      collectModelFiles(manifest, files);
      for (const f of files) urls.push(`${base}${f}`);
    }
    if (urls.length === 0) return;
    if (navigator.serviceWorker?.controller) {
      sendCacheMessage(urls);
    } else {
      // SW 未控制：普通 fetch 预取（生产环境 SW 的 fetch 拦截会把这些响应回写缓存）
      await Promise.allSettled(urls.map((u) => nativeFetch(u, { mode: "cors" })));
    }
  } catch {
    // 预缓存失败不影响主流程
  }
}

// 首次进入后，后台并行预缓存内置模型（furina 远端 + BCSZ1.1 本地）。
// 每个模型用各自最优根（BCSZ→打包根，furina→远端 CDN）。
// 清单只维护在 live2d/models.ts 的 BUILTIN_MODELS，此处不再重复枚举。
// includeRemoteLarge=false（widget.live2d.preload 关闭时）：跳过只能走远端的大模型
// （furina moc3 约 95MB），不提前占用带宽与磁盘；当前展示模型仍会正常下载。
export function precacheAllModels(includeRemoteLarge = true): void {
  const jobs = BUILTIN_MODELS.filter(
    (name) => includeRemoteLarge || bundledRootFor(name) !== "",
  ).map(async (name) => {
    try {
      const root = await pickCdnRoot(name);
      await precacheModel(root, name);
    } catch {
      // ignore
    }
  });
  void Promise.allSettled(jobs);
}

// ---- 缓存状态（设置页展示 / 手动管理） ----
// 与 sw.js 的 CACHE_NAME 保持一致：版本不同则读写的是两个桶，页面看不到 SW 写的内容。
export const LIVE2D_CACHE_NAME = "rin-live2d-v4";

export type ModelCacheStats = {
  // 缓存条目数（每个文件一条）
  count: number;
  // 命中 MIME 里的 Content-Length 求和，拿不到长度时按 0 计
  bytes: number;
  // 分模型的条目数，用于界面判断"哪个模型已经下好了"
  perModel: Record<string, number>;
};

// 统计当前 Cache Storage 里的模型缓存。页面与 SW 同源，直接读即可。
export async function getModelCacheStats(): Promise<ModelCacheStats> {
  const out: ModelCacheStats = { count: 0, bytes: 0, perModel: {} };
  try {
    const cache = await caches.open(LIVE2D_CACHE_NAME);
    const requests = await cache.keys();
    out.count = requests.length;
    for (const req of requests) {
      const url = req.url;
      const model = BUILTIN_MODELS.find((n) => url.includes(modelAssetBase("", n)));
      if (model) out.perModel[model] = (out.perModel[model] ?? 0) + 1;
      const res = await cache.match(req, { ignoreVary: true });
      const len = Number(res?.headers.get("content-length") ?? 0);
      if (Number.isFinite(len)) out.bytes += len;
    }
  } catch {
    // 无 Cache Storage（隐私模式等）：返回全零
  }
  return out;
}

// 清空模型缓存（含历史版本桶），下次进入会重新下载。
export async function clearModelCache(): Promise<void> {
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith("rin-live2d")).map((k) => caches.delete(k)),
    );
  } catch {
    // ignore
  }
}

// 手动"立即下载全部模型"：无视 preload 开关，强制把范围兜底打开。
export function downloadAllModels(): void {
  precacheAllModels(true);
}
