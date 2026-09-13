import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAlert } from "../components/dialog";
import {
    applyThemeColor,
} from "../utils/theme-color";
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

function readThemeColor(draft: SettingsDraft): string | undefined {
    return typeof draft.clientConfig["theme.color"] === "string"
        ? (draft.clientConfig["theme.color"] as string)
        : undefined;
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

    useEffect(() => {
        if (loadedRef.current) return;
        loadedRef.current = true;

        loadSettingsConfigState()
            .then((state) => {
                setDraft(state.draft);
                setInitialDraft(state.draft);
                initialDraftRef.current = state.draft;
                mergeSessionConfig(state.draft.clientConfig);
                if (liveThemeColor) {
                    applyThemeColor(readThemeColor(state.draft));
                }
                handlersRef.current.onLoaded?.(state);
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                showAlert(t("settings.get_config_failed$message", { message }));
            })
            .finally(() => {
                setLoading(false);
            });

        return () => {
            if (liveThemeColor) {
                applyThemeColor(readThemeColor(initialDraftRef.current));
            }
        };
    }, [liveThemeColor, showAlert, t]);

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
            applyThemeColor(readThemeColor(initialDraft));
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
