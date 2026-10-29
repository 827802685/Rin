import type { Plugin } from 'unified';
import type { Content, Root } from 'mdast';
import katex from 'katex';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function processNode(child: Content, index: number, siblings: Content[]) {
  if (child.type !== 'code') {
    if ('children' in child && Array.isArray(child.children)) {
      child.children.forEach(processNode);
    }
    return;
  }
  const { lang, value } = child;
  // 仅处理 ```math 围栏块；行内/块级 $...$ 由 remark-math + rehype-katex 处理
  if (lang !== 'math') return;
  let inner: string;
  try {
    inner = katex.renderToString(value || '', {
      displayMode: true,
      throwOnError: false,
      output: 'html',
    });
  } catch {
    inner = `<pre class="rin-math-fallback">${escapeHtml(value || '')}</pre>`;
  }
  siblings[index] = {
    type: 'html',
    value: `<div class="rin-math-block">${inner}</div>`,
  };
}

/**
 * 把 ```math 围栏块渲染为 KaTeX HTML（与 remarkMermaid 处理 ```mermaid 同构）。
 * 编辑器侧以 codeBlock(language=math) 存储，tiptap-markdown 序列化为 ```math，
 * 公开页经本插件转成公式。
 */
const remarkMathBlock: Plugin<[], Root> = () => (root: Root) => {
  if (Array.isArray(root.children)) {
    root.children.forEach(processNode);
  }
};

export default remarkMathBlock;
