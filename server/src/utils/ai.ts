import { getAIConfig } from "./db-config";

type ConfigReader = {
    get(key: string): Promise<unknown>;
};

// AI Provider presets with their default API URLs
const AI_PROVIDER_URLS: Record<string, string> = {
    openai: "https://api.openai.com/v1",
    claude: "https://api.anthropic.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    deepseek: "https://api.deepseek.com/v1",
};

// Cloudflare Worker AI models mapping (short name -> full model ID)
// Current valid catalog (2026): https://developers.cloudflare.com/workers-ai/models/
export const WORKER_AI_MODELS: Record<string, string> = {
    // Meta Llama 4
    "llama-4-scout-17b-16e-instruct": "@cf/meta/llama-4-scout-17b-16e-instruct",
    // OpenAI gpt-oss
    "gpt-oss-120b": "@cf/openai/gpt-oss-120b",
    "gpt-oss-20b": "@cf/openai/gpt-oss-20b",
    // Zhipu GLM
    "glm-4.7-flash": "@cf/zai-org/glm-4.7-flash",
    "glm-5.2": "@cf/zai-org/glm-5.2",
    // Moonshot Kimi
    "kimi-k2.7-code": "@cf/moonshotai/kimi-k2.7-code",
    "kimi-k2.6": "@cf/moonshotai/kimi-k2.6",
    // DeepSeek
    "deepseek-v4-flash-0731": "@cf/deepseek-ai/deepseek-v4-flash-0731",
    // Qwen
    "qwen3.8-27b": "@cf/qwen/qwen3.8-27b",
    // Google Gemma
    "gemma-4-26b-a4b-it": "@cf/google/gemma-4-26b-a4b-it",
    // NVIDIA Nemotron
    "nemotron-3-120b-a12b": "@cf/nvidia/nemotron-3-120b-a12b",
    // IBM Granite
    "granite-4.0-h-micro": "@cf/ibm-granite/granite-4.0-h-micro",
    // DeepSeek R1 distilled
    "deepseek-r1-distill-qwen-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
};

export const AI_SUMMARY_SYSTEM_PROMPT =
    "你是一个中文内容摘要助手。请用简洁、准确、自然的中文总结用户提供的内容，不超过200字，不要添加原文没有的信息，不要输出标题或项目符号。";

// AI 博文生成系统提示词模板
const AI_BLOG_GENERATE_PROMPTS: Record<string, string> = {
    technical: `你是一个专业的技术博客作者。请根据用户提供的主题和关键词，撰写一篇结构清晰、内容详实的技术文章。

要求：
1. 使用 Markdown 格式
2. 包含标题、引言、正文（分章节）、总结
3. 代码示例要完整可运行
4. 语言通俗易懂，避免过多专业术语堆砌
5. 字数控制在 1500-3000 字`,
    
    casual: `你是一个轻松的生活/科技博主。请根据用户提供的主题，写一篇风格轻松的博文。

要求：
1. 使用 Markdown 格式
2. 语气亲切自然，像和朋友聊天
3. 可以加入个人见解和经验分享
4. 结构清晰但不拘泥于形式
5. 字数控制在 800-2000 字`,
    
    tutorial: `你是一个耐心的教程作者。请根据用户提供的主题，撰写一份详细的操作指南。

要求：
1. 使用 Markdown 格式
2. 步骤清晰，编号明确
3. 每个步骤都有详细说明和预期结果
4. 包含前置准备和常见问题解答
5. 字数控制在 2000-4000 字`,
    
    review: `你是一个客观的评测者。请根据用户提供的产品/服务名称，撰写一篇评测文章。

要求：
1. 使用 Markdown 格式
2. 包含产品介绍、优缺点分析、使用体验、购买建议
3. 观点客观公正，不偏不倚
4. 数据准确，论据充分
5. 字数控制在 1500-3000 字`,
};

/**
 * Get full Worker AI model ID from short name
 */
export function getWorkerAIModelId(shortName: string): string {
    return WORKER_AI_MODELS[shortName] || shortName;
}

export function normalizeExternalAIBaseUrl(apiUrl: string): string {
    return apiUrl
        .trim()
        .replace(/\/+$/g, "")
        .replace(/\/chat\/completions$/i, "");
}

export function buildExternalAIChatCompletionsUrl(
    provider: string,
    apiUrl: string,
): string {
    const normalizedApiUrl = normalizeExternalAIBaseUrl(apiUrl || AI_PROVIDER_URLS[provider] || "");
    if (!normalizedApiUrl) {
        throw new Error("API URL not configured");
    }

    return `${normalizedApiUrl}/chat/completions`;
}

