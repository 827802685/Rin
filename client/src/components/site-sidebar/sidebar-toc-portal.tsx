import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 侧栏布局下把文章页目录传送进全局侧栏槽位；槽位不存在（非侧栏壳）时原样渲染。
 */
export function SidebarTocPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById("rin-sidebar-slot"));
  }, []);

  if (!slot) {
    return <>{children}</>;
  }
  return createPortal(children, slot);
}
