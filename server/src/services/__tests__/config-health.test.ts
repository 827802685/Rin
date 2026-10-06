import { describe, expect, it } from "bun:test";
import { buildHealthCheckResponse, type HealthCheckItem } from "../config-health";

type FakeConfig = {
    get: (key: string) => Promise<any>;
    getOrDefault: <T>(key: string, defaultValue: T) => Promise<T>;
};

function createConfig(values: Record<string, unknown> = {}): FakeConfig {
    return {
        async get(key: string) {
            return values[key];
        },
        async getOrDefault<T>(key: string, defaultValue: T): Promise<T> {
            const value = values[key];
            return value === undefined || value === null ? defaultValue : (value as T);
        },
    };
}

function createEnv(overrides: Record<string, unknown> = {}): Env {
    return overrides as unknown as Env;
}

const S3_ENV = {
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "rin-bucket",
    S3_ACCESS_KEY_ID: "access-key",
    S3_SECRET_ACCESS_KEY: "secret-key",
};

const SECURE_ENV = {
    JWT_SECRET: "jwt-secret",
    ADMIN_USERNAME: "owner",
    ADMIN_PASSWORD: "a-strong-password",
    RIN_GITHUB_CLIENT_ID: "client-id",
    RIN_GITHUB_CLIENT_SECRET: "client-secret",
    ...S3_ENV,
};

function pick(items: HealthCheckItem[], id: string): HealthCheckItem {
    const found = items.find((item) => item.id === id);
    if (!found) {
        throw new Error(`health item ${id} not found in ${items.map((i) => i.id).join(", ")}`);
    }
    return found;
}

async function build(
    clientValues: Record<string, unknown> = {},
    serverValues: Record<string, unknown> = {},
    envOverrides: Record<string, unknown> = {},
) {
    const response = await buildHealthCheckResponse(
        createConfig(clientValues),
        createConfig(serverValues),
        createEnv(envOverrides),
    );
    return response;
}

describe("buildHealthCheckResponse > auth-runtime", () => {
    it("reports success when JWT_SECRET is present", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV });
        const item = pick(items, "auth-runtime");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
        expect(item.summary.key).toBe("health.items.auth_runtime.success.summary");
    });

    it("reports danger when JWT_SECRET is missing", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV, JWT_SECRET: undefined });
        const item = pick(items, "auth-runtime");

        expect(item.status).toBe("danger");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.auth_runtime.danger.summary");
    });
});

describe("buildHealthCheckResponse > login-methods", () => {
    it("reports warning when login is disabled", async () => {
        const { items } = await build({ "login.enabled": false }, {}, { ...SECURE_ENV });
        const item = pick(items, "login-methods");

        expect(item.status).toBe("warning");
        expect(item.summary.key).toBe("health.items.login_methods.disabled.summary");
    });

    it("reports danger when neither OAuth nor password login is configured", async () => {
        const { items } = await build({}, {}, {
            JWT_SECRET: "jwt-secret",
            ...S3_ENV,
        });
        const item = pick(items, "login-methods");

        expect(item.status).toBe("danger");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.login_methods.missing.summary");
    });

    it("reports danger and flags the credential when the default admin password is in use", async () => {
        const { items } = await build({}, {}, {
            ...SECURE_ENV,
            ADMIN_USERNAME: "admin",
            ADMIN_PASSWORD: "admin123",
        });
        const item = pick(items, "login-methods");

        expect(item.status).toBe("danger");
        expect(item.summary.key).toBe("health.items.login_methods.default_password.summary");
        expect(item.details?.map((detail) => detail.key)).toEqual([
            "health.items.login_methods.details.github_configured",
            "health.items.login_methods.details.password_default",
        ]);
    });

    it("reports warning when only password login is available", async () => {
        const { items } = await build({}, {}, {
            ...SECURE_ENV,
            RIN_GITHUB_CLIENT_ID: undefined,
            RIN_GITHUB_CLIENT_SECRET: undefined,
        });
        const item = pick(items, "login-methods");

        expect(item.status).toBe("warning");
        expect(item.configured).toBe(true);
        expect(item.summary.key).toBe("health.items.login_methods.oauth_missing.summary");
        expect(item.details?.map((detail) => detail.key)).toEqual([
            "health.items.login_methods.details.github_missing",
            "health.items.login_methods.details.password_configured",
        ]);
    });

    it("reports success when both login methods are configured", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV });
        const item = pick(items, "login-methods");

        expect(item.status).toBe("success");
        expect(item.details?.map((detail) => detail.key)).toEqual([
            "health.items.login_methods.details.github_configured",
            "health.items.login_methods.details.password_configured",
        ]);
    });
});

