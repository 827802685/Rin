import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options ? `${key}|${JSON.stringify(options)}` : key,
    }),
}));

vi.mock("../hooks/useSiteConfig", () => ({
    useSiteConfig: () => ({ feedCardVariant: "default" }),
}));

// Avoid needing a router context just to assert the link target.
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

const { FeedCard } = await import("../feed_card");

const createdAt = new Date("2026-01-01T00:00:00Z");

function renderCard(props: Partial<Parameters<typeof FeedCard>[0]> = {}) {
    return render(
        <FeedCard
            id="42"
            title="Hello world"
            summary="A short summary"
            createdAt={createdAt}
            updatedAt={createdAt}
            {...props}
        />,
    );
}

describe("FeedCard", () => {
    it("renders the title and summary", () => {
        renderCard();

        expect(screen.getByText("Hello world")).toBeTruthy();
        expect(screen.getByText("A short summary")).toBeTruthy();
    });

    it("links to the article unless it is a preview", () => {
        const { container, unmount } = renderCard();
        expect(container.querySelector("a")?.getAttribute("href")).toBe("/feed/42");
        unmount();

        const preview = renderCard({ preview: true });
        expect(preview.container.querySelector("a")).toBeNull();
    });

    it("shows no status badges for a normal published article", () => {
        renderCard({ draft: 0, listed: 1, top: 0 });

        expect(screen.queryByText("draft")).toBeNull();
        expect(screen.queryByText("unlisted")).toBeNull();
        expect(screen.queryByText("article.top.title")).toBeNull();
    });

    it("badges drafts", () => {
        renderCard({ draft: 1 });
        expect(screen.getByText("draft")).toBeTruthy();
    });

    it("badges unlisted articles", () => {
        renderCard({ listed: 0 });
        expect(screen.getByText("unlisted")).toBeTruthy();
    });

    it("badges pinned articles", () => {
        renderCard({ top: 1 });
        expect(screen.getByText("article.top.title")).toBeTruthy();
    });

    it("only shows the publish time when the article was never edited", () => {
        renderCard({ createdAt, updatedAt: createdAt });

        expect(screen.queryByText(/feed_card.updated/)).toBeNull();
    });

    it("shows both times once the article has been edited", () => {
        renderCard({ updatedAt: new Date("2026-02-01T00:00:00Z") });

        expect(screen.getByText(/feed_card.published/)).toBeTruthy();
        expect(screen.getByText(/feed_card.updated/)).toBeTruthy();
    });

    it("renders the cover image when an avatar is present", () => {
        const { container } = renderCard({ avatar: "https://example.com/a.png" });

        expect(container.querySelector("img")).not.toBeNull();
    });

    it("omits the image block when there is no avatar", () => {
        const { container } = renderCard();

        expect(container.querySelector("img")).toBeNull();
    });

    it("renders every hashtag", () => {
        renderCard({
            hashtags: [
                { id: 1, name: "rust" },
                { id: 2, name: "cloudflare" },
            ],
        });

        expect(screen.getByText(/rust/)).toBeTruthy();
        expect(screen.getByText(/cloudflare/)).toBeTruthy();
    });

    it("tolerates a missing hashtag list", () => {
        expect(() => renderCard({ hashtags: undefined })).not.toThrow();
    });
});
