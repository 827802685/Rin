import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../../state/config";
import { sidebarLayoutDefinition } from "../sidebar-layout";
import { Header } from "../../../../components/header";

// jsdom 没有 ResizeObserver（header.tsx 观测高度用）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? ResizeObserverStub;

// 拦截站点侧栏的标签请求（jsdom 无后端）
vi.mock("../../../../app/runtime", () => ({
  client: {
    tag: {
      list: vi.fn().mockResolvedValue({ data: [{ id: 1, name: "test", count: 3 }] }),
    },
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderShell() {
  const config = new ConfigWrapper({ "header.layout": "sidebar" }, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      {sidebarLayoutDefinition.renderRouteShell({
        header: <Header>{null}</Header>,
        content: <div>content-fallback</div>,
        rawContent: <div>page-content</div>,
        footer: <footer>site-footer</footer>,
        paddingClassName: undefined,
      })}
    </ClientConfigContext.Provider>,
  );
}

describe("sidebar 布局 renderRouteShell（双侧边栏壳）", () => {
  it("渲染右侧栏 aside：ProfileCard + 标签 + TOC 传送槽", async () => {
    const { container } = renderShell();

    const aside = container.querySelector("aside");
    expect(aside).toBeTruthy();
    expect(aside?.className).toContain("w-72");

    // TOC 传送槽位存在（SidebarTocPortal 依赖 #rin-sidebar-slot）
    expect(document.getElementById("rin-sidebar-slot")).toBeTruthy();

    // rawContent 优先生效
    expect(screen.getByText("page-content")).toBeTruthy();

    // 侧栏内容（ProfileCard 的标签/时间线链接，来自 i18n key）
    await waitFor(() => expect(screen.getAllByText("sidebar.view_tags").length).toBeGreaterThan(0));
  });
});
