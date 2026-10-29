import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { Banner } from "../banner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithConfig(overrides: Record<string, unknown>) {
  const config = new ConfigWrapper(overrides, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      <Banner />
    </ClientConfigContext.Provider>,
  );
}

describe("Banner（美化清单⑧，配置驱动）", () => {
  it("未配置 appearance.banner 时不渲染任何内容", () => {
    const { container } = renderWithConfig({});
    expect(container.textContent).toBe("");
  });

  it("配置了图片数组时渲染轮播图", () => {
    const { container } = renderWithConfig({
      "appearance.banner": JSON.stringify(["https://example.com/a.png", "https://example.com/b.png"]),
    });
    expect(container.querySelectorAll("img").length).toBe(2);
  });

  it("配置为非 JSON 时不渲染（容错）", () => {
    const { container } = renderWithConfig({ "appearance.banner": "not-json" });
    expect(container.textContent).toBe("");
  });
});