describe("buildHealthCheckResponse > storage", () => {
    it("reports success when every S3 key is present", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV });
        const item = pick(items, "storage");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
        expect(item.summary.key).toBe("health.items.storage.ready.summary");
    });

    it("reports danger and lists the missing keys when S3 is partially configured", async () => {
        const { items } = await build({}, {}, {
            ...SECURE_ENV,
            S3_ACCESS_KEY_ID: undefined,
            S3_SECRET_ACCESS_KEY: undefined,
        });
        const item = pick(items, "storage");

        expect(item.status).toBe("danger");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.storage.missing.summary_partial");
        expect(item.summary.values?.keys).toBe("S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY");
        expect(item.details?.map((detail) => detail.values?.key)).toEqual([
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
        ]);
    });

    it("reports warning instead of danger when no S3 key is configured at all", async () => {
        const { items } = await build({}, {}, { JWT_SECRET: "jwt-secret" });
        const item = pick(items, "storage");

        expect(item.status).toBe("warning");
        expect(item.summary.key).toBe("health.items.storage.missing.summary_none");
    });

    it("reports success when an R2 bucket binding replaces S3", async () => {
        const { items } = await build({}, {}, {
            JWT_SECRET: "jwt-secret",
            R2_BUCKET: { get: () => null },
        });
        const item = pick(items, "storage");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
    });
});

describe("buildHealthCheckResponse > ai-summary", () => {
    it("reports warning when the AI summary feature is disabled", async () => {
        const { items } = await build({}, { "ai_summary.enabled": false }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("warning");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.ai_summary.disabled.summary");
    });

    it("reports danger when AI is enabled without a model", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.model": "",
            "ai_summary.api_key": "sk-test",
        }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("danger");
        expect(item.summary.key).toBe("health.items.ai_summary.no_model.summary");
    });

    it("reports success for worker-ai when the AI binding exposes run()", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.provider": "worker-ai",
            "ai_summary.model": "@cf/meta/llama-3-8b",
        }, {
            ...SECURE_ENV,
            AI: { run: async () => ({}) },
        });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("success");
        expect(item.summary.key).toBe("health.items.ai_summary.worker_ai.ready.summary");
        expect(item.summary.values?.model).toBe("@cf/meta/llama-3-8b");
    });

    it("reports danger for worker-ai when the AI binding is missing", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.provider": "worker-ai",
            "ai_summary.model": "@cf/meta/llama-3-8b",
        }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("danger");
        expect(item.summary.key).toBe("health.items.ai_summary.worker_ai.missing.summary");
    });

    it("reports success for an external provider with an API key and default URL", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.provider": "openai",
            "ai_summary.model": "gpt-4o-mini",
            "ai_summary.api_key": "sk-test",
        }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("success");
        expect(item.summary.key).toBe("health.items.ai_summary.external.ready.summary");
        expect(item.details?.map((detail) => detail.values)).toEqual([
            { provider: "openai" },
            { model: "gpt-4o-mini" },
        ]);
    });

    it("reports danger and asks for a key when the external provider has no API key", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.provider": "openai",
            "ai_summary.model": "gpt-4o-mini",
            "ai_summary.api_key": "",
        }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("danger");
        expect(item.summary.key).toBe("health.items.ai_summary.external.missing.summary_key");
    });

    it("reports danger when the provider has no known default URL and no api_url", async () => {
        const { items } = await build({}, {
            "ai_summary.enabled": true,
            "ai_summary.provider": "self-hosted",
            "ai_summary.model": "local-model",
            "ai_summary.api_key": "sk-test",
            "ai_summary.api_url": "",
        }, { ...SECURE_ENV });
        const item = pick(items, "ai-summary");

        expect(item.status).toBe("danger");
        expect(item.summary.key).toBe("health.items.ai_summary.external.missing.summary_url");
    });
});

describe("buildHealthCheckResponse > webhook", () => {
    it("reports success when the webhook_url config key is set", async () => {
        const { items } = await build({}, { webhook_url: "https://hooks.example.com/rin" }, { ...SECURE_ENV });
        const item = pick(items, "webhook");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
        expect(item.summary.key).toBe("health.items.webhook.ready.summary");
    });

    it("reports success when only the legacy WEBHOOK_URL config key is set", async () => {
        const { items } = await build({}, { WEBHOOK_URL: "https://legacy.example.com/rin" }, { ...SECURE_ENV });
        const item = pick(items, "webhook");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
    });

    it("reports success when the webhook URL comes from the environment", async () => {
        const { items } = await build({}, {}, {
            ...SECURE_ENV,
            WEBHOOK_URL: "https://env.example.com/rin",
        });
        const item = pick(items, "webhook");

        expect(item.status).toBe("success");
        expect(item.configured).toBe(true);
    });

    it("falls back to the legacy key when webhook_url holds only whitespace", async () => {
        const { items } = await build({}, {
            webhook_url: "   ",
            WEBHOOK_URL: "https://legacy.example.com/rin",
        }, { ...SECURE_ENV });
        const item = pick(items, "webhook");

        expect(item.status).toBe("success");
    });

    it("reports warning when no webhook URL is available anywhere", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV });
        const item = pick(items, "webhook");

        expect(item.status).toBe("warning");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.webhook.missing.summary");
    });

    it("suggests enabling the friend crontab when it is turned off", async () => {
        const withCrontab = await build({}, { webhook_url: "https://hooks.example.com/rin" }, { ...SECURE_ENV });
        const withoutCrontab = await build(
            {},
            { webhook_url: "https://hooks.example.com/rin", friend_crontab: false },
            { ...SECURE_ENV },
        );

        expect(pick(withCrontab.items, "webhook").suggestion?.key).toBe("health.items.common.no_action");
        expect(pick(withoutCrontab.items, "webhook").suggestion?.key)
            .toBe("health.items.webhook.ready.suggestion_optional");
    });
});

