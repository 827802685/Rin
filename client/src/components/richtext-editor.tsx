import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Markdown as TiptapMarkdown, MarkdownStorage } from "tiptap-markdown";
import React, { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import Loading from "react-loading";
import { FlatInset, FlatTabButton } from "@rin/ui";
import { useAlert } from "./dialog";
import { useColorMode } from "../utils/darkModeUtils";
import { uploadImageFile } from "../utils/image-upload";
import { Markdown } from "./markdown";

declare module "@tiptap/core" {
  interface Storage {
    markdown: MarkdownStorage;
  }
}

interface RichTextEditorProps {
  content: string;
  setContent: (content: string) => void;
  placeholder?: string;
  height?: string;
}

type EditorMode = "richtext" | "markdown" | "preview";

function ToolButton({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  children,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-theme disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-theme/30 bg-theme/10 text-theme"
          : "border-transparent t-secondary hover:border-black/10 hover:bg-neutral-100 dark:hover:border-white/10 dark:hover:bg-neutral-700"
      }`}
    >
      {children ?? (
        <>
          <i className={icon} aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </>
      )}
    </button>
  );
}

export function RichTextEditor({ content, setContent, placeholder = "> 开始写作...", height = "600px" }: RichTextEditorProps) {
  const { t } = useTranslation();
  const colorMode = useColorMode();
  const { showAlert, AlertUI } = useAlert();
  const [mode, setMode] = useState<EditorMode>("richtext");
  const [markdownDraft, setMarkdownDraft] = useState(content);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 用 fn 判断是否由 markdown 模式修改，避免循环写入覆盖编辑中的内容
  const suppressMarkdown = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TiptapMarkdown.configure({
        html: false,
        tightLists: true,
        linkify: true,
        breaks: true,
      }),
    ],
    content: content,
    editorProps: {
      attributes: {
        class:
          "richtext-prose max-w-none focus:outline-none min-h-[320px] px-5 py-4 prose prose-neutral dark:prose-invert prose-headings:font-bold prose-headings:my-3 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:my-2 prose-p:leading-7 prose-img:rounded-xl prose-img:mx-auto prose-a:text-[#0686c8] prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:not-italic prose-pre:bg-[#f6f6f6] prose-code:text-[#e061cb]",
      },
    },
    onUpdate: ({ editor }) => {
      suppressMarkdown.current = true;
      setContent(editor.storage.markdown?.getMarkdown() ?? editor.getHTML());
      requestAnimationFrame(() => {
        suppressMarkdown.current = false;
      });
    },
  });

  // 外部 content 变化（load/重置/切回源码确认）时同步，避免覆盖正在编辑
  const syncFromOutside = useCallback(() => {
    if (!editor) return;
    const currentMarkdown = editor.storage.markdown?.getMarkdown?.() ?? "";
    if (currentMarkdown !== content && !suppressMarkdown.current) {
      editor.commands.setContent(content === "" ? "" : content);
    }
  }, [editor, content]);
  React.useEffect(() => {
    // 仅在 mode 切换回富文本、或初次挂载且内容有差异时同步
    if (mode === "richtext") {
      syncFromOutside();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, content]);

  // ---- 图片上传 ----
  const uploadImages = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        if (file.size > 5 * 1024 * 1024) {
          showAlert(t("upload.failed$size", { size: 5 }));
          continue;
        }
        setUploading(true);
        try {
          const result = await uploadImageFile(file);
          if (!editor) continue;
          const url = result.url;
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        } catch (error) {
          console.error(error);
          showAlert(error instanceof Error ? error.message : t("upload.failed"));
        } finally {
          setUploading(false);
        }
      }
    },
    [editor, showAlert, t],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const files = event.clipboardData?.files;
      if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith("image/"))) {
        event.preventDefault();
        void uploadImages(files);
      }
    },
    [uploadImages],
  );

  // ---- 模式切换 ----
  const switchMode = (next: EditorMode) => {
    if (next === mode) return;
    if (mode === "richtext" && (next === "markdown" || next === "preview")) {
      // 先把当前富文本转成 markdown 作为草稿
      setMarkdownDraft(editor?.storage.markdown?.getMarkdown() ?? editor?.getHTML() ?? "");
    }
    if (next === "richtext" && mode === "markdown") {
      // 确认源码修改：写回
      setContent(markdownDraft);
    }
    setMode(next);
  };

  // ---- markdown 源码编辑 ----
  const markdownEditorRef = useRef<HTMLTextAreaElement>(null);
  const handleMarkdownChange = (value: string) => {
    setMarkdownDraft(value);
    if (mode === "markdown") {
      setContent(value);
    }
  };

  // 检测 selected 状态辅助
  const isActive = (check: () => boolean) => {
    return editor?.isActive(check) ?? false;
  };

  if (!editor) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loading type="spin" color="#FC466B" height={24} width={24} />
      </div>
    );
  }

  const activeHeading = (() => {
    if (editor.isActive("heading", { level: 1 })) return "1";
    if (editor.isActive("heading", { level: 2 })) return "2";
    if (editor.isActive("heading", { level: 3 })) return "3";
    return "0";
  })();

  return (
    <div className="flex flex-col gap-0 sm:gap-3">
      <FlatInset className="flex flex-wrap items-center gap-2 rounded-none border-0 border-b border-black/10 bg-transparent p-2 dark:border-white/10 sm:rounded-none sm:border-0 sm:border-b sm:p-3">
        <FlatTabButton
          active={mode === "richtext"}
          onClick={() => switchMode("richtext")}
        >
          {t("rich_editor.mode.visual")}
        </FlatTabButton>
        <FlatTabButton
          active={mode === "markdown"}
          onClick={() => switchMode("markdown")}
        >
          {t("rich_editor.mode.markdown")}
        </FlatTabButton>
        <FlatTabButton
          active={mode === "preview"}
          onClick={() => switchMode("preview")}
        >
          {t("preview")}
        </FlatTabButton>

        {mode === "richtext" && (
          <>
            <span className="mx-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden="true" />
            <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label={t("markdown_editor.toolbar.label")}>
              <ToolButton
                label={t("rich_editor.toolbar.heading1")}
                icon="ri-text"
                active={activeHeading === "1"}
                onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              >
                H1
              </ToolButton>
              <ToolButton
                label={t("rich_editor.toolbar.heading2")}
                icon="ri-text"
                active={activeHeading === "2"}
                onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                H2
              </ToolButton>
              <ToolButton
                label={t("rich_editor.toolbar.heading3")}
                icon="ri-text"
                active={activeHeading === "3"}
                onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              >
                H3
              </ToolButton>
              <span className="mx-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden="true" />
              <ToolButton
                label={t("rich_editor.toolbar.bold")}
                icon="ri-bold"
                active={isActive(() => editor.isActive("bold"))}
                onClick={() => editor.chain().focus().toggleBold().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.italic")}
                icon="ri-italic"
                active={isActive(() => editor.isActive("italic"))}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.strike")}
                icon="ri-strikethrough"
                active={isActive(() => editor.isActive("strike"))}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.code")}
                icon="ri-code-s-slash-line"
                active={isActive(() => editor.isActive("code"))}
                onClick={() => editor.chain().focus().toggleCode().run()}
              />
              <span className="mx-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden="true" />
              <ToolButton
                label={t("rich_editor.toolbar.quote")}
                icon="ri-double-quotes-l"
                active={isActive(() => editor.isActive("blockquote"))}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.ul")}
                icon="ri-list-unordered"
                active={isActive(() => editor.isActive("bulletList"))}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.ol")}
                icon="ri-list-ordered"
                active={isActive(() => editor.isActive("orderedList"))}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              />
              <ToolButton
                label={t("rich_editor.toolbar.task")}
                icon="ri-task-line"
                active={isActive(() => editor.isActive("taskList"))}
                onClick={() => editor.chain().focus().toggleTaskList().run()}
              />
              <span className="mx-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden="true" />
              <ToolButton
                label={t("rich_editor.toolbar.link")}
                icon="ri-link"
                active={isActive(() => editor.isActive("link"))}
                onClick={() => {
                  const previous = editor.getAttributes("link").href as string | undefined;
                  const href = window.prompt(t("rich_editor.toolbar.link_url"), previous ?? "https://");
                  if (href === null) return;
                  if (href === "") {
                    editor.chain().focus().extendMarkRange("link").unsetLink().run();
                    return;
                  }
                  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
                }}
              />
              <ToolButton
                label={t("rich_editor.toolbar.hr")}
                icon="ri-separator"
                onClick={() => editor.chain().focus().setHorizontalRule().run()}
              />
              <span className="mx-1 hidden h-6 w-px bg-black/10 dark:bg-white/10 sm:block" aria-hidden="true" />
              <ToolButton
                label={t("rich_editor.toolbar.upload_image")}
                icon="ri-image-add-line"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              />
            </div>
          </>
        )}
      </FlatInset>

      <div className={mode === "richtext" ? "block" : "hidden"}>
        <div
          className="relative min-h-0 overflow-hidden rounded-2xl border border-black/10 bg-w dark:border-white/10"
          onDrop={(event) => {
            event.preventDefault();
            const files = event.dataTransfer?.files;
            if (files && files.length > 0) {
              void uploadImages(files);
            }
          }}
          onPaste={handlePaste}
        >
          <EditorContent editor={editor} style={{ height }} />
        </div>
      </div>

      <div className={mode === "markdown" ? "block" : "hidden"}>
        <textarea
          ref={markdownEditorRef}
          value={markdownDraft}
          onChange={(e) => handleMarkdownChange(e.target.value)}
          spellCheck={false}
          style={{ height }}
          className={`w-full resize-none rounded-2xl border border-black/10 bg-w p-4 font-mono text-sm leading-6 t-primary outline-none focus:border-theme/40 dark:border-white/10 ${
            colorMode === "dark" ? "dark" : ""
          }`}
        />
      </div>

      <div className={mode === "preview" ? "block" : "hidden"}>
        <div
          className="min-h-0 overflow-y-auto rounded-2xl border border-black/10 bg-w px-5 py-5 dark:border-white/10"
          style={{ height }}
        >
          <Markdown content={markdownDraft && markdownDraft.trim() ? markdownDraft : placeholder} />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (files && files.length > 0) {
            void uploadImages(files);
          }
          e.currentTarget.value = "";
        }}
      />
      <AlertUI />
    </div>
  );
}