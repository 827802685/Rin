import { SearchableSelect, SettingsCard, SettingsCardBody, SettingsCardHeader, SettingsCardRow } from "@rin/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { useAlert } from "../components/dialog.tsx";
import { HeaderLayoutPreview } from "../components/site-header/layout-preview";
import {
  HEADER_BEHAVIOR_OPTIONS,
  HEADER_LAYOUT_OPTIONS,
  normalizeHeaderBehavior,
  normalizeHeaderLayout,
} from "../components/site-header/layout-options";
import { FEED_CARD_VARIANTS, normalizeFeedCardVariant } from "../components/feed-card-options";
import { FeedCardPreview } from "../components/feed-card-preview";
import { FEED_LAYOUT_OPTIONS, normalizeFeedLayout } from "../components/feed-layout-options";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { applyThemeColor, normalizeThemeColor } from "../utils/theme-color";
import { ItemInput, ItemSwitch, ItemTitle, SaveBar } from "./settings-items";
import {
  areSettingsDraftsEqual,
  createSettingsConfigWrappers,
  loadSettingsConfigState,
  mergeSessionConfig,
  saveSettingsConfigState,
  type SettingsDraft,
  updateDraftConfig,
} from "./settings-helpers";

const THEME_COLOR_OPTIONS = [
  { label: "Furina", value: "#5ab0d8" },
  { label: "Rose", value: "#fc466b" },
  { label: "Violet", value: "#7c3aed" },
  { label: "Blue", value: "#2563eb" },
  { label: "Teal", value: "#0f766e" },
  { label: "Orange", value: "#ea580c" },
];

const CURSOR_OPTIONS = [
  { value: "/cursors/furina/normal.png", label: "Normal" },
  { value: "/cursors/furina/link.png", label: "Link" },
  { value: "/cursors/furina/text.png", label: "Text" },
  { value: "/cursors/furina/help.png", label: "Help" },
  { value: "/cursors/furina/busy.png", label: "Busy" },
  { value: "/cursors/furina/move.png", label: "Move" },
  { value: "/cursors/furina/person.png", label: "Person" },
  { value: "/cursors/furina/handwriting.png", label: "Handwriting" },
  { value: "/cursors/furina/unavailable.png", label: "Unavailable" },
];

const PLAYER_AUDIO_EXAMPLE = JSON.stringify(
  [
    { name: "L'hymne à l'amour", artist: "Furina", url: "https://example.com/track.mp3", cover: "/avatar.png" },
  ],
  null,
  2,
);

function CursorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {CURSOR_OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition-all ${
              selected
                ? "border-theme bg-theme/5 shadow-sm shadow-theme/10"
                : "border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
            }`}
          >
            <img src={option.value} alt="" className="h-6 w-6" />
            <span className="text-sm t-primary">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsTheme() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SettingsDraft>({ clientConfig: {}, serverConfig: {} });
  const [initialDraft, setInitialDraft] = useState<SettingsDraft>({ clientConfig: {}, serverConfig: {} });
  const ref = useRef(false);
  const initialDraftRef = useRef<SettingsDraft>({ clientConfig: {}, serverConfig: {} });
  const { showAlert, AlertUI } = useAlert();
  // 设置页"添加自定义模型"表单
  const [newModelName, setNewModelName] = useState("");
  const [newModelUrl, setNewModelUrl] = useState("");

  function getDraftThemeColor(nextDraft: SettingsDraft) {
    return typeof nextDraft.clientConfig["theme.color"] === "string" ? nextDraft.clientConfig["theme.color"] : undefined;
  }

  useEffect(() => {
    if (ref.current) return;
    loadSettingsConfigState()
      .then((state) => {
        setDraft(state.draft);
        setInitialDraft(state.draft);
        initialDraftRef.current = state.draft;
        mergeSessionConfig(state.draft.clientConfig);
        applyThemeColor(getDraftThemeColor(state.draft));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        showAlert(t("settings.get_config_failed$message", { message }));
      })
      .finally(() => {
        setLoading(false);
      });
    ref.current = true;

    return () => {
      applyThemeColor(getDraftThemeColor(initialDraftRef.current));
    };
  }, [showAlert, t]);

  const { clientConfig } = useMemo(() => createSettingsConfigWrappers(draft), [draft]);
  const hasUnsavedChanges = !areSettingsDraftsEqual(draft, initialDraft);
  const themeColorValue = normalizeThemeColor(String(clientConfig.get("theme.color") ?? "#5ab0d8"));
  const feedLayoutValue = normalizeFeedLayout(String(clientConfig.get("feed.layout") ?? "list"));
  const feedCardVariantValue = normalizeFeedCardVariant(String(clientConfig.get("feed.card_variant") ?? "default"));
  const previewSiteName = String(clientConfig.get("site.name") ?? clientConfig.default("site.name") ?? "Rin");
  const previewSiteAvatar = String(clientConfig.get("site.avatar") ?? clientConfig.default("site.avatar") ?? "");

  const live2dEnabled = clientConfig.getBoolean("widget.live2d.enabled");
  const live2dPosition = String(clientConfig.get("widget.live2d.position") ?? "right");
  const live2dScale = String(clientConfig.get("widget.live2d.scale") ?? "1");
  // 默认模型 id（furina / BCSZ1.1 / 自定义模型 id）
  const live2dDefaultModel = String(clientConfig.get("widget.live2d.defaultModel") ?? "furina");
  // 自定义模型列表配置（JSON 数组 [{ id, name, url }]，由设置里"添加模型"生成）
  const live2dCustomModelsRaw = String(clientConfig.get("widget.live2d.customModels") ?? "[]");
  // 解析后的自定义模型列表（失效返回空数组）
  const live2dCustomModels = useMemo<{ id: string; name: string; url: string }[]>(() => {
    try {
      const arr = JSON.parse(live2dCustomModelsRaw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(
        (x): x is { id: string; name: string; url: string } =>
          !!x && typeof x.id === "string" && typeof x.name === "string" && typeof x.url === "string",
      );
    } catch {
      return [];
    }
  }, [live2dCustomModelsRaw]);
  const cursorEnabled = clientConfig.getBoolean("widget.cursor.enabled");
  const cursorDefault = String(clientConfig.get("widget.cursor.default") ?? "/cursors/furina/normal.png");
  const cursorPointer = String(clientConfig.get("widget.cursor.pointer") ?? "/cursors/furina/link.png");
  const cursorText = String(clientConfig.get("widget.cursor.text") ?? "/cursors/furina/text.png");
  const fireworkEnabled = clientConfig.getBoolean("widget.firework.enabled");
  const fireworkMobileDisabled = clientConfig.getBoolean("widget.firework.disable_on_mobile");
  const playerEnabled = clientConfig.getBoolean("widget.player.enabled");
  const playerAutoplay = clientConfig.getBoolean("widget.player.autoplay");
  const playerAudio = String(clientConfig.get("widget.player.audio") ?? "[]");
  const playerMetingApi = String(clientConfig.get("widget.player.meting_api") ?? "");
  const playerMeting = String(clientConfig.get("widget.player.meting") ?? "");
  const shareEnabled = clientConfig.getBoolean("widget.share.enabled");
  const shareNetworks = String(clientConfig.get("widget.share.networks") ?? "");
  const anchorEnabled = clientConfig.getBoolean("widget.anchor.enabled");
  const anchorAuto = clientConfig.getBoolean("widget.anchor.auto");
  const anchorLength = String(clientConfig.get("widget.anchor.length") ?? "60");

  function setConfigValue(key: string, value: unknown) {
    setDraft((current) => updateDraftConfig(current, "client", key, value));
  }

  // 写入自定义模型列表（JSON）
  function saveCustomModels(list: { id: string; name: string; url: string }[]) {
    setConfigValue("widget.live2d.customModels", JSON.stringify(list));
  }

  // 添加一个自定义模型（生成唯一 id）
  function handleAddCustomModel() {
    const name = newModelName.trim();
    const url = newModelUrl.trim();
    if (!name || !url) {
      showAlert(t("theme.live2d.custom.need_both"));
      return;
    }
    if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
      showAlert(t("theme.live2d.custom.invalid_url"));
      return;
    }
    if (live2dCustomModels.some((c) => c.name === name)) {
      showAlert(t("theme.live2d.custom.dup_name"));
      return;
    }
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const next = [...live2dCustomModels, { id, name, url }];
    saveCustomModels(next);
    setNewModelName("");
    setNewModelUrl("");
  }

  // 删除一个自定义模型；若其为当前默认模型，重置默认模型为 furina
  function handleRemoveCustomModel(id: string) {
    const next = live2dCustomModels.filter((c) => c.id !== id);
    saveCustomModels(next);
    if (live2dDefaultModel === id) {
      setConfigValue("widget.live2d.defaultModel", "furina");
    }
  }

  function handleReset() {
    setDraft(initialDraft);
    applyThemeColor(getDraftThemeColor(initialDraft));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const state = await saveSettingsConfigState(draft);
      setDraft(state.draft);
      setInitialDraft(state.draft);
      initialDraftRef.current = state.draft;
      mergeSessionConfig(state.draft.clientConfig);
      window.dispatchEvent(new Event("storage"));
      showAlert(t("theme.save_success"));
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
        <title>{`${t("theme.title")} - ${siteConfig.name}`}</title>
      </Helmet>
      <main className="w-full rounded-2xl bg-w" aria-label={t("theme.title")}>
        <div className="flex flex-col items-start space-y-2 pb-24">
          {(loading || saving) && <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />}

          <ItemTitle title={t("settings.personalization.title")} />
          <div className="w-full">
            <SettingsCard>
              <SettingsCardRow
                header={
                  <SettingsCardHeader
                    title={t("settings.header_layout.title")}
                    description={t("settings.header_layout.desc")}
                  />
                }
                action={
                  <SearchableSelect
                    value={normalizeHeaderLayout(String(clientConfig.get("header.layout") ?? "classic"))}
                    onChange={(value) => {
                      setConfigValue("header.layout", value);
                    }}
                    options={HEADER_LAYOUT_OPTIONS.map((value) => ({
                      value,
                      label: t(`settings.header_layout.options.${value}`),
                    }))}
                    placeholder={t("settings.header_layout.title")}
                    emptyLabel={t("no_more")}
                    searchable={false}
                  />
                }
              />
              <SettingsCardBody>
                <div className="grid gap-3 md:grid-cols-2">
                  {HEADER_LAYOUT_OPTIONS.map((value) => (
                    <HeaderLayoutPreview
                      key={value}
                      data={{
                        avatar: previewSiteAvatar,
                        name: previewSiteName,
                        themeColor: themeColorValue,
                      }}
                      layout={value}
                      selected={normalizeHeaderLayout(String(clientConfig.get("header.layout") ?? "classic")) === value}
                      title={t(`settings.header_layout.options.${value}`)}
                      description={t(`settings.header_layout.preview.${value}`)}
                      onClick={() => {
                        setConfigValue("header.layout", value);
                      }}
                    />
                  ))}
                </div>
              </SettingsCardBody>
              <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
                <SettingsCardRow
                  header={
                    <SettingsCardHeader
                      title={t("settings.feed_layout.title")}
                      description={t("settings.feed_layout.desc")}
                    />
                  }
                  action={
                    <SearchableSelect
                      value={feedLayoutValue}
                      onChange={(value) => {
                        setConfigValue("feed.layout", value);
                      }}
                      options={FEED_LAYOUT_OPTIONS.map((value) => ({
                        value,
                        label: t(`settings.feed_layout.options.${value}`),
                      }))}
                      placeholder={t("settings.feed_layout.title")}
                      emptyLabel={t("no_more")}
                      searchable={false}
                    />
                  }
                />
              </div>
              <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
                <SettingsCardRow
                  header={
                    <SettingsCardHeader
                      title={t("settings.feed_card.title")}
                      description={t("settings.feed_card.desc")}
                    />
                  }
                  action={
                    <SearchableSelect
                      value={feedCardVariantValue}
                      onChange={(value) => {
                        setConfigValue("feed.card_variant", value);
                      }}
                      options={FEED_CARD_VARIANTS.map((value) => ({
                        value,
                        label: t(`settings.feed_card.options.${value}`),
                      }))}
                      placeholder={t("settings.feed_card.title")}
                      emptyLabel={t("no_more")}
                      searchable={false}
                    />
                  }
                />
                <SettingsCardBody>
                  <div className="grid gap-3 md:grid-cols-2">
                    {FEED_CARD_VARIANTS.map((value) => (
                      <FeedCardPreview
                        key={value}
                        variant={value}
                        selected={feedCardVariantValue === value}
                        title={t(`settings.feed_card.options.${value}`)}
                        description={t(`settings.feed_card.preview.${value}`)}
                        onClick={() => {
                          setConfigValue("feed.card_variant", value);
                        }}
                      />
                    ))}
                  </div>
                </SettingsCardBody>
              </div>
              <div className="mt-4 border-t border-black/5 pt-4 dark:border-white/10">
                <SettingsCardRow
                  header={
                    <SettingsCardHeader
                      title={t("settings.header_behavior.title")}
                      description={t("settings.header_behavior.desc")}
                    />
                  }
                  action={
                    <SearchableSelect
                      value={normalizeHeaderBehavior(String(clientConfig.get("header.behavior") ?? "fixed"))}
                      onChange={(value) => {
                        setConfigValue("header.behavior", value);
                      }}
                      options={HEADER_BEHAVIOR_OPTIONS.map((value) => ({
                        value,
                        label: t(`settings.header_behavior.options.${value}`),
                      }))}
                      placeholder={t("settings.header_behavior.title")}
                      emptyLabel={t("no_more")}
                      searchable={false}
                    />
                  }
                />
              </div>
            </SettingsCard>
          </div>

          <ItemTitle title={t("theme.color_section.title")} />
          <div className="w-full">
            <SettingsCard>
              <SettingsCardRow
                header={
                  <SettingsCardHeader
                    title={t("settings.theme_color.title")}
                    description={t("settings.theme_color.desc")}
                  />
                }
                action={
                  <div className="text-sm font-medium t-primary">{themeColorValue}</div>
                }
              />
              <SettingsCardBody>
                <div className="flex flex-wrap gap-3">
                  {THEME_COLOR_OPTIONS.map((option) => {
                    const selected = themeColorValue === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setConfigValue("theme.color", option.value);
                          applyThemeColor(option.value);
                        }}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 transition-all ${
                          selected
                            ? "border-theme bg-theme/5 shadow-sm shadow-theme/10"
                            : "border-black/10 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
                        }`}
                      >
                        <span
                          className="h-6 w-6 rounded-full border border-black/10 dark:border-white/10"
                          style={{ backgroundColor: option.value }}
                        />
                        <span className="text-sm t-primary">{t(`settings.theme_color.options.${option.label.toLowerCase()}`)}</span>
                        {selected ? <i className="ri-check-line text-theme" /> : null}
                      </button>
                    );
                  })}
                  <label className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2 hover:border-black/20 dark:border-white/10 dark:hover:border-white/20">
                    <input
                      type="color"
                      value={themeColorValue}
                      onChange={(event) => {
                        const normalized = normalizeThemeColor(event.target.value);
                        setConfigValue("theme.color", normalized);
                        applyThemeColor(normalized);
                      }}
                      className="color-input-reset h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                    />
                    <span className="text-sm t-primary">{t("settings.theme_color.custom")}</span>
                  </label>
                </div>
              </SettingsCardBody>
            </SettingsCard>
          </div>

          <ItemTitle title={t("theme.widgets.title")} />
          <ItemSwitch
            title={t("theme.live2d.enable.title")}
            description={t("theme.live2d.enable.desc")}
            checked={live2dEnabled}
            onChange={(checked) => {
              setConfigValue("widget.live2d.enabled", checked);
            }}
          />
          {live2dEnabled ? (
            <>
              <ItemSwitch
                title={t("theme.live2d.position.title")}
                description={t("theme.live2d.position.desc")}
                checked={live2dPosition === "left"}
                onChange={(checked) => {
                  setConfigValue("widget.live2d.position", checked ? "left" : "right");
                }}
              />
              <ItemInput
                title={t("theme.live2d.model.title")}
                description={t("theme.live2d.model.desc")}
                configKeyTitle={t("theme.live2d.model.label")}
                value={String(clientConfig.get("widget.live2d.model") ?? "")}
                placeholder="https://raw-githubusercontent-com-gh.zjkl0330.dpdns.org/827802685/Live2D/refs/heads/master/model/furina/furina.model3.json"
                onChange={(value) => {
                  setConfigValue("widget.live2d.model", value);
                }}
              />
              <ItemInput
                title={t("theme.live2d.scale.title")}
                description={t("theme.live2d.scale.desc")}
                configKeyTitle={t("theme.live2d.scale.label")}
                value={live2dScale}
                placeholder="1"
                onChange={(value) => {
                  const num = Number(value);
                  if (!Number.isFinite(num)) {
                    return;
                  }
                  // 限制在安全范围，防止模型渲染过大挡住页面
                  setConfigValue("widget.live2d.scale", String(Math.min(Math.max(num, 0.1), 2)));
                }}
              />
              <ItemInput
                title={t("theme.live2d.layout.title")}
                description={t("theme.live2d.layout.desc")}
                configKeyTitle={t("theme.live2d.layout.label")}
                value={String(clientConfig.get("widget.live2d.layout") ?? "")}
                placeholder='{"Center Y": 0.05}'
                onChange={(value) => {
                  setConfigValue("widget.live2d.layout", value);
                }}
              />
              <SettingsCard>
                <SettingsCardRow
                  header={
                    <SettingsCardHeader
                      title={t("theme.live2d.defaultModel.title")}
                      description={t("theme.live2d.defaultModel.desc")}
                    />
                  }
                  action={<span />}
                />
                <SettingsCardBody>
                  <select
                    value={live2dDefaultModel}
                    onChange={(event) => {
                      setConfigValue("widget.live2d.defaultModel", event.target.value);
                    }}
                    className="w-full rounded-xl border border-black/10 bg-w px-4 py-2.5 text-sm t-primary outline-none transition-colors focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:focus:border-white/20"
                  >
                    <option value="furina">{t("theme.live2d.switch.furina")}</option>
                    <option value="BCSZ1.1">{t("theme.live2d.switch.BCSZ1.1")}</option>
                    {live2dCustomModels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </SettingsCardBody>
              </SettingsCard>
              <SettingsCard>
                <SettingsCardRow
                  header={
                    <SettingsCardHeader
                      title={t("theme.live2d.custom.title")}
                      description={t("theme.live2d.custom.desc")}
                    />
                  }
                  action={<span />}
                />
                <SettingsCardBody>
                  {/* 已有自定义模型列表 */}
                  {live2dCustomModels.length === 0 ? (
                    <p className="mb-2 text-xs t-muted">{t("theme.live2d.custom.empty")}</p>
                  ) : (
                    <ul className="mb-2 flex flex-col gap-1">
                      {live2dCustomModels.map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-black/10 bg-neutral-50 px-3 py-1.5 text-sm dark:border-white/10 dark:bg-neutral-800"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate font-medium t-primary">
                              {c.name}
                              {c.id === live2dDefaultModel ? (
                                <span className="ml-1 text-xs text-theme">
                                  {t("theme.live2d.custom.defaultFlag")}
                                </span>
                              ) : null}
                            </span>
                            <span className="truncate text-xs t-muted">{c.url}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomModel(c.id)}
                            className="shrink-0 rounded-full px-1 text-neutral-400 transition hover:text-red-500"
                            aria-label={t("theme.live2d.custom.remove")}
                            title={t("theme.live2d.custom.remove")}
                          >
                            <i className="ri-delete-bin-line" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* 添加自定义模型表单 */}
                  <div className="flex flex-col gap-2">
                    <input
                      value={newModelName}
                      onChange={(event) => setNewModelName(event.target.value)}
                      placeholder={t("theme.live2d.custom.namePlaceholder")}
                      className="w-full rounded-xl border border-black/10 bg-w px-4 py-2.5 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:focus:border-white/20"
                    />
                    <input
                      value={newModelUrl}
                      onChange={(event) => setNewModelUrl(event.target.value)}
                      placeholder={t("theme.live2d.custom.urlPlaceholder")}
                      className="w-full rounded-xl border border-black/10 bg-w px-4 py-2.5 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:focus:border-white/20"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomModel}
                      className="inline-flex items-center justify-center gap-1 rounded-full bg-theme px-4 py-2 text-sm font-medium text-white transition hover:bg-theme-hover"
                    >
                      <i className="ri-add-line" />
                      {t("theme.live2d.custom.add")}
                    </button>
                  </div>
                </SettingsCardBody>
              </SettingsCard>
            </>
          ) : null}

          <ItemSwitch
            title={t("theme.cursor.enable.title")}
            description={t("theme.cursor.enable.desc")}
            checked={cursorEnabled}
            onChange={(checked) => {
              setConfigValue("widget.cursor.enabled", checked);
            }}
          />
          {cursorEnabled ? (
            <>
              <div className="w-full">
                <SettingsCard>
                  <SettingsCardRow
                    header={
                      <SettingsCardHeader
                        title={t("theme.cursor.default.title")}
                        description={t("theme.cursor.default.desc")}
                      />
                    }
                    action={
                      <div className="flex items-center gap-2">
                        <img src={cursorDefault} alt="" className="h-6 w-6" />
                        <span className="max-w-52 truncate text-sm text-neutral-500 dark:text-neutral-400">{cursorDefault}</span>
                      </div>
                    }
                  />
                  <SettingsCardBody>
                    <CursorPicker
                      value={cursorDefault}
                      onChange={(value) => {
                        setConfigValue("widget.cursor.default", value);
                      }}
                    />
                  </SettingsCardBody>
                </SettingsCard>
              </div>
              <div className="w-full">
                <SettingsCard>
                  <SettingsCardRow
                    header={
                      <SettingsCardHeader
                        title={t("theme.cursor.pointer.title")}
                        description={t("theme.cursor.pointer.desc")}
                      />
                    }
                    action={
                      <div className="flex items-center gap-2">
                        <img src={cursorPointer} alt="" className="h-6 w-6" />
                        <span className="max-w-52 truncate text-sm text-neutral-500 dark:text-neutral-400">{cursorPointer}</span>
                      </div>
                    }
                  />
                  <SettingsCardBody>
                    <CursorPicker
                      value={cursorPointer}
                      onChange={(value) => {
                        setConfigValue("widget.cursor.pointer", value);
                      }}
                    />
                  </SettingsCardBody>
                </SettingsCard>
              </div>
              <div className="w-full">
                <SettingsCard>
                  <SettingsCardRow
                    header={
                      <SettingsCardHeader
                        title={t("theme.cursor.text.title")}
                        description={t("theme.cursor.text.desc")}
                      />
                    }
                    action={
                      <div className="flex items-center gap-2">
                        <img src={cursorText} alt="" className="h-6 w-6" />
                        <span className="max-w-52 truncate text-sm text-neutral-500 dark:text-neutral-400">{cursorText}</span>
                      </div>
                    }
                  />
                  <SettingsCardBody>
                    <CursorPicker
                      value={cursorText}
                      onChange={(value) => {
                        setConfigValue("widget.cursor.text", value);
                      }}
                    />
                  </SettingsCardBody>
                </SettingsCard>
              </div>
            </>
          ) : null}

          <ItemSwitch
            title={t("theme.firework.enable.title")}
            description={t("theme.firework.enable.desc")}
            checked={fireworkEnabled}
            onChange={(checked) => {
              setConfigValue("widget.firework.enabled", checked);
            }}
          />
          {fireworkEnabled ? (
            <ItemSwitch
              title={t("theme.firework.disable_mobile.title")}
              description={t("theme.firework.disable_mobile.desc")}
              checked={fireworkMobileDisabled}
              onChange={(checked) => {
                setConfigValue("widget.firework.disable_on_mobile", checked);
              }}
            />
          ) : null}

          <ItemSwitch
            title={t("theme.player.enable.title")}
            description={t("theme.player.enable.desc")}
            checked={playerEnabled}
            onChange={(checked) => {
              setConfigValue("widget.player.enabled", checked);
            }}
          />
          {playerEnabled ? (
            <>
              <ItemSwitch
                title={t("theme.player.autoplay.title")}
                description={t("theme.player.autoplay.desc")}
                checked={playerAutoplay}
                onChange={(checked) => {
                  setConfigValue("widget.player.autoplay", checked);
                }}
              />
              <div className="w-full">
                <SettingsCard>
                  <SettingsCardRow
                    header={
                      <SettingsCardHeader
                        title={t("theme.player.audio.title")}
                        description={t("theme.player.audio.desc")}
                      />
                    }
                    action={
                      <button
                        type="button"
                        className="text-sm text-theme hover:underline"
                        onClick={() => {
                          setConfigValue("widget.player.audio", playerAudio === "[]" ? PLAYER_AUDIO_EXAMPLE : "[]");
                        }}
                      >
                        {playerAudio === "[]" ? t("theme.player.audio.example") : t("theme.player.audio.clear")}
                      </button>
                    }
                  />
                  <SettingsCardBody>
                    <textarea
                      value={playerAudio}
                      onChange={(event) => {
                        setConfigValue("widget.player.audio", event.target.value);
                      }}
                      className="min-h-40 w-full rounded-xl border border-black/10 bg-w px-4 py-3 font-mono text-xs t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
                      placeholder='[{"name":"Song","artist":"Artist","url":"https://...","cover":"/avatar.png"}]'
                    />
                  </SettingsCardBody>
                </SettingsCard>
              </div>
              <ItemInput
                title={t("theme.player.meting_api.title")}
                description={t("theme.player.meting_api.desc")}
                configKeyTitle={t("theme.player.meting_api.label")}
                value={playerMetingApi}
                placeholder="https://music.example.com/api"
                onChange={(value) => {
                  setConfigValue("widget.player.meting_api", value);
                }}
              />
              <ItemInput
                title={t("theme.player.meting.title")}
                description={t("theme.player.meting.desc")}
                configKeyTitle={t("theme.player.meting.label")}
                value={playerMeting}
                placeholder='{"server":"netease","type":"playlist","id":"60198"}'
                onChange={(value) => {
                  setConfigValue("widget.player.meting", value);
                }}
              />
            </>
          ) : null}

          <ItemSwitch
            title={t("theme.share.enable.title")}
            description={t("theme.share.enable.desc")}
            checked={shareEnabled}
            onChange={(checked) => {
              setConfigValue("widget.share.enabled", checked);
            }}
          />
          {shareEnabled ? (
            <ItemInput
              title={t("theme.share.networks.title")}
              description={t("theme.share.networks.desc")}
              configKeyTitle={t("theme.share.networks.label")}
              value={shareNetworks}
              placeholder="weibo,qq,weixin,telegram,x,facebook,qzone,copy"
              onChange={(value) => {
                setConfigValue("widget.share.networks", value);
              }}
            />
          ) : null}

          <ItemSwitch
            title={t("theme.anchor.enable.title")}
            description={t("theme.anchor.enable.desc")}
            checked={anchorEnabled}
            onChange={(checked) => {
              setConfigValue("widget.anchor.enabled", checked);
            }}
          />
          {anchorEnabled ? (
            <>
              <ItemSwitch
                title={t("theme.anchor.auto.title")}
                description={t("theme.anchor.auto.desc")}
                checked={anchorAuto}
                onChange={(checked) => {
                  setConfigValue("widget.anchor.auto", checked);
                }}
              />
              <ItemInput
                title={t("theme.anchor.length.title")}
                description={t("theme.anchor.length.desc")}
                configKeyTitle={t("theme.anchor.length.label")}
                value={anchorLength}
                placeholder="60"
                onChange={(value) => {
                  setConfigValue("widget.anchor.length", value);
                }}
              />
            </>
          ) : null}

          {hasUnsavedChanges && (
            <SaveBar
              message={t("theme.unsaved_changes")}
              saving={saving}
              loading={loading}
              onReset={handleReset}
              onSave={handleSave}
            />
          )}
        </div>
      </main>
      <AlertUI />
    </div>
  );
}