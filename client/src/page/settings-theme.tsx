import {
  fieldBaseClassName,
  fieldCompactClassName,
  SearchableSelect,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsCardRow,
} from "@rin/ui";
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
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
import { BUILTIN_MODELS, newCustomModelId, parseCustomModels } from "../components/theme/live2d/models";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { useSettingsDraft } from "../hooks/use-settings-draft";
import { applyThemeColor, normalizeThemeColor } from "../utils/theme-color";
import { ItemInput, ItemSwitch, ItemTitle, SaveBar } from "./settings-items";

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
  const {
    loading,
    saving,
    clientConfig,
    hasUnsavedChanges,
    setClientConfigValue: setConfigValue,
    handleReset,
    handleSave,
    showAlert,
    AlertUI,
  } = useSettingsDraft({
    successMessage: "theme.save_success",
    liveThemeColor: true,
  });
  // 设置页"添加自定义模型"表单
  const [newModelName, setNewModelName] = useState("");
  const [newModelUrl, setNewModelUrl] = useState("");

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
  // 自定义模型列表配置（JSON 数组 [{ id, name, url }]，解析逻辑统一在 live2d/models.ts）
  const live2dCustomModelsRaw = clientConfig.get("widget.live2d.customModels");
  const live2dCustomModels = useMemo(
    () => parseCustomModels(live2dCustomModelsRaw),
    [live2dCustomModelsRaw],
  );
  // 设置页模型列表展示项：内置模型在前（展示名走 i18n），自定义模型在后
  const live2dModelEntries = useMemo(() => {
    const builtin = BUILTIN_MODELS.map((id) => ({
      id,
      name: t(`theme.live2d.switch.${id}`),
      url: "",
      builtin: true,
    }));
    return [...builtin, ...live2dCustomModels.map((c) => ({ ...c, builtin: false }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live2dCustomModels, t]);
  const cursorEnabled = clientConfig.getBoolean("widget.cursor.enabled");
  const cursorDefault = String(clientConfig.get("widget.cursor.default") ?? "/cursors/furina/normal.png");
  const cursorPointer = String(clientConfig.get("widget.cursor.pointer") ?? "/cursors/furina/link.png");
  const cursorText = String(clientConfig.get("widget.cursor.text") ?? "/cursors/furina/text.png");
  const fireworkEnabled = clientConfig.getBoolean("widget.firework.enabled");
  const fireworkMobileDisabled = clientConfig.getBoolean("widget.firework.disable_on_mobile");
  const playerEnabled = clientConfig.getBoolean("widget.player.enabled");
  const playerAutoplay = clientConfig.getBoolean("widget.player.autoplay");
  const playerAudio = String(clientConfig.get("widget.player.audio") ?? "[]");
  // 播放列表 JSON 失校验：非法 JSON 时行内提示（保存的仍是原字符串，不阻塞其它设置）
  const playerAudioInvalid = useMemo(() => {
    try {
      JSON.parse(playerAudio);
      return false;
    } catch {
      return true;
    }
  }, [playerAudio]);
  const playerMetingApi = String(clientConfig.get("widget.player.meting_api") ?? "");
  const playerMeting = String(clientConfig.get("widget.player.meting") ?? "");
  const shareEnabled = clientConfig.getBoolean("widget.share.enabled");
  const shareNetworks = String(clientConfig.get("widget.share.networks") ?? "");
  const anchorEnabled = clientConfig.getBoolean("widget.anchor.enabled");
  const anchorAuto = clientConfig.getBoolean("widget.anchor.auto");
  const anchorLength = String(clientConfig.get("widget.anchor.length") ?? "60");

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
    const next = [...live2dCustomModels, { id: newCustomModelId(), name, url }];
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
              <ItemSwitch
                title={t("theme.live2d.edge.title")}
                description={t("theme.live2d.edge.desc")}
                checked={String(clientConfig.get("widget.live2d.edge") ?? "").trim().toLowerCase() === "true"}
                onChange={(checked) => {
                  setConfigValue("widget.live2d.edge", checked);
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
              {/* 模型管理：内置 + 自定义统一列出，点"设为默认"切换默认模型，添加表单在底部 */}
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
                  <ul className="mb-3 flex flex-col gap-1.5">
                    {live2dModelEntries.map((m) => (
                      <li
                        key={m.id}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                          m.id === live2dDefaultModel
                            ? "border-theme/40 bg-theme/5"
                            : "border-black/10 bg-neutral-50 dark:border-white/10 dark:bg-neutral-800"
                        }`}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium t-primary">
                            {m.name}
                            {m.builtin ? (
                              <span className="ml-1.5 rounded bg-neutral-200/70 px-1 py-0.5 align-middle text-[10px] t-muted dark:bg-neutral-700">
                                {t("theme.live2d.custom.builtin")}
                              </span>
                            ) : null}
                            {m.id === live2dDefaultModel ? (
                              <span className="ml-1 text-xs text-theme">
                                {t("theme.live2d.custom.defaultFlag")}
                              </span>
                            ) : null}
                          </span>
                          {m.url ? <span className="truncate text-xs t-muted">{m.url}</span> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {m.id !== live2dDefaultModel ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfigValue("widget.live2d.defaultModel", m.id);
                              }}
                              className="rounded-full px-2 py-1 text-xs text-theme transition hover:bg-theme/10"
                              title={t("theme.live2d.custom.set_default")}
                            >
                              {t("theme.live2d.custom.set_default")}
                            </button>
                          ) : null}
                          {!m.builtin ? (
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomModel(m.id)}
                              className="rounded-full px-1 text-neutral-400 transition hover:text-red-500"
                              aria-label={t("theme.live2d.custom.remove")}
                              title={t("theme.live2d.custom.remove")}
                            >
                              <i className="ri-delete-bin-line" />
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {/* 添加自定义模型表单 */}
                  <div className="flex flex-col gap-2">
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        value={newModelName}
                        onChange={(event) => setNewModelName(event.target.value)}
                        placeholder={t("theme.live2d.custom.namePlaceholder")}
                        className={`${fieldCompactClassName} placeholder:text-neutral-400`}
                      />
                      <input
                        value={newModelUrl}
                        onChange={(event) => setNewModelUrl(event.target.value)}
                        placeholder={t("theme.live2d.custom.urlPlaceholder")}
                        className={`${fieldCompactClassName} placeholder:text-neutral-400`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomModel}
                      className="inline-flex items-center justify-center gap-1 self-start rounded-full bg-theme px-4 py-2 text-sm font-medium text-white transition hover:bg-theme-hover"
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
                      className={`${fieldBaseClassName} min-h-40 px-4 py-3 font-mono text-xs placeholder:text-neutral-400 dark:placeholder:text-neutral-500`}
                      placeholder='[{"name":"Song","artist":"Artist","url":"https://...","cover":"/avatar.png"}]'
                    />
                    {playerAudioInvalid ? (
                      <p className="mt-2 text-xs text-red-500">{t("theme.player.audio.invalid_json")}</p>
                    ) : null}
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