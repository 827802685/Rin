import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../state/config";
import { NotFoundPage } from "../../page/not-found";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../components/button", () => ({
  Button: ({ title }: { title: string }) => <button>{title}</button>,
}));

function render404(overrides: Record<string, unknown> = {}) {
  const config = new ConfigWrapper(overrides, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      <NotFoundPage />
    </ClientConfigContext.Provider>,
  );
}

describe("NotFoundPage 404 插画页", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("默认渲染内置樱花鸟居 SVG 与返回按钮", () => {
    const { container } = render404();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toContain("🌸");
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("配置 appearance.notfound_image 时用自定义插画替代内置 SVG", () => {
    const { container } = render404({ "appearance.notfound_image": "https://img.example/404.png" });
    expect(container.querySelector("svg")).toBeNull();
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("https://img.example/404.png");
  });
});
