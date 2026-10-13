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

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

// 模型容器：#waifu 的宿主 div（className="relative" + inline 宽高），
// 其唯一子节点是绝对定位的模型区（cursor-grab）。
function boxOf(container: HTMLElement): HTMLElement | null {
  const cage = container.querySelector<HTMLElement>(".cursor-grab");
  return cage?.parentElement ?? null;
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
    expect(boxOf(narrow.container)?.style.width).toBe("239px");
    expect(boxOf(narrow.container)?.style.height).toBe("239px");
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
    expect(boxOf(container)?.style.width).toBe("180px");

    act(() => {
      setViewportWidth(1280);
      window.dispatchEvent(new Event("resize"));
    });
    expect(boxOf(container)?.style.width).toBe("300px");
  });
});
