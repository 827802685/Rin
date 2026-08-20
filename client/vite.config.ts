import { defineConfig, type Plugin } from 'vite'
import { existsSync, createReadStream, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Live2D 看板娘本地模型源（仅 dev）。
 *
 * 看板娘插件从远端 CDN 拉 98.9MB 的 moc3/4K 贴图，开发时极慢。这里用一个
 * Vite dev 中间件把本地 models/furina 目录按插件期望的路径结构暴露出来，
 * 让看板娘在开发环境直接读本地文件（毫秒级）。
 *
 * 插件期望的 CDN 结构（与 https://827802685.github.io/Live2D/ 一致）：
 *   <cdnRoot>model_list.json              -> {"messages":[...],"models":["furina"]}
 *   <cdnRoot>model/furina/<FileReferences>  -> furina.model3.json 里引用的各文件
 * 我们把 CDN 根指向 http://localhost:<devPort>/rin-live2d-cdn/ 即可命中这里。
 */
function rinLive2dLocalCdn(): Plugin {
  const modelsDir = join(__dirname, "../models/furina");
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
        // 根清单：返回单一模型 furina
        if (target === "model_list.json") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ messages: ["本地模型加载中 ~"], models: ["furina"] }));
          return;
        }
        // 模型文件：model/furina/<path>
        const marker = "model/furina/";
        if (!target.startsWith(marker)) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        // 插件把模型清单里给定的模型名 <name> 映射为 model/<name>/index.json，
        // 而本地模型配置文件名是 furina.model3.json，这里做一次别名映射。
        let rel = target.slice(marker.length);
        if (rel === "index.json") rel = "furina.model3.json";
        const file = normalize(join(modelsDir, rel));
        if (!file.startsWith(normalize(modelsDir))) {
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
