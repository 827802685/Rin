import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AIChatMessage } from "@rin/api";
import { client } from "../../app/runtime";
import { ClientConfigContext } from "../../state/config";
import {
  type ActionName,
  IDLE_EXPRESSIONS,
  clamp,
  getLive2dModel,
  isActionPlaying,
  patchModelForActions,
  playAction,
  stopAllMotions,
} from "./live2d/actions";
import { bundledRootFor, pickCdnRoot, precacheAllModels, prefetchModel } from "./live2d/cache";
import {
  capSubdelegateDpr,
  capSubdelegateFps,
  createDprCapWrapper,
  createPixelAlphaProbe,
  normalizeFpsCap,
  releaseDragSetDragging,
  takeOverDragSetDragging,
} from "./live2d/perf";
import {
  BUILTIN_MODELS,
  type CustomModel,
  allModelIds,
  chatPromptFor,
  parseCustomModels,
  progressTargetFor,
  resolveDefaultName,
} from "./live2d/models";
import { buildOverrideStyleCss, OVERRIDE_STYLE_ID } from "./live2d/override-style";
import { type ProgressState, formatProgressMb, progressPercent } from "./live2d/progress-format";
import { clampDragPosition, loadSavedPos, saveSavedPos } from "./live2d/saved-pos";
import {
  type SilhouetteRect,
  computeSilhouetteFit,
  measureSilhouette,
  supportsClipPath,
} from "./live2d/silhouette";
import {
  isEdgeRestEnabled,
  normalizeScale,
  parseLayoutConfig,
  widgetBoxSize,
} from "./live2d/widget-config";

/**
 * Live2D 看板娘组件 —— live2d-widget 插件接入版（复刻 Demo autoload.js）
 *
 * 渲染引擎：stevenjoezhang/live2d-widget（827802685 的 fork，暴露 window.initWidget），
 * 与 Demo（https://827802685.github.io/Live2D/）完全同源。
 *
 * 模块划分：
 *   - live2d/models.ts   模型清单唯一来源（内置 + 自定义模型、聊天人设）；
 *   - live2d/actions.ts  动作引擎（JS 参数动画）与模型实例捕获；
 *   - live2d/cache.ts    模型源探测与 Service Worker 预缓存；
 *   - live2d/widget-config.ts   组件配置归一化纯函数（scale/edge/layout/容器尺寸）；
 *   - live2d/progress-format.ts 下载进度百分比与 MB 文案的纯计算；
 *   - live2d/saved-pos.ts       拖动位置持久化与视口限位；
 *   - live2d/override-style.ts  插件覆盖样式（含 edgeRest 裁剪）的 CSS 串构建；
 *   - 本文件             插件加载/挂载、拖拽、聊天面板等有状态主流程。
 *
 * 交互（联动性）说明：
 *   - 鼠标移动：渲染器让模型眼睛/头部跟随光标（onDrag）；
 *   - 悬停身体：渲染器派发 live2d:hoverbody → 插件在 #waifu-tips 显示气泡；
 *   - 点击模型：渲染器播放 TapBody 动作/表情并派发 live2d:tapbody → 插件显示气泡；
 *   - 空闲/复制/切页：插件按 waifu-tips.json 定时显示气泡；
 *   - 换模型/摸一摸按钮：通过合成 pointerdown 触发模型真实动作 + showTips 显示自定义气泡。
 *
 * 与 Demo 的差异（为适配博客）：
 *   - 模型源：优先 dpdns 加速镜像（国内直连更快、更稳），失败自动回退 github.io 直连；
 *   - 隐藏插件自带的 #waifu-tool（工具列）与 #waifu-toggle（开关），交互交给 React 按钮；
 *   - 气泡复用插件的 #waifu-tips，仅重写样式贴合博客主题（蓝色气泡）；
 *   - 不加载 config-panel.js（参数面板），保持博客干净；
 *   - 渲染分辨率按 MAX_RENDER_DPR 封顶（HiDPI 屏上大模型卡顿的主要来源）；
 *   - 保留 React 外壳：文件夹拖拽、换模型/摸一摸/隐藏按钮、加载进度、错误提示。
 */

// 插件资源根目录（相对 waifu-tips.js 所在处）
const DIST = "https://827802685.github.io/Live2D/dist/";
const WIDGET_CSS = `${DIST}waifu.css`;
const WIDGET_SCRIPT = `${DIST}waifu-tips.js`;
const WIDGET_JSON = `${DIST}waifu-tips.json`;
const CUBISM2_PATH = `${DIST}live2d.min.js`;
const CUBISM5_PATH = `${DIST}live2dcubismcore.min.js`;
// 渲染器 chunk（AppDelegate 所在模块），用于捕获模型实例以驱动衣服/头发物理
const CHUNK_URL = `${DIST}chunk/index2.js`;

// 透明像素判定阈值：alpha 低于该值视为"透明区域"，点击透传给后面的元素。
// 同时用作轮廓测量的阈值（见 live2d/silhouette.ts）。
const CLICK_ALPHA_THRESHOLD = 16;

// 轮廓贴合会写进画布行内样式的属性（卸载/换模型时按这份清单清理）。
// -webkit-clip-path 是给只认前缀的老内核（iOS 13.0 及以下）的双写，两者同时生效。
const SILHOUETTE_STYLE_PROPS = ["width", "height", "left", "top", "clip-path", "-webkit-clip-path"] as const;
// 点击 vs 拖拽的判定阈值（像素）
const DRAG_START_THRESHOLD = 6;

// ---- 渲染分辨率封顶（性能） ----
// 渲染器画布物理分辨率 = clientWidth * devicePixelRatio，触摸坐标也统一乘
// devicePixelRatio（见 chunk/index2.js 的 resizeCanvas/onTouches*）。高分屏（dpr=2/3）
// 下片元开销成倍增长，是大模型卡顿的主要来源之一。对所有内部用到 devicePixelRatio
// 的渲染器方法，在调用期间把 window.devicePixelRatio 临时封顶为该值（画布尺寸与
// 坐标映射同步生效，模型视角/点击命中保持一致），调用结束立即还原，不影响页面其它部分。
// 两个落点缺一不可：原型层 capRendererDpr 管坐标，实例层 capSubdelegateDpr 管帧缓冲
//（实测只包原型时 dpr≈2.67 的机器上 300px 容器仍开成 800x800）。
const MAX_RENDER_DPR = 1.5;

// 我们挂出去的原型/实例方法带的标记，用来跨挂载识别"自己包过的"并避免叠包
type CapMarkedFunction = ((...args: unknown[]) => unknown) & {
  rinDprCap?: boolean;
  rinExpose?: boolean;
};

// initWidget 的配置结构（对应 stevenjoezhang/live2d-widget 的 dist/autoload.js）
type InitWidgetConfig = {
  waifuPath: string;
  cdnPath?: string;
  cubism2Path?: string;
  cubism5Path?: string;
  modelId?: number;
  logLevel?: string;
  drag?: boolean;
};
type WidgetLoader = (config: InitWidgetConfig) => void;

// 用于标记我们注入的 <link>/<script>，便于卸载时定向清理（尽量不误删页面其它资源）
const CSS_MARK = "rin-live2d-widget--css";
const SCRIPT_MARK = "rin-live2d-widget--script";

// ---------------------------------------------------------------------------
// 基础工具函数
// ---------------------------------------------------------------------------

// 判重式加载 <link rel="stylesheet">
function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLLinkElement>(
      `link[data-rin-live2d-widget="${CSS_MARK}"]`,
    );
    if (existing) {
      resolve();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.rinLive2dWidget = CSS_MARK;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load stylesheet ${href}`));
    document.head.appendChild(link);
  });
}

// 判重式加载 <script type="module">（waifu-tips.js 内含 export，必须按 module 注入）
function loadModuleScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-rin-live2d-widget="${SCRIPT_MARK}"]`,
    );
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)));
      }
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    script.dataset.rinLive2dWidget = SCRIPT_MARK;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// 复刻 Demo：把 window.Image 包一层默认 crossOrigin=anonymous。
// 模型贴图来自跨域 CDN，统一加 crossOrigin 避免纹理因跨域被 Canvas 污染/加载失败。
let originalImage: typeof window.Image | null = null;
function patchGlobalImage() {
  if (typeof window === "undefined" || originalImage) {
    return;
  }
  originalImage = window.Image;
  function PatchedImage(this: unknown, ...args: ConstructorParameters<typeof Image>) {
    const img = new (originalImage as typeof Image)(...args);
    img.crossOrigin = "anonymous";
    return img as typeof img;
  }
  PatchedImage.prototype = (originalImage as typeof Image).prototype;
  (window as unknown as { Image: typeof Image }).Image =
    PatchedImage as unknown as typeof Image;
}
function restoreGlobalImage() {
  if (originalImage) {
    (window as unknown as { Image: typeof Image }).Image = originalImage;
    originalImage = null;
  }
}

