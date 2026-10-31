import { classicLayoutDefinition } from "./classic-layout";
import { PreviewBrand, PreviewCanvas, PreviewContent } from "../preview-primitives";
import type { HeaderLayoutDefinition } from "../layout-types";
import { SiteSidebar } from "../../site-sidebar/sidebar";

// 顶栏沿用 classic 的渲染；两栏结构在 route shell 里做
const { renderDesktop, renderMobile } = classicLayoutDefinition;

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
          <div className="min-w-0 flex-1 [&_.wauto]:w-full">{rawContent ?? content}</div>
          {/* 浏览器「电脑版」通常把布局视口固定成 980px，比 Tailwind lg(1024) 差 44px，
              按 lg 判断会导致手机开电脑版依然是单栏。这里把侧栏门槛单独降到 980px：
              手机竖屏(390~430)/平板竖屏(768) 仍不显示，等宽 ≥980 才铺两栏。 */}
          <aside className="sticky top-24 hidden w-72 shrink-0 min-[980px]:block">
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
