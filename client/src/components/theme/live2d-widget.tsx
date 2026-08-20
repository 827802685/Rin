import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { AIChatMessage } from "@rin/api";
import { client } from "../../app/runtime";
import { ClientConfigContext } from "../../state/config";

/**
 * Live2D 看板娘组件 —— live2d-widget 插件接入版（复刻 Demo autoload.js）
 *
 * 渲染引擎：stevenjoezhang/live2d-widget（827802685 的 fork，暴露 window.initWidget），
 * 与 Demo（https://827802685.github.io/Live2D/）完全同源。
 *
 * 交互（联动性）说明：
 *   - 鼠标移动：渲染器让模型眼睛/头部跟随光标（onDrag）；
 *   - 悬停身体：渲染器派发 live2d:hoverbody → 插件在 #waifu-tips 显示气泡；
 *   - 点击模型：渲染器播放 TapBody 动作/表情并派发 live2d:tapbody → 插件显示气泡；
 *   - 空闲/复制/切页：插件按 waifu-tips.json 定时显示气泡；
 *   - 换模型/摸一摸按钮：通过合成 pointerdown 触发模型真实动作 + showTips 显示自定义气泡。
 *
 * 与 Demo 的差异（为适配博客）：
 *   - 模型源：优先 github.io 直连（实测最快、同源 CORS），失败自动回退加速代理；
 *   - 隐藏插件自带的 #waifu-tool（工具列）与 #waifu-toggle（开关），交互交给 React 按钮；
 *   - 气泡复用插件的 #waifu-tips，仅重写样式贴合博客主题（蓝色气泡）；
 *   - 不加载 config-panel.js（参数面板），保持博客干净；
 *   - 保留 React 外壳：文件夹拖拽、换模型/摸一摸/隐藏按钮、加载进度、错误提示。
 *
 * 本版本针对用户反馈做的优化：
 *   1. 衣服重力飘动：拖动时用真实指针速度驱动模型拖拽参数（替代原假正弦波），
 *      让模型自带的 physics3（重力 Y=-1）自然带动衣服摆动，松手后惯性回弹；
 *   2. 流畅度：进度追踪改为流式计数（TransformStream），不再把 91MB moc3 整块读进内存；
 *   3. 更早请求最大模型：探测到 CDN 根地址后立即并行预取 moc3/贴图，不等插件脚本；
 *   4. 透明区域点击穿透：点击画布时读取该点像素 alpha，透明则把点击透传给后面的元素；
 *   5. 新增动作：摸摸/挥手/摇头/跳舞（JS 驱动参数动画），并修复点击/悬停/表情轮播
 *      （原模型配置缺少 HitAreas 导致原生命中检测永远失败，动作从未真正触发）；
 *   6. 换模型按钮：支持在 furina / BCSZ1.1 之间切换（复用插件 modelId 机制）；
 *   7. 对话框改为蓝色；
 *   8. 渲染门控：模型完整加载（CompleteSetup）前不显示模型，避免露出半成品；
 *   9. 颈部错位：支持通过 widget.live2d.layout 注入 Layout 微调模型位置/缩放。
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

// 模型根地址候选：优先本地（dev，Vite 中间件提供，毫秒级），其次 github.io 直连，
// 最后回退加速代理（Demo 默认）。
const CDN_CANDIDATES = [
  // dev 环境下由 vite.config.ts 的 rinLive2dLocalCdn 中间件提供本地模型文件
  ...(import.meta.env.DEV ? [`${location.origin}/rin-live2d-cdn/`] : []),
  "https://827802685.github.io/Live2D/",
  "https://raw-githubusercontent-com-gh.zjkl0330.dpdns.org/827802685/Live2D/refs/heads/master/",
];

// 各模型首次加载的核心文件总字节数（moc3 + 贴图 + physics + cdi + 配置），作为进度分母。
// furina：moc3 95MB + 4K 贴图 8MB + 其余；BCSZ1.1：贴图 13.9MB + moc3 1.28MB + 其余（约 22.6MB）
const EXPECTED_TOTAL_BY_NAME: Record<AvatarModel, number> = {
  furina: 103740290,
  "BCSZ1.1": 22639505,
};

// 透明像素判定阈值：alpha 低于该值视为"透明区域"，点击透传给后面的元素
const CLICK_ALPHA_THRESHOLD = 16;
// 点击 vs 拖拽的判定阈值（像素）
const DRAG_START_THRESHOLD = 6;

// ---- 趴在屏幕边缘（edgeRest）模式参数 ----
// 实现思路：模型整体放大并锚定在底部中心，再用 clip-path 把下半身"裁到屏幕外"，
// 只露出上半身，配合底部一条"桌面边缘"高光，看起来像双手搭在屏幕底边。
// 因为裁的是 #live2d 画布本身，不会影响浮在上方的 #waifu-tips 气泡。
const EDGE_SCALE = 1.45; // 放大倍数
const EDGE_CLIP_TOP = "10%"; // 顶部裁掉的比例（去掉超出画面的头顶）
const EDGE_CLIP_BOTTOM = "32%"; // 底部裁掉的比例（隐藏下半身/腿）

// initWidget 的配置结构（对应 stevenjoezhang/live2d-widget 的 dist/autoload.js）
type InitWidgetConfig = {
  waifuPath: string;
  cdnPath?: string;
  cubism2Path?: string;
  cubism5Path?: string;
  tools?: string[];
  modelId?: number;
  logLevel?: string;
  drag?: boolean;
};
type WidgetLoader = (config: InitWidgetConfig) => void;

// 用于标记我们注入的 <link>/<script>，便于卸载时定向清理（尽量不误删页面其它资源）
const CSS_MARK = "rin-live2d-widget--css";
const SCRIPT_MARK = "rin-live2d-widget--script";
const OVERRIDE_STYLE_ID = "rin-live2d-widget--override";

// 看板娘可选模型（与 CDN model_list.json 的 models 顺序一致，供"换模型"切换）。
// 名字即 CDN 模型目录名；展示名用 i18n（theme.live2d.switch.<name>）。
const AVATAR_MODELS = ["furina", "BCSZ1.1"] as const;
type AvatarModel = (typeof AVATAR_MODELS)[number];

// 各模型的核心大文件（用于预取，加速首次加载）
const MODEL_FILES_BY_NAME: Record<AvatarModel, string[]> = {
  furina: ["furina.moc3", "furina.8192/texture_00.png"],
  "BCSZ1.1": ["BCSZ1.1.moc3", "textures/texture_00.png"],
};

// 芙宁娜聊天人设：注入给设置里绑定的 AI，让它以芙宁娜的口吻回复
const FURINA_SYSTEM_PROMPT =
  "你是芙宁娜，这个博客的 Live2D 看板娘。你性格活泼可爱、略带傲娇，说话简短俏皮，" +
  "喜欢用语气词（～、哦、嘛、啦）。请用中文回复，每次回复不超过 80 字，不要使用 Markdown 格式。";

// 复刻 Demo 的工具集。工具列本身会被覆盖样式隐藏（#waifu-tool{display:none}），
// 交互交给 React 外壳；去掉 "quit"（与 React 的 Hide 逻辑冲突）。
const TOOLS = ["hitokoto", "photo", "info"];

// ---------------------------------------------------------------------------
// 动作引擎：JS 驱动参数动画（不依赖模型 motion3 文件，避免改远程 CDN）
// ---------------------------------------------------------------------------

type ActionName = "pet" | "wave" | "shake" | "dance";

type ParamCurve = { id: string; fn: (t: number) => number };

type ActionDef = {
  duration: number;
  expression?: string;
  params: ParamCurve[];
};

// 参数动画曲线：t 为归一化时间 [0,1]。
// 参数范围参考 Live2D 标准：ParamAngle* ±30，ParamBodyAngle* ±30，
// ParamEye*Open/Smile 0~1，ParamMouthForm -1~1，Param85 为手臂摆动角（-30~30），
// Param92/87/94/3/93 为手臂位置开关（0~1）。
const ACTIONS: Record<ActionName, ActionDef> = {
  pet: {
    duration: 2.2,
    expression: "blush",
    params: [
      // 低头蹭蹭 + 轻微左右摆
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 6 },
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 4 },
      { id: "ParamBodyAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 3 },
      // 开心眯眼
      { id: "ParamEyeROpen", fn: () => -0.25 },
      { id: "ParamEyeLOpen", fn: () => -0.25 },
      { id: "ParamEyeRSmile", fn: () => 0.8 },
      { id: "ParamEyeLSmile", fn: () => 0.8 },
      // 微笑
      { id: "ParamMouthForm", fn: () => 0.6 },
    ],
  },
  wave: {
    duration: 2.6,
    expression: "cat_mouth",
    params: [
      // 手臂上下挥动（Param85 大幅摆臂）
      { id: "Param85", fn: (t) => Math.sin(t * Math.PI * 4) * 18 },
      { id: "Param92", fn: (t) => (t < 0.15 ? 0 : 1) },
      // 头轻微侧倾
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "ParamAngleX", fn: () => 4 },
    ],
  },
  shake: {
    duration: 1.6,
    params: [
      // 左右摇头，幅度逐渐衰减
      { id: "ParamAngleZ", fn: (t) => Math.sin(t * Math.PI * 6) * 11 * (1 - t) },
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 3) * 3 * (1 - t) },
    ],
  },
  dance: {
    duration: 4,
    expression: "stars",
    params: [
      // 身体左右摇摆 + 头点动 + 手臂舞动
      { id: "ParamBodyAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 8 },
      { id: "ParamBodyAngleZ", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "ParamAngleY", fn: (t) => Math.sin(t * Math.PI * 4) * 6 },
      { id: "ParamAngleX", fn: (t) => Math.sin(t * Math.PI * 2) * 5 },
      { id: "Param85", fn: (t) => Math.sin(t * Math.PI * 2) * 15 },
      { id: "Param92", fn: (t) => (Math.sin(t * Math.PI * 2) > 0 ? 1 : 0) },
      { id: "ParamBreath", fn: (t) => Math.sin(t * Math.PI * 2) * 0.4 },
    ],
  },
};

// 空闲时轮播的安全表情（对应 CDN 模型配置里的 Expression Name）
const IDLE_EXPRESSIONS = [
  "blush",
  "cat_mouth",
  "stars",
  "sweat",
  "cheek_rest",
  "smart",
  "cover_mouth",
  "antenna_fan",
];

// 当前正在播放的动作（模块级单例，供 update 钩子读取）
const actionStateRef: {
  current: { name: ActionName; startTime: number; def: ActionDef } | null;
} = { current: null };

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function playAction(name: ActionName) {
  const model = getLive2dModel();
  if (!model) return;
  const def = ACTIONS[name];
  if (!def) return;
  actionStateRef.current = { name, startTime: performance.now(), def };
  if (def.expression) {
    try {
      model.setExpression?.(def.expression);
    } catch {
      // ignore
    }
  }
}

// 每帧把动作参数写入模型（在渲染器 update 之后执行，覆盖该帧的最终参数）
function applyActionFrame(model: Live2dModelLike) {
  const action = actionStateRef.current;
  if (!action) return;
  const cubism = model.getModel?.();
  if (!cubism || typeof cubism.setParameterValueById !== "function") return;
  const elapsed = (performance.now() - action.startTime) / 1000;
  const t = Math.min(1, elapsed / action.def.duration);
  for (const curve of action.def.params) {
    try {
      cubism.setParameterValueById(curve.id, curve.fn(t));
    } catch {
      // ignore
    }
  }
  if (t >= 1) {
    actionStateRef.current = null;
    if (action.def.expression) {
      try {
        model._expressionManager?.stopAllMotions?.();
      } catch {
        // ignore
      }
    }
  }
}

// 在模型实例上包一层 update：渲染器每帧调用 s.update()，我们在其后注入动作参数
function patchModelForActions(model: Live2dModelLike) {
  if ((model as { __rinActionPatched?: boolean }).__rinActionPatched) return;
  (model as { __rinActionPatched?: boolean }).__rinActionPatched = true;
  const origUpdate = (model as { update?: unknown }).update;
  if (typeof origUpdate !== "function") return;
  (model as { update: unknown }).update = function (this: unknown, ...args: unknown[]) {
    const result = (origUpdate as (...a: unknown[]) => unknown).apply(this, args);
    applyActionFrame(this as Live2dModelLike);
    return result;
  };
}

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
      AppDelegate?: { prototype: { run?: (...args: unknown[]) => unknown } };
    };
    const AppDelegate = mod.AppDelegate;
    if (!AppDelegate) {
      return false;
    }
    const origRun = AppDelegate.prototype.run;
    AppDelegate.prototype.run = function (this: unknown, ...args: unknown[]) {
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
    };
    return true;
  } catch {
    return false;
  }
}

// 从捕获的 AppDelegate 实例中取出 Live2D 模型（CubismUserModel），用于喂拖拽/物理/动作
type Live2dModelLike = {
  setDragging?: (x: number, y: number) => void;
  startRandomMotion?: (group: string, priority: number) => void;
  setRandomExpression?: () => void;
  setExpression?: (name: string) => void;
  getModel?: () => {
    setParameterValueById?: (id: string, value: number) => void;
  };
  _expressionManager?: { stopAllMotions?: () => void };
  _motionManager?: { stopAllMotions?: () => void };
  _state?: number;
  update?: unknown;
};
function getLive2dModel(): Live2dModelLike | undefined {
  const app = (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp;
  const sub = (app as { _subdelegates?: { at?: (i: number) => unknown } } | undefined)?._subdelegates?.at?.(
    0,
  );
  const manager = (sub as { getLive2DManager?: () => unknown } | undefined)?.getLive2DManager?.();
  return (manager as { _models?: { at?: (i: number) => Live2dModelLike } } | undefined)?._models?.at?.(
    0,
  );
}

type ProgressState = { loaded: number; total: number };

/**
 * 全局 fetch 包装：统计 /model/ 请求的下载字节数（流式计数，不缓冲整个文件）。
 * 返回卸载时恢复 window.fetch 的函数。
 *
 * 额外职责：
 *   - 对模型配置文件（index.json / .model3.json）注入 Layout（用于微调模型位置/缩放）；
 *   - 对同一 URL 的去重：预取与插件加载同一文件时只计一次字节数。
 */
