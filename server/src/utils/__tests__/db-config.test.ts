import { describe, expect, it } from "bun:test";
import { AI_CONFIG_PREFIX, DEFAULT_AI_CONFIG, MASKED_SECRET } from "@rin/config";
import {
    getAIConfig,
    getAIConfigForFrontend,
    getFrontendAIEnabled,
    readAIConfigFromMap,
    readAIConfigFromValues,
    setAIConfig,
} from "../db-config";

type Write = { key: string; value: unknown; save: boolean | undefined };

/**
 * 内存版配置读写器：记录每一次 set 的 `save` 参数与 save() 次数，
 * 这样才能断言「批量写入只在最后落一次盘」。
 */
function createConfig(initial: Record<string, unknown> = {}) {
    const data = new Map<string, unknown>(Object.entries(initial));
    const writes: Write[] = [];
    let saveCalls = 0;

    return {
        writes,
        get saveCalls() {
            return saveCalls;
        },
        async get(key: string) {
            return data.get(key) ?? null;
        },
        async set(key: string, value: unknown, save?: boolean) {
            writes.push({ key, value, save });
            data.set(key, value);
        },
        async save() {
            saveCalls++;
        },
    };
}

function prefixed(values: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [AI_CONFIG_PREFIX + k, v]));
}

describe("readAIConfigFromValues", () => {
    it("没有任何值的时候返回默认配置", () => {
        expect(readAIConfigFromValues({})).toEqual(DEFAULT_AI_CONFIG);
    });

    it("enabled 认布尔与字符串两种写法", () => {
        expect(readAIConfigFromValues(prefixed({ enabled: true })).enabled).toBe(true);
        expect(readAIConfigFromValues(prefixed({ enabled: "true" })).enabled).toBe(true);
        expect(readAIConfigFromValues(prefixed({ enabled: "false" })).enabled).toBe(false);
        expect(readAIConfigFromValues(prefixed({ enabled: false })).enabled).toBe(false);
        expect(readAIConfigFromValues(prefixed({ enabled: 1 })).enabled).toBe(false);
    });

    it("provider 只接受非空字符串，非字符串回落默认", () => {
        expect(readAIConfigFromValues(prefixed({ provider: "deepseek" })).provider).toBe("deepseek");
        expect(readAIConfigFromValues(prefixed({ provider: "" })).provider).toBe(DEFAULT_AI_CONFIG.provider);
        expect(readAIConfigFromValues(prefixed({ provider: 42 })).provider).toBe(DEFAULT_AI_CONFIG.provider);
    });

    it("model 与 api_url 允许空串（清空即回落默认值的语义由调用方决定）", () => {
        const config = readAIConfigFromValues(prefixed({ model: "", api_url: "" }));
        expect(config.model).toBe("");
        expect(config.api_url).toBe("");
    });

    it("map 版本与对象版本结果一致", () => {
        const values = prefixed({ enabled: "true", api_key: "sk-1" });
        expect(readAIConfigFromMap(new Map(Object.entries(values)))).toEqual(readAIConfigFromValues(values));
    });
});

describe("getAIConfig", () => {
    it("按前缀逐个读取五个字段", async () => {
        const config = createConfig(
            prefixed({ enabled: "true", provider: "claude", model: "m1", api_key: "sk-1", api_url: "https://x" }),
        );

        const result = await getAIConfig(config);

        expect(result).toEqual({
            enabled: true,
            provider: "claude",
            model: "m1",
            api_key: "sk-1",
            api_url: "https://x",
        });
    });

    it("库里没有值时返回默认配置", async () => {
        expect(await getAIConfig(createConfig())).toEqual(DEFAULT_AI_CONFIG);
    });
});

describe("getFrontendAIEnabled", () => {
    it("未配置时回落默认值", async () => {
        expect(await getFrontendAIEnabled(createConfig())).toBe(DEFAULT_AI_CONFIG.enabled);
    });

    it("认布尔与字符串两种写法", async () => {
        expect(await getFrontendAIEnabled(createConfig(prefixed({ enabled: true })))).toBe(true);
        expect(await getFrontendAIEnabled(createConfig(prefixed({ enabled: "true" })))).toBe(true);
        expect(await getFrontendAIEnabled(createConfig(prefixed({ enabled: "false" })))).toBe(false);
    });
});

describe("setAIConfig", () => {
    it("写入传入的字段，undefined 的字段不动", async () => {
        const config = createConfig(prefixed({ api_key: "sk-old" }));

        await setAIConfig(config, { provider: "openai", model: "gpt-4o" });

        expect(await config.get(AI_CONFIG_PREFIX + "provider")).toBe("openai");
        expect(await config.get(AI_CONFIG_PREFIX + "model")).toBe("gpt-4o");
        expect(await config.get(AI_CONFIG_PREFIX + "api_key")).toBe("sk-old");
    });

    it("逐字段写入都不落盘，最后统一 save 一次", async () => {
        const config = createConfig();

        await setAIConfig(config, { provider: "openai", model: "gpt-4o", api_url: "https://x" });

        expect(config.writes.every((write) => write.save === false)).toBe(true);
        expect(config.saveCalls).toBe(1);
    });

    it("空串 api_key 视为「不改」，旧密钥保留", async () => {
        const config = createConfig(prefixed({ api_key: "sk-old" }));

        await setAIConfig(config, { api_key: "   " });

        expect(await config.get(AI_CONFIG_PREFIX + "api_key")).toBe("sk-old");
        expect(config.writes).toHaveLength(0);
        // 没有写入也仍然要落盘一次，保持与有写入时一致
        expect(config.saveCalls).toBe(1);
    });

    it("前端掩码被回传时不覆盖真实密钥", async () => {
        const config = createConfig(prefixed({ api_key: "sk-real" }));

        await setAIConfig(config, { api_key: MASKED_SECRET });

        expect(await config.get(AI_CONFIG_PREFIX + "api_key")).toBe("sk-real");
        expect(config.writes).toHaveLength(0);
    });

    it("掩码前后带空白同样视为「不改」", async () => {
        const config = createConfig(prefixed({ api_key: "sk-real" }));

        await setAIConfig(config, { api_key: `  ${MASKED_SECRET}  ` });

        expect(await config.get(AI_CONFIG_PREFIX + "api_key")).toBe("sk-real");
    });

    it("正常密钥照常写入", async () => {
        const config = createConfig(prefixed({ api_key: "sk-old" }));

        await setAIConfig(config, { api_key: "sk-new" });

        expect(await config.get(AI_CONFIG_PREFIX + "api_key")).toBe("sk-new");
    });
});

describe("getAIConfigForFrontend", () => {
    it("永远不下发密钥，只用 api_key_set 表达有没有配", async () => {
        const config = createConfig(prefixed({ api_key: "sk-real", enabled: "true" }));

        const result = await getAIConfigForFrontend(config);

        expect(result.api_key).toBe("");
        expect(result.api_key_set).toBe(true);
        expect(result.enabled).toBe(true);
    });

    it("空密钥时 api_key_set 为 false", async () => {
        const result = await getAIConfigForFrontend(createConfig(prefixed({ api_key: "" })));

        expect(result.api_key_set).toBe(false);
    });
});
