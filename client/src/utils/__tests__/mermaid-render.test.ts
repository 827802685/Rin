import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMermaidBlocks } from "../mermaid-render";

// mermaid 本体（含各图表类型分块）是刻意保持"只有页面真的用到才加载"的，
// 这里用 vi.hoisted + vi.mock 把动态 import("mermaid") 换成探针，
// 这样测试既能验证调用顺序，也能验证"没有 mermaid 块时完全不拉 chunk"。
type RunOptions = { suppressErrors: boolean; nodes: ArrayLike<HTMLElement> };

const mermaidDouble = vi.hoisted(() => {
  const initialize = vi.fn((_options: { startOnLoad: boolean; theme: string }) => {});
  const run = vi.fn((_options: RunOptions) => Promise.resolve());
  return { initialize, run };
});

vi.mock("mermaid", () => ({ default: mermaidDouble }));

function addBlock(className: string): HTMLElement {
  const node = document.createElement("pre");
  node.className = className;
  node.textContent = "graph TD; A-->B;";
  document.body.appendChild(node);
  return node;
}

describe("renderMermaidBlocks", () => {
  beforeEach(() => {
    mermaidDouble.initialize.mockClear();
    mermaidDouble.run.mockClear();
    mermaidDouble.run.mockResolvedValue(undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("页面没有 mermaid 块时不加载、不初始化 mermaid", async () => {
    await renderMermaidBlocks();

    expect(mermaidDouble.initialize).not.toHaveBeenCalled();
    expect(mermaidDouble.run).not.toHaveBeenCalled();
  });

  it("保持 default → dark 两段式 initialize 与两次 run", async () => {
    const light = addBlock("mermaid_default");
    const dark = addBlock("mermaid_dark");

    await renderMermaidBlocks();

    expect(mermaidDouble.initialize).toHaveBeenNthCalledWith(1, {
      startOnLoad: false,
      theme: "default",
    });
    expect(mermaidDouble.initialize).toHaveBeenNthCalledWith(2, {
      startOnLoad: false,
      theme: "dark",
    });

    expect(mermaidDouble.run).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mermaidDouble.run.mock.calls.map((call) => call[0]);
    expect(firstCall!.suppressErrors).toBe(true);
    expect(Array.from(firstCall!.nodes)).toEqual([light]);
    expect(secondCall!.suppressErrors).toBe(true);
    expect(Array.from(secondCall!.nodes)).toEqual([dark]);
  });

  it("并发调用串行排队，主题切换不互相穿插", async () => {
    addBlock("mermaid_default");

    await Promise.all([renderMermaidBlocks(), renderMermaidBlocks()]);

    const themes = mermaidDouble.initialize.mock.calls.map((call) => call[0].theme);
    expect(themes).toEqual(["default", "dark", "default", "dark"]);
  });

  it("渲染失败只记录日志，既不抛出也不影响后续调用", async () => {
    addBlock("mermaid_default");
    mermaidDouble.run.mockRejectedValueOnce(new Error("parse error"));

    await expect(renderMermaidBlocks()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(new Error("parse error"));

    // 队列没有被失败的调用堵死
    mermaidDouble.run.mockResolvedValue(undefined as never);
    await renderMermaidBlocks();
    expect(mermaidDouble.run).toHaveBeenCalledTimes(3);
  });
});
