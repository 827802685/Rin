import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { Danmaku } from "../danmaku";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const listMock = vi.fn();
const createMock = vi.fn();

vi.mock("../../../app/runtime", () => ({
  client: {
    comment: {
      list: (...args: unknown[]) => listMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

function renderDanmaku(overrides: Record<string, unknown> = {}) {
  const config = new ConfigWrapper({ "widget.danmaku.enabled": true, ...overrides }, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      <Danmaku feedId={1} />
    </ClientConfigContext.Provider>,
  );
}

describe("Danmaku 评论弹幕层", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    listMock.mockReset();
    createMock.mockReset();
  });

  it("关闭开关时不渲染", () => {
    const { container } = renderDanmaku({ "widget.danmaku.enabled": false });
    expect(container.textContent).toBe("");
    expect(listMock).not.toHaveBeenCalled();
  });

  it("开启后拉取评论并渲染弹幕条目", async () => {
    listMock.mockResolvedValue({
      data: [{ id: 1, content: "第一条例" }, { id: 2, content: "又来一条" }],
    });
    renderDanmaku();
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(1));
    await waitFor(() => {
      expect(screen.getByText("第一条例")).toBeTruthy();
    });
    expect(screen.getByText("又来一条")).toBeTruthy();
  });

  it("输入回车发送弹幕：以【弹幕】前缀写入评论", async () => {
    listMock.mockResolvedValue({ data: [] });
    createMock.mockResolvedValue({ data: { id: 9 } });
    renderDanmaku();
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "你好呀");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const [, body] = createMock.mock.calls[0];
    expect(body.content).toBe("【弹幕】你好呀");
  });
});