describe("buildHealthCheckResponse > rss", () => {
    it("reports success with caching when RSS is enabled and storage is ready", async () => {
        const { items } = await build({ rss: true }, {}, { ...SECURE_ENV });
        const item = pick(items, "rss");

        expect(item.status).toBe("success");
        expect(item.summary.key).toBe("health.items.rss.enabled.summary_cached");
    });

    it("reports warning with on-demand delivery when storage is incomplete", async () => {
        const { items } = await build({ rss: true }, {}, {
            ...SECURE_ENV,
            S3_BUCKET: undefined,
        });
        const item = pick(items, "rss");

        expect(item.status).toBe("warning");
        expect(item.summary.key).toBe("health.items.rss.enabled.summary_on_demand");
    });

    it("reports warning when RSS is disabled", async () => {
        const { items } = await build({ rss: false }, {}, { ...SECURE_ENV });
        const item = pick(items, "rss");

        expect(item.status).toBe("warning");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.rss.disabled.summary");
    });
});

describe("buildHealthCheckResponse > site-identity", () => {
    it("reports success when both name and avatar are configured", async () => {
        const { items } = await build({
            "site.name": "Rin",
            "site.avatar": "https://cdn.example.com/a.png",
        }, {}, { ...SECURE_ENV });
        const item = pick(items, "site-identity");

        expect(item.status).toBe("success");
        expect(item.summary.values?.name).toBe("Rin");
        expect(item.summary.key).toBe("health.items.site_identity.ready.summary");
    });

    it("reports warning when the avatar is missing", async () => {
        const { items } = await build({ "site.name": "Rin" }, {}, { ...SECURE_ENV });
        const item = pick(items, "site-identity");

        expect(item.status).toBe("warning");
        expect(item.summary.key).toBe("health.items.site_identity.ready.summary_missing_avatar");
    });

    it("reports warning when the site name is missing", async () => {
        const { items } = await build({}, {}, { ...SECURE_ENV });
        const item = pick(items, "site-identity");

        expect(item.status).toBe("warning");
        expect(item.configured).toBe(false);
        expect(item.summary.key).toBe("health.items.site_identity.missing.summary");
    });

    it("treats a whitespace-only site name as missing", async () => {
        const { items } = await build({ "site.name": "   " }, {}, { ...SECURE_ENV });
        const item = pick(items, "site-identity");

        expect(item.configured).toBe(false);
        expect(item.status).toBe("warning");
    });
});

describe("buildHealthCheckResponse > response shape", () => {
    it("summarises status counts that add up to the item count", async () => {
        const response = await build({}, {}, { ...SECURE_ENV });

        const total = response.summary.success + response.summary.warning + response.summary.danger;
        expect(total).toBe(response.items.length);
    });

    it("exposes one item per check id", async () => {
        const response = await build({}, {}, { ...SECURE_ENV });

        expect(response.items.map((item) => item.id)).toEqual([
            "auth-runtime",
            "login-methods",
            "storage",
            "ai-summary",
            "webhook",
            "rss",
            "site-identity",
        ]);
    });

    it("stamps generatedAt with an ISO timestamp", async () => {
        const response = await build({}, {}, { ...SECURE_ENV });

        expect(Number.isNaN(Date.parse(response.generatedAt))).toBe(false);
        expect(response.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("reports no success item when nothing is configured", async () => {
        const response = await build({}, {}, {});

        expect(response.summary.success).toBe(0);
        expect(pick(response.items, "auth-runtime").status).toBe("danger");
        expect(pick(response.items, "login-methods").status).toBe("danger");
        // 全部 S3 键缺失属于「尚未启用对象存储」，只报 warning 而非 danger
        expect(pick(response.items, "storage").status).toBe("warning");
        expect(response.summary.danger).toBe(2);
    });
});
