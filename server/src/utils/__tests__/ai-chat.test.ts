import { afterEach, describe, expect, it, mock } from "bun:test";
import type { AIConfig } from "@rin/api";
import { AI_CONFIG_PREFIX } from "@rin/config";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createAIConfigReader(config: AIConfig) {
  const values = new Map<string, unknown>(
    Object.entries(config).map(([key, value]) => [`${AI_CONFIG_PREFIX}${key}`, value]),
  );

  return {
    async get(key: string) {
      return values.get(key);
    },
  };
}

const CHAT_MESSAGES = [
  { role: "user" as const, content: "Hello" },
];

describe("generateAIChatReply", () => {
  it("returns an error when AI is disabled", async () => {
    const serverConfig = createAIConfigReader({
      enabled: false,
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "secret",
      api_url: "https://api.openai.com/v1",
    });

    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({} as Env, serverConfig, CHAT_MESSAGES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("AI is not enabled");
    }
  });

  it("returns an error when an external provider has no API key", async () => {
    const serverConfig = createAIConfigReader({
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "",
      api_url: "https://api.openai.com/v1",
    });

    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({} as Env, serverConfig, CHAT_MESSAGES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("API key not configured");
    }
  });

  it("sends the messages to Workers AI and returns the reply", async () => {
    const serverConfig = createAIConfigReader({
      enabled: true,
      provider: "worker-ai",
      model: "llama-3-8b",
      api_key: "",
      api_url: "",
    });

    const calls: Array<any> = [];
    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({
      AI: {
        run: async (_model: string, payload: any) => {
          calls.push(payload);
          return { response: "hi" };
        },
      },
    } as unknown as Env, serverConfig, CHAT_MESSAGES);

    expect(result).toEqual({ ok: true, content: "hi" });
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual(CHAT_MESSAGES);
  });

  it("sends the messages to the external provider and returns the reply", async () => {
    const serverConfig = createAIConfigReader({
      enabled: true,
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "secret",
      api_url: "https://api.openai.com/v1",
    });

    const requests: Array<any> = [];
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(init);
      return new Response(JSON.stringify({
        choices: [{ message: { content: "hi there" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({} as Env, serverConfig, CHAT_MESSAGES);

    expect(result).toEqual({ ok: true, content: "hi there" });
    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0].body));
    expect(body.messages).toEqual(CHAT_MESSAGES);
  });

  it("strips reasoning tags from the reply", async () => {
    const serverConfig = createAIConfigReader({
      enabled: true,
      provider: "worker-ai",
      model: "llama-3-8b",
      api_key: "",
      api_url: "",
    });

    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({
      AI: {
        run: async () => ({ response: "<thinking>hidden</thinking>answer" }),
      },
    } as unknown as Env, serverConfig, CHAT_MESSAGES);

    expect(result).toEqual({ ok: true, content: "answer" });
  });

  it("returns an error when the AI responds with empty content", async () => {
    const serverConfig = createAIConfigReader({
      enabled: true,
      provider: "worker-ai",
      model: "llama-3-8b",
      api_key: "",
      api_url: "",
    });

    const { generateAIChatReply } = await import("../ai");

    const result = await generateAIChatReply({
      AI: {
        run: async () => ({ response: "" }),
      },
    } as unknown as Env, serverConfig, CHAT_MESSAGES);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Empty response from AI provider");
    }
  });
});