import { Hono } from "hono";
import type { AppContext, Variables } from "../core/hono-types";
import { generateAIChatReply, generateBlogPost, type AIChatMessage } from "../utils/ai";
import { getAIConfig } from "../utils/db-config";
import { getClientIP } from "../utils/request";
import { consumeRateLimit } from "../utils/rate-limit";
import { RateLimitError, ServiceUnavailableError } from "../errors";
import { createTaskQueue, createFeedAIGenerateTask } from "../queue";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CONTENT_LENGTH = 4000;

// The AI chat endpoint is reachable by anonymous visitors (AI page and the
// Live2D widget), so it cannot require a login. Instead every caller gets a
// fixed-window budget, with a tighter one for guests.
const GUEST_CHAT_LIMIT_PER_MINUTE = 10;
const USER_CHAT_LIMIT_PER_MINUTE = 30;
const CHAT_WINDOW_SECONDS = 60;

function parseChatMessages(raw: unknown): AIChatMessage[] | null {
    if (!Array.isArray(raw)) {
        return null;
    }

    const messages: AIChatMessage[] = [];
    for (const item of raw) {
        if (messages.length >= MAX_MESSAGES) {
            break;
        }

        if (!item || typeof item !== "object") {
            return null;
        }

        const { role, content } = item as Record<string, unknown>;
        if (role !== "system" && role !== "user" && role !== "assistant") {
            return null;
        }

        if (typeof content !== "string" || content.trim() === "") {
            return null;
        }

        if (content.length > MAX_MESSAGE_CONTENT_LENGTH) {
            return null;
        }

        messages.push({ role, content });
    }

    return messages.length > 0 ? messages : null;
}

export function AIService(): Hono<{
    Bindings: Env;
    Variables: Variables;
}> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();

    // POST /ai/chat - Send a chat message using the configured AI provider
    app.post("/chat", async (c: AppContext) => {
        const db = c.get('db');
        const serverConfig = c.get('serverConfig');
        const uid = c.get('uid');

        const aiConfig = await getAIConfig(serverConfig);
        if (!aiConfig.enabled) {
            throw new ServiceUnavailableError('AI is not enabled');
        }

        const throttle = await consumeRateLimit(db, {
            scope: "ai-chat",
            identifier: uid ? `user:${uid}` : `ip:${getClientIP(c)}`,
            limit: uid ? USER_CHAT_LIMIT_PER_MINUTE : GUEST_CHAT_LIMIT_PER_MINUTE,
            windowSeconds: CHAT_WINDOW_SECONDS,
        });

        if (!throttle.allowed) {
            throw new RateLimitError('Too many AI requests, please slow down');
        }

        const body = await c.req.json().catch(() => null) as { messages?: unknown } | null;
        const messages = parseChatMessages(body?.messages);

        if (!messages) {
            return c.json({ error: "Messages are required" }, 400);
        }

        const result = await generateAIChatReply(c.get("env"), serverConfig, messages);

        if (!result.ok) {
            return c.json({ error: result.error }, 503);
        }

        return c.json({ content: result.content });
    });

    // POST /ai/generate-blog - 手动触发 AI 博文生成（需要登录）
    app.post("/generate-blog", async (c: AppContext) => {
        const db = c.get('db');
        const serverConfig = c.get('serverConfig');
        const uid = c.get('uid');
        const env = c.get('env');

        // 需要登录才能使用此功能
        if (!uid) {
            return c.json({ error: "Authentication required" }, 401);
        }

        const aiConfig = await getAIConfig(serverConfig);
        if (!aiConfig.enabled) {
            throw new ServiceUnavailableError('AI is not enabled');
        }

        const body = await c.req.json().catch(() => null) as {
            topic?: string;
            keywords?: string[];
            style?: "technical" | "casual" | "tutorial" | "review";
            maxLength?: number;
        } | null;

        // 将任务加入队列异步处理
        try {
            await createTaskQueue(env).send(
                createFeedAIGenerateTask({
                    topic: body?.topic,
                    keywords: body?.keywords || [],
                    style: body?.style || "technical",
                    maxLength: body?.maxLength || 2000,
                }),
            );

            return c.json({ 
                success: true, 
                message: "Blog generation task queued successfully",
            });
        } catch (error) {
            return c.json({ 
                success: false, 
                error: error instanceof Error ? error.message : String(error),
            }, 500);
        }
    });

    return app;
}