/**
 * 给渲染器做渲染分辨率封顶（坐标侧）：遍历 AppDelegate 原型上源码含 devicePixelRatio
 * 的方法，在其执行期间把 window.devicePixelRatio 临时替换为 min(真实值, MAX_RENDER_DPR)。
 * 画布物理分辨率的封顶不在这里——resizeCanvas 属于 subdelegate（实测类链 Cs），
 * 原型上没有这个名字，由就绪门控里的 capSubdelegateDpr 按实例补上。
 */
function capRendererDpr(proto: Record<string, unknown>): void {
  for (const key of Object.getOwnPropertyNames(proto)) {
    const value = proto[key] as CapMarkedFunction | undefined;
    if (typeof value !== "function") continue;
    // AppDelegate.prototype 是跨挂载共享的模块级对象：换模型、隐藏后再显示都会
    // 再跑一次 patchLive2dApp，跳过自己挂过的包装才不会让调用链逐层叠加。
    if (value.rinDprCap) continue;
    if (!value.toString().includes("devicePixelRatio")) continue;
    const wrapped = createDprCapWrapper(value, MAX_RENDER_DPR) as CapMarkedFunction;
    wrapped.rinDprCap = true;
    proto[key] = wrapped;
  }
}

/**
 * 预加载渲染器 chunk 并打补丁：把 AppDelegate 实例暴露到 window，
 * 以便直接调用 model.setDragging 驱动物理（衣服/头发飘动）。
 *
 * 插件内部 import("./chunk/index2.js") 与这里 import 的是同一 URL，
 * 浏览器模块缓存按 URL 共享，因此打补丁能作用到插件创建的实例上。
 * 必须在 initWidget 之前调用，否则实例已创建、补丁不生效。
 */
async function patchLive2dApp(): Promise<boolean> {
  try {
    const mod = (await import(/* @vite-ignore */ CHUNK_URL)) as {
      AppDelegate?: { prototype: Record<string, unknown> & { run?: (...args: unknown[]) => unknown } };
    };
    const proto = mod.AppDelegate?.prototype;
    if (!proto) {
      return false;
    }
    // 渲染分辨率封顶（HiDPI 性能）：覆盖原型上全部含 devicePixelRatio 的方法（坐标侧）。
    // 另外两个落点都不在这里：帧缓冲尺寸在 subdelegate.resizeCanvas（实例层，
    // 见 applyRenderCaps 里的 capSubdelegateDpr），帧率热点在 subdelegate.update
    //（实测循环入口 run 只调用一次，包它不影响帧率）。
    capRendererDpr(proto);
    const currentRun = proto.run as CapMarkedFunction | undefined;
    if (typeof currentRun === "function" && currentRun.rinExpose) {
      // 原型跨挂载共享，已经暴露过实例就不再包一层
      return true;
    }
    const origRun = proto.run as (...args: unknown[]) => unknown;
    const exposedRun = function (this: unknown, ...args: unknown[]) {
      (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp = this;
      // 兜底：监听 WebGL context lost，阻止默认行为（默认会导致上下文永久丢失），
      // 让浏览器有机会自动恢复。正常场景下隐藏用的是 visibility 方案不会触发，
      // 这里仅防止极端情况（GPU 重置/内存压力）下模型永久空白。
      const bindCtxGuard = () => {
        const canvas = document.getElementById("live2d");
        if (!canvas) return false;
        if (canvas.dataset.rinCtxGuard === "1") return true;
        canvas.dataset.rinCtxGuard = "1";
        canvas.addEventListener(
          "webglcontextlost",
          (e) => e.preventDefault(),
          false,
        );
        return true;
      };
      if (!bindCtxGuard()) {
        const timer = window.setInterval(() => {
          if (bindCtxGuard()) {
            window.clearInterval(timer);
          }
        }, 500);
      }
      return (origRun as (...a: unknown[]) => unknown).apply(this, args);
    } as CapMarkedFunction;
    exposedRun.rinExpose = true;
    proto.run = exposedRun;
    return true;
  } catch {
    return false;
  }
}

/**
 * 全局 fetch 包装：统计模型文件的下载字节数（流式计数，不缓冲整个文件）。
 *
 * 额外职责：
 *   - 对模型配置文件（index.json / .model3.json）注入 Layout（用于微调模型位置/缩放）；
 *   - 对同一 URL 的去重：预取与插件加载同一文件时只计一次字节数；
 *   - retarget()：换模型时原地换分母并清零分子（见下方 ProgressTracker 注释）。
 */
type ProgressTarget = {
  // 目标模型名；null 表示自定义模型（URL 认不出名字，退回"含 /model/ 即计"的老口径）
  name: string | null;
  // 分母（总字节）；0 表示未知，UI 只显示已下载量
  total: number;
};
type ProgressTracker = {
  restore: () => void;
  retarget: (next: ProgressTarget) => void;
};

function installProgressTracker(
  onProgress: (p: ProgressState) => void,
  initial: ProgressTarget,
  layoutConfig?: Record<string, number> | null,
): ProgressTracker {
  const state: ProgressState = { loaded: 0, total: initial.total };
  let target = initial;
  const origFetch = window.fetch.bind(window);
  // 已开始计数的 URL（同一文件只计一次，避免预取 + 插件加载重复计数）
  const countingUrls = new Set<string>();
  let rafPending = false;

  // 分子只统计"当前目标模型"的文件：换模型后旧模型的在途流、别的模型的预取都不该计进来
  // （否则会出现"73.8 / 5.6 MB"这种分子分母来自两个模型的读数）。
  const countsFor = (url: string) =>
    url.indexOf("/model/") !== -1 &&
    (!target.name || url.indexOf(`/model/${target.name}/`) !== -1);

  const notify = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      onProgress({ loaded: state.loaded, total: state.total });
    });
  };

  const wrapped: typeof window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url || "";
    // 只拦截模型文件请求（URL 含 /model/），其余请求原样放行
    if (!countsFor(url)) {
      return origFetch(input, init);
    }

    // 模型配置文件：注入 Layout（若配置了），文件很小无需进度统计
    if (layoutConfig && (url.endsWith("index.json") || url.endsWith(".model3.json"))) {
      return origFetch(input, init).then(async (resp) => {
        if (!resp) return resp;
        try {
          const data = (await resp.json()) as Record<string, unknown>;
          data.Layout = layoutConfig;
          return new Response(JSON.stringify(data), {
            status: resp.status,
            statusText: resp.statusText,
            headers: { "content-type": "application/json" },
          });
        } catch {
          return resp;
        }
      });
    }

    // 同一 URL 只计一次字节（预取与插件加载去重）
    if (countingUrls.has(url)) {
      return origFetch(input, init);
    }
    countingUrls.add(url);

    return origFetch(input, init).then(async (resp) => {
      if (!resp || !resp.body) return resp;
      const reader = resp.body.getReader();
      // 流式转发：边读边计数，不把整个文件缓冲进内存（避免 91MB moc3 导致内存暴涨/GC 卡顿）
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          (async () => {
            try {
              for (;;) {
                const r = await reader.read();
                if (r.done) {
                  controller.close();
                  break;
                }
                // 逐块复核：中途换模型时，旧模型的在途流继续转发但不再计数
                if (countsFor(url)) {
                  state.loaded += r.value.byteLength;
                  notify();
                }
                controller.enqueue(r.value);
              }
            } catch (err) {
              controller.error(err);
            }
          })();
        },
      });
      // 去掉压缩相关头，避免与已解码的流体积不一致
      const headers = new Headers(resp.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      return new Response(stream, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    });
  };

  window.fetch = wrapped;
  return {
    restore: () => {
      window.fetch = origFetch;
    },
    retarget: (next) => {
      target = next;
      state.total = next.total;
      state.loaded = 0;
      countingUrls.clear();
      notify();
    },
  };
}

