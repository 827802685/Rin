export type ToolItem = {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
};

export function parseToolsConfig(value: unknown): ToolItem[] {
  let parsed: unknown = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return [];
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item, index) => ({
      id: String(item.id ?? `tool-${index}`),
      name: String(item.name ?? ""),
      description: String(item.description ?? ""),
      icon: String(item.icon ?? ""),
      url: String(item.url ?? ""),
    }))
    .filter((tool) => tool.name.trim().length > 0);
}

export function serializeToolsConfig(tools: ToolItem[]): string {
  return JSON.stringify(tools);
}

export function createToolId(): string {
  return `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toolHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}