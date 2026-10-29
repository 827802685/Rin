import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { MusicPlayer } from "../music-player";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithConfig(overrides: Record<string, unknown>) {
  const config = new ConfigWrapper(overrides, defaultClientConfig);
  return render(
    <ClientConfigContext.Provider value={config}>
      <MusicPlayer />
    </ClientConfigContext.Provider>,
  );
}

describe("MusicPlayer 无源提示（修复开关开了却静默不渲染）", () => {
  it("开了开关但没配音频源时，显示配置提示而非空白", () => {
    renderWithConfig({ "widget.player.enabled": true });
    expect(screen.getByText("theme.player.no_source")).toBeTruthy();
  });

  it("关掉开关时整体不渲染", () => {
    const { container } = renderWithConfig({ "widget.player.enabled": false });
    expect(container.textContent).toBe("");
  });

  it("配了静态曲目时不提示无源，渲染出播放器", () => {
    const audio = JSON.stringify([
      { name: "示例曲", artist: "某人", url: "https://example.com/a.mp3" },
    ]);
    renderWithConfig({ "widget.player.enabled": true, "widget.player.audio": audio });
    expect(screen.queryByText("theme.player.no_source")).toBeNull();
    expect(screen.getByText("示例曲")).toBeTruthy();
  });
});
