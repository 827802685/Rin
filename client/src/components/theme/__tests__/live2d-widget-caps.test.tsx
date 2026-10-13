// 「设置保存后不刷新即时生效」的挂载链路用例。
//
// 为什么需要这条测试：帧率封顶落在渲染循环每帧调用的 subdelegate.update 上，
// 应用它的 applyRenderCaps 定义在 deps 为 [modelVersion] 的长生命周期 effect 里，
// 闭包捕获的是挂载那一次渲染的 ConfigWrapper 实例。设置保存后 Provider 换成的是
// **新的包装对象**（内部 config 是快照，不是活引用），旧闭包读到的仍是旧值——
// 真机实测过：下拉选「30 帧」保存后 subdelegate 上没有出现遮蔽。
// 现在 applyRenderCaps 通过 configRef 读最新实例，这里把这条链路钉住。
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { Live2DWidget } from "../live2d-widget";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  delete (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp;
});

// 造一个与远端引擎同形状的 app：_subdelegates 是 getSize/at 列表，update 在原型上
function installFakeApp() {
  class Sub {
    draws = 0;
    update() {
      this.draws += 1;
    }
  }
  const items = [new Sub()];
  (window as unknown as { __rinLive2dApp?: unknown }).__rinLive2dApp = {
    _subdelegates: {
      getSize: () => items.length,
      at: (i: number) => items[i],
    },
  };
  return items;
}

function isShadowed(sub: object) {
  return Object.prototype.hasOwnProperty.call(sub, "update");
}

function renderWidget(fpsCap: unknown) {
  const config = new ConfigWrapper(
    { "widget.live2d.scale": 1, "widget.live2d.fps_cap": fpsCap },
    defaultClientConfig,
  );
  return render(
    <ClientConfigContext.Provider value={config}>
      <Live2DWidget />
    </ClientConfigContext.Provider>,
  );
}

describe("Live2DWidget 渲染封顶的设置联动", () => {
  it("换用新的 ConfigWrapper（模拟保存后的 Provider）时，不重挂载也能挂上帧率封顶", () => {
    vi.spyOn(performance, "now").mockImplementation(() => 1000);
    const items = installFakeApp();
    expect(isShadowed(items[0])).toBe(false);

    const view = renderWidget(0);
    expect(isShadowed(items[0])).toBe(false);

    // 保存「30 帧」：Provider 下发新实例，组件只 re-render，不重新挂载插件
    act(() => {
      view.rerender(
        <ClientConfigContext.Provider value={new ConfigWrapper({ "widget.live2d.scale": 1, "widget.live2d.fps_cap": 30 }, defaultClientConfig)}>
          <Live2DWidget />
        </ClientConfigContext.Provider>,
      );
    });
    expect(isShadowed(items[0])).toBe(true);
    expect((items[0].update as unknown as { rinFpsCap?: boolean }).rinFpsCap).toBe(true);

    // 改回「不封顶」：撤掉遮蔽，恢复原型方法
    act(() => {
      view.rerender(
        <ClientConfigContext.Provider value={new ConfigWrapper({ "widget.live2d.scale": 1, "widget.live2d.fps_cap": 0 }, defaultClientConfig)}>
          <Live2DWidget />
        </ClientConfigContext.Provider>,
      );
    });
    expect(isShadowed(items[0])).toBe(false);
    view.unmount();
  });
});
