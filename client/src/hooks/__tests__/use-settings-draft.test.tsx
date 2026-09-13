import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showAlert = vi.fn();

vi.mock("react-i18next", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../components/dialog", () => ({
    useAlert: () => ({ showAlert, AlertUI: () => null }),
}));

vi.mock("../../utils/theme-color", () => ({
    applyThemeColor: vi.fn(),
}));

const loadSettingsConfigState = vi.fn();
const saveSettingsConfigState = vi.fn();

vi.mock("../../page/settings-helpers", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        loadSettingsConfigState: () => loadSettingsConfigState(),
        saveSettingsConfigState: (draft: unknown) => saveSettingsConfigState(draft),
    };
});

const { applyThemeColor } = await import("../../utils/theme-color");
const { useSettingsDraft } = await import("../use-settings-draft");

const stored = {
    draft: { clientConfig: { "site.name": "Rin" }, serverConfig: {} },
    hasStoredAiApiKey: false,
};

describe("useSettingsDraft", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadSettingsConfigState.mockResolvedValue(stored);
        saveSettingsConfigState.mockResolvedValue(stored);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("starts in a loading state and settles once the config arrives", async () => {
        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved" }));

        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.clientConfig.get("site.name")).toBe("Rin");
    });

    it("reports unsaved changes only after the draft diverges", async () => {
        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved" }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.hasUnsavedChanges).toBe(false);

        act(() => {
            result.current.setConfigValue("client", "site.name", "Other");
        });

        expect(result.current.hasUnsavedChanges).toBe(true);
    });

    it("restores the original draft on reset", async () => {
        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved" }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setConfigValue("client", "site.name", "Other");
        });
        expect(result.current.hasUnsavedChanges).toBe(true);

        act(() => {
            result.current.handleReset();
        });
        expect(result.current.hasUnsavedChanges).toBe(false);
        expect(result.current.clientConfig.get("site.name")).toBe("Rin");
    });

    it("persists the draft and confirms with the supplied message", async () => {
        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved" }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
            result.current.setConfigValue("client", "site.name", "Other");
        });

        await act(async () => {
            await result.current.handleSave();
        });

        expect(saveSettingsConfigState).toHaveBeenCalled();
        expect(showAlert).toHaveBeenCalledWith("saved");
        expect(result.current.hasUnsavedChanges).toBe(false);
    });

    it("surfaces a save failure instead of silently succeeding", async () => {
        saveSettingsConfigState.mockRejectedValue(new Error("boom"));

        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved" }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.handleSave();
        });

        expect(showAlert).toHaveBeenCalledWith("settings.update_failed$message");
    });

    it("alerts when the configuration cannot be loaded", async () => {
        loadSettingsConfigState.mockRejectedValue(new Error("offline"));

        renderHook(() => useSettingsDraft({ successMessage: "saved" }));

        await waitFor(() => expect(showAlert).toHaveBeenCalledWith("settings.get_config_failed$message"));
    });

    it("applies the theme colour live only when asked to", async () => {
        const { result } = renderHook(() =>
            useSettingsDraft({ successMessage: "saved", liveThemeColor: true }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(applyThemeColor).toHaveBeenCalled();
    });

    it("runs the onLoaded and onSaved hooks", async () => {
        const onLoaded = vi.fn();
        const onSaved = vi.fn();

        const { result } = renderHook(() => useSettingsDraft({ successMessage: "saved", onLoaded, onSaved }));
        await waitFor(() => expect(onLoaded).toHaveBeenCalledWith(stored));

        await act(async () => {
            await result.current.handleSave();
        });

        expect(onSaved).toHaveBeenCalledWith(stored);
    });
});
