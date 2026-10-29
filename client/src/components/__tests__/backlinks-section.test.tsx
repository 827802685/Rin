import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}|${JSON.stringify(options)}` : key,
  }),
}));

// Avoid needing a router context; capture the href instead of resolving it.
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

// 用可控 client 替换运行时，隔离网络。
const backlinks = vi.fn();
const relatedFeeds = vi.fn();
vi.mock("../../app/runtime", () => ({
  client: {
    feed: {
      backlinks,
      relatedFeeds,
    },
  },
}));

const { BacklinksSection } = await import("../backlinks-section");

describe("BacklinksSection", () => {
  it("shows nothing while empty and renders backlinks + related (regression: 反向链接/相关文章)", async () => {
    backlinks.mockResolvedValue({ error: false, data: [{ id: 11, title: "源文章", slug: "src", summary: "" }] });
    relatedFeeds.mockResolvedValue({ error: false, data: [{ id: 22, title: "相关A", summary: "", slug: null, shared: 2, createdAt: null }] });

    const { container, unmount } = render(<BacklinksSection id={1} />);

    await waitFor(() => expect(screen.getByText("源文章")).toBeTruthy());
    expect(screen.getByText("相关A")).toBeTruthy();
    // 两个区块各自链接到 /feed/:id
    expect(container.querySelector('a[href="/feed/11"]')).toBeTruthy();
    expect(container.querySelector('a[href="/feed/22"]')).toBeTruthy();
    unmount();
  });

  it("renders untitled fallback when a link lacks a title", async () => {
    backlinks.mockResolvedValue({ error: false, data: [{ id: 9, title: "", slug: null, summary: "" }] });
    relatedFeeds.mockResolvedValue({ error: false, data: [] });

    render(<BacklinksSection id={2} />);

    await waitFor(() => expect(screen.getByText("article.untitled")).toBeTruthy());
  });

  it("hides entirely on error (does not crash the article page)", async () => {
    backlinks.mockRejectedValue(new Error("network"));
    relatedFeeds.mockRejectedValue(new Error("network"));

    const { container } = render(<BacklinksSection id={3} />);

    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("renders nothing when both lists are empty", async () => {
    backlinks.mockResolvedValue({ error: false, data: [] });
    relatedFeeds.mockResolvedValue({ error: false, data: [] });

    const { container } = render(<BacklinksSection id={4} />);

    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
