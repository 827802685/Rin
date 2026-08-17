import type { Plugin } from "unified";
import { SKIP, visit } from "unist-util-visit";
import type { Link, Root, Text } from "mdast";
import type { Node } from "unist";

export type AnchorOptions = {
  enabled: boolean;
  auto: boolean;
  length: number;
};

const EXPLICIT_MARKER = /\s*\{#anchor-([\w-]+)\}\s*$/;
const BLOCK_TYPES = new Set(["heading", "paragraph", "listItem"]);

function nodeTextContent(node: Node): string {
  if ("value" in node && typeof (node as { value: unknown }).value === "string") {
    return (node as { value: string }).value;
  }
  if ("children" in node && Array.isArray((node as { children: unknown[] }).children)) {
    return (node as { children: Node[] }).children.map(nodeTextContent).join("");
  }
  return "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findLastTextLeaf(node: Node): { parent: Node & { children: Node[] }; index: number; text: string } | null {
  if (node.type === "text") {
    return null;
  }
  const children = (node as { children?: Node[] }).children;
  if (!children || children.length === 0) {
    return null;
  }
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.type === "text") {
      return { parent: node as Node & { children: Node[] }, index: i, text: (child as Text).value };
    }
    const nested = findLastTextLeaf(child);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function appendAnchorLink(node: Node, id: string): void {
  const nodeWithChildren = node as Node & { children: Node[] };
  if (!Array.isArray(nodeWithChildren.children)) {
    return;
  }
  const link: Link = {
    type: "link",
    url: `#${id}`,
    title: null,
    children: [
      {
        type: "text",
        value: " ",
      },
      {
        type: "text",
        value: "#",
      },
    ],
    data: {
      hProperties: {
        className: ["anchor-link"],
        "aria-label": id,
      },
    },
  };
  nodeWithChildren.children.push(link as unknown as Node);
}

export const remarkAnchor: Plugin<[AnchorOptions?], Root> = (options) => {
  return (tree) => {
    const enabled = Boolean(options?.enabled);
    const auto = Boolean(options?.auto);
    const length = options?.length || 60;

    if (!enabled) {
      return;
    }

    visit(tree, (node) => {
      if (!BLOCK_TYPES.has(node.type)) {
        return undefined;
      }

      const existingId = (node.data as { hProperties?: { id?: string } } | undefined)?.hProperties?.id;
      if (existingId) {
        return undefined;
      }

      const textContent = nodeTextContent(node);
      const marker = EXPLICIT_MARKER.exec(textContent);
      const hasMarker = marker !== null;
      const blockId = hasMarker ? `anchor-${marker[1]}` : auto ? slugify(textContent).slice(0, length) : "";

      if (!blockId) {
        return undefined;
      }

      if (hasMarker) {
        const leaf = findLastTextLeaf(node);
        if (leaf) {
          const withoutMarker = leaf.text.replace(EXPLICIT_MARKER, "");
          const textNode: Text = {
            type: "text",
            value: withoutMarker,
          };
          leaf.parent.children[leaf.index] = textNode;
        }
      }

      node.data = node.data || {};
      node.data.hProperties = node.data.hProperties || {};
      node.data.hProperties.id = blockId;
      appendAnchorLink(node, blockId);

      return SKIP;
    });
  };
};
