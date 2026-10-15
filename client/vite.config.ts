import { defineConfig, type Plugin } from 'vite'
import {
  existsSync, readdirSync, createReadStream, statSync, rmSync, mkdirSync,
  writeFileSync, cpSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, relative } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";
// 前端模型清单唯一来源（避免与 live2d-widget.tsx 各自硬编码一份顺序）
import { BUILTIN_MODELS } from './src/components/theme/live2d/models'
// 引擎文件清单唯一来源（镜像与运行时探测共用同一份，避免两处各写一遍）
import { ENGINE_FILES, LOCAL_ENGINE_DIST, REMOTE_ENGINE_DIST } from './src/components/theme/live2d/engine'

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Live2D 看板娘插件引擎（waifu.css / waifu-tips.js / chunk / Cubism core）的本地镜像。
 *
 * 这 7 个小文件决定看板娘是否存在，原先只从 github.io 拉；对国内读者 github.io 经常不通，
 * 结果是整个挂件不出现。这里把它们缓存到 client/.live2d-engine/（gitignored），
 * dev 由中间件同源直出、build 拷进产物，运行时（live2d/engine.ts）先探同源、取不到才回退远端。
 * 离线时下载失败只是退回改动前的行为，不会把构建弄挂。
 */
const ENGINE_CACHE_DIR = join(__dirname, ".live2d-engine");

