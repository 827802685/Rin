import { describe, expect, it } from "vitest";
import { createToolId, parseToolsConfig, serializeToolsConfig, toolHostname } from "../tools";

const TOOL = {
  id: "chat",
  name: "Chat",
  description: "AI 在线对话助手",
  icon: "https://chat.example.com/favicon.ico",
  url: "https://chat.example.com/",
};

describe("parseToolsConfig", () => {
  it("returns an empty array for undefined or empty values", () => {
    expect(parseToolsConfig(undefined)).toEqual([]);
    expect(parseToolsConfig("")).toEqual([]);
    expect(parseToolsConfig("   ")).toEqual([]);
    expect(parseToolsConfig(null)).toEqual([]);
  });

  it("returns an empty array for non-array values", () => {
    expect(parseToolsConfig("not json")).toEqual([]);
    expect(parseToolsConfig(JSON.stringify({ name: "Chat" }))).toEqual([]);
    expect(parseToolsConfig(42)).toEqual([]);
  });

  it("parses a serialized JSON string", () => {
    const tools = parseToolsConfig(serializeToolsConfig([TOOL]));
    expect(tools).toEqual([TOOL]);
  });

  it("parses an already-deserialized array (e.g. database config store round-trip)", () => {
    const tools = parseToolsConfig([TOOL]);
    expect(tools).toEqual([TOOL]);
  });

  it("normalizes partial items and drops items without a name", () => {
    const tools = parseToolsConfig([
      { name: "RAG", url: "https://rag.example.com/" },
      { id: "missing-name", url: "https://example.com/" },
    ]);
    expect(tools).toEqual([
      { id: "tool-0", name: "RAG", description: "", icon: "", url: "https://rag.example.com/" },
    ]);
  });
});

describe("serializeToolsConfig", () => {
  it("serializes to a JSON string that parseToolsConfig can read back", () => {
    const value = serializeToolsConfig([TOOL]);
    expect(typeof value).toBe("string");
    expect(parseToolsConfig(value)).toEqual([TOOL]);
  });
});

describe("createToolId", () => {
  it("generates unique ids", () => {
    expect(createToolId()).not.toBe(createToolId());
  });
});

describe("toolHostname", () => {
  it("extracts the hostname from a url", () => {
    expect(toolHostname("https://chat.example.com/path")).toBe("chat.example.com");
  });

  it("returns an empty string for invalid urls", () => {
    expect(toolHostname("not a url")).toBe("");
  });
});