// 读取画布上某点的像素 alpha（用于透明区域点击穿透）。
// 渲染器创建 WebGL 时开了 preserveDrawingBuffer:true，可直接读像素。
function readPixelAlpha(clientX: number, clientY: number): number {
  const canvas = document.getElementById("live2d") as HTMLCanvasElement | null;
  if (!canvas) return 255;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 255;
  const x = Math.round(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.round(((clientY - rect.top) / rect.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return 255;
  const gl = (canvas.getContext("webgl2") ||
    canvas.getContext("webgl")) as WebGLRenderingContext | WebGL2RenderingContext | null;
  if (!gl) return 255;
  const pixel = new Uint8Array(4);
  try {
    // 确保读默认 framebuffer（画布），模型最终绘制在默认 framebuffer 上
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // WebGL 原点在左下角，需翻转 Y
    gl.readPixels(x, canvas.height - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  } catch {
    return 255;
  }
  return pixel[3];
}

// readPixels 只在 pointerdown 时发生（非逐帧轮询），但仍可能连点。
// 100ms 内、8px 邻近范围内复用上一次采样结果，省掉重复的同步 GPU 读回。
const probePixelAlpha = createPixelAlphaProbe(readPixelAlpha);

// 把点击透传给画布后面的元素（透明区域不挡后面的链接/按钮）
function passClickThrough(clientX: number, clientY: number, widget: HTMLElement | null) {
  if (!widget) return;
  const prev = widget.style.pointerEvents;
  widget.style.pointerEvents = "none";
  let el: Element | null = null;
  try {
    el = document.elementFromPoint(clientX, clientY);
  } finally {
    widget.style.pointerEvents = prev;
  }
  if (!el || widget.contains(el)) return;
  // 派发可冒泡的 click，触发 React onClick / 链接默认行为
  el.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
    }),
  );
}

// 拖动位置持久化与 Layout/配置解析等同目录纯函数模块，
// 见 live2d/saved-pos.ts、live2d/widget-config.ts。

export function Live2DWidget() {
  const config = useContext(ClientConfigContext);
  // 长生命周期 effect（挂载 effect 的 deps 是 [modelVersion]）里读配置必须走这个镜像：
  // 设置保存后 Provider 换成新的 ConfigWrapper 实例，闭包捕获的旧实例持的是快照，
  // 读不到刚保存的值（实测「帧率上限」保存后不生效）。
  const configRef = useRef(config);
  configRef.current = config;
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  // 当前模型的不透明包围盒（比例），null = 未测到 / 无需贴合
  const [silhouette, setSilhouette] = useState<SilhouetteRect | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [dragging, setDragging] = useState(false);
  // 默认模型：配置项 widget.live2d.defaultModel（"furina" / "BCSZ1.1" / 自定义模型 id），
  // 非法值回退轻模型 BCSZ1.1（见 live2d/models.ts 的 resolveDefaultName）。必须在首次渲染
  // 就解析出正确值——加载 effect（deps [modelVersion]）
  // 闭包读取 activeModel 且只在挂载时运行一次，若放在 effect 里 setActiveModel，
  // 异步体拿到的仍是旧闭局值（实测配置 BCSZ1.1 却静默加载远端 furina 95MB）。
  // 配置在 React 挂载前已由 /api/config/client/bootstrap.js 同步注入，渲染期读取安全。
  const [activeModel, setActiveModel] = useState<string>(() =>
    resolveDefaultName(
      config.get("widget.live2d.defaultModel"),
      parseCustomModels(config.get("widget.live2d.customModels")),
    ),
  );
  // 自定义模型列表的 ref 镜像（渲染期间稳定引用；设置修改后经关键重载生效）
  const customModelsRef = useRef<CustomModel[]>(parseCustomModels(config.get("widget.live2d.customModels")));
  // 上一次"模型配置签名"，用于检测默认/自定义模型设置变化并触发重载
  const prevModelsSigRef = useRef<string | undefined>(undefined);
  // 回退用的模型版本号（仅当渲染器实例不可用时才重挂载组件）：
  // 切换模型时自增，作为外层 key 强制重挂载组件以加载新模型。
  const [modelVersion, setModelVersion] = useState(0);
  // 当前生效模型的 CDN 根地址（initWidget 探测成功后写入，供切换模型拼接 index.json）
  const cdnRootRef = useRef<string>("");
  // 进度统计句柄：换模型（不重挂载）时用它原地换分母 + 清零分子
  const progressTrackerRef = useRef<ProgressTracker | null>(null);
  // 渲染循环是否被"页面隐藏/失焦"暂停（恢复时只在暂停过的情况下才重启，避免双开循环）
  const renderLoopPausedRef = useRef(false);
  // 定时器组（就绪轮询 / 停滞兜底 / 空闲轮播）当前是否处于失焦暂停状态，
  // 用来保证 stop/start 严格配对、且只在模型就绪后发生
  const timersPausedRef = useRef(false);
  // 渲染"就绪门控"轮询的启动 / 停止句柄（首屏与切换模型共用，切换会复用同一个
  // WebGL 渲染器实例并重新轮询，彻底避免"重挂载组件 → 第二个 WebGL 上下文"的隐患）
  const readyPollStartRef = useRef<(() => void) | null>(null);
  const readyPollStopRef = useRef<(() => void) | null>(null);
  // 渲染封顶（帧缓冲分辨率 + 帧率）的重新应用句柄：模型就绪时由就绪门控调用，
  // 设置里改帧率数值时由下方 effect 调用
  const applyRenderCapsRef = useRef<(() => void) | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<AIChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const modelAreaRef = useRef<HTMLDivElement | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const tipsTimerRef = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const renderedRef = useRef(false);
  const lastProgressAtRef = useRef(Date.now());
  // 拖动状态镜像（ref 版，供动画帧读取）
  const draggingRef = useRef(false);
  // 拖动期间被接管的模型 setDragging 原函数（用于恢复与重置）
  const dragOrigSetDraggingRef = useRef<((x: number, y: number) => void) | null>(null);
  // 拖动指针速度（px/ms，归一化到 -1..1），用于驱动衣服重力飘动
  const dragVelocityRef = useRef({ x: 0, y: 0 });
  const lastMoveRef = useRef({ x: 0, y: 0, t: 0 });
  // 交互状态：拖拽 or 待判定点击穿透
  const interactionRef = useRef<{
    kind: "drag" | "pending";
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    clientX: number;
    clientY: number;
    moved: number;
  } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => loadSavedPos());
  // 视口尺寸：窄屏（竖屏手机）和矮屏（横屏手机、窗口化桌面）都要给页面让位
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const position = String(config.get("widget.live2d.position") ?? "right");
  // 防止配置被误调成超大值导致模型挡住整个页面：限制在安全范围内
  const scaleValue = normalizeScale(config.get("widget.live2d.scale"));
  // 趴在屏幕边缘模式：仅显示模型上半身，双手像趴在桌面一样搭在屏幕底部边缘
  const edgeRest = isEdgeRestEnabled(config.get("widget.live2d.edge"));
  // 颈部/位置微调：widget.live2d.layout（JSON），注入模型配置的 Layout 段
  const layoutConfig = parseLayoutConfig(String(config.get("widget.live2d.layout") ?? ""));

  // 模型容器尺寸：与插件 #waifu-canvas 的 300x300 一致，随配置缩放；窄屏按视口收缩
  const { width: boxW, height: boxH } = widgetBoxSize(scaleValue, viewport.width, viewport.height);

  // ---- 轮廓贴合：把人物放大到填满容器，命中区也跟着裁成人物那块矩形 ----
  // 不测就不知道留白有多大：实测 393px 视口里 177 见方的画布只有 99×134 是人物本体。
  // 包围盒是比例值，容器改尺寸（缩放配置 / 转屏）只重算样式，不必重新测量。
  // 不支持 clip-path 的内核直接跳过测量：反正不裁剪，读了像素也只能维持原样。
  const clipOk = useMemo(
    () => supportsClipPath(typeof CSS === "undefined" ? undefined : CSS),
    [],
  );
  useEffect(() => {
    setSilhouette(null);
    if (!rendered || !clipOk) return;
    let cancelled = false;
    let attempts = 0;
    const probe = () => {
      if (cancelled) return;
      const canvas = document.getElementById("live2d") as HTMLCanvasElement | null;
      const rect = canvas ? measureSilhouette(canvas, CLICK_ALPHA_THRESHOLD) : null;
      if (rect) {
        setSilhouette(rect);
        return;
      }
      // 刚 CompleteSetup 时可能还没提交过一帧（或整幅透明），稍后重试
      attempts += 1;
      if (attempts < 6) window.setTimeout(probe, 250);
    };
    probe();
    return () => {
      cancelled = true;
    };
  }, [rendered, clipOk, activeModel]);

  useEffect(() => {
    const canvas = document.getElementById("live2d");
    if (!canvas) return;
    // edgeRest 自带"放大 + 裁下半身"，两种模式互斥，不叠加
    const fit =
      edgeRest || !clipOk
        ? null
        : computeSilhouetteFit(silhouette, { width: boxW, height: boxH });
    const clip = fit
      ? `inset(${Math.round(fit.clip.top)}px ${Math.round(fit.clip.right)}px ${Math.round(fit.clip.bottom)}px ${Math.round(fit.clip.left)}px)`
      : "";
    const styles: Record<string, string> = fit
      ? {
          width: `${Math.round(fit.width)}px`,
          height: `${Math.round(fit.height)}px`,
          left: `${Math.round(fit.left)}px`,
          top: `${Math.round(fit.top)}px`,
          "clip-path": clip,
          "-webkit-clip-path": clip,
        }
      : {};
    for (const prop of SILHOUETTE_STYLE_PROPS) {
      const value = styles[prop];
      // 必须用「行内 !important」：插件初始化时会把 style.width 写成位图 px，我们的覆盖
      // 样式表也是 !important，只有行内 important 能同时压过这两处。
      if (value) canvas.style.setProperty(prop, value, "important");
      else canvas.style.removeProperty(prop);
    }
  }, [silhouette, boxW, boxH, edgeRest, clipOk, rendered, activeModel]);

  // 当前模型的展示名（内置模型用 i18n，自定义模型用其配置的角色名），
  // 供聊天面板标题/提示文案使用，保证人设与显示的模型一致。
  const activeDisplayName = (() => {
    const custom = customModelsRef.current.find((c) => c.id === activeModel);
    if (custom) return custom.name;
    const key = `theme.live2d.switch.${activeModel}`;
    const translated = t(key);
    return translated === key ? activeModel : translated;
  })();

  /**
   * 在插件的 #waifu-tips 气泡里显示一条消息（复刻插件内部 i() 的行为）。
   * 与插件自身的消息共用同一个元素，天然互斥：后显示的覆盖先显示的。
   */
  function showTips(text: string, duration = 4000) {
    const el = document.getElementById("waifu-tips");
    if (!el) {
      return;
    }
    // i18n 文案均为纯文本，用 textContent 注入，避免 HTML 注入隐患
    el.textContent = text;
    el.classList.add("waifu-tips-active");
    if (tipsTimerRef.current) {
      window.clearTimeout(tipsTimerRef.current);
    }
    tipsTimerRef.current = window.setTimeout(() => {
      el.classList.remove("waifu-tips-active");
      tipsTimerRef.current = null;
    }, duration);
  }

  // 在当前模型之间循环切换：点一下换模型按钮即在所有模型间循环（内置 furina/BCSZ1.1 +
  // 自定义模型），不做二级菜单。
  function switchToNextModel() {
    const ids = allModelIds(customModelsRef.current);
    const idx = ids.indexOf(activeModel);
    const next = ids[(idx + 1) % ids.length] ?? ids[0];
    switchModel(next);
  }

  /**
   * 切换看板娘模型。
   *
   * 首选方案：复用已就绪的 Cubism5 渲染器实例（plugin 已挂到 window.__rinLive2dApp，
   * 它来自 chunk/index2.js 的 AppDelegate），直接调用其 changeModel(index.json URL)。
   * 这是 live2d-widget 插件内部 loadModel 用的原生切换方式：模型 moc3/贴图/物理/动作
   * 由渲染器按 index.json 的 FileReferences 重新拉取，并复用同一个 WebGL 上下文渲染，
   * 不会产生第二个实例，也不依赖 model_list.json 的 models 下标（即使生产 CDN 的
   * model_list 尚未更新出新模型，只要 model/<name>/index.json 可访问就能切换）。
   *
   * 兜底方案：仅当渲染器实例尚未就绪时，才走"重挂载组件重新 initWidget"的老路径
   * （init 流程会按命中根的 model_list 重新解析 modelId，口径唯一）。
   */
  function switchModel(name: string) {
    // 内置模型存在 BUILTIN_MODELS，自定义模型在其配置表里
    const isBase = (BUILTIN_MODELS as readonly string[]).includes(name);
    const custom = customModelsRef.current.find((c) => c.id === name);
    if (!isBase && !custom) return;
    setActiveModel(name);
    // 进度口径跟着换目标：分母换成目标模型的字节、分子清零。快路径复用的是同一个
    // tracker（不重挂载加载 effect），不换就会「分子是新模型、分母是旧模型」。
    progressTrackerRef.current?.retarget(progressTargetFor(name));
    setProgress(null);
    showTips(t("theme.live2d.switch.switching"), 3000);

    const app = (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp;
    const canChange = app && typeof (app as { changeModel?: unknown }).changeModel === "function";
    // 渲染器就绪 → 复用实例直接换模型。内置模型按目标选根（BCSZ→打包根、furina→远端）；
    // 自定义模型直接用其配置的 .model3.json url 加载。
    if (canChange) {
      // 收起当前模型，显示加载态，等待新模型就绪后淡入
      renderedRef.current = false;
      setRendered(false);
      setError(null);
      document.getElementById("live2d")?.classList.remove("rin-live2d-ready");
      // 目标模型用自己的根加载（本地打包根与远端根不可互通）
      void (async () => {
        let indexUrl: string;
        if (custom) {
          // 自定义：直接用配置 url
          indexUrl = custom.url;
        } else {
          const root = await pickCdnRoot(name);
          cdnRootRef.current = root;
          indexUrl = `${root}model/${name}/index.json`;
        }
        try {
          (app as { changeModel: (u: string) => void }).changeModel(indexUrl);
          // 重新开启"就绪门控"轮询，等新模型 CompleteSetup 后淡入
          readyPollStartRef.current?.();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }
    // 兜底：渲染器还没就绪，退回重挂载组件重新 initWidget
    setModelVersion((v) => v + 1);
  }

  function petModel() {
    playAction("pet");
    const tips = [
      t("theme.live2d.talk.poke1"),
      t("theme.live2d.talk.poke2"),
      t("theme.live2d.talk.poke3"),
    ];
    showTips(tips[Math.floor(Math.random() * tips.length)], 3600);
  }

  function playCustomAction(name: ActionName) {
    playAction(name);
    const tipKey =
      name === "wave"
        ? t("theme.live2d.actions.tip.wave")
        : name === "shake"
          ? t("theme.live2d.actions.tip.shake")
          : t("theme.live2d.actions.tip.dance");
    showTips(tipKey, 3600);
    setShowActions(false);
  }

  /** 返回首页：导航到顶域根路径（同标签页，不新开窗口）。后续新增界面时仍回到根路径。 */
  function goHome() {
    setLocation("/");
  }

  /** 发送聊天消息：走设置里绑定的 AI（ai_summary 配置），注入当前模型的人设 */
  async function handleChatSend() {
    const content = chatInput.trim();
    if (!content || chatLoading) return;

    // 聊天记录只存 user/assistant 消息，system 提示词不进 chatMessages，
    // 否则会在聊天面板里把提示词显示成第一条气泡
    const userMsg: AIChatMessage = { role: "user", content };
    const nextDisplay: AIChatMessage[] = [...chatMessages, userMsg].slice(-20);
    setChatMessages(nextDisplay);
    setChatInput("");
    setChatLoading(true);
    setChatError(null);

    // 服务端有 30 条上限：system + 最近 20 条历史 + 新消息。
    // 人设跟随当前模型（内置模型各有人设，自定义模型带角色名生成）。
    const payload: AIChatMessage[] = [
      { role: "system", content: chatPromptFor(activeModel, customModelsRef.current) },
      ...nextDisplay,
    ];
    const { data, error } = await client.chat.send(payload);
    if (error) {
      setChatError(error.value || t("theme.live2d.chat.error"));
    } else if (data?.content) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
    } else {
      setChatError(t("theme.live2d.chat.error"));
    }
    setChatLoading(false);
  }

  // 聊天消息更新时自动滚到底部
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  // 点击模型/聊天面板之外的地方时收起聊天窗口
  useEffect(() => {
    if (!chatOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (outerRef.current && target && !outerRef.current.contains(target)) {
        setChatOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [chatOpen]);

  /**
   * 插件被加载后同步插入 #waifu（其内含 #waifu-canvas > canvas#live2d、#waifu-tips、#waifu-tool）。
   * 这里把它「请」进 React 的模型容器，使其随文件夹一起定位/缩放；同时隐藏插件自带的
   * #waifu-toggle（显示/隐藏交给 React 的 Hide 按钮）。
   */
  function adoptPluginDom() {
    const cage = modelAreaRef.current;
    const waifu = document.getElementById("waifu");
    if (cage && waifu && waifu.parentElement !== cage) {
      cage.appendChild(waifu);
    }
    const toggle = document.getElementById("waifu-toggle");
    if (toggle && toggle.id) {
      toggle.style.display = "none";
    }
  }

  useEffect(() => {
    let disposed = false;

    // ---- 首次挂载，清掉可能残留的插件会话状态，保证每次挂载都从干净状态开始 ----
    // 本次挂载加载 activeModel（首屏即渲染期解析出的默认模型）。首屏由 pickCdnRoot(activeModel)
    // 自动选根：furina 走远端 CDN，BCSZ1.1 走本地打包根。下方 loader 前还会按
    // "命中根的实际 model_list"解析真实下标并写入 localStorage.modelId（唯一写入点）。
    try {
      localStorage.removeItem("waifu-disabled");
      localStorage.removeItem("waifu-display");
      sessionStorage.removeItem("waifu-message-priority");
    } catch {
      // ignore
    }

    // ---- 注入我们自己的覆盖样式：把插件 #waifu 定位进 React 容器，气泡改为蓝色 ----
    // 规则串构建在 live2d/override-style.ts（纯函数，逐行原样迁移；edgeRest 时
    // 追加"趴屏幕边缘"的放大/裁剪规则）。气泡样式为何全带 !important 见该模块注释。
    // 先创建覆盖样式元素（可重复挂载，后续在插件样式之后会再重挂一次保证优先级）
    const overrideStyle = document.createElement("style");
    overrideStyle.id = OVERRIDE_STYLE_ID;
    overrideStyle.textContent = buildOverrideStyleCss(edgeRest);
    document.head.appendChild(overrideStyle);

    // ---- 复刻 Demo：给图片加载统一加 crossOrigin ----
    patchGlobalImage();

    // ---- 下载进度追踪（必须在 initWidget 之前安装；流式计数 + Layout 注入）----
    // 进度分母：内置模型用精确总字节数；自定义模型未知 → 传 0，UI 只显示已下载量。
    // 目标写进 tracker 而不是只传数字：换模型走的是"复用渲染器实例"的快路径
    //（不重挂载本 effect），必须能原地换分母并清零分子，否则切到 furina 后
    // 分子按 furina 涨、分母还是上一个模型的，界面显示"100% + 73.8 / 5.6 MB"。
    const tracker = installProgressTracker(
      (p) => {
        lastProgressAtRef.current = Date.now();
        if (!disposed) setProgress(p);
      },
      progressTargetFor(activeModel),
      layoutConfig,
    );
    progressTrackerRef.current = tracker;

    // ---- 预加载渲染器 chunk 并打补丁，捕获模型实例（必须在 initWidget 之前）----
    // 失败不阻塞渲染：加载不到也只是少了"拖动飘动"这一锦上添花的物理效果。
    // 用共享 Promise 保证 initWidget 前补丁已就绪，避免插件先创建实例导致动作/物理失效。
    const patchPromise = patchLive2dApp();

    // 渲染封顶按实例应用（帧缓冲分辨率 + 帧率）。换模型后 subdelegate 会重建，
    // 所以每次模型就绪都要重新调用一次。
    const applyRenderCaps = () => {
      const app = (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp;
      // 帧缓冲分辨率：resizeCanvas 不在 AppDelegate.prototype 上，原型补丁覆盖不到它
      capSubdelegateDpr(app, MAX_RENDER_DPR);
      const fpsCap = normalizeFpsCap(configRef.current.get("widget.live2d.fps_cap"));
      const capped = capSubdelegateFps(app, fpsCap);
      if (fpsCap > 0 && capped === 0) {
        console.warn("[rin-live2d] 帧率封顶未能挂上（渲染器结构不识别），实际仍按全屏帧率渲染");
      }
    };

    // ---- 渲染"就绪门控"：轮询模型状态，CompleteSetup(22) 后才放行 ----
    // 原实现监听 live2d:rendered（渲染循环一启动就触发，并非模型真正渲染完成），
    // 导致遮罩过早消失、露出没加载完的模型。改为轮询模型实例状态更准确。
    // 该逻辑同时服务首屏与"切换模型"（切换后复用同一个渲染器实例，只是把画布收起、
    // 重新开启轮询、等新模型就绪后再淡入），因此封装成 start/stop 并注册到 ref 供
    // switchModel 调用；每次 start 前都会 stop 掉上一个轮询，避免重复 interval。
    let readyPollTimer: number | undefined;
    const stopReadyPoll = () => {
      if (readyPollTimer) {
        window.clearInterval(readyPollTimer);
        readyPollTimer = undefined;
      }
    };
    const startReadyPoll = () => {
      stopReadyPoll();
      // 从 start 起的"预热窗口"内先不判就绪：切换模型时 changeModel 需要一点时间
      // 重置内部模型状态，避免轮询把还未真正切换的旧模型（_state 仍为 22）误判为就绪。
      const gatedAt = Date.now();
      readyPollTimer = window.setInterval(() => {
        if (disposed || renderedRef.current) {
          stopReadyPoll();
          return;
        }
        if (Date.now() - gatedAt < 600) return;
        const model = getLive2dModel();
        if (model && model._state === 22) {
          renderedRef.current = true;
          setRendered(true);
          setError(null);
          // 就绪后给画布加"已就绪"类，淡入模型
          document.getElementById("live2d")?.classList.add("rin-live2d-ready");
          // 给当前模型实例包一层 update，注入动作参数动画
          patchModelForActions(model);
          // 渲染封顶落在渲染循环每帧调用的 subdelegate 上（实测定位的热点与盲区）
          applyRenderCaps();
          // 模型就绪后打个招呼（挥手）
          window.setTimeout(() => {
            if (!disposed) playAction("wave");
          }, 800);
          stopReadyPoll();
        }
      }, 300);
    };
    readyPollStartRef.current = startReadyPoll;
    readyPollStopRef.current = stopReadyPoll;
    applyRenderCapsRef.current = applyRenderCaps;
    startReadyPoll();

    // ---- 兜底：下载停滞（连续 2 分钟无进展且未渲染）时提示用户 ----
    let stallTimer = 0;
    const stopStallTimer = () => {
      if (stallTimer) {
        window.clearInterval(stallTimer);
        stallTimer = 0;
      }
    };
    const startStallTimer = () => {
      if (stallTimer) return;
      stallTimer = window.setInterval(() => {
        if (disposed) return;
        if (renderedRef.current) {
          stopStallTimer();
          return;
        }
        if (Date.now() - lastProgressAtRef.current > 120000) {
          setError(t("theme.live2d.loading.stalled"));
          stopStallTimer();
        }
      }, 30000);
    };
    startStallTimer();

    // ---- 空闲动作/表情轮播：让模型偶尔自己挥手/摇头/跳舞、换表情 ----
    let idleTimer = 0;
    const stopIdleTimer = () => {
      if (idleTimer) {
        window.clearInterval(idleTimer);
        idleTimer = 0;
      }
    };
    const startIdleTimer = () => {
      if (idleTimer) return;
      idleTimer = window.setInterval(() => {
        if (disposed || !renderedRef.current) return;
        const model = getLive2dModel();
        if (!model) return;
        // 正在播放动作时不打断
        if (isActionPlaying()) return;
        const roll = Math.random();
        if (roll < 0.22) {
          // 偶尔随机做一个动作
          const names: ActionName[] = ["wave", "shake", "dance"];
          playAction(names[Math.floor(Math.random() * names.length)]);
        } else {
          // 其余时间轮播一个安全表情，3 秒后清除
          const name = IDLE_EXPRESSIONS[Math.floor(Math.random() * IDLE_EXPRESSIONS.length)];
          try {
            model.setExpression?.(name);
            window.setTimeout(() => {
              if (!disposed) stopAllMotions(model);
            }, 3000);
          } catch {
            // ignore
          }
        }
      }, 12000);
    };
    startIdleTimer();

    // ---- 页面不可见 / 窗口失焦时自动暂停轮询与渲染循环 ----
    // 三个定时器（就绪轮询 / 停滞兜底 / 空闲轮播）在后台没有可见收益：
    // 空闲轮播甚至会驱动模型持续动画。切回前台时按当前状态恢复。
    //
    // 渲染循环的暂停是实测后才加上的真优化：引擎的自绘循环由插件自己按帧
    // requestAnimationFrame 驱动（看板娘 canvas 每帧约 49 次 drawElements，
    // 实测 ≈2950 次/秒）。引擎自带 stop()/run()（stop 里 cancelAnimationFrame
    // 掉 _drawFrameId），实测 stop 后 drawElements 归零、run 恢复回 ≈2950 次/秒
    // 且不会双开循环——恢复只由 renderLoopPausedRef 触发一次。
    const setRenderLoopPaused = (paused: boolean) => {
      const app = (window as unknown as { __rinLive2dApp?: unknown })
        .__rinLive2dApp as
        | { stop?: () => unknown; run?: () => unknown; _drawFrameId?: number | null }
        | undefined;
      if (!app) return;
      if (paused) {
        if (typeof app.stop === "function") {
          app.stop();
        } else if (app._drawFrameId) {
          cancelAnimationFrame(app._drawFrameId);
          app._drawFrameId = null;
        }
        renderLoopPausedRef.current = true;
      } else if (renderLoopPausedRef.current) {
        renderLoopPausedRef.current = false;
        try {
          app.run?.();
        } catch {
          // 恢复失败不阻塞：最坏情况是模型停在最后一帧
        }
      }
    };
    // 只有模型已经画出来（renderedRef）之后才允许暂停：加载中停掉就绪轮询会让
    // 看板娘永远不淡入（实测踩到：加载期间窗口失焦、focus 没再来，模型 _state=22
    // 却因为没有轮询而一直隐藏）。失焦时若还在加载就什么都不做。
    const setTimersPaused = (paused: boolean) => {
      if (paused) {
        if (!renderedRef.current || timersPausedRef.current) return;
        timersPausedRef.current = true;
        stopStallTimer();
        stopIdleTimer();
        readyPollStopRef.current?.();
        setRenderLoopPaused(true);
      } else if (timersPausedRef.current && !disposed) {
        timersPausedRef.current = false;
        if (!renderedRef.current) readyPollStartRef.current?.();
        startStallTimer();
        startIdleTimer();
        setRenderLoopPaused(false);
      }
    };
    const onVisibilityChange = () => setTimersPaused(document.hidden);
    const onWindowBlur = () => setTimersPaused(true);
    const onWindowFocus = () => {
      if (!document.hidden) setTimersPaused(false);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onWindowFocus);

    (async () => {
      try {
        // 不做 WebGL 前置检查：与 Demo 的 live2d-widget 插件行为一致。
        // 插件在运行时直接创建 WebGL 上下文，若浏览器不支持会自行在控制台报错并降级。

        // 1) 探测可用的模型源（按 activeModel：BCSZ1.1 走本地打包根，furina 走远端 CDN）
        const cdnRoot = await pickCdnRoot(activeModel);
        cdnRootRef.current = cdnRoot;
        if (disposed) return;

        // 2) 探测到根地址后立即并行预取当前模型的核心文件（moc3/贴图），
        //    不等插件脚本加载，让大体积 moc3 尽早开始下载
        prefetchModel(cdnRoot, activeModel);

        // 2.5) 后台全量预缓存全部内置模型：把每个模型的全部资源
        //      （moc3/贴图/动作/物理/口型）写入本地 Cache Storage。首次进入即下载一次，
        //      之后切换模型都命中本地缓存、不再重复下载。（不阻塞主流程）
        //      widget.live2d.preload 关闭时跳过仅远端可得的大模型（furina 约 95MB），
        //      当前正在展示的模型仍由上面的 prefetchModel 正常下载。
        precacheAllModels(config.getBoolean("widget.live2d.preload"));

        // 3) 加载样式与插件脚本（均为判重，可安全重复挂载）
        await loadStylesheet(WIDGET_CSS);
        // 插件 waifu.css 加载完成后，把我们的覆盖样式重新追加到 <head> 末尾，
        // 确保它在 DOM 顺序上位于插件样式之后（配合 !important 双保险，避免被米色默认样式覆盖）。
        document.getElementById(OVERRIDE_STYLE_ID)?.remove();
        document.head.appendChild(overrideStyle);
        await loadModuleScript(WIDGET_SCRIPT);
        if (disposed) return;

        // 4) 等待渲染器补丁就绪（捕获模型实例），再初始化插件
        await patchPromise;
        if (disposed) return;

        // 5) 等待 window.initWidget 就绪
        const loader = (window as unknown as { initWidget?: WidgetLoader }).initWidget;
        if (typeof loader !== "function") {
          throw new Error(
            "initWidget is not available. Check that waifu-tips.js was loaded from " + DIST,
          );
        }

        // 5.5) 若首次默认模型是"自定义模型"（不在内置链表里），无法用 loader 的
        //      cdnPath+modelId 拉取（那是基于内置 model_list 的）。此时先用 loader 加载
        //      一个"该根实际含有"的内置模型当占位，随后立即 changeModel(自定义 url)
        //      切到目标模型。占位优先轻的 BCSZ1.1：写死 furina 会让自定义模型用户
        //      先下 95MB 才切到自己的模型，而且在生产打包根里取不到它——该根的
        //      model_list 按 vite.config.ts 只声明 ["BCSZ1.1"]，indexOf("furina") 直接 -1
        //      会抛 model_missing；只有 dev 根（rinLive2dLocalCdn）同时列出两者。
        const customTarget = customModelsRef.current.find((c) => c.id === activeModel);
        const isCustomDefault = !!customTarget;

        // 6) 复刻 Demo 的调用方式（cdnPath + modelId；内置模型均为 Cubism5）
        // modelId：插件加载的模型 = 当前 cdnPath 的 model_list.models[modelId]。
        // 注意：不同根的 models 列表不同且下标不互通——
        //   - 打包根（生产 BCSZ1.1）：models=["BCSZ1.1"]，BCSZ1.1 恒在下标 0；
        //   - 远端根：models=["furina"]（实测只含 furina，不含 BCSZ），furina=0。
        // 因此不能想当然写死 0 或全局下标，必须按"命中根的实际 model_list"解析目标模型的
        // 真实下标。若命中根里根本没有 activeModel（如拿 BCSZ1.1 却落到 furina-only 的远端根），
        // 说明打包资源没随站点发布，此时应明确报错而非静默改加载别的模型
        // （否则 state 说 BCSZ、插件却加载 furina、进度用 BCSZ 的 22.6MB 当分母 →
        // 22MB 就显示 100%，其实 furina 的 95MB 还没下完 → 表现就是"卡在 100%不显示"）。
        const modelListRes = await fetch(`${cdnRoot}model_list.json`, { mode: "cors" });
        if (!modelListRes.ok) {
          throw new Error(
            t("theme.live2d.error.manifest_unavailable", { url: `${cdnRoot}model_list.json` }),
          );
        }
        const modelList = (await modelListRes.json()) as { models?: unknown[] };
        const listedModels = modelList.models ?? [];
        // 占位取"这个根真的有"的内置模型：优先轻的 BCSZ1.1，只有远端根才需要退回 furina。
        const placeholderModel = listedModels.includes("BCSZ1.1") ? "BCSZ1.1" : "furina";
        const loadFor = isCustomDefault ? placeholderModel : activeModel;
        const resolvedId = listedModels.indexOf(loadFor);
        if (resolvedId < 0) {
          throw new Error(
            t("theme.live2d.error.model_missing", {
              name: loadFor,
              root: bundledRootFor(loadFor) || cdnRoot,
            }),
          );
        }
        // 让插件 initCheck 读到的 modelId 与这里一致（插件会优先用 localStorage 值覆盖 config）。
        // 这是 modelId 的唯一写入点：switchModel 走 changeModel(url)，不再额外写。
        try {
          localStorage.setItem("modelId", String(resolvedId));
        } catch {
          // ignore
        }
        loader({
          waifuPath: WIDGET_JSON,
          cdnPath: cdnRoot,
          cubism2Path: CUBISM2_PATH,
          cubism5Path: CUBISM5_PATH,
          modelId: resolvedId,
          logLevel: "info",
          // 插件自带拖拽关闭，交给 React 文件夹拖拽统一处理
          drag: false,
        });
        if (disposed) return;

        // 5.6) 若首屏默认是自定义模型，loader 已挂载占位模型（内置），现在切到目标自定义
        if (isCustomDefault && customTarget) {
          const app = (window as unknown as { __rinLive2dApp?: unknown })
            .__rinLive2dApp as { changeModel?: (u: string) => void } | undefined;
          if (app && typeof app.changeModel === "function") {
            renderedRef.current = false;
            setRendered(false);
            setError(null);
            app.changeModel(customTarget.url);
          }
        }

        // 7) initWidget 同步执行到 r() 的第一步（插入 #waifu）后即返回，
        //    因此在调用返回后立刻把 #waifu 放进 React 容器
        adoptPluginDom();
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      readyPollStopRef.current?.();
      stopStallTimer();
      stopIdleTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onWindowFocus);
      // 卸载时不要把引擎留在停止状态：循环归零会连累后续复用同一实例的路径
      setRenderLoopPaused(false);
      // 新一轮 effect 挂载时会自己把定时器全开，暂停标记要跟着清零
      timersPausedRef.current = false;
      renderLoopPausedRef.current = false;
      window.removeEventListener("pointermove", onWindowMoveRef.current);
      window.removeEventListener("pointerup", onWindowUpRef.current);
      window.removeEventListener("pointercancel", onWindowUpRef.current);
      tracker.restore();
      if (progressTrackerRef.current === tracker) progressTrackerRef.current = null;
      stopDragFlutter();
      if (tipsTimerRef.current) {
        window.clearTimeout(tipsTimerRef.current);
      }

      // ---- 卸载时清理插件注入的 DOM / 脚本，尽量不破坏页面其它区域 ----
      // 注：插件会在 window/document 上注册一些监听器与 setInterval，这些全局引用
      // 无法在此移除（插件没有暴露销毁句柄）；已把可移除的 DOM/脚本/样式/图片补丁清理干净。
      document.getElementById("waifu")?.remove();
      document.getElementById("waifu-toggle")?.remove();
      document.getElementById(OVERRIDE_STYLE_ID)?.remove();
      document
        .querySelector(`link[data-rin-live2d-widget="${CSS_MARK}"]`)
        ?.remove();
      document
        .querySelector(`script[data-rin-live2d-widget="${SCRIPT_MARK}"]`)
        ?.remove();
      restoreGlobalImage();
      try {
        localStorage.removeItem("waifu-disabled");
        localStorage.removeItem("waifu-display");
        sessionStorage.removeItem("waifu-message-priority");
      } catch {
        // ignore
      }
    };
    // 挂载时加载一次；切换模型（modelVersion 自增）时重新加载插件以加载新模型。
    // 组件内部 re-render（隐藏/拖动等）不重载插件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelVersion]);

  // 设置里修改默认模型 / 增删自定义模型后，重载看板娘以应用新的模型列表。
  // 依赖这两个配置值的变化；变化时重置回默认模型并重挂载插件。
  const settingsModelsSig = `${config.get<string>("widget.live2d.defaultModel")}|${config.get<string>("widget.live2d.customModels")}`;
  useEffect(() => {
    const prev = prevModelsSigRef.current;
    prevModelsSigRef.current = settingsModelsSig;
    // 跳过首次挂载（首屏已按默认加载）
    if (prev === undefined) return;
    if (prev === settingsModelsSig) return;
    // 模型配置变化：重置到新的默认模型并重载
    setActiveModel(
      resolveDefaultName(
        config.get("widget.live2d.defaultModel"),
        parseCustomModels(config.get("widget.live2d.customModels")),
      ),
    );
    setModelVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsModelsSig]);

  // 设置里改动帧率封顶后立刻重新应用，不必等看板娘重载。
  // 模型还没就绪时 capSubdelegateFps 取不到实例，返回 0 不做任何事，就绪门控会再补一次。
  const fpsCapValue = normalizeFpsCap(config.get("widget.live2d.fps_cap"));
  useEffect(() => {
    applyRenderCapsRef.current?.();
  }, [fpsCapValue]);

  /**
   * 拖动时驱动衣服/头发飘动的物理：接管模型的 setDragging，用真实指针速度喂值，
   * 让布料在拖动过程中跟着鼠标惯性飘动（模型自带 physics3 重力 Y=-1 会自然带动衣服）。
   * 松手后恢复原函数，拖拽管理器会自然回弹，产生重力惯性感。
   * 接管与收尾的可测实现（含「必须以 model 为 this 调原方法」这条约束）在 perf.ts。
   */
  function startDragFlutter() {
    const model = getLive2dModel();
    if (!model) return;
    dragVelocityRef.current = { x: 0, y: 0 };
    const orig = takeOverDragSetDragging(model, () => dragVelocityRef.current);
    if (!orig) return;
    dragOrigSetDraggingRef.current = orig;
    draggingRef.current = true;
  }

  // 拖动/卸载结束：恢复模型原 setDragging，喂一个衰减速度让拖拽管理器自然回弹
  function stopDragFlutter() {
    draggingRef.current = false;
    const model = getLive2dModel();
    const orig = dragOrigSetDraggingRef.current;
    dragOrigSetDraggingRef.current = null;
    if (!model || !orig) return;
    releaseDragSetDragging(model, orig, () => dragVelocityRef.current);
  }

  // window 级指针监听：保证拖动过程中指针移出 DOM 也不丢失
  const onWindowMove = (event: PointerEvent) => {
    const state = interactionRef.current;
    const wrapper = outerRef.current;
    if (!state || !wrapper) return;

    // 更新指针速度（用于驱动衣服飘动）
    const now = performance.now();
    const dt = Math.max(8, now - lastMoveRef.current.t);
    const vx = (event.clientX - lastMoveRef.current.x) / dt; // px/ms
    const vy = (event.clientY - lastMoveRef.current.y) / dt;
    // 归一化：约 1.5px/ms（150px/s）对应满幅 1.0，再做指数平滑
    const nx = clamp(vx / 1.5, -1, 1);
    const ny = clamp(vy / 1.5, -1, 1);
    dragVelocityRef.current.x = dragVelocityRef.current.x * 0.55 + nx * 0.45;
    dragVelocityRef.current.y = dragVelocityRef.current.y * 0.55 + ny * 0.45;
    lastMoveRef.current = { x: event.clientX, y: event.clientY, t: now };

    if (state.kind === "pending") {
      // 待判定点击穿透：移动超过阈值则转为拖拽
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.hypot(dx, dy) > DRAG_START_THRESHOLD) {
        interactionRef.current = {
          kind: "drag",
          startX: state.startX,
          startY: state.startY,
          origLeft: wrapper.offsetLeft,
          origTop: wrapper.offsetTop,
          clientX: 0,
          clientY: 0,
          moved: Math.hypot(dx, dy),
        };
        startDragFlutter();
        setDragging(true);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        document.body.dataset.live2dDragging = "true";
      }
      return;
    }

    // 拖拽移动
    const deltaX = event.clientX - state.startX;
    const deltaY = event.clientY - state.startY;
    state.moved = Math.max(state.moved, Math.hypot(deltaX, deltaY));
    const nextLeft = state.origLeft + deltaX;
    const nextTop = state.origTop + deltaY;
    // 限位：不超过视口右下，且顶部不高于 0
    const { left: clampedLeft, top: clampedTop } = clampDragPosition(
      nextLeft,
      nextTop,
      window.innerWidth,
      window.innerHeight,
    );
    setPos({ left: clampedLeft, top: clampedTop });
  };

  const onWindowUp = (_event: PointerEvent) => {
    const state = interactionRef.current;
    interactionRef.current = null;
    window.removeEventListener("pointermove", onWindowMoveRef.current);
    window.removeEventListener("pointerup", onWindowUpRef.current);
    window.removeEventListener("pointercancel", onWindowUpRef.current);
    if (!state) return;
    if (state.kind === "pending") {
      // 未移动 → 视为点击，透传给后面的元素
      passClickThrough(state.clientX, state.clientY, outerRef.current);
      return;
    }
    // 拖拽结束
    const wrapper = outerRef.current;
    if (wrapper) {
      saveSavedPos(wrapper.offsetLeft, wrapper.offsetTop);
    }
    setDragging(false);
    stopDragFlutter();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    delete document.body.dataset.live2dDragging;
    // 按在模型上但几乎没移动 → 视为"抚摸"点击，而不是拖拽
    if (state.moved < DRAG_START_THRESHOLD) tapPet();
  };

  // 轻点模型本体触发抚摸动作（JS 参数曲线驱动，见 live2d/actions.ts）。
  // 说明：远端 widget fork 未暴露 HitArea 分区信息，无法区分摸头/摸身体等
  // 不同区域的反馈，只能做整体统一的抚摸动画。
  const lastPetAtRef = useRef(0);
  function tapPet() {
    const now = Date.now();
    if (now - lastPetAtRef.current < 1500) return; // 连点冷却，避免动作排队
    if (!renderedRef.current || isActionPlaying()) return;
    lastPetAtRef.current = now;
    playAction("pet");
  }

  // 用 ref 保存最新 handler，便于在 effect 清理里移除
  const onWindowMoveRef = useRef(onWindowMove);
  onWindowMoveRef.current = onWindowMove;
  const onWindowUpRef = useRef(onWindowUp);
  onWindowUpRef.current = onWindowUp;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // 忽略合成事件，避免误触发拖拽
    if (!event.isTrusted || event.button !== 0) {
      return;
    }
    const wrapper = outerRef.current;
    if (!wrapper) {
      return;
    }
    // 透明区域点击穿透：读取该点像素 alpha，透明则先挂起，等指针抬起时透传
    const alpha = probePixelAlpha(event.clientX, event.clientY);
    if (alpha < CLICK_ALPHA_THRESHOLD) {
      interactionRef.current = {
        kind: "pending",
        startX: event.clientX,
        startY: event.clientY,
        origLeft: wrapper.offsetLeft,
        origTop: wrapper.offsetTop,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: 0,
      };
    } else {
      // 不透明（模型本体）：直接开始拖拽
      interactionRef.current = {
        kind: "drag",
        startX: event.clientX,
        startY: event.clientY,
        origLeft: wrapper.offsetLeft,
        origTop: wrapper.offsetTop,
        clientX: 0,
        clientY: 0,
        moved: 0,
      };
      startDragFlutter();
      setDragging(true);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      document.body.dataset.live2dDragging = "true";
    }
    lastMoveRef.current = { x: event.clientX, y: event.clientY, t: performance.now() };
    window.addEventListener("pointermove", onWindowMoveRef.current);
    window.addEventListener("pointerup", onWindowUpRef.current);
    window.addEventListener("pointercancel", onWindowUpRef.current);
  }

  const anchorStyle: React.CSSProperties =
    position === "left" ? { left: "1rem" } : { right: "1rem" };

  // 有记忆/拖动坐标时用 left/top，否则回到默认 bottom 锚点
  const positionStyle: React.CSSProperties = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px` }
    : anchorStyle;

  // 加载进度百分比（0-100）。自定义模型不知总字节数（total=0）时返回 null，仅显示已下载量。
  const pct = progressPercent(progress);

  return (
    <>
      {hidden ? (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="fixed bottom-4 z-40 rounded-full bg-theme px-3 py-2 text-white shadow-lg transition hover:bg-theme-hover"
          style={anchorStyle}
          aria-label={t("theme.live2d.show")}
        >
          <i className="ri-magic-line" />
        </button>
      ) : null}
      {/* pointer-events-none：整个看板娘占位块比可见人物大得多（方形模型区 + 行容器留白），
          默认让整棵子树不吃事件，只有真正可交互的子树显式接管：工具栏、聊天面板、画布
          （画布由 override-style 的 #live2d{pointer-events:auto} 负责）。
          pointer-events 可被后代用 auto 覆盖，所以穿透不影响模型拖动与点击。 */}
      <div
        ref={outerRef}
        className="pointer-events-none fixed bottom-2 z-40"
        style={{
          ...positionStyle,
          // 隐藏时不能用 display:none：canvas 尺寸归零会导致 WebGL 上下文丢失，
          // 渲染器 update() 因 isContextLost() 直接返回，重新显示后模型无法再渲染。
          // 改用 visibility+opacity+pointer-events 隐藏，保持 canvas 尺寸与 WebGL 上下文。
          ...(hidden
            ? { visibility: "hidden", opacity: 0, pointerEvents: "none" }
            : {}),
        }}
      >
        <div className={`flex items-end gap-1 ${dragging ? "pointer-events-none" : ""}`}>
          {/* 竖排工具栏：首页 / 聊天 / 换模型 / 摸一摸 / 动作 / 隐藏（从上到下） */}
          <div className="pointer-events-auto relative flex flex-col items-center gap-1">
            {showActions && !error ? (
              <div className="absolute right-full top-1/2 mr-2 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-black/10 bg-w p-1.5 shadow dark:border-white/10">
                {(["wave", "shake", "dance"] as ActionName[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => playCustomAction(name)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-base transition hover:scale-110 hover:bg-neutral-100 dark:hover:bg-white/10"
                    aria-label={t(`theme.live2d.actions.${name}`)}
                    title={t(`theme.live2d.actions.${name}`)}
                  >
                    <i
                      className={
                        name === "wave"
                          ? "ri-hand-heart-line"
                          : name === "shake"
                            ? "ri-emotion-normal-line"
                            : "ri-music-2-line"
                      }
                    />
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              onClick={goHome}
              className="rounded-full bg-w p-2 text-sm shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.home")}
              title={t("theme.live2d.home")}
            >
              <i className="ri-home-4-line" />
            </button>
            <button
              type="button"
              onClick={() => setChatOpen((value) => !value)}
              className={`rounded-full bg-w p-2 text-sm shadow transition ${chatOpen ? "text-theme" : "t-muted hover:text-theme"}`}
              aria-label={t("theme.live2d.chat.button")}
              title={t("theme.live2d.chat.button")}
            >
              <i className="ri-chat-3-line" />
            </button>
            <button
              type="button"
              onClick={switchToNextModel}
              className="rounded-full bg-w p-2 text-sm shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.switch.button")}
              title={t("theme.live2d.switch.button")}
            >
              <i className="ri-refresh-line" />
            </button>
            <button
              type="button"
              onClick={petModel}
              className="rounded-full bg-w p-2 text-sm shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.poke")}
              title={t("theme.live2d.poke")}
            >
              <i className="ri-hand-heart-line" />
            </button>
            <button
              type="button"
              onClick={() => setShowActions((value) => !value)}
              className={`rounded-full bg-w p-2 text-sm shadow transition ${showActions ? "text-theme" : "t-muted hover:text-theme"}`}
              aria-label={t("theme.live2d.actions.button")}
              title={t("theme.live2d.actions.button")}
            >
              <i className="ri-magic-line" />
            </button>
            <button
              type="button"
              onClick={() => setHidden(true)}
              className="rounded-full bg-w p-2 text-sm shadow t-muted transition hover:text-theme"
              aria-label={t("theme.live2d.hide")}
              title={t("theme.live2d.hide")}
            >
              <i className="ri-close-line" />
            </button>
          </div>

          {error ? (
            <p className="max-w-44 text-xs text-red-500">{error}</p>
          ) : (
            <div
              className="pointer-events-none relative"
              style={{ width: boxW, height: boxH }}
            >
              {/* 模型容器：插件生成的 #waifu 会被移入这里。
                  注意：此容器不能有 React 子节点，否则手动 appendChild 的 #waifu 会在 re-render 时被 React 清掉。
                  不能加 overflow-hidden，否则浮在模型上方的 #waifu-tips 气泡会被裁掉。
                  pointer-events-none：这一层是正方形，人物只占中间一块，留白必须把事件
                  还给页面（旧实现在这里吃点击 + touch-action:none 挡滚动）。拖动/点击的
                  处理仍然生效——事件由画布（pointer-events:auto）冒泡上来。 */}
              <div
                ref={modelAreaRef}
                className="pointer-events-none absolute inset-0 select-none"
                onPointerDown={onPointerDown}
              />
              {/* 加载进度覆盖层：渲染完成前显示（作为兄弟节点，不干扰 #waifu）。
                  pointer-events-none：下载大模型时这块方形占位可能持续几十秒，
                  纯展示的进度条不该在此期间吃掉下面的点击与滚动。 */}
              {!rendered ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-w/95 text-xs shadow-inner dark:bg-neutral-900/95">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      className="h-full rounded-full bg-theme transition-[width] duration-300"
                      style={{ width: `${pct ?? 0}%` }}
                    />
                  </div>
                  <span className="t-muted">
                    {progress
                      ? pct != null
                        ? `${t("theme.live2d.loading.downloading")} ${pct}%`
                        : `${t("theme.live2d.loading.downloading")}…`
                      : t("theme.live2d.loading.connecting")}
                  </span>
                  {progress ? (
                    <span className="t-muted text-[10px]">
                      {formatProgressMb(progress)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {/* 聊天面板：浮在模型上方，标题/提示跟随当前模型。
                  外层方形已 pointer-events-none，面板自身要重新接管事件。 */}
              {chatOpen ? (
                <div className="pointer-events-auto absolute bottom-full right-0 mb-2 flex w-72 flex-col overflow-hidden rounded-2xl border border-black/10 bg-w shadow-xl dark:border-white/10">
                  <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/10">
                    <span className="text-sm font-semibold">
                      {t("theme.live2d.chat.title", { name: activeDisplayName })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setChatOpen(false)}
                      className="t-muted transition hover:text-theme"
                      aria-label={t("theme.live2d.hide")}
                    >
                      <i className="ri-close-line" />
                    </button>
                  </div>
                  <div ref={chatScrollRef} className="flex h-56 flex-col gap-2 overflow-y-auto p-3">
                    {chatMessages.length === 0 ? (
                      <p className="t-muted text-xs">
                        {t("theme.live2d.chat.hint", { name: activeDisplayName })}
                      </p>
                    ) : (
                      chatMessages.map((m, i) => (
                        <div
                          key={i}
                          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 text-xs ${
                            m.role === "user"
                              ? "self-end bg-theme text-white"
                              : "self-start bg-neutral-100 dark:bg-neutral-700"
                          }`}
                        >
                          {m.content}
                        </div>
                      ))
                    )}
                    {chatLoading ? (
                      <div className="t-muted self-start text-xs">…</div>
                    ) : null}
                  </div>
                  {chatError ? (
                    <p className="px-3 pb-1 text-xs text-red-500">{chatError}</p>
                  ) : null}
                  <div className="flex items-center gap-2 border-t border-black/10 p-2 dark:border-white/10">
                    <input
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleChatSend();
                        }
                      }}
                      placeholder={t("theme.live2d.chat.placeholder", { name: activeDisplayName })}
                      className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-3 py-1.5 text-xs outline-none transition focus:border-theme dark:border-white/10"
                    />
                    <button
                      type="button"
                      onClick={handleChatSend}
                      disabled={chatLoading}
                      className="shrink-0 rounded-full bg-theme px-3 py-1.5 text-xs text-white transition hover:bg-theme-hover disabled:opacity-50"
                    >
                      {t("theme.live2d.chat.send")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
