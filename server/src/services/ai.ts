import { Hono } from "hono";
import type { AppContext, Variables } from "../core/hono-types";
import { generateAIChatReply, type AIChatMessage } from "../utils/ai";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CONTENT_LENGTH = 4000;

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
        const body = await c.req.json().catch(() => null) as { messages?: unknown } | null;
        const messages = parseChatMessages(body?.messages);

        if (!messages) {
            return c.json({ error: "Messages are required" }, 400);
        }

        const result = await generateAIChatReply(c.get("env"), c.get("serverConfig"), messages);

        if (!result.ok) {
            return c.json({ error: result.error }, 503);
        }

        return c.json({ content: result.content });
    });

    return app;
}