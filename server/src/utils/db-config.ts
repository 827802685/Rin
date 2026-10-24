import type { AIConfig } from "@rin/api";
import { AI_CONFIG_PREFIX, DEFAULT_AI_CONFIG, MASKED_SECRET } from "@rin/config";

type ConfigReader = {
    get(key: string): Promise<unknown>;
};

type ConfigWriter = ConfigReader & {
    set(key: string, value: unknown, save?: boolean): Promise<void>;
    save(): Promise<void>;
};

const AI_CONFIG_FIELDS = ["enabled", "provider", "model", "api_key", "api_url"] as const;

export function readAIConfigFromValues(values: Record<string, unknown>): AIConfig {
    const config: AIConfig = { ...DEFAULT_AI_CONFIG };

    const enabled = values[AI_CONFIG_PREFIX + "enabled"];
    if (enabled != null) {
        config.enabled = enabled === true || enabled === "true";
    }

    const provider = values[AI_CONFIG_PREFIX + "provider"];
    if (typeof provider === "string" && provider.length > 0) {
        config.provider = provider;
    }

    const model = values[AI_CONFIG_PREFIX + "model"];
    if (typeof model === "string") {
        config.model = model;
    }

    const apiKey = values[AI_CONFIG_PREFIX + "api_key"];
    if (typeof apiKey === "string") {
        config.api_key = apiKey;
    }

    const apiUrl = values[AI_CONFIG_PREFIX + "api_url"];
    if (typeof apiUrl === "string") {
        config.api_url = apiUrl;
    }

    return config;
}

export function readAIConfigFromMap(values: Map<string, unknown>): AIConfig {
    return readAIConfigFromValues(Object.fromEntries(values));
}

export async function getAIConfig(config: ConfigReader): Promise<AIConfig> {
    const values = await Promise.all(
        AI_CONFIG_FIELDS.map(async (field) => [field, await config.get(AI_CONFIG_PREFIX + field)] as const),
    );

    return readAIConfigFromValues(
        Object.fromEntries(values.map(([field, value]) => [AI_CONFIG_PREFIX + field, value])),
    );
}

export async function getFrontendAIEnabled(config: ConfigReader): Promise<boolean> {
    const enabled = await config.get(AI_CONFIG_PREFIX + "enabled");
    return enabled == null ? DEFAULT_AI_CONFIG.enabled : enabled === true || enabled === "true";
}

export async function setAIConfig(config: ConfigWriter, updates: Partial<AIConfig>): Promise<void> {
    for (const field of AI_CONFIG_FIELDS) {
        const value = updates[field];
        if (value === undefined) {
            continue;
        }

        // 空串与前端掩码都表示「这一项没改」。掩码是服务端自己下发的值，客户端
        // （或任何照着 GET 结果回写的脚本）原样 POST 回来是必然会发生的事，
        // 写进库就等于把真密钥换成 8 个圆点：AI 调用全部 401，而界面因为
        // api_key_set 仍为 true 还显示「已配置」。
        if (field === "api_key" && typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed === "" || trimmed === MASKED_SECRET) {
                continue;
            }
        }

        await config.set(AI_CONFIG_PREFIX + field, value, false);
    }

    await config.save();
}

export async function getAIConfigForFrontend(
    config: ConfigReader,
): Promise<AIConfig & { api_key_set: boolean }> {
    const aiConfig = await getAIConfig(config);
    return {
        ...aiConfig,
        api_key: "",
        api_key_set: aiConfig.api_key.length > 0,
    };
}
