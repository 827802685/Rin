import { useEffect, useState } from "react";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlock } from "@tiptap/extension-code-block";
import katex from "katex";

/**
 * 把 KaTeX 公式源码渲染为 HTML 字符串。
 * 抽成纯函数便于单测（katex.renderToString 在 jsdom/node 下也能跑）。
 */
export function renderMathToHtml(source: string): string {
  return katex.renderToString(source || "", {
    displayMode: true,
    throwOnError: false,
    output: "html",
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 公式块：实时预览 KaTeX，源码可折叠编辑 */
function MathBlockView({ node }: { node: { textContent: string } }) {
  const source = node.textContent;
  const [html, setHtml] = useState("");
  useEffect(() => {
    try {
      setHtml(renderMathToHtml(source));
    } catch {
      setHtml("");
    }
  }, [source]);
  return (
    <NodeViewWrapper className="rin-codeblock rin-codeblock-math" data-language="math">
      <div
        className="rin-math-preview"
        dangerouslySetInnerHTML={{ __html: html || `<pre>${escapeHtml(source)}</pre>` }}
      />
      <details className="rin-codeblock-source">
        <summary>LaTeX 源码</summary>
        <pre>
          <NodeViewContent />
        </pre>
      </details>
    </NodeViewWrapper>
  );
}

/** 图表块：实时渲染 Mermaid，失败/未就绪时回退展示源码 */
function MermaidBlockView({ node }: { node: { textContent: string } }) {
  const source = node.textContent;
  const [svg, setSvg] = useState<string>("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setFailed(false);
    import("mermaid")
      .then(({ default: mermaid }) => {
        try {
          mermaid.initialize({ startOnLoad: false, theme: "default" });
          return mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, source || "");
        } catch (e) {
          throw e;
        }
      })
      .then(({ svg }: { svg: string }) => {
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  return (
    <NodeViewWrapper className="rin-codeblock rin-codeblock-mermaid" data-language="mermaid">
      {failed ? (
        <pre className="rin-mermaid-fallback">{source}</pre>
      ) : svg ? (
        <div className="rin-mermaid-preview" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <pre className="rin-mermaid-loading">{source}</pre>
      )}
      <details className="rin-codeblock-source">
        <summary>Mermaid 源码</summary>
        <pre>
          <NodeViewContent />
        </pre>
      </details>
    </NodeViewWrapper>
  );
}

function CodeBlockView(props: any) {
  const node = props.node;
  const lang = ((node?.attrs?.language as string) || "").toLowerCase();
  if (lang === "mermaid") {
    return <MermaidBlockView node={node} />;
  }
  if (lang === "math") {
    return <MathBlockView node={node} />;
  }
  // 其它语言保持默认 <pre> 渲染，保证原有代码块行为不变
  return (
    <NodeViewWrapper as="pre" className="rin-codeblock">
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

/**
 * 扩展内置 CodeBlock：
 * - language=mermaid / math 时渲染可视化预览（差异化公式/图表块）；
 * - 其它语言保持默认渲染。
 * 复用 tiptap-markdown 对 codeBlock 的往返序列化，不新增节点类型，避免序列化崩坏。
 * 使用 addNodeView（而非插件 nodeViews）以兼容 ReactNodeViewRenderer 的类型。
 */
export const CodeBlockEnhancer = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
