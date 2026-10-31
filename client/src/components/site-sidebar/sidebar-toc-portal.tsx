import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** 与 sidebar-layout 的 `lg` 断点保持一致 */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 侧栏布局下把文章页目录传送进全局侧栏槽位；槽位不存在（非侧栏壳）时原样渲染。
 *
 * 窄屏时侧栏整体折叠，槽位虽然还在 DOM 里但不可见——此时必须走原样渲染，
 * 否则手机上的文章目录会被塞进看不见的侧栏，读者以为目录功能没了。
 */
export function SidebarTocPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      setSlot(document.getElementById("rin-sidebar-slot"));
      return;
    }

    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => {
      setSlot(query.matches ? document.getElementById("rin-sidebar-slot") : null);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  if (!slot) {
    return <>{children}</>;
  }
  return createPortal(children, slot);
}
