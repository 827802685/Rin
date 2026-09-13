import { useMemo } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { useSettingsDraft } from "../hooks/use-settings-draft";
import { parseToolsConfig, serializeToolsConfig } from "../utils/tools";
import { SaveBar } from "./settings-items";
import { ToolsSettings } from "./settings-tools";

export function ToolsAdminPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();

  const {
    loading,
    saving,
    clientConfig,
    hasUnsavedChanges,
    setClientConfigValue,
    handleReset,
    handleSave,
    AlertUI,
  } = useSettingsDraft({ successMessage: "settings.tools.save_success" });

  const toolsValue = useMemo(() => parseToolsConfig(clientConfig.get("tools")), [clientConfig]);

  function handleToolsChange(tools: ReturnType<typeof parseToolsConfig>) {
    setClientConfigValue("tools", serializeToolsConfig(tools));
  }

  return (
    <div className="flex w-full flex-col pb-24">
      <Helmet>
        <title>{`${t("tools.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      {(loading || saving) && <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />}

      <ToolsSettings value={toolsValue} onChange={handleToolsChange} />

      {hasUnsavedChanges && (
        <SaveBar
          message={t("settings.tools.unsaved_changes")}
          saving={saving}
          loading={loading}
          onReset={handleReset}
          onSave={handleSave}
        />
      )}
      <AlertUI />
    </div>
  );
}