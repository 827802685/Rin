import { normalizeHeaderLayout, type HeaderLayoutOption } from "./layout-options";
import { classicLayoutDefinition } from "./layouts/classic-layout";
import { compactLayoutDefinition } from "./layouts/compact-layout";
import { sidebarLayoutDefinition } from "./layouts/sidebar-layout";
import type { HeaderLayoutRegistry } from "./layout-types";

const layoutRegistry: HeaderLayoutRegistry = {
  classic: classicLayoutDefinition,
  compact: compactLayoutDefinition,
  sidebar: sidebarLayoutDefinition,
};

export function getHeaderLayoutDefinition(layout: HeaderLayoutOption | string | null | undefined) {
  return layoutRegistry[normalizeHeaderLayout(layout ?? undefined)];
}
