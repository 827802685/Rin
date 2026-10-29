import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMathToHtml } from "../code-block-enhancer";
import { Markdown } from "../../markdown";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../utils/darkModeUtils", () => ({ useColorMode: () => "light" }));

function installClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn(writeText) },
    configurable: true,
  });
  return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(window, "isSecureContext");
});

describe("renderMathToHtml", () => {
  it("produces KaTeX HTML for a valid formula", () => {
    const html = renderMathToHtml("E = mc^2");
    expect(html).toContain("katex");
    expect(html).toContain("=");
  });

  it("does not throw on invalid LaTeX (throwOnError:false)", () => {
    const html = renderMathToHtml("\\frac{1}{");
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
  });

  it("returns safe html for empty source", () => {
    const html = renderMathToHtml("");
    expect(html).toContain("katex");
  });
});

describe("Markdown ```math block (remarkMathBlock)", () => {
  beforeEach(() => installClipboard(async () => {}));

  it("renders a ```math fenced block as a KaTeX block (regression: 公式图表差异化)", () => {
    const { container } = render(
      <Markdown content={"```math\nE = mc^2\n```"} />,
    );
    // 插件把 ```math 转成 <div class="rin-math-block"> 内含 katex
    expect(container.querySelector(".rin-math-block")).toBeTruthy();
    expect(container.querySelector(".katex")).toBeTruthy();
  });

  it("does not treat ```math as a normal copyable code block", () => {
    render(<Markdown content={"```math\nE = mc^2\n```"} />);
    expect(screen.queryByRole("button", { name: "code_block.copy" })).toBeNull();
  });

  it("still renders normal code blocks with a copy button", () => {
    render(<Markdown content={"```ts\nconst a = 1;\n```"} />);
    expect(screen.getByRole("button", { name: "code_block.copy" })).toBeTruthy();
  });
});