async function ensureEngineFile(rel: string): Promise<string | null> {
  const file = join(ENGINE_CACHE_DIR, rel);
  // 认「已存在且非空」：上次写坏/写断的 0 字节文件会重新下载
  if (existsSync(file) && statSync(file).size > 0) return file;
  try {
    const res = await fetch(`${REMOTE_ENGINE_DIST}${rel}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`[rin] 引擎镜像取不到 ${rel}：HTTP ${res.status}`);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      console.warn(`[rin] 引擎镜像取到空文件 ${rel}`);
      return null;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, buf);
    return file;
  } catch (e) {
    console.warn(`[rin] 引擎镜像取不到 ${rel}：${String(e).slice(0, 120)}`);
    return null;
  }
}

function rinLive2dEngineDevMiddleware(): Plugin {
  const mime = (rel: string) =>
    rel.endsWith(".css") ? "text/css" : rel.endsWith(".json") ? "application/json" : "application/javascript";
  return {
    name: 'rin:live2d-engine-mirror',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith(LOCAL_ENGINE_DIST)) return next();
        let rel: string;
        try {
          rel = decodeURIComponent(url.slice(LOCAL_ENGINE_DIST.length));
        } catch {
          rel = url.slice(LOCAL_ENGINE_DIST.length);
        }
        // 只认清单里的路径（不做通用文件映射，杜绝目录穿越）
        const wanted = ENGINE_FILES.find((f) => f === rel);
        if (!wanted) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        void ensureEngineFile(wanted).then((file) => {
          if (!file) {
            // 让前端的同源探测失败 → 回退远端，与改动前一致
            res.statusCode = 502;
            res.end("engine mirror unavailable");
            return;
          }
          // MIME 必须是真正的 JS/CSS：运行时按 content-type 判资源可用（见 live2d/engine.ts）
          res.setHeader("content-type", mime(wanted));
          res.setHeader("cache-control", "no-store");
          createReadStream(file).pipe(res);
        });
        return;
      });
    },
  };
}

function rinLive2dEngineBundle(): Plugin {
  return {
    name: 'rin:live2d-engine-bundle',
    apply: 'build',
    async closeBundle() {
      const out = join(__dirname, "..", "dist", "client", ...LOCAL_ENGINE_DIST.split("/").filter(Boolean));
      const missing: string[] = [];
      for (const rel of ENGINE_FILES) {
        const file = await ensureEngineFile(rel);
        if (!file) {
          missing.push(rel);
          continue;
        }
        const dest = join(out, rel);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(file, dest);
      }
      if (missing.length) {
        console.warn(`[rin] 看板娘引擎镜像缺 ${missing.length} 个文件（${missing.join(", ")}）：运行时回退远端 CDN`);
      } else {
        console.log(`[rin] 看板娘插件引擎已随产物打包: ${LOCAL_ENGINE_DIST}（${ENGINE_FILES.length} 个文件）`);
      }
    },
  };
}

/**
 * Live2D 看板娘本地模型源（仅 dev）。
 *
 * 看板娘插件从远端 CDN 拉大体积 moc3/4K 贴图，开发时极慢。这里用一个
 * Vite dev 中间件把本地 models/ 下每个子目录按插件期望的路径结构暴露出来，
 * 让看板娘在开发环境直接读本地文件（毫秒级），生产构建不受影响（apply:"serve"）。
 *
 * 插件期望的 CDN 结构（与 https://827802685.github.io/Live2D/ 一致）：
 *   <cdnRoot>model_list.json              -> {"messages":[...],"models":["<name>", ...]}
 *   <cdnRoot>model/<name>/index.json      -> 模型配置入口（模型库存量清单）
 *   <cdnRoot>model/<name>/<FileReferences> -> index.json 里引用的各文件
 *
 * 我们把 CDN 根指向 http://localhost:<devPort>/rin-live2d-cdn/ 即可命中这里。
 * 说明：
 *   - modelsDir 下每个子目录对应一个模型 <name>（目录名即模型名）；
 *   - 若某模型目录内自带 index.json，则插件直接使用它；
 *     否则（如 furina 配置文件名是 furina.model3.json）把 index.json 别名映射过去。
 */
function rinLive2dLocalCdn(): Plugin {
  const modelsDir = join(__dirname, "../models");
  // 防目录穿越：跨平台判断 child 是否在 parent 目录内。
  // 不能写 child.startsWith(parent + "/") —— Windows 上 normalize 产出反斜杠，
  // 该判断恒为 false，会把所有模型文件误判成越界（实测整站 404、只能回落远端大模型）。
  const isInside = (parent: string, child: string) => {
    const rel = relative(normalize(parent), normalize(child));
    return rel !== "" && !rel.startsWith("..") && !rel.includes(":");
  };
  // 本地模型漫游顺序：与前端 live2d/models.ts 的 BUILTIN_MODELS 完全一致
  // （["furina","BCSZ1.1"]），不要用目录字典序（会排成 ["BCSZ1.1","furina"]），
  // 否则插件用 modelId 下标解析模型名会取错。
  const listModelDirs = () => {
    try {
      return readdirSync(modelsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      return [] as string[];
    }
  };
  // 收集本地模型名：按前端固定顺序返回，仅保留实际存在的目录
  const modelNames = () =>
    BUILTIN_MODELS.filter((n) => listModelDirs().includes(n));
  return {
    name: "rin:live2d-local-cdn",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || "").split("?")[0];
        if (!url.startsWith("/rin-live2d-cdn/")) return next();
        let target: string;
        try {
          target = decodeURIComponent(url.slice("/rin-live2d-cdn/".length));
        } catch {
          target = url.slice("/rin-live2d-cdn/".length);
        }
        // 根清单：返回本地全部模型（与生产 CDN 保持一致，含 furina 与 BCSZ1.1）
        if (target === "model_list.json") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ messages: ["本地模型加载中 ~"], models: modelNames() }));
          return;
        }
        // 模型文件：model/<name>/<path>
        const marker = "model/";
        if (!target.startsWith(marker)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const afterMarker = target.slice(marker.length); // <name>/<path>
        const slash = afterMarker.indexOf("/");
        if (slash < 0) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        const name = decodeURIComponent(afterMarker.slice(0, slash));
        const modelDir = normalize(join(modelsDir, name));
        if (!isInside(modelsDir, modelDir) || !statSync(modelDir, { throwIfNoEntry: false })?.isDirectory()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        // 模型配置入口：优先 <name>/index.json，否则别名到 <name>/<name>.model3.json
        let rel = decodeURIComponent(afterMarker.slice(slash + 1));
        const model3Index = indexConfigFor(modelDir, name);
        if (rel === "index.json" && model3Index) rel = model3Index;
        const file = normalize(join(modelDir, rel));
        if (!isInside(modelDir, file)) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        // 简单按扩展名映射 MIME
        const mime =
          file.endsWith(".json")
            ? "application/json"
            : file.endsWith(".png")
              ? "image/png"
              : file.endsWith(".wav")
                ? "audio/wav"
                : file.endsWith(".mp3")
                  ? "audio/mpeg"
                  : "application/octet-stream";
        res.setHeader("content-type", mime);
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-length", String(statSync(file).size));
        createReadStream(file).pipe(res);
        return;
      });
    },
  };
}

// 若模型目录内没有 index.json，则把配置文件名规约为 <name>.model3.json（如 furina）
function indexConfigFor(modelDir: string, name: string): string | null {
  if (existsSync(join(modelDir, "index.json"))) return null;
  const rel = `${name}.model3.json`;
  return existsSync(join(modelDir, rel)) ? rel : null;
}

/**
 * monaco-editor (>= 0.5x) ships an inline-completions view that imports
 * `.../inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js`.
 * When `node_modules/monaco-editor` comes from a corrupted / partial tarball
 * (e.g. a registry mirror was offline mid-download) that file is missing and
 * Vite hard-fails with:
 *
 *   Could not resolve "./inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js"
 *
 * The upstream tarball DOES contain the file; the failure is purely a broken
 * local install. To keep the build resilient instead of relying on manual
 * node_modules surgery (which a later `bun install` overwrites), we conditionally
 * redirect the fragile internal module to a local no-op shim. The shim is used
 * ONLY when the real file is absent, so healthy installs keep the real monaco
 * code and the inline-Copilot "long distance hint" UI (never used by this
 * markdown editor) stays inert.
 */
function monacoLongDistanceHintShim(): Plugin {
  const relPath = 'node_modules/monaco-editor/esm/vs/editor/contrib/inlineCompletions/browser/view/inlineEdits/inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js';
  // monaco may be hoisted to the repo root or nested under client/node_modules
  const candidates = [join(__dirname, relPath), join(__dirname, '../', relPath)];
  const realFile = candidates.find((p) => existsSync(p));
  if (realFile) {
    return { name: 'rin:monaco-long-distance-shim', enforce: 'pre', resolveId: (id) => { /* noop */ } };
  }
  const shimFile = fileURLToPath(new URL('./src/vendors/monaco-inline-edits-long-distance-hint.shim.ts', import.meta.url));
  const shimPath = normalize(shimFile);
  return {
    name: 'rin:monaco-long-distance-shim',
    enforce: 'pre',
    // Redirect the internal specifier used by inlineEditsView.js to the shim.
    resolveId(source) {
      if (source.includes('inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint')) {
        return shimPath;
      }
      return null;
    },
  };
}

/**
 * Live2D 看板娘模型打进产物（仅 build）。
 *
 * Cloudflare 单文件上限 25MiB：furina 的 moc3 单文件约 95MB 超限，只能走远端
 * CDN；但 BCSZ1.1 整个模型约 11.8MB、单文件最大约 3.4MB（贴图已降到 4096²），
 * 完全可随博客静态资源一起分发（同域、全球 CDN、毫秒级，彻底摆脱远端 github.io
 * 的小水管）。
 *
 * 产物结构（与插件期望的 CDN 布局一致）：
 *   <root>/live2d-bundled/model_list.json          -> {"messages":[],"models":["BCSZ1.1"]}
 *   <root>/live2d-bundled/model/BCSZ1.1/index.json  -> 模型配置入口
 *   <root>/live2d-bundled/model/BCSZ1.1/...         -> 其余模型文件
 * 前端的 BCSZ1.1 候选根即为 `${location.origin}/live2d-bundled/`。
 */
function rinLive2dBundledModel(): Plugin {
  const src = join(__dirname, '../models/BCSZ1.1');
  return {
    name: 'rin:live2d-bundled-model',
    apply: 'build',
    closeBundle() {
      const out = join(__dirname, '../dist/client/live2d-bundled');
      const modelDir = join(out, 'model/BCSZ1.1');
      if (!existsSync(src)) {
        console.warn('[rin] models/BCSZ1.1 不存在，跳过 Live2D 模型打包');
        return;
      }
      rmSync(modelDir, { recursive: true, force: true });
      mkdirSync(modelDir, { recursive: true });
      cpSync(src, modelDir, { recursive: true });
      writeFileSync(
        join(out, 'model_list.json'),
        // 打包根只声明 BCSZ1.1（下标 0 = BCSZ1.1）。
        // 原则：本域打包根只放"可随站打包的模型"；furina 单文件 95MB 超 Pages 限制
        // 不放这里。插件 initCheck 用 localStorage.modelId 按下标取 model_list.models
        // 拼 index.json；本根只有 BCSZ1.1 时 modelId 恒为 0 → 恒命中 BCSZ1.1。
        // 想切 furina 时 switchModel 会重新 pickCdnRoot 到远端 github.io 根加载。
        JSON.stringify({ messages: [], models: ['BCSZ1.1'] }),
      );
      console.log('[rin] Live2D 模型已随产物打包: live2d-bundled/');
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  const serverPort = Number(process.env.RIN_SERVER_PORT || "11499");
  const serverTarget = `http://127.0.0.1:${serverPort}`;
  const cacheDir = process.env.RIN_VITE_CACHE_DIR || "../.vite/client";
  
  return {
    cacheDir,
    // Note: Client configuration is fetched from server at runtime
    // No environment variables are injected at build time
    build: {
      outDir: '../dist/client',
      emptyOutDir: true,
    },
    plugins: [
      react(),
      monacoLongDistanceHintShim(),
      ...(isDev ? [rinLive2dLocalCdn(), rinLive2dEngineDevMiddleware()] : []),
      rinLive2dBundledModel(),
      rinLive2dEngineBundle(),
      // Only open visualizer in build mode
      visualizer({ open: !isDev })
    ],
    server: {
      proxy: {
        "/api": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/atom.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/rss.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.json": {
          target: serverTarget,
          changeOrigin: false,
        },
        "/feed.xml": {
          target: serverTarget,
          changeOrigin: false,
        },
      },
    },
    // Vitest configuration
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
    },
  }
})
