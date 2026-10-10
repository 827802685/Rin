/**
 * mermaid 按需渲染工具。
 *
 * 之前 feed / writing 页面都 `import mermaid from "mermaid"` 静态引入，
 * 导致 mermaid 本体（含大量解析器/图表类型）被打进首屏主 chunk。
 * 这里改为：只有页面上确实存在待渲染的 mermaid 代码块时，才动态
 * `import("mermaid")` 并执行原有的 initialize → run(default) →
 * initialize → run(dark) 流程。
 *
 * 行为保留点：
 * - initialize 配置原样保留（startOnLoad:false + theme default/dark 两段式）；
 * - run 仍带 suppressErrors:true，解析失败的图按原逻辑静默降级（不抛出）；
 * - 动态 import 失败时只 console.error，不炸页面；
 * - 并发去重：模块级缓存续接同一 import；渲染调用串行排队，
 *   避免多次触发的 initialize 主题切换互相穿插。
 */

type MermaidInstance = typeof import("mermaid").default;

/** 并发去重：同一时刻只会有一次 mermaid chunk 请求 */
let mermaidLoader: Promise<MermaidInstance> | null = null;

function loadMermaid(): Promise<MermaidInstance> {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid")
      .then(({ default: instance }) => instance)
      .catch((error) => {
        // 允许下次调用重试失败的加载
        mermaidLoader = null;
        throw error;
      });
  }
  return mermaidLoader;
}

/** 串行队列：渲染调用按到达顺序执行，保持 default→dark 的主题切换时序 */
let renderQueue: Promise<void> = Promise.resolve();

async function runMermaidBlocks(
  defaultNodes: NodeListOf<HTMLElement>,
  darkNodes: NodeListOf<HTMLElement>,
): Promise<void> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
  });
  await mermaid.run({
    suppressErrors: true,
    nodes: defaultNodes,
  });
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
  });
  await mermaid.run({
    suppressErrors: true,
    nodes: darkNodes,
  });
}

/**
 * 渲染页面上所有 mermaid 代码块（与改造前 feed/writing 中的逻辑一致）。
 * 若当前 DOM 里没有任何 mermaid 块，则完全不会加载 mermaid chunk。
 */
export async function renderMermaidBlocks(): Promise<void> {
  const defaultNodes = document.querySelectorAll<HTMLElement>("pre.mermaid_default");
  const darkNodes = document.querySelectorAll<HTMLElement>("pre.mermaid_dark");
  if (defaultNodes.length === 0 && darkNodes.length === 0) {
    return;
  }
  const next = renderQueue.then(() => runMermaidBlocks(defaultNodes, darkNodes));
  // 调用方一律以 void 使用，这里把失败收敛到队列内部，避免 unhandled rejection
  renderQueue = next.catch((error: unknown) => {
    // 与改造前的失败路径对齐：渲染/加载异常只记录，不阻断后续调用
    console.error(error);
  });
  await renderQueue;
}