function extractAIText(response: unknown): string | null {
    if (typeof response === "string") {
        return response;
    }

    if (!response || typeof response !== "object") {
        return null;
    }

    const responseObj = response as Record<string, any>;

    if (typeof responseObj.response === "string") return responseObj.response;
    if (typeof responseObj.content === "string") return responseObj.content;
    if (typeof responseObj.output === "string") return responseObj.output;
    if (typeof responseObj.result === "string") return responseObj.result;

    const messageContent = responseObj.choices?.[0]?.message?.content;
    if (typeof messageContent === "string" && messageContent.trim()) {
        return messageContent.trim();
    }

    const outputText = responseObj.output?.[0]?.content?.[0]?.text;
    if (typeof outputText === "string" && outputText.trim()) {
        return outputText.trim();
    }

    return null;
}

/**
 * Execute Worker AI request
 */
async function executeWorkerAI(
    env: Env,
    modelId: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string | null> {
    if (!env.AI || typeof env.AI.run !== "function") {
        throw new Error("Workers AI binding is not configured");
    }

    // Worker AI uses messages format for chat models
    const response = await env.AI.run(modelId as any, {
        messages
    } as any);

    return extractAIText(response);
}

/**
 * Execute external AI API request
 */
async function executeExternalAI(
    config: {
        provider: string;
        model: string;
        api_key: string;
        api_url: string;
    },
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options: {
        maxTokens?: number;
        temperature?: number;
    } = {},
): Promise<string | null> {
    const { provider, model, api_key, api_url } = config;

    if (!api_key) {
        throw new Error("API key not configured");
    }

    const finalApiUrl = buildExternalAIChatCompletionsUrl(provider, api_url);

    const response = await fetch(finalApiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${api_key}`,
        },
        body: JSON.stringify({
            model: model,
            messages,
            max_tokens: options.maxTokens ?? 500,
            temperature: options.temperature ?? 0.3,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Test AI model configuration
 */
export async function testAIModel(
    env: Env,
    config: {
        provider: string;
        model: string;
        api_key?: string;
        api_url?: string;
    },
    testPrompt: string
): Promise<{ success: boolean; response?: string; error?: string; details?: string }> {
    try {
        let result: string | null;

        if (config.provider === 'worker-ai') {
            const fullModelName = getWorkerAIModelId(config.model);
            console.log(`[Test AI] Using Worker AI model: ${fullModelName}`);
            result = await executeWorkerAI(env, fullModelName, [
                { role: "user", content: testPrompt },
            ]);
        } else {
            result = await executeExternalAI({
                provider: config.provider,
                model: config.model,
                api_key: config.api_key || '',
                api_url: config.api_url || '',
            }, [
                { role: "user", content: testPrompt },
            ]);
        }

        if (result) {
            return { 
                success: true, 
                response: result,
            };
        } else {
            return { 
                success: false, 
                error: 'Empty response from AI' 
            };
        }
    } catch (error: any) {
        return processAIError(error, config.model, config.provider);
    }
}

/**
 * Generate AI summary for article content
 */
export async function generateAISummary(
    env: Env, 
    serverConfig: ConfigReader,
    content: string
): Promise<string | null> {
    const result = await generateAISummaryResult(env, serverConfig, content);
    return result.summary;
}

export async function generateAISummaryResult(
    env: Env,
    serverConfig: ConfigReader,
    content: string
): Promise<{ summary: string | null; skipped: boolean; error?: string }> {
    const config = await getAIConfig(serverConfig);

    if (!config.enabled) {
        return { summary: null, skipped: true };
    }

    const { provider, model } = config;
    const maxContentLength = 8000;
    const truncatedContent = content.length > maxContentLength
        ? content.slice(0, maxContentLength) + "..."
        : content;
    const summaryMessages = [
        { role: "system" as const, content: AI_SUMMARY_SYSTEM_PROMPT },
        { role: "user" as const, content: truncatedContent },
    ];

    try {
        let result: string | null;

        if (provider === 'worker-ai') {
            const fullModelName = getWorkerAIModelId(model);
            result = await executeWorkerAI(
                env,
                fullModelName,
                summaryMessages,
            );
        } else {
            result = await executeExternalAI(config, summaryMessages);
        }

        if (!result || !result.trim()) {
            return {
                summary: null,
                skipped: false,
                error: `Empty response from AI provider "${provider}" using model "${model}"`,
            };
        }

        const cleaned = stripReasoningTags(result);
        if (!cleaned.trim()) {
            return {
                summary: null,
                skipped: false,
                error: `AI response contained only reasoning tags with no final answer (provider "${provider}", model "${model}")`,
            };
        }

        return { summary: cleaned, skipped: false };
    } catch (error) {
        console.error("[AI Summary] Failed to generate summary:", error);
        return {
            summary: null,
            skipped: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export function stripReasoningTags(text: string): string {
    if (!text) return "";

    let out = text;
    out = out.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, "");
    out = out.replace(/<think(?:\s[^>]*)?>[\s\S]*$/gi, "");
    out = out.replace(/<thinking(?:\s[^>]*)?>[\s\S]*?<\/thinking\s*>/gi, "");
    out = out.replace(/<thinking(?:\s[^>]*)?>[\s\S]*$/gi, "");
    out = out.replace(/<reasoning(?:\s[^>]*)?>[\s\S]*?<\/reasoning\s*>/gi, "");
    out = out.replace(/<reasoning(?:\s[^>]*)?>[\s\S]*$/gi, "");

    return out.trim();
}

/**
 * Process AI error and return user-friendly message
 */
function processAIError(
    error: any, 
    model: string, 
    provider: string
): { success: false; error: string; details?: string } {
    const originalMessage = error.message || 'Unknown error';
    console.error('[AI] Error:', error);

    let errorMessage = originalMessage;
    let errorDetails = '';

    if (originalMessage.includes('fetch failed') || originalMessage.includes('NetworkError')) {
        errorMessage = 'Network error: Unable to connect to AI service';
        errorDetails = 'Please check your API URL and network connection.';
    } else if (originalMessage.includes('Workers AI binding is not configured')) {
        errorMessage = 'Workers AI is not configured';
        errorDetails = 'Add the Cloudflare Workers AI binding before testing the worker-ai provider.';
    } else if (originalMessage.includes('401') || originalMessage.includes('Unauthorized')) {
        errorMessage = 'Authentication failed: Invalid API key';
        errorDetails = 'Please check your API key is correct and not expired.';
    } else if (originalMessage.includes('429')) {
        errorMessage = 'Rate limit exceeded';
        errorDetails = 'Too many requests. Please wait a moment.';
    } else if (originalMessage.includes('404')) {
        errorMessage = 'Model not found';
        errorDetails = `Model "${model}" not found for provider "${provider}".`;
    } else if (originalMessage.includes('500') || originalMessage.includes('503')) {
        errorMessage = 'AI service temporarily unavailable';
        errorDetails = 'Service is experiencing issues. Please try again later.';
    } else if (originalMessage.includes('Invalid')) {
        errorMessage = `AI model error: ${originalMessage}`;
        errorDetails = `Model "${model}" may not be supported. Please verify the model ID.`;
    }

    return { 
        success: false, 
        error: errorMessage,
        details: errorDetails || `Original: ${originalMessage}`
    };
}

/**
 * 生成完整博客文章
 */
export interface BlogGenerationRequest {
    topic?: string;       // 主题（可选）
    keywords?: string[];  // 关键词
    style?: "technical" | "casual" | "tutorial" | "review";
    maxLength?: number;   // 最大字数
}

export interface BlogGenerationResult {
    title: string | null;
    content: string | null;
    summary: string | null;
    tags: string[];
    error?: string;
}

export async function generateBlogPost(
    env: Env,
    serverConfig: ConfigReader,
    request: BlogGenerationRequest,
): Promise<BlogGenerationResult> {
    const config = await getAIConfig(serverConfig);

    if (!config.enabled) {
        return {
            title: null,
            content: null,
            summary: null,
            tags: [],
            error: "AI is not enabled",
        };
    }

    const style = request.style || "technical";
    const systemPrompt = AI_BLOG_GENERATE_PROMPTS[style] || AI_BLOG_GENERATE_PROMPTS.technical;
    
    // 构建用户提示词
    const userPromptParts: string[] = [];
    
    if (request.topic) {
        userPromptParts.push(`主题：${request.topic}`);
    }
    
    if (request.keywords && request.keywords.length > 0) {
        userPromptParts.push(`关键词：${request.keywords.join("、")}`);
    }
    
    if (request.maxLength) {
        userPromptParts.push(`字数要求：约 ${request.maxLength} 字`);
    }
    
    userPromptParts.push("\n请开始创作：");
    
    const userPrompt = userPromptParts.join("\n");
    
    const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: userPrompt },
    ];

    try {
        let result: string | null;

        if (config.provider === 'worker-ai') {
            const fullModelName = getWorkerAIModelId(config.model);
            result = await executeWorkerAI(env, fullModelName, messages);
        } else {
            result = await executeExternalAI(config, messages, {
                maxTokens: 4000,
                temperature: 0.7,
            });
        }

        if (!result || !result.trim()) {
            return {
                title: null,
                content: null,
                summary: null,
                tags: [],
                error: "Empty response from AI",
            };
        }

        // 解析 AI 生成的内容
        const parsed = parseGeneratedBlog(result);
        
        return {
            title: parsed.title,
            content: parsed.content,
            summary: parsed.summary,
            tags: parsed.tags,
        };
    } catch (error) {
        console.error("[AI Blog Generation] Failed:", error);
        return {
            title: null,
            content: null,
            summary: null,
            tags: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * 解析 AI 生成的博客文章
 * 期望格式：
 * # 标题
 * 
 * [摘要]
 * 摘要内容...
 * 
 * [标签]
 * tag1, tag2, tag3
 * 
 * 正文内容...
 */
function parseGeneratedBlog(text: string): {
    title: string | null;
    content: string | null;
    summary: string | null;
    tags: string[];
} {
    const cleaned = stripReasoningTags(text);
    
    // 提取标题（第一个 # 标题）
    const titleMatch = cleaned.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : null;
    
    // 提取摘要
    let summary: string | null = null;
    const summaryMatch = cleaned.match(/\[摘要\]\s*\n([\s\S]*?)(?=\n\n|\[|$)/);
    if (summaryMatch) {
        summary = summaryMatch[1].trim();
    }
    
    // 提取标签
    let tags: string[] = [];
    const tagsMatch = cleaned.match(/\[标签\]\s*\n(.+)$/m);
    if (tagsMatch) {
        tags = tagsMatch[1]
            .split(/[,，、]/)
            .map(t => t.trim())
            .filter(t => t.length > 0);
    }
    
    // 提取正文（去除标题、摘要、标签部分）
    let content = cleaned;
    if (titleMatch) {
        content = content.replace(titleMatch[0], "").trim();
    }
    content = content.replace(/\[摘要\][\s\S]*?(?=\n\n|\[|$)/, "").trim();
    content = content.replace(/\[标签\][\s\S]*$/, "").trim();
    
    // 如果没有单独提取到摘要，使用前 200 字作为摘要
    if (!summary && content.length > 200) {
        summary = content.substring(0, 200) + "...";
    }
    
    return {
        title,
        content: content || null,
        summary,
        tags,
    };
}


/**
 * Get available models for a provider
 */
export function getAvailableModels(provider: string): string[] {
    if (provider === 'worker-ai') {
        return Object.keys(WORKER_AI_MODELS);
    }
    return [];
}

/**
 * Check if provider requires API key
 */
export function requiresApiKey(provider: string): boolean {
    return provider !== 'worker-ai';
}

export type AIChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

/**
 * Generate a chat reply using the configured AI provider.
 * Reuses the same provider/model/api_key/api_url as the AI summary feature.
 */
export async function generateAIChatReply(
    env: Env,
    serverConfig: ConfigReader,
    messages: AIChatMessage[],
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
    const config = await getAIConfig(serverConfig);

    if (!config.enabled) {
        return { ok: false, error: "AI is not enabled" };
    }

    if (config.provider !== "worker-ai" && !config.api_key) {
        return { ok: false, error: "API key not configured" };
    }

    try {
        let result: string | null;

        if (config.provider === "worker-ai") {
            const fullModelName = getWorkerAIModelId(config.model);
            result = await executeWorkerAI(env, fullModelName, messages);
        } else {
            result = await executeExternalAI(
                config,
                messages,
                {
                    maxTokens: 1000,
                    temperature: 0.7,
                },
            );
        }

        if (!result || !result.trim()) {
            return {
                ok: false,
                error: `Empty response from AI provider "${config.provider}" using model "${config.model}"`,
            };
        }

        const cleaned = stripReasoningTags(result);
        if (!cleaned.trim()) {
            return {
                ok: false,
                error: `AI response contained only reasoning tags with no final answer (provider "${config.provider}", model "${config.model}")`,
            };
        }

        return { ok: true, content: cleaned };
    } catch (error) {
        console.error("[AI Chat] Failed to generate reply:", error);
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
