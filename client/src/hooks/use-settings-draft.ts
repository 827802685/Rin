import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAlert } from "../components/dialog";
import {
    applyThemeConfig,
} from "../utils/theme-scheme";
import {
    areSettingsDraftsEqual,
    createSettingsConfigWrappers,
    loadSettingsConfigState,
    mergeSessionConfig,
    saveSettingsConfigState,
    updateDraftConfig,
    type SettingsDraft,
    type SettingsLoadState,
} from "../page/settings-helpers";

const EMPTY_DRAFT: SettingsDraft = { clientConfig: {}, serverConfig: {} };

export interface UseSettingsDraftOptions {
    /** i18n key shown after a successful save. */
    successMessage: string;
    /**
     * Applies `theme.color` while the user experiments and restores the
     * original colour when the page unmounts without saving.
     */
    liveThemeColor?: boolean;
    /** Extra work once the configuration has loaded. */
    onLoaded?: (state: SettingsLoadState) => void;
    /** Extra work after a successful save. */
    onSaved?: (state: SettingsLoadState) => void;
}

function readThemeDraft(draft: SettingsDraft): { scheme: unknown; color?: string; customCss?: unknown } {
    const color = typeof draft.clientConfig["theme.color"] === "string"
        ? (draft.clientConfig["theme.color"] as string)
        : undefined;
    return {
        scheme: draft.clientConfig["theme.scheme"],
        color,
        customCss: draft.clientConfig["theme.custom_css"],
    };
}

function applyThemeDraft(draft: SettingsDraft) {
    const { scheme, color, customCss } = readThemeDraft(draft);
    applyThemeConfig({ scheme, color, customCss });
}

/**
 * Shared load / edit / save lifecycle for the settings screens.
 *
 * `settings`, `settings-theme` and `tools-admin` each carried their own copy of
 * this state machine, and the copies had already drifted (only two of them
 * restored the theme colour on unmount). Keeping one implementation means a fix
 * applies everywhere.
 */
export function useSettingsDraft(options: UseSettingsDraftOptions) {
    const { successMessage, liveThemeColor = false, onLoaded, onSaved } = options;
    const { t } = useTranslation();
    const { showAlert, AlertUI } = useAlert();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);
    const [initialDraft, setInitialDraft] = useState<SettingsDraft>(EMPTY_DRAFT);

    const loadedRef = useRef(false);
    const initialDraftRef = useRef<SettingsDraft>(EMPTY_DRAFT);

    // Keep the callbacks in a ref so the load effect can stay a one-shot.
    const handlersRef = useRef({ onLoaded, onSaved });
    handlersRef.current = { onLoaded, onSaved };
    // showAlert/t 的引用稳定性不保证：若把它们放进依赖，effect 会在草稿加载后
    // 重跑，重跑的清理函数用「仍是空的初始草稿」把实时主题预览清掉（实测：
    // 自定义 CSS 预览刚挂上就被立即移除）。一律经 ref 读最新值，effect 保持一次性。
    const loadErrorRef = useRef({ showAlert, t });
    loadErrorRef.current = { showAlert, t };
    const liveFlagRef = useRef(liveThemeColor);
    liveFlagRef.current = liveThemeColor;

    useEffect(() => {
        // 清理函数必须每次挂载都注册。此前 `if (loadedRef.current) return;`
        // 写在函数体最前，StrictMode 下第二次挂载提前返回、不再返回清理函数，
        // 卸载时的"恢复初始草稿/卸载自定义 CSS 预览"就永远不会执行（实测预览
        // 泄漏到前台页面，直到整页刷新才被 bootstrap 重置）。
        const restore = () => {
            if (liveFlagRef.current) {
                applyThemeDraft(initialDraftRef.current);
            }
        };
        if (loadedRef.current) return restore;

        loadedRef.current = true;

        loadSettingsConfigState()
            .then((state) => {
                setDraft(state.draft);
                setInitialDraft(state.draft);
                initialDraftRef.current = state.draft;
                mergeSessionConfig(state.draft.clientConfig);
                if (liveFlagRef.current) {
                    applyThemeDraft(state.draft);
                }
                handlersRef.current.onLoaded?.(state);
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                const { showAlert: alert, t: translate } = loadErrorRef.current;
                alert(translate("settings.get_config_failed$message", { message }));
            })
            .finally(() => {
                setLoading(false);
            });

        return restore;
    }, []);

    const { clientConfig, serverConfig } = useMemo(() => createSettingsConfigWrappers(draft), [draft]);
    const hasUnsavedChanges = !areSettingsDraftsEqual(draft, initialDraft);

    const setConfigValue = useCallback((type: "client" | "server", key: string, value: unknown) => {
        setDraft((current) => updateDraftConfig(current, type, key, value));
    }, []);

    const setClientConfigValue = useCallback((key: string, value: unknown) => {
        setDraft((current) => updateDraftConfig(current, "client", key, value));
    }, []);

    const replaceDraft = useCallback((updater: (current: SettingsDraft) => SettingsDraft) => {
        setDraft((current) => updater(current));
    }, []);

    const handleReset = useCallback(() => {
        setDraft(initialDraft);
        if (liveThemeColor) {
            applyThemeDraft(initialDraft);
        }
    }, [initialDraft, liveThemeColor]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const state = await saveSettingsConfigState(draft);
            setDraft(state.draft);
            setInitialDraft(state.draft);
            initialDraftRef.current = state.draft;
            mergeSessionConfig(state.draft.clientConfig);
            window.dispatchEvent(new Event("storage"));
            handlersRef.current.onSaved?.(state);
            showAlert(t(successMessage));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showAlert(t("settings.update_failed$message", { message }));
        } finally {
            setSaving(false);
        }
    }, [draft, liveThemeColor, showAlert, successMessage, t]);

    return {
        loading,
        saving,
        draft,
        initialDraft,
        clientConfig,
        serverConfig,
        hasUnsavedChanges,
        setConfigValue,
        setClientConfigValue,
        replaceDraft,
        handleReset,
        handleSave,
        showAlert,
        AlertUI,
    };
}
