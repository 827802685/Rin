import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Feed } from "@rin/api";
import { ClientConfigContext } from "../../state/config";
import { ArticleSideRail } from "../article-side-rail";

// 测试环境不初始化 i18n，直接把键尾段当文案返回
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key.split(".").pop() ?? key,
  }),
}));

const feed: Feed = {
  id: 1,
  title: "Hello",
  content: "",
  uid: 1,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ai_summary: "",
  ai_summary_status: "completed",
  ai_summary_error: "",
  hashtags: [
    { id: 1, name: "web" },
    { id: 2, name: "blog" },
  ],
  user: { id: 1, username: "rin", avatar: null },
  pv: 0,
  uv: 0,
  likes: 0,
};

function renderRail() {
  const config = {
    get: (key: string) => (key === "site.description" ? "A blog." : undefined),
  } as never;
  return render(
    <ClientConfigContext.Provider value={config}>
      <ArticleSideRail feed={feed} />
    </ClientConfigContext.Provider>,
  );
}

describe("ArticleSideRail", () => {
  it("渲染作者名与全部标签", () => {
    renderRail();
    expect(screen.getByText("rin")).toBeTruthy();
    expect(screen.getByText("#web")).toBeTruthy();
    expect(screen.getByText("#blog")).toBeTruthy();
  });

  it("标签链接指向 hashtag 路由", () => {
    renderRail();
    const link = screen.getByText("#web").closest("a");
    expect(link?.getAttribute("href")).toBe("/hashtag/web");
  });

  it("复制链接后按钮短暂显示已复制", () => {
    // jsdom 没有 clipboard 和 execCommand，stub 掉降级路径
    document.execCommand = () => true;
    renderRail();
    // jsdom 没有 clipboard，走 execCommand 降级路径
    const btn = screen.getByText(/copy_link/i).closest("button")!;
    fireEvent.click(btn);
    expect(screen.getByText(/link_copied/i)).toBeTruthy();
  });

  it("初始不显示回到顶部，滚动超过阈值后出现", () => {
    renderRail();
    const top = screen.getByText(/back_to_top/i).closest("button")!;
    expect(top.className).toContain("opacity-0");
    Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
    fireEvent.scroll(window);
    expect(top.className).toContain("opacity-100");
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
});
