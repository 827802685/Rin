import { defineConfig, type Plugin } from 'vite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize } from 'node:path'
import react from '@vitejs/plugin-react-swc'
import { visualizer } from "rollup-plugin-visualizer";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
