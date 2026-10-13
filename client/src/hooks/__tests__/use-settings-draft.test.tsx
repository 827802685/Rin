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

const applyCustomThemeCss = vi.fn();
const applyThemeScheme = vi.fn();
const applyThemeConfig = vi.fn();

vi.mock("../../utils/theme-scheme", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        applyThemeConfig: (input: unknown) => applyThemeConfig(input),
        applyCustomThemeCss: (css: unknown) => applyCustomThemeCss(css),
        applyThemeScheme: (scheme: unknown, color: unknown) => applyThemeScheme(scheme, color),
    };
});

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

        // 加载成功后经 applyThemeConfig 总入口落地主题（内部再派发到配色/方案）
        expect(applyThemeConfig).toHaveBeenCalledTimes(1);
        expect(applyThemeConfig).toHaveBeenCalledWith({ scheme: undefined, color: undefined, customCss: undefined });

        applyThemeConfig.mockClear();
        const { result: plain } = renderHook(() =>
            useSettingsDraft({ successMessage: "saved" }),
        );
        await waitFor(() => expect(plain.current.loading).toBe(false));
        expect(applyThemeConfig).not.toHaveBeenCalled();
    });

    it("unmount restores the loaded initial draft via applyThemeConfig", async () => {
        const storedDraft = {
            clientConfig: { "site.name": "Rin", "theme.scheme": "sakura", "theme.color": "#d16180", "theme.custom_css": ":root{--surface-page:#102030}" },
            serverConfig: {},
        };
        loadSettingsConfigState.mockResolvedValue({ draft: storedDraft, hasStoredAiApiKey: false });

        const { result, unmount } = renderHook(() =>
            useSettingsDraft({ successMessage: "saved", liveThemeColor: true }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        applyThemeConfig.mockClear();
        act(() => {
            result.current.setConfigValue("client", "theme.custom_css", ":root{--surface-page:#000000}");
        });
        expect(applyThemeConfig).not.toHaveBeenCalled();

        unmount();
        expect(applyThemeConfig).toHaveBeenCalledWith({
            scheme: "sakura",
            color: "#d16180",
            customCss: ":root{--surface-page:#102030}",
        });
    });

    it("never unmounts: cleanup must not fire mid-session even if unstable deps change", async () => {
        // 本用例环境下 useTranslation 每次渲染返回新的 t：旧实现把 t 放进加载
        // effect 依赖，加载后的任意重渲染会触发"重跑的清理"，用仍是空的初始
        // 草稿把实时主题（含自定义 CSS 预览）清掉。实测表现为预览刚挂上就消失。
        loadSettingsConfigState.mockResolvedValue({
            draft: { clientConfig: { "site.name": "Rin", "theme.scheme": "sakura" }, serverConfig: {} },
            hasStoredAiApiKey: false,
        });

        const { result, rerender } = renderHook(() =>
            useSettingsDraft({ successMessage: "saved", liveThemeColor: true }),
        );
        await waitFor(() => expect(result.current.loading).toBe(false));

        applyThemeConfig.mockClear();
        rerender();
        rerender();

        expect(applyThemeConfig).not.toHaveBeenCalled();
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
