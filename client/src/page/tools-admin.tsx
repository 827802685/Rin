import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { Button } from "../components/button";
import { useAlert } from "../components/dialog";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { parseToolsConfig, serializeToolsConfig } from "../utils/tools";
import {
  areSettingsDraftsEqual,
  createSettingsConfigWrappers,
  loadSettingsConfigState,
  saveSettingsConfigState,
  type SettingsDraft,
  updateDraftConfig,
} from "./settings-helpers";
import { ToolsSettings } from "./settings-tools";
import { SettingsBadge, SettingsCard, SettingsCardHeader, SettingsCardRow } from "@rin/ui";

export function ToolsAdminPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const { showAlert, AlertUI } = useAlert();
  const [draft, setDraft] = useState<SettingsDraft>({ clientConfig: {}, serverConfig: {} });
  const [initialDraft, setInitialDraft] = useState<SettingsDraft>({ clientConfig: {}, serverConfig: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const ref = useRef(false);

  useEffect(() => {
    if (ref.current) return;
    loadSettingsConfigState()
      .then((state) => {
        setDraft(state.draft);
        setInitialDraft(state.draft);
      })
      .catch((err: any) => {
        showAlert(t("settings.get_config_failed$message", { message: err.message }));
      })
      .finally(() => {
        setLoading(false);
      });
    ref.current = true;
  }, [showAlert, t]);

  const { clientConfig } = useMemo(() => createSettingsConfigWrappers(draft), [draft]);
  const toolsValue = useMemo(() => parseToolsConfig(clientConfig.get("tools")), [clientConfig]);
  const hasUnsavedChanges = !areSettingsDraftsEqual(draft, initialDraft);

  function handleToolsChange(tools: ReturnType<typeof parseToolsConfig>) {
    setDraft((current) => updateDraftConfig(current, "client", "tools", serializeToolsConfig(tools)));
  }

  function handleReset() {
    setDraft(initialDraft);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const state = await saveSettingsConfigState(draft);
      setDraft(state.draft);
      setInitialDraft(state.draft);
      window.dispatchEvent(new Event("storage"));
      showAlert(t("settings.tools.save_success"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showAlert(t("settings.update_failed$message", { message }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full flex-col">
      <Helmet>
        <title>{`${t("tools.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      {(loading || saving) && <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />}

      <ToolsSettings value={toolsValue} onChange={handleToolsChange} />

      {hasUnsavedChanges && (
        <div className="sticky bottom-4 z-20 mt-6 w-full pb-2">
          <SettingsCard tone="warning">
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.tools.save.title")}
                  description={t("settings.tools.unsaved_changes")}
                  badge={<SettingsBadge tone="warning">{t("settings.tools.unsaved_changes")}</SettingsBadge>}
                />
              }
              action={
                <>
                  <Button secondary title={t("reset")} onClick={handleReset} disabled={saving} />
                  <Button title={t("save")} onClick={handleSave} disabled={saving || loading} />
                </>
              }
            />
          </SettingsCard>
        </div>
      )}
      <AlertUI />
    </div>
  );
}