import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClientConfigContext, ConfigWrapper, defaultClientConfig } from "../../../state/config";
import { AmbientBackground, normalizeAmbientType } from "../ambient-background";

function renderWithConfig(overrides: Record<string, unknown>) {
    const config = new ConfigWrapper(overrides, defaultClientConfig);
    return render(
        <ClientConfigContext.Provider value={config}>
            <AmbientBackground />
        </ClientConfigContext.Provider>,
    );
}

describe("normalizeAmbientType", () => {
    it("accepts the four presets and falls back to snow", () => {
        expect(normalizeAmbientType("sakura")).toBe("sakura");
        expect(normalizeAmbientType("starry")).toBe("starry");
        expect(normalizeAmbientType("bubbles")).toBe("bubbles");
        expect(normalizeAmbientType("fireflies")).toBe("snow");
    });
});

describe("AmbientBackground mount", () => {
    it("renders nothing while disabled", () => {
        const { container } = renderWithConfig({});
        expect(container.querySelector("canvas")).toBeNull();
    });

    it("mounts a behind-content, click-through canvas when enabled", () => {
        // jsdom 的 canvas.getContext 返回 null，引擎应安静跳过而不是抛错
        const { container } = renderWithConfig({ "widget.ambient.enabled": true });
        const canvas = container.querySelector("canvas");
        expect(canvas).not.toBeNull();
        expect(canvas!.className).toContain("-z-10");
        expect(canvas!.className).toContain("pointer-events-none");
    });
});
