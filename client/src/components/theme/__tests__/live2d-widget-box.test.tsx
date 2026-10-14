// 看板娘容器尺寸的挂载用例：验证「窄屏让位」真的接到组件渲染链上，
// 而不是只存在于 widgetBoxSize 这个纯函数里。
//
// 为什么需要这条链路测试：实际挡住页面控件的是插件的 #waifu 元素，
// 而 #waifu 由 override-style 撑成容器的 100%（插件自带 waifu.css 里 #waifu 没有宽高）。
// 所以只有「容器 inline 宽度随视口变化」成立，收缩才会体现在界面上。
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { Live2DWidget } from "../live2d-widget";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: height,
  });
}

function setViewportWidth(width: number) {
  setViewport(width, 768);
}

// 模型容器：#waifu 的宿主 div，是渲染树里唯一同时带 inline 宽高的 div。
// 不靠 class 定位（Tailwind 类名会被美化改动），只看它自己的尺寸样式。
function boxOf(container: HTMLElement): HTMLElement | null {
  return (
    [...container.querySelectorAll<HTMLElement>("div[style]")].find(
      (el) => el.style.width !== "" && el.style.height !== "",
    ) ?? null
  );
}

function renderWidget(scale: unknown) {
  const config = new ConfigWrapper({ "widget.live2d.scale": scale }, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      <Live2DWidget />
    </ClientConfigContext.Provider>,
  );
}

describe("Live2DWidget 容器尺寸", () => {
  it("窄视口挂载时按视口收缩，宽视口保持配置尺寸", () => {
    setViewportWidth(531);
    const narrow = renderWidget(1);
    // 窄屏比例 0.55、上限 240（见 widgetBoxSize）
    expect(boxOf(narrow.container)?.style.width).toBe("240px");
    expect(boxOf(narrow.container)?.style.height).toBe("240px");
    // 整棵子树默认不吃事件：方形模型区与它的祖先（看板娘根节点）都是
    // pointer-events-none，只有画布由 override-style 的 #live2d{pointer-events:auto} 接管。
    const box = boxOf(narrow.container);
    expect(box?.className).toContain("pointer-events-none");
    let inertAncestor: HTMLElement | null = null;
    for (let el = box?.parentElement ?? null; el; el = el.parentElement) {
      if (el.className.toString().includes("pointer-events-none")) {
        inertAncestor = el;
        break;
      }
    }
    expect(inertAncestor).not.toBeNull();
    narrow.unmount();

    setViewportWidth(1280);
    const wide = renderWidget(1.2);
    expect(boxOf(wide.container)?.style.width).toBe("360px");
    wide.unmount();
  });

  it("视口变化时容器宽度跟着重新计算（resize 监听已接上）", () => {
    setViewportWidth(1280);
    const { container } = renderWidget(1);
    expect(boxOf(container)?.style.width).toBe("300px");

    act(() => {
      setViewportWidth(400);
      window.dispatchEvent(new Event("resize"));
    });
    expect(boxOf(container)?.style.width).toBe("220px");

    act(() => {
      setViewportWidth(1280);
      window.dispatchEvent(new Event("resize"));
    });
    expect(boxOf(container)?.style.width).toBe("300px");
  });

  it("横屏手机（宽度够但很矮）挂载与转屏都按高度让位", () => {
    // 实测 851×393：宽度 851 不触发窄屏规则，旧口径容器仍是 300，
    // 人物高 293 占屏高 75%，加上竖排工具栏正好顶满屏幕。
    setViewport(851, 393);
    const { container } = renderWidget(1);
    expect(boxOf(container)?.style.width).toBe("216px");

    // 转回竖屏（393×851）：高度不再收，仍由宽度收到 216
    act(() => {
      setViewport(393, 851);
      window.dispatchEvent(new Event("resize"));
    });
    expect(boxOf(container)?.style.width).toBe("216px");

    // 回到平板横屏（1024×768）：两个方向都够，恢复配置尺寸
    act(() => {
      setViewport(1024, 768);
      window.dispatchEvent(new Event("resize"));
    });
    expect(boxOf(container)?.style.width).toBe("300px");
  });
});
