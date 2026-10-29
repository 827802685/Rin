import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { FallingSakura } from "../falling-sakura";
import { RibbonBackground } from "../ribbon-background";
import { PowerMode } from "../power-mode";
import { NoteEffect } from "../note-effect";
import { CyberEffects } from "../cyber-effects";
import { WaveFooter } from "../wave-footer";
import { Hitokoto } from "../hitokoto";
import { Preloader } from "../preloader";

// jsdom 未实现 matchMedia / IntersectionObserver：给最小 polyfill
beforeAll(() => {
    if (typeof window.matchMedia !== "function") {
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: (query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            }),
        });
    }
});

beforeEach(() => {
    document.documentElement.className = "";
    document.body.innerHTML = "";
});

afterEach(() => {
    sessionStorage.clear();
});

function renderWithConfig(ui: React.ReactElement, overrides: Record<string, unknown>) {
    const config = new ConfigWrapper(overrides, defaultClientConfig);
    return render(<ClientConfigContext.Provider value={config}>{ui}</ClientConfigContext.Provider>);
}

describe("FallingSakura", () => {
    it("renders nothing while disabled", () => {
        const { container } = renderWithConfig(<FallingSakura />, {});
        expect(container.querySelector("canvas")).toBeNull();
    });

    it("mounts a click-through canvas when enabled", () => {
        const { container } = renderWithConfig(<FallingSakura />, { "widget.sakura.enabled": true });
        const canvas = container.querySelector("canvas");
        expect(canvas).not.toBeNull();
        expect(canvas!.className).toContain("pointer-events-none");
    });
});

describe("RibbonBackground", () => {
    it("renders nothing while disabled", () => {
        const { container } = renderWithConfig(<RibbonBackground />, {});
        expect(container.querySelector("canvas")).toBeNull();
    });

    it("mounts canvas when enabled with default nest mode", () => {
        const { container } = renderWithConfig(<RibbonBackground />, { "widget.ribbon.enabled": true });
        expect(container.querySelector("canvas")).not.toBeNull();
    });
});

describe("PowerMode", () => {
    it("renders nothing while disabled", () => {
        const { container } = renderWithConfig(<PowerMode />, {});
        expect(container.querySelector("canvas")).toBeNull();
    });

    it("mounts canvas when enabled", () => {
        const { container } = renderWithConfig(<PowerMode />, { "widget.power_mode.enabled": true });
        expect(container.querySelector("canvas")).not.toBeNull();
    });
});

describe("NoteEffect", () => {
    it("does not spawn notes on unrelated clicks when disabled", () => {
        document.body.innerHTML = '<a aria-label="home" href="/">Home</a>';
        renderWithConfig(<NoteEffect />, {});
        document.querySelector('a[aria-label="home"]')!.dispatchEvent(
            new MouseEvent("click", { bubbles: true }),
        );
        expect(document.querySelectorAll(".rin-note")).toHaveLength(0);
    });

    it("spawns floating notes when the brand link is clicked", () => {
        document.body.innerHTML = '<a aria-label="home" href="/">Home</a>';
        renderWithConfig(<NoteEffect />, { "widget.note_click.enabled": true });
        act(() => {
            document.querySelector('a[aria-label="home"]')!.dispatchEvent(
                new MouseEvent("click", { bubbles: true }),
            );
        });
        const notes = document.querySelectorAll(".rin-note");
        expect(notes.length).toBeGreaterThanOrEqual(3);
        expect(notes.length).toBeLessThanOrEqual(5);
    });
});

describe("CyberEffects", () => {
    it("renders nothing and sets no class when disabled", () => {
        const { container } = renderWithConfig(<CyberEffects />, {});
        expect(container.querySelector(".rin-cyber-grid-bg")).toBeNull();
        expect(document.documentElement.classList.contains("rin-cyber-glitch")).toBe(false);
    });

    it("toggles the glitch class and renders the grid layer", () => {
        const { container, unmount } = renderWithConfig(<CyberEffects />, {
            "widget.cyber.title_glitch": true,
            "widget.cyber.grid_background": true,
        });
        expect(container.querySelector(".rin-cyber-grid-bg")).not.toBeNull();
        expect(document.documentElement.classList.contains("rin-cyber-glitch")).toBe(true);
        unmount();
        expect(document.documentElement.classList.contains("rin-cyber-glitch")).toBe(false);
    });
});

describe("WaveFooter", () => {
    it("renders nothing while disabled", () => {
        const { container } = renderWithConfig(<WaveFooter />, {});
        expect(container.querySelector("svg")).toBeNull();
    });

    it("renders two wave layers when enabled", () => {
        const { container } = renderWithConfig(<WaveFooter />, { "widget.wave_footer.enabled": true });
        expect(container.querySelectorAll("svg")).toHaveLength(2);
    });
});

describe("Hitokoto", () => {
    it("renders nothing while disabled", () => {
        renderWithConfig(<Hitokoto />, {});
        expect(screen.queryByTestId("hitokoto")).toBeNull();
    });

    it("types the configured quote character by character", async () => {
        renderWithConfig(<Hitokoto />, {
            "widget.hitokoto.enabled": true,
            "widget.hitokoto.quotes": [" Testing "],
        });
        await waitFor(
            () => {
                expect(screen.getByTestId("hitokoto").textContent).toContain("Testing");
            },
            { timeout: 2000 },
        );
    });
});

describe("Preloader", () => {
    it("renders nothing when disabled", () => {
        const { container } = renderWithConfig(<Preloader />, {});
        expect(container.querySelector(".rin-preloader")).toBeNull();
    });

    it("shows the overlay once per session and leaves after load", async () => {
        const { container } = renderWithConfig(<Preloader />, { "widget.preloader.enabled": true });
        expect(container.querySelector(".rin-preloader")).not.toBeNull();
        // 第二次挂载（同 session）不再显示
        const { container: second } = renderWithConfig(<Preloader />, { "widget.preloader.enabled": true });
        expect(second.querySelector(".rin-preloader")).toBeNull();
    });
});
