import { afterEach, describe, expect, it } from "bun:test";
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

function aiEnv(response: string): Env {
  return { AI: { run: async () => ({ response }) } } as unknown as Env;
}

const serverConfig = createAIConfigReader({
  enabled: true,
  provider: "worker-ai",
  model: "llama-3-8b",
  api_key: "",
  api_url: "",
});

describe("generateBlogPost > parseGeneratedBlog", () => {
  it("keeps the body when the response has a [标签] section", async () => {
    const { generateBlogPost } = await import("../ai");

    const result = await generateBlogPost(
      aiEnv(
        ["# 标题", "", "[摘要]", "这是摘要", "", "[标签]", "rust, 博客", "", "正文第一段", "正文第二段"].join(
          "\n",
        ),
      ),
      serverConfig,
      { topic: "Rust" },
    );

    // 回归：正文排在 [标签] 之后，旧实现一刀切到结尾把正文删光（content 恒为 null）
    expect(result.error).toBeUndefined();
    expect(result.title).toBe("标题");
    expect(result.content).toBe("正文第一段\n正文第二段");
    expect(result.summary).toBe("这是摘要");
    expect(result.tags).toEqual(["rust", "博客"]);
  });

  it("keeps the body when the response has no [标签] section", async () => {
    const { generateBlogPost } = await import("../ai");

    const result = await generateBlogPost(
      aiEnv("# 标题\n\n[摘要]\n摘要\n\n正文内容"),
      serverConfig,
      { topic: "Rust" },
    );

    expect(result.content).toBe("正文内容");
    expect(result.tags).toEqual([]);
  });

  it("falls back to the first 200 characters as the summary", async () => {
    const { generateBlogPost } = await import("../ai");
    const body = "字".repeat(260);

    const result = await generateBlogPost(aiEnv(`# 标题\n\n${body}`), serverConfig, {
      topic: "Rust",
    });

    expect(result.summary).toBe(`${"字".repeat(200)}...`);
    expect(result.content).toBe(body);
  });
});