function installProgressTracker(
  onProgress: (p: ProgressState) => void,
  total: number,
  layoutConfig?: Record<string, number> | null,
): () => void {
  const state: ProgressState = { loaded: 0, total };
  const origFetch = window.fetch.bind(window);
  // 已开始计数的 URL（同一文件只计一次，避免预取 + 插件加载重复计数）
  const countingUrls = new Set<string>();
  let rafPending = false;

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
    if (url.indexOf("/model/") === -1) {
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
                state.loaded += r.value.byteLength;
                notify();
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
  return () => {
    window.fetch = origFetch;
  };
}

// 探测可用的模型源：依次请求 model_list.json，返回第一个能正常返回模型清单的根地址
async function pickCdnRoot(): Promise<string> {
  for (const root of CDN_CANDIDATES) {
    try {
      const res = await fetch(`${root}model_list.json`, { mode: "cors" });
      if (res.ok) {
        const data = (await res.json()) as { models?: unknown[] };
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          return root;
        }
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return CDN_CANDIDATES[0];
}

// 探测到 CDN 根地址后立即并行预取当前模型的核心文件（moc3/贴图），
// 不等插件脚本加载；插件稍后请求同一 URL 时命中浏览器/SW 缓存。
function prefetchModel(cdnRoot: string, name: AvatarModel) {
  const base = `${cdnRoot}model/${name}/`;
  const files = MODEL_FILES_BY_NAME[name] ?? [];
  for (const file of files) {
    fetch(`${base}${file}`, { mode: "cors" }).catch(() => {
      // 预取失败不阻塞主流程
    });
  }
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

// 拖动位置持久化 key
const POS_KEY = "rin.live2d.pos";
// 记忆的拖动偏移 {leftPercent, topPx}：水平按百分比锚定，垂直按像素
type SavedPos = { left: number; top: number } | null;

function loadSavedPos(): SavedPos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { left: number; top: number };
    if (typeof parsed.left === "number" && typeof parsed.top === "number") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

// 解析 Layout 配置（JSON 字符串，如 {"Center Y": 0.05}）
function parseLayoutConfig(raw: string): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = v;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function Live2DWidget() {
  const config = useContext(ClientConfigContext);
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [activeModel, setActiveModel] = useState<AvatarModel>("furina");
  // 模型版本号：切换模型时自增，作为外层 key 强制重挂载组件以加载新模型
  const [modelVersion, setModelVersion] = useState(0);
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
  } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => loadSavedPos());

  const position = String(config.get("widget.live2d.position") ?? "right");
  // modelUrl 保留读取，兼容既有配置；插件模式下改为 cdnPath + modelId，
  // 因此该 URL 不再被直接使用，为空也不影响渲染
  const modelUrl = String(config.get("widget.live2d.model") ?? "");
  // 显式引用一次，示意这是"按需保留"；插件模式实际用 cdnPath+modelId，此值仅供扩展
  void modelUrl;
  const rawScale = Number(config.get("widget.live2d.scale") ?? 1);
  // 防止配置被误调成超大值导致模型挡住整个页面：限制在安全范围内
  const scaleValue = Number.isFinite(rawScale) ? Math.min(Math.max(rawScale, 0.1), 2) : 1;
  // 趴在屏幕边缘模式：仅显示模型上半身，双手像趴在桌面一样搭在屏幕底部边缘
  const edgeRest =
    config.get<boolean>("widget.live2d.edge") === true ||
    config.get<string>("widget.live2d.edge")?.toString().trim().toLowerCase() === "true";
  // 颈部/位置微调：widget.live2d.layout（JSON），注入模型配置的 Layout 段
  const layoutConfig = parseLayoutConfig(String(config.get("widget.live2d.layout") ?? ""));

  // 模型容器尺寸：与插件 #waifu-canvas 的 300x300 一致，随配置缩放
  const boxW = Math.round(300 * scaleValue);
  const boxH = Math.round(300 * scaleValue);

  /**
   * 在插件的 #waifu-tips 气泡里显示一条消息（复刻插件内部 i() 的行为）。
   * 与插件自身的消息共用同一个元素，天然互斥：后显示的覆盖先显示的。
   */
  function showTips(text: string, duration = 4000) {
    const el = document.getElementById("waifu-tips");
    if (!el) {
      return;
    }
    el.innerHTML = text;
    el.classList.add("waifu-tips-active");
    if (tipsTimerRef.current) {
      window.clearTimeout(tipsTimerRef.current);
    }
    tipsTimerRef.current = window.setTimeout(() => {
      el.classList.remove("waifu-tips-active");
      tipsTimerRef.current = null;
    }, duration);
  }

  /**
   * 切换看板娘模型。
   *
   * 插件通过 localStorage 的 "modelId"（对应 model_list.json 的 models 下标）决定加载哪个模型，
   * 且只在 initWidget 初始化时读取一次。因此切换模型 = 更新 modelId 后强制重挂载本组件，
   * 让 useEffect 重新走一遍"探测 CDN → 预取 → initWidget"流程，加载新模型。
   */
  function switchModel(name: AvatarModel) {
    const nextIndex = AVATAR_MODELS.indexOf(name);
    if (nextIndex < 0) return;
    try {
      localStorage.setItem("modelId", String(nextIndex));
    } catch {
      // ignore
    }
    setActiveModel(name);
    setShowModelPicker(false);
    setModelVersion((v) => v + 1);
    // 提示切换中，稍后新模型就绪时气泡会被覆盖
    showTips(t("theme.live2d.switch.switching"), 3000);
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

  /** 发送聊天消息：走设置里绑定的 AI（ai_summary 配置），注入芙宁娜人设 */
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

    // 服务端有 30 条上限：system + 最近 20 条历史 + 新消息
    const payload: AIChatMessage[] = [
      { role: "system", content: FURINA_SYSTEM_PROMPT },
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
    try {
      localStorage.removeItem("waifu-disabled");
      localStorage.removeItem("waifu-display");
      sessionStorage.removeItem("waifu-message-priority");
      // 读取当前选中的模型下标（默认 0 = furina）；切换模型时由 switchModel 写入
      const saved = Number(localStorage.getItem("modelId") ?? "0");
      const idx = Number.isFinite(saved) && saved >= 0 && saved < AVATAR_MODELS.length ? saved : 0;
      localStorage.setItem("modelId", String(idx));
    } catch {
      // ignore
    }

    // ---- 注入我们自己的覆盖样式：把插件 #waifu 定位进 React 容器，气泡改为蓝色 ----
    // 先创建覆盖样式元素（可重复挂载，后续在插件样式之后会再重挂一次保证优先级）
    const overrideStyle = document.createElement("style");
    overrideStyle.id = OVERRIDE_STYLE_ID;

    const rules = [
      `#${OVERRIDE_STYLE_ID}{}`,
      // 模型容器：占满 React 容器，取消插件默认的 fixed 定位与过渡
      `#waifu{position:absolute !important;top:0;left:0;bottom:auto !important;`,
      `transform:none !important;transition:none !important;z-index:0 !important;`,
      `width:100%;height:100%;margin:0}`,
      `#waifu.waifu-active{bottom:auto !important}`,
      `#waifu:hover{transform:none !important}`,
      `#waifu-canvas{width:100% !important;height:100% !important;margin:0}`,
      // 渲染门控：模型完整加载前画布透明（避免露出半成品），就绪后淡入
      `#live2d{width:100% !important;height:100% !important;position:relative;display:block;`,
      `opacity:0;transition:opacity .4s ease;}`,
      `#live2d.rin-live2d-ready{opacity:1;}`,
      // 气泡：浮在模型上方，淡蓝色半透明背景（保持透明效果，仅改颜色为淡蓝）。
      // 注意：插件 waifu.css 在覆盖样式之后加载，且选择器特异性相同（都是 #waifu-tips），
      // 因此这里所有属性都必须带 !important，否则会被插件默认的米色样式覆盖。
      `#waifu-tips{position:absolute !important;bottom:100% !important;left:50% !important;`,
      `transform:translateX(-50%) !important;margin:0 0 8px !important;`,
      `width:max-content !important;max-width:220px !important;min-height:0 !important;`,
      `background:rgba(186,225,248,.92) !important;border:1px solid rgba(90,176,232,.45) !important;`,
      `border-radius:12px !important;box-shadow:0 4px 16px rgba(90,176,232,.28) !important;`,
      `color:#2a4a6b !important;font-size:12px !important;line-height:1.5 !important;`,
      `padding:6px 10px !important;opacity:0 !important;`,
      `transition:opacity .2s !important;z-index:20 !important;pointer-events:none !important;`,
      `text-align:center !important;`,
      `animation:none !important;overflow:visible !important;text-overflow:clip !important;`,
      `word-break:normal !important;}`,
      `[data-color-mode="dark"] #waifu-tips{background:rgba(46,84,120,.9) !important;`,
      `border-color:rgba(120,180,230,.35) !important;color:#dceaf7 !important;}`,
      `#waifu-tips.waifu-tips-active{opacity:1 !important;}`,
      `#waifu-tips span{color:#2a4a6b !important;}`,
      `[data-color-mode="dark"] #waifu-tips span{color:#dceaf7 !important;}`,
      // 工具列与开关交给 React 按钮
      `#waifu-tool,#waifu-toggle{display:none !important}`,
    ];
    // 趴在屏幕边缘：放大模型 + 裁掉下半身 + 底部画一条"桌面边缘"高光
    if (edgeRest) {
      rules.push(
        // 容器底部对齐屏幕底边，模型整体放大并锚定底部
        `#waifu{bottom:0 !important;transform:none !important;}`,
        `#live2d{transform:scale(${EDGE_SCALE});transform-origin:50% 100%;`,
        `clip-path:inset(${EDGE_CLIP_TOP} 0 ${EDGE_CLIP_BOTTOM} 0);}`,
        // 桌面边缘：模型下方一条细高光，模拟桌面反射/厚度
        `#waifu::after{content:"";position:absolute;left:0;right:0;bottom:0;`,
        `height:10px;background:linear-gradient(180deg,rgba(0,0,0,0) 0%,`,
        `rgba(255,255,255,.25) 40%,rgba(0,0,0,.12) 100%);`,
        `pointer-events:none;z-index:1;}`,
        `[data-color-mode="dark"] #waifu::after{`,
        `background:linear-gradient(180deg,rgba(0,0,0,0) 0%,`,
        `rgba(255,255,255,.08) 40%,rgba(0,0,0,.35) 100%);}`,
      );
      // 桌面横条视觉（比高光更明显）：画一条横贯容器底部的"桌沿"线
      rules.push(
        `#waifu::before{content:"";position:absolute;left:0;right:0;bottom:10px;`,
        `height:2px;background:rgba(120,180,230,.35);`,
        `pointer-events:none;z-index:1;}`,
      );
    }
    overrideStyle.textContent = rules.join("\n");
    document.head.appendChild(overrideStyle);

    // ---- 复刻 Demo：给图片加载统一加 crossOrigin ----
    patchGlobalImage();

    // ---- 下载进度追踪（必须在 initWidget 之前安装；流式计数 + Layout 注入）----
    const restoreFetch = installProgressTracker(
      (p) => {
        lastProgressAtRef.current = Date.now();
        if (!disposed) setProgress(p);
      },
      EXPECTED_TOTAL_BY_NAME[activeModel],
      layoutConfig,
    );

    // ---- 预加载渲染器 chunk 并打补丁，捕获模型实例（必须在 initWidget 之前）----
    // 失败不阻塞渲染：加载不到也只是少了"拖动飘动"这一锦上添花的物理效果。
    // 用共享 Promise 保证 initWidget 前补丁已就绪，避免插件先创建实例导致动作/物理失效。
    const patchPromise = patchLive2dApp();

    // ---- 渲染门控：轮询模型状态，CompleteSetup(22) 后才放行模型 ----
    // 原实现监听 live2d:rendered（渲染循环一启动就触发，并非模型真正渲染完成），
    // 导致遮罩过早消失、露出没加载完的模型。改为轮询模型实例状态更准确。
    const modelReadyTimer = window.setInterval(() => {
      if (disposed || renderedRef.current) {
        window.clearInterval(modelReadyTimer);
        return;
      }
      const model = getLive2dModel();
      if (model && model._state === 22) {
        renderedRef.current = true;
        setRendered(true);
        setError(null);
        // 就绪后给画布加"已就绪"类，淡入模型
        document.getElementById("live2d")?.classList.add("rin-live2d-ready");
        // 给模型实例包一层 update，注入动作参数动画
        patchModelForActions(model);
        // 模型就绪后打个招呼（挥手）
        window.setTimeout(() => {
          if (!disposed) playAction("wave");
        }, 800);
        window.clearInterval(modelReadyTimer);
      }
    }, 300);

    // ---- 兜底：下载停滞（连续 2 分钟无进展且未渲染）时提示用户 ----
    const stallTimer = window.setInterval(() => {
      if (disposed) return;
      if (renderedRef.current) {
        window.clearInterval(stallTimer);
        return;
      }
      if (Date.now() - lastProgressAtRef.current > 120000) {
        setError(t("theme.live2d.loading.stalled"));
        window.clearInterval(stallTimer);
      }
    }, 30000);

    // ---- 空闲动作/表情轮播：让模型偶尔自己挥手/摇头/跳舞、换表情 ----
    const idleTimer = window.setInterval(() => {
      if (disposed || !renderedRef.current) return;
      const model = getLive2dModel();
      if (!model) return;
      // 正在播放动作时不打断
      if (actionStateRef.current) return;
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
            try {
              model._expressionManager?.stopAllMotions?.();
            } catch {
              // ignore
            }
          }, 3000);
        } catch {
          // ignore
        }
      }
    }, 12000);

    (async () => {
      try {
        // 不做 WebGL 前置检查：与 Demo 的 live2d-widget 插件行为一致。
        // 插件在运行时直接创建 WebGL 上下文，若浏览器不支持会自行在控制台报错并降级。

        // 1) 探测可用的模型源（github.io 优先，失败回退代理）
        const cdnRoot = await pickCdnRoot();
        if (disposed) return;

        // 2) 探测到根地址后立即并行预取当前模型的核心文件（moc3/贴图），
        //    不等插件脚本加载，让大体积 moc3 尽早开始下载
        prefetchModel(cdnRoot, activeModel);

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

        // 6) 复刻 Demo 的调用方式（cdnPath + modelId；毛豆 furina 为 Cubism5 / 使用 cubism5Path）
        loader({
          waifuPath: WIDGET_JSON,
          cdnPath: cdnRoot,
          cubism2Path: CUBISM2_PATH,
          cubism5Path: CUBISM5_PATH,
          tools: TOOLS,
          modelId: AVATAR_MODELS.indexOf(activeModel),
          logLevel: "info",
          // 插件自带拖拽关闭，交给 React 文件夹拖拽统一处理
          drag: false,
        });
        if (disposed) return;

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
      window.clearInterval(modelReadyTimer);
      window.clearInterval(stallTimer);
      window.clearInterval(idleTimer);
      window.removeEventListener("pointermove", onWindowMoveRef.current);
      window.removeEventListener("pointerup", onWindowUpRef.current);
      window.removeEventListener("pointercancel", onWindowUpRef.current);
      restoreFetch();
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

  /**
   * 拖动时驱动衣服/头发飘动的物理：接管模型的 setDragging，用真实指针速度喂值，
   * 让布料在拖动过程中跟着鼠标惯性飘动（模型自带 physics3 重力 Y=-1 会自然带动衣服）。
   * 松手后恢复原函数，拖拽管理器会自然回弹，产生重力惯性感。
   */
  function startDragFlutter() {
    const model = getLive2dModel();
    if (!model) return;
    const setDragging = model.setDragging;
    if (typeof setDragging !== "function") return;
    dragOrigSetDraggingRef.current = setDragging;
    dragVelocityRef.current = { x: 0, y: 0 };
    // 拖动期间忽略渲染器传入的位置值，改用真实指针速度驱动
    model.setDragging = (x: number, y: number) => {
      void x;
      void y;
      const v = dragVelocityRef.current;
      setDragging(clamp(v.x, -1, 1), clamp(v.y, -1, 1));
    };
    draggingRef.current = true;
  }

  // 拖动/卸载结束：恢复模型原 setDragging，喂一个衰减速度让拖拽管理器自然回弹
  function stopDragFlutter() {
    draggingRef.current = false;
    const model = getLive2dModel();
    const orig = dragOrigSetDraggingRef.current;
    if (!model || !orig) {
      dragOrigSetDraggingRef.current = null;
      return;
    }
    let frames = 0;
    const tick = () => {
      if (frames >= 20) {
        model.setDragging = orig;
        dragOrigSetDraggingRef.current = null;
        orig(0, 0);
        return;
      }
      frames++;
      const decay = Math.max(0, 1 - frames / 20);
      const v = dragVelocityRef.current;
      orig(v.x * decay, v.y * decay);
      requestAnimationFrame(tick);
    };
    tick();
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
    const nextLeft = state.origLeft + deltaX;
    const nextTop = state.origTop + deltaY;
    // 限位：不超过视口右下，且顶部不高于 0
    const clampedLeft = Math.min(Math.max(nextLeft, 0), window.innerWidth - 20);
    const clampedTop = Math.min(Math.max(nextTop, 0), window.innerHeight - 20);
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
      localStorage.setItem(POS_KEY, JSON.stringify({ left: wrapper.offsetLeft, top: wrapper.offsetTop }));
    }
    setDragging(false);
    stopDragFlutter();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    delete document.body.dataset.live2dDragging;
  };

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
    const alpha = readPixelAlpha(event.clientX, event.clientY);
    if (alpha < CLICK_ALPHA_THRESHOLD) {
      interactionRef.current = {
        kind: "pending",
        startX: event.clientX,
        startY: event.clientY,
        origLeft: wrapper.offsetLeft,
        origTop: wrapper.offsetTop,
        clientX: event.clientX,
        clientY: event.clientY,
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

  // 加载进度百分比（0-100）
  const pct = progress
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0;

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
      <div
        ref={outerRef}
        className="fixed bottom-2 z-40"
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
          <div className="relative flex flex-col items-center gap-1">
            {showModelPicker && !error ? (
              <div className="absolute right-full top-1/2 mr-2 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-black/10 bg-w p-1.5 shadow dark:border-white/10">
                {AVATAR_MODELS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => switchModel(name)}
                    className={`flex h-8 items-center gap-2 rounded-full px-3 text-sm transition hover:bg-neutral-100 dark:hover:bg-white/10 ${
                      name === activeModel ? "text-theme" : "t-muted"
                    }`}
                    aria-label={t(`theme.live2d.switch.${name}`)}
                    title={t(`theme.live2d.switch.${name}`)}
                  >
                    <i
                      className={
                        name === "furina" ? "ri-water-flash-line" : "ri-fox-line"
                      }
                    />
                    <span>{t(`theme.live2d.switch.${name}`)}</span>
                  </button>
                ))}
              </div>
            ) : null}
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
              onClick={() => setShowModelPicker((value) => !value)}
              className={`rounded-full bg-w p-2 text-sm shadow transition ${showModelPicker ? "text-theme" : "t-muted hover:text-theme"}`}
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
              className="relative"
              style={{ width: boxW, height: boxH }}
            >
              {/* 模型容器：插件生成的 #waifu 会被移入这里。
                  注意：此容器不能有 React 子节点，否则手动 appendChild 的 #waifu 会在 re-render 时被 React 清掉。
                  不能加 overflow-hidden，否则浮在模型上方的 #waifu-tips 气泡会被裁掉。 */}
              <div
                ref={modelAreaRef}
                className="absolute inset-0 cursor-grab touch-none select-none"
                onPointerDown={onPointerDown}
              />
              {/* 加载进度覆盖层：渲染完成前显示（作为兄弟节点，不干扰 #waifu） */}
              {!rendered ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-w/95 text-xs shadow-inner dark:bg-neutral-900/95">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                    <div
                      className="h-full rounded-full bg-theme transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="t-muted">
                    {progress
                      ? `${t("theme.live2d.loading.downloading")} ${pct}%`
                      : t("theme.live2d.loading.connecting")}
                  </span>
                  {progress ? (
                    <span className="t-muted text-[10px]">
                      {(progress.loaded / 1048576).toFixed(1)} /{" "}
                      {(progress.total / 1048576).toFixed(1)} MB
                    </span>
                  ) : null}
                </div>
              ) : null}
              {/* 聊天面板：浮在模型上方 */}
              {chatOpen ? (
                <div className="absolute bottom-full right-0 mb-2 flex w-72 flex-col overflow-hidden rounded-2xl border border-black/10 bg-w shadow-xl dark:border-white/10">
                  <div className="flex items-center justify-between border-b border-black/10 px-3 py-2 dark:border-white/10">
                    <span className="text-sm font-semibold">{t("theme.live2d.chat.title")}</span>
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
                      <p className="t-muted text-xs">{t("theme.live2d.chat.hint")}</p>
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
                      placeholder={t("theme.live2d.chat.placeholder")}
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
