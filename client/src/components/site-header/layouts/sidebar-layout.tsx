import { useState } from "react";
import { useTranslation } from "react-i18next";
import { classicLayoutDefinition } from "./classic-layout";
import { PreviewBrand, PreviewCanvas, PreviewContent } from "../preview-primitives";
import type { HeaderLayoutDefinition } from "../layout-types";
import { SiteSidebar } from "../../site-sidebar/sidebar";

// 顶栏沿用 classic 的渲染；两栏结构在 route shell 里做
const { renderDesktop, renderMobile } = classicLayoutDefinition;

/**
 * 窄屏（< lg）下侧栏整体隐藏会把站点简介、社交链接、标签云全丢掉。
 * 这里折叠成一块可展开的面板挂在正文下方：默认收起不抢阅读空间，
 * 但至少给窄屏读者留了入口，而不是让"侧栏双列"在手机上凭空消失。
 */
function NarrowScreenSidebar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-6 lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="rin-glass-pill flex w-full items-center justify-between rounded-2xl border border-line bg-w px-4 py-3 text-sm t-secondary transition-colors hover:text-theme"
      >
        <span className="flex items-center gap-2">
          <i className="ri-layout-right-2-line" aria-hidden />
          {t("sidebar.narrow_title")}
        </span>
        <i className={open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden />
      </button>
      {open ? (
        <div className="mt-3">
          {/* withTocSlot=false：目录槽位只能有一份，桌面 aside 已经占用了 */}
          <SiteSidebar withTocSlot={false} />
        </div>
      ) : null}
    </div>
  );
}

export const sidebarLayoutDefinition: HeaderLayoutDefinition = {
  kind: "sidebar",
  renderDesktop,
  renderMobile,
  renderPreview(data) {
    return (
      <PreviewCanvas className="w-full overflow-hidden rounded-[22px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <PreviewBrand data={data} />
          <div className="flex items-center gap-1">
            <div className="h-4 w-8 rounded-full" style={{ backgroundColor: data.themeColor }} />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-black/10 dark:bg-white/10" />
            <div className="h-2 w-full rounded bg-black/5 dark:bg-white/[0.06]" />
            <div className="h-2 w-5/6 rounded bg-black/5 dark:bg-white/[0.06]" />
            <div className="h-10 rounded-lg bg-black/5 dark:bg-white/[0.06]" />
          </div>
          <div className="w-14 shrink-0 space-y-1.5 rounded-lg bg-black/5 p-1.5 dark:bg-white/[0.06]">
            <div className="mx-auto h-4 w-4 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="h-1.5 w-full rounded bg-black/10 dark:bg-white/10" />
            <div className="h-1.5 w-3/4 rounded bg-black/10 dark:bg-white/10" />
          </div>
        </div>
        <PreviewContent />
      </PreviewCanvas>
    );
  },
  renderRouteShell({ header, content, rawContent, footer }) {
    return (
      <div className="flex min-h-screen flex-col">
        {header}
        <div className="mx-auto flex w-full max-w-6xl flex-1 items-start gap-6 px-4 py-4 sm:px-6 lg:px-10">
          {/* 页面自己已经有一层 <main>，这里再用 main 会嵌套出两个主地标 */}
          <div className="min-w-0 flex-1 [&_.wauto]:w-full">
            {rawContent ?? content}
            <NarrowScreenSidebar />
          </div>
          <aside className="sticky top-24 hidden w-72 shrink-0 lg:block">
            <div className="scrollbar-none flex max-h-[calc(100vh-7.5rem)] flex-col overflow-y-auto">
              <SiteSidebar />
            </div>
          </aside>
        </div>
        {footer}
      </div>
    );
  },
};
