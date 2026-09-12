import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../clipboard";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

/** jsdom does not implement execCommand, so it has to be injected explicitly. */
function mockExecCommand(impl: () => boolean) {
    const execCommand = vi.fn(impl);
    Object.defineProperty(document, "execCommand", {
        value: execCommand,
        configurable: true,
        writable: true,
    });
    return execCommand;
}

describe("copyText", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(navigator, "clipboard");
        Reflect.deleteProperty(window, "isSecureContext");
        Reflect.deleteProperty(document, "execCommand");
    });

  it("returns false for empty input without touching the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    mockClipboard(writeText);
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    expect(await copyText("")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("uses the async clipboard API in secure contexts", async () => {
    const writeText = vi.fn(async () => {});
    mockClipboard(writeText);
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    mockClipboard(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    const execCommand = mockExecCommand(() => true);

    expect(await copyText("legacy")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when both paths fail", async () => {
    mockClipboard(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });

    mockExecCommand(() => false);

    expect(await copyText("nope")).toBe(false);
  });

  it("removes the temporary textarea from the DOM", async () => {
    mockClipboard(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    mockExecCommand(() => true);

    const before = document.querySelectorAll("textarea").length;
    await copyText("cleanup");
    expect(document.querySelectorAll("textarea").length).toBe(before);
  });
});
