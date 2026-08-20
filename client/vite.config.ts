import { defineConfig, type Plugin } from 'vite'
import { existsSync, readdirSync, createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // 收集本地模型名（子目录），保持与仓库 models/ 目录一致
  const modelNames = () => {
    try {
      return readdirSync(modelsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  };
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
        if (!modelDir.startsWith(normalize(modelsDir) + "/") || !statSync(modelDir, { throwIfNoEntry: false })?.isDirectory()) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        // 模型配置入口：优先 <name>/index.json，否则别名到 <name>/<name>.model3.json
        let rel = decodeURIComponent(afterMarker.slice(slash + 1));
        const model3Index = indexConfigFor(modelDir, name);
        if (rel === "index.json" && model3Index) rel = model3Index;
        const file = normalize(join(modelDir, rel));
        if (!file.startsWith(normalize(modelDir) + "/")) {
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
              : file.endsWith(".wav") || file.endsWith(".mp3")
                ? "audio/wav"
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
      ...(isDev ? [rinLive2dLocalCdn()] : []),
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
