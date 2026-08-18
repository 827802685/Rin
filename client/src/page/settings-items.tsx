import * as Switch from "@radix-ui/react-switch";
import { type ChangeEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { Button } from "../components/button";
import { useConfirm } from "../components/dialog";
import { ImageUploadInput } from "../components/image-upload-input";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsCardRow,
  SettingsSectionTitle,
} from "@rin/ui";

export function ItemTitle({ title }: { title: string }) {
  return <SettingsSectionTitle title={title} />;
}

export function ItemSwitch({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <Switch.Root className="SwitchRoot" checked={checked} onCheckedChange={onChange}>
              <Switch.Thumb className="SwitchThumb" />
            </Switch.Root>
          }
        />
      </SettingsCard>
    </div>
  );
}

export function ItemInput({
  title,
  configKeyTitle,
  description,
  value,
  placeholder,
  onChange,
}: {
  title: string;
  description: string;
  configKeyTitle: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full">
      <SettingsCard>
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => {
            setIsOpen((current) => {
              return !current;
            });
          }}
        >
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {value || placeholder || configKeyTitle}
                </span>
                <i
                  className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </div>
            }
          />
        </button>
        {isOpen ? (
          <SettingsCardBody>
            <textarea
              placeholder={placeholder || configKeyTitle}
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
              }}
              className="min-h-36 w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20"
            />
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-3 inline-flex items-center gap-1 rounded-full bg-theme px-4 py-1.5 text-sm font-medium text-white transition hover:bg-theme-hover"
            >
              <i className="ri-check-line" />
              {t("confirm")}
            </button>
          </SettingsCardBody>
        ) : null}
      </SettingsCard>
    </div>
  );
}

// 固定吸附在视口底部的"未保存更改"浮层，凌驾于所有页面内容之上，
// 内部宽度与页面内容对齐。有未保存修改时由各设置页渲染。
export function SaveBar({
  message,
  saving,
  loading,
  onReset,
  onSave,
}: {
  message: string;
  saving: boolean;
  loading: boolean;
  onReset: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50">
      <div className="border-t border-black/10 bg-w shadow-[0_-4px_24px_rgba(0,0,0,0.15)] dark:border-white/10">
        <div className="mx-auto flex w-full max-w-screen-xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium t-primary">
            <span className="h-2 w-2 shrink-0 rounded-full bg-theme" aria-hidden="true" />
            <span className="truncate">{message}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button secondary title={t("reset")} onClick={onReset} disabled={saving} />
            <Button title={t("save")} onClick={onSave} disabled={saving || loading} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ItemButton({
  title,
  description,
  buttonTitle,
  onConfirm,
  alertTitle,
  alertDescription,
}: {
  title: string;
  description: string;
  buttonTitle: string;
  onConfirm: () => Promise<void>;
  alertTitle: string;
  alertDescription: string;
}) {
  const { showConfirm, ConfirmUI } = useConfirm();

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <Button
              title={buttonTitle}
              onClick={() => {
                showConfirm(alertTitle, alertDescription, onConfirm);
              }}
            />
          }
        />
      </SettingsCard>
      <ConfirmUI />
    </div>
  );
}

export function ItemWithUpload({
  title,
  description,
  accept,
  onFileChange,
}: {
  title: string;
  description: string;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  accept: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setLoading(true);
    try {
      await onFileChange(event);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <SettingsCard>
        <SettingsCardRow
          header={<SettingsCardHeader title={title} description={description} />}
          action={
            <>
              {loading && <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />}
              <input ref={inputRef} type="file" className="hidden" accept={accept} onChange={handleFileChange} />
              <Button
                onClick={() => {
                  inputRef.current?.click();
                }}
                title={t("upload.title")}
              />
            </>
          }
        />
      </SettingsCard>
    </div>
  );
}

export function ItemImageInput({
  title,
  description,
  configKeyTitle,
  value,
  placeholder,
  onChange,
  onError,
  shape = "rounded",
}: {
  title: string;
  description: string;
  configKeyTitle: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onError?: (message: string) => void;
  shape?: "rounded" | "circle";
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full">
      <SettingsCard>
        <button
          type="button"
          className="block w-full text-left"
          onClick={() => {
            setIsOpen((current) => !current);
          }}
        >
          <SettingsCardRow
            header={<SettingsCardHeader title={title} description={description} />}
            action={
              <div className="flex items-center gap-3">
                {value ? (
                  <img
                    src={value}
                    alt={configKeyTitle}
                    className={`h-10 w-10 object-cover ${shape === "circle" ? "rounded-full" : "rounded-2xl"}`}
                  />
                ) : null}
                <span className="max-w-56 truncate text-sm text-neutral-500 dark:text-neutral-400">
                  {value || placeholder || configKeyTitle}
                </span>
                <i
                  className={`ri-arrow-down-s-line text-lg text-neutral-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </div>
            }
          />
        </button>
        {isOpen ? (
          <SettingsCardBody>
            <ImageUploadInput
              value={value}
              onChange={onChange}
              onError={onError}
              placeholder={placeholder || configKeyTitle}
              shape={shape}
            />
          </SettingsCardBody>
        ) : null}
      </SettingsCard>
    </div>
  );
}
