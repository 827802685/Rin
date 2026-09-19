import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../markdown";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../utils/darkModeUtils", () => ({ useColorMode: () => "light" }));

const fenced = "```typescript\nconst a = 1;\n```";
const inline = "use `npm install` here";

/**
 * The clipboard is exercised for real rather than stubbed out: jsdom has no
 * `navigator.clipboard`, so one is installed here. That way these tests also
 * cover `utils/clipboard.ts` itself, including its secure-context branch.
 */
function installClipboard(writeText: () => Promise<void>) {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn(writeText) },
        configurable: true,
    });
    return navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "clipboard");
    Reflect.deleteProperty(window, "isSecureContext");
});

describe("Markdown code blocks", () => {
    beforeEach(() => {
        installClipboard(async () => {});
    });

    it("renders a fenced block with its language label", () => {
        render(<Markdown content={fenced} />);

        expect(screen.getByText("typescript")).toBeTruthy();
    });

    it("offers a copy button for fenced blocks", () => {
        render(<Markdown content={fenced} />);

        expect(screen.getByRole("button", { name: "code_block.copy" })).toBeTruthy();
    });

    it("copies the code without the trailing newline and confirms it", async () => {
        const writeText = installClipboard(async () => {});
        render(<Markdown content={fenced} />);

        fireEvent.click(screen.getByRole("button", { name: "code_block.copy" }));

        await waitFor(() => expect(screen.getByText("code_block.copied")).toBeTruthy());
        expect(writeText).toHaveBeenCalledWith("const a = 1;");
    });

    it("surfaces a failure when the clipboard rejects", async () => {
        installClipboard(async () => {
            throw new Error("denied");
        });
        render(<Markdown content={fenced} />);

        fireEvent.click(screen.getByRole("button", { name: "code_block.copy" }));

        await waitFor(() => expect(screen.getByText("code_block.failed")).toBeTruthy());
    });

    it("does not add a copy button to inline code", () => {
        render(<Markdown content={inline} />);

        expect(screen.queryByRole("button", { name: "code_block.copy" })).toBeNull();
        expect(screen.getByText("npm install")).toBeTruthy();
    });
});
