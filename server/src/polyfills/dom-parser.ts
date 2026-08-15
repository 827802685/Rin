import { DOMParser, Node } from "@xmldom/xmldom";

if (typeof globalThis.DOMParser === "undefined") {
  globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
}

if (typeof (globalThis as { Node?: unknown }).Node === "undefined") {
  (globalThis as { Node?: unknown }).Node = Node as unknown as typeof globalThis.Node;
}