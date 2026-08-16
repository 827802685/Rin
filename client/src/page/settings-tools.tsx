import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "react-modal";
import { Button } from "../components/button";
import { useConfirm } from "../components/dialog";
import { ImageUploadInput } from "../components/image-upload-input";
import { Input } from "../components/input";
import { ItemTitle } from "./settings-items";
import { createToolId, toolHostname, type ToolItem } from "../utils/tools";
import { SettingsCard, SettingsCardHeader, SettingsCardRow } from "@rin/ui";

export function ToolsSettings({
  value,
  onChange,
}: {
  value: ToolItem[];
  onChange: (tools: ToolItem[]) => void;
}) {
  const { t } = useTranslation();
  const { showConfirm, ConfirmUI } = useConfirm();
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ToolItem | null>(null);

  const openCreate = () => {
    setEditing(null);
    setIsOpen(true);
  };

  const openEdit = (tool: ToolItem) => {
    setEditing(tool);
    setIsOpen(true);
  };

  const handleDelete = (tool: ToolItem) => {
    showConfirm(
      t("settings.tools.delete.confirm_title"),
      t("settings.tools.delete.confirm_desc", { name: tool.name }),
      () => {
        onChange(value.filter((item) => item.id !== tool.id));
      },
    );
  };

  const handleSave = (tool: ToolItem) => {
    const next = editing ? value.map((item) => (item.id === editing.id ? tool : item)) : [...value, tool];
    onChange(next);
    setIsOpen(false);
  };

  return (
    <>
      <ItemTitle title={t("settings.tools.title")} />
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={t("settings.tools.manage.title")} description={t("settings.tools.manage.desc")} />}
          action={<Button title={t("settings.tools.add")} onClick={openCreate} />}
        />
      </SettingsCard>

      {value.map((tool) => (
        <div key={tool.id} className="w-full">
          <SettingsCard>
            <SettingsCardRow
              header={
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <ToolIcon tool={tool} />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold tracking-[-0.02em] t-primary">{tool.name}</p>
                    <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{tool.description || tool.url}</p>
                  </div>
                </div>
              }
              action={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(tool)}
                    title={t("settings.tools.edit")}
                    aria-label={t("settings.tools.edit")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary t-primary bg-button transition-colors"
                  >
                    <i className="ri-edit-line" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(tool)}
                    title={t("settings.tools.delete.title")}
                    aria-label={t("settings.tools.delete.title")}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary t-primary bg-button transition-colors"
                  >
                    <i className="ri-delete-bin-line" aria-hidden="true" />
                  </button>
                </div>
              }
            />
          </SettingsCard>
        </div>
      ))}

      <ToolEditModal
        isOpen={isOpen}
        initial={editing}
        onClose={() => setIsOpen(false)}
        onSave={handleSave}
      />
      <ConfirmUI />
    </>
  );
}

function ToolIcon({ tool }: { tool: ToolItem }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showIcon = tool.icon.trim().length > 0 && !imageFailed;

  if (showIcon) {
    return (
      <img
        src={tool.icon}
        alt={tool.name}
        className="h-10 w-10 shrink-0 rounded-xl object-cover border border-black/10 dark:border-white/10"
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme/10 text-theme">
      <i className="ri-apps-2-line text-lg" aria-hidden="true" />
    </div>
  );
}

const MODAL_STYLE = {
  content: {
    top: "50%",
    left: "50%",
    right: "auto",
    bottom: "auto",
    marginRight: "-50%",
    transform: "translate(-50%, -50%)",
    padding: "0",
    border: "none",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    background: "transparent",
    maxWidth: "40rem",
    width: "90vw",
  },
  overlay: {
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    zIndex: 1000,
  },
} as const;

function ToolEditModal({
  isOpen,
  initial,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  initial: ToolItem | null;
  onClose: () => void;
  onSave: (tool: ToolItem) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setIcon(initial?.icon ?? "");
      setUrl(initial?.url ?? "");
      setError("");
    }
  }, [isOpen, initial]);

  const handleSubmit = () => {
    if (!name.trim()) {
      setError(t("settings.tools.name_required"));
      return;
    }
    if (!url.trim()) {
      setError(t("settings.tools.url_required"));
      return;
    }
    onSave({
      id: initial?.id ?? createToolId(),
      name: name.trim(),
      description: description.trim(),
      icon: icon.trim(),
      url: url.trim(),
    });
  };

  const applyFavicon = () => {
    const hostname = toolHostname(url.trim());
    if (hostname) {
      setIcon(`${hostname.startsWith("http") ? hostname : `https://${hostname}`}/favicon.ico`);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      shouldCloseOnOverlayClick
      shouldCloseOnEsc
      style={MODAL_STYLE}
      contentLabel={initial ? t("settings.tools.edit") : t("settings.tools.add")}
    >
      <div className="flex flex-col bg-w w-full rounded-2xl shadow-lg p-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold t-primary">{initial ? t("settings.tools.edit") : t("settings.tools.add")}</h1>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-full p-2 text-neutral-500 transition-colors hover:bg-black/5 dark:hover:bg-white/10">
            <i className="ri-close-line text-lg" aria-hidden="true" />
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        <div className="mt-6 space-y-6">
          <div className="flex flex-col items-start space-y-4">
            <label className="text-sm font-medium t-secondary">{t("settings.tools.icon")}</label>
            <div className="w-full">
              <ImageUploadInput value={icon} onChange={setIcon} onError={setError} placeholder={t("settings.tools.icon_placeholder")} shape="rounded" maxFileSize={2 * 1024 * 1024} />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={applyFavicon}
                disabled={url.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-w px-3 py-2 text-sm t-secondary transition-colors hover:border-black/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:border-white/20"
              >
                <i className="ri-focus-3-line" aria-hidden="true" />
                {t("settings.tools.fetch_icon")}
              </button>
              <p className="text-xs t-secondary">{t("settings.tools.icon_hint")}</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium t-secondary">{t("settings.tools.name")}</label>
            <Input value={name} setValue={setName} placeholder={t("settings.tools.name_placeholder")} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium t-secondary">{t("settings.tools.description")}</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("settings.tools.description_placeholder")}
              className="min-h-24 w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium t-secondary">{t("settings.tools.url")}</label>
            <Input value={url} setValue={setUrl} placeholder={t("settings.tools.url_placeholder")} />
          </div>

          <div className="flex flex-row items-center justify-end space-x-2 pt-4">
            <Button secondary title={t("cancel")} onClick={onClose} />
            <Button title={initial ? t("save") : t("settings.tools.add")} onClick={handleSubmit} />
          </div>
        </div>
      </div>
    </Modal>
  );
}