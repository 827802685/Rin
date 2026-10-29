import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { SocialFloat } from "../social-float";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderWithConfig(ui: React.ReactElement, overrides: Record<string, unknown>) {
  const config = new ConfigWrapper(overrides, defaultClientConfig);
  return render(<ClientConfigContext.Provider value={config}>{ui}</ClientConfigContext.Provider>);
}

describe("SocialFloat 博主社交悬浮挂件", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("关闭开关时不渲染", () => {
    const { container } = renderWithConfig(<SocialFloat />, {
      "widget.social.enabled": false,
      "widget.social.links": JSON.stringify([{ icon: "ri-mail-line", url: "mailto:a@b.c" }]),
    });
    expect(container.textContent).toBe("");
  });

  it("开启但无链接时不渲染", () => {
    const { container } = renderWithConfig(<SocialFloat />, {
      "widget.social.enabled": true,
    });
    expect(container.textContent).toBe("");
  });

  it("开启且有链接时渲染图标链接", () => {
    renderWithConfig(<SocialFloat />, {
      "widget.social.enabled": true,
      "widget.social.links": [
        { icon: "ri-mail-line", url: "mailto:a@b.c", title: "邮箱" },
        { icon: "ri-github-line", url: "https://github.com/x" },
      ],
    });
    const anchors = screen.getAllByRole("link");
    expect(anchors.length).toBe(2);
    expect((anchors[0] as HTMLAnchorElement).href).toBe("mailto:a@b.c");
  });

  it("过滤缺 icon 或 url 的脏数据", () => {
    renderWithConfig(<SocialFloat />, {
      "widget.social.enabled": true,
      "widget.social.links": [
        { icon: "ri-mail-line" },
        { url: "https://x" },
        { icon: "ri-rss-line", url: "https://blog.example/rss" },
      ],
    });
    expect(screen.getAllByRole("link").length).toBe(1);
  });
});
