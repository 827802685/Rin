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
  if (name === "furina") return "";
  if (import.meta.env.DEV) return `${location.origin}/rin-live2d-cdn/`;
  return `${location.origin}/live2d-bundled/`;
}

// 探测可用的模型源：按目标模型组装候选根（本地/打包根优先），
// 依次请求该根下的 model_list.json，返回第一个能正常返回模型清单的根地址。
export async function pickCdnRoot(name: string): Promise<string> {
  const localRoot = bundledRootFor(name);
  const candidates = [...(localRoot ? [localRoot] : []), ...REMOTE_CDN_CANDIDATES];
  for (const root of candidates) {
    try {
      const res = await fetch(`${root}model_list.json`, { mode: "cors" });
      if (res.ok) {
        // 根可达即可（切换按 name 直接拼 index.json，不依赖 model_list 的下标/content）
        return root;
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return candidates[0];
}

// 探测到模型根地址后立即并行预取当前模型的核心文件（moc3/贴图），
// 不等插件脚本加载；插件稍后请求同一 URL 时命中浏览器/SW 缓存。
export function prefetchModel(cdnRoot: string, name: string) {
  const base = `${cdnRoot}model/${name}/`;
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
async function precacheModel(cdnRoot: string, name: string): Promise<void> {
  try {
    const index = await nativeFetch(`${cdnRoot}model/${name}/index.json`, { mode: "cors" });
    if (!index.ok) return;
    const manifest = (await index.json()) as { FileReferences?: unknown };
    const files = new Set<string>();
    collectModelFiles(manifest, files);
    if (files.size === 0) return;
    const base = `${cdnRoot}model/${name}/`;
    const urls = [...files].map((f) => `${base}${f}`);
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

// 首次进入后，后台并行预缓存所有内置模型（furina 远端 + BCSZ1.1 本地）。
// 每个模型用各自最优根（BCSZ→打包根，furina→远端 CDN）。
// 清单只维护在 live2d/models.ts 的 BUILTIN_MODELS，此处不再重复枚举。
export function precacheAllModels(): void {
  const jobs = BUILTIN_MODELS.map(async (name) => {
    try {
      const root = await pickCdnRoot(name);
      await precacheModel(root, name);
    } catch {
      // ignore
    }
  });
  void Promise.allSettled(jobs);
}
