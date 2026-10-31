import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// SiteSidebar 会打标签接口，壳层测试只关心槽位结构，mock 掉数据组件
vi.mock("../../../site-sidebar/sidebar", () => ({
    SiteSidebar: () => <div data-testid="site-sidebar" />,
}));

// 壳层里的窄屏折叠面板要取按钮文案，测试环境没有 i18n 实例，直接回显 key
vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

const { getHeaderLayoutDefinition } = await import("../../layout-registry");
const { sidebarLayoutDefinition } = await import("../sidebar-layout");

describe("header layout registry", () => {
    it("registers the sidebar shell as a first-class layout", () => {
        expect(getHeaderLayoutDefinition("sidebar")).toBe(sidebarLayoutDefinition);
        expect(sidebarLayoutDefinition.kind).toBe("sidebar");
    });

    it("falls back to classic for unknown layouts", () => {
        expect(getHeaderLayoutDefinition("retro-three-column").kind).toBe("top");
        expect(getHeaderLayoutDefinition(null).kind).toBe("top");
    });
});

describe("sidebarLayoutDefinition.renderRouteShell", () => {
    it("places raw content in the main column and the sidebar in the aside", () => {
        const { container } = render(
            <div>
                {sidebarLayoutDefinition.renderRouteShell({
                    header: <div data-testid="header" />,
                    content: "rendered-content",
                    rawContent: <div data-testid="raw">raw-content</div>,
                    footer: <div data-testid="footer" />,
                })}
            </div>,
        );

        // 壳层不再用 <main>：页面自己已经渲染了一个 <main>，嵌套会违反 HTML 规范
        const main = container.querySelector(".min-w-0.flex-1");
        expect(main).not.toBeNull();
        // rawContent 优先于已包壳的 content
        expect(screen.getByTestId("raw")).toBeTruthy();
        expect(screen.queryByText("rendered-content")).toBeNull();
        // 页面自带的 wauto 收窄类被覆盖为满宽
        expect(main!.className).toContain("[&_.wauto]:w-full");
        expect(container.querySelector("aside")?.querySelector('[data-testid="site-sidebar"]')).toBeTruthy();
        expect(screen.getByTestId("header")).toBeTruthy();
        expect(screen.getByTestId("footer")).toBeTruthy();
    });

    it("falls back to content when rawContent is absent", () => {
        const { container } = render(
            <div>
                {sidebarLayoutDefinition.renderRouteShell({
                    header: <div />,
                    content: "rendered-content",
                    footer: <div />,
                })}
            </div>,
        );

        expect(container.querySelector(".min-w-0.flex-1")?.textContent).toContain("rendered-content");
    });

    it("mounts a collapsed sidebar panel for narrow screens", () => {
        const { container } = render(
            <div>
                {sidebarLayoutDefinition.renderRouteShell({
                    header: <div />,
                    content: "rendered-content",
                    footer: <div />,
                })}
            </div>,
        );

        // 桌面 aside 之外还要有一份窄屏入口，否则手机上的侧栏内容彻底丢失
        const toggle = container.querySelector("button[aria-expanded]");
        expect(toggle).not.toBeNull();
        expect(toggle!.getAttribute("aria-expanded")).toBe("false");
        expect(toggle!.textContent).toContain("sidebar.narrow_title");
        // 默认收起：展开前不重复挂载侧栏数据组件
        expect(screen.getAllByTestId("site-sidebar")).toHaveLength(1);

        fireEvent.click(toggle!);

        expect(toggle!.getAttribute("aria-expanded")).toBe("true");
        expect(screen.getAllByTestId("site-sidebar")).toHaveLength(2);
    });
});
