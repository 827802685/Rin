import { afterEach, describe, expect, it, mock } from "bun:test";
import { createOAuthPlugin, GitHubProvider, type OAuthProvider } from "../oauth";

const originalFetch = globalThis.fetch;

function makeProvider(overrides: Partial<OAuthProvider> = {}): OAuthProvider {
    return {
        name: "ExampleProvider",
        clientId: "client-abc",
        clientSecret: "secret-xyz",
        authorizeUrl: "https://provider.example.com/login/oauth/authorize",
        tokenUrl: "https://provider.example.com/login/oauth/access_token",
        scopes: ["read:user"],
        ...overrides,
    };
}

function buildPlugin(provider: OAuthProvider, name = "Example") {
    return createOAuthPlugin({ [name]: provider });
}

describe("createOAuthPlugin.generateState", () => {
    it("returns 64 lowercase hex characters (32 random bytes)", () => {
        const { generateState } = buildPlugin(makeProvider());
        const state = generateState();

        expect(state).toMatch(/^[0-9a-f]{64}$/);
    });

    it("does not repeat across calls", () => {
        const { generateState } = buildPlugin(makeProvider());
        const seen = new Set<string>();

        for (let i = 0; i < 64; i += 1) {
            seen.add(generateState());
        }

        expect(seen.size).toBe(64);
    });

    it("is not derived from a constant seed or timestamp", () => {
        const pluginA = buildPlugin(makeProvider(), "A");
        const pluginB = buildPlugin(makeProvider(), "B");

        expect(pluginA.generateState()).not.toBe(pluginB.generateState());
    });
});

describe("createOAuthPlugin.createRedirectUrl", () => {
    it("throws for an unknown provider", () => {
        const { createRedirectUrl } = buildPlugin(makeProvider());

        expect(() => createRedirectUrl("state-1", "Nope")).toThrow(
            'OAuth provider "Nope" not found',
        );
    });

    it("points at the provider authorizeUrl with client_id and state", () => {
        const { createRedirectUrl } = buildPlugin(makeProvider());
        const url = new URL(createRedirectUrl("state-1", "Example"));

        expect(url.origin + url.pathname).toBe(
            "https://provider.example.com/login/oauth/authorize",
        );
        expect(url.searchParams.get("client_id")).toBe("client-abc");
        expect(url.searchParams.get("state")).toBe("state-1");
    });

    it("forwards the configured scopes to the authorize request", () => {
        const { createRedirectUrl } = buildPlugin(
            makeProvider({ scopes: ["read:user", "user:email"] }),
        );
        const url = new URL(createRedirectUrl("state-1", "Example"));

        expect(url.searchParams.get("scope")).toBe("read:user,user:email");
    });

    it("omits the scope parameter when the provider declares no scopes", () => {
        const { createRedirectUrl } = buildPlugin(makeProvider({ scopes: [] }));
        const url = new URL(createRedirectUrl("state-1", "Example"));

        expect(url.searchParams.has("scope")).toBe(false);
    });

    it("sends the redirect_uri that the provider is configured with", () => {
        const { createRedirectUrl } = buildPlugin(
            makeProvider({ redirectUri: "https://app.example.com/callback" }),
        );
        const url = new URL(createRedirectUrl("state-1", "Example"));

        expect(url.searchParams.get("redirect_uri")).toBe(
            "https://app.example.com/callback",
        );
    });

    it("omits redirect_uri when the provider has none", () => {
        const { createRedirectUrl } = buildPlugin(makeProvider());
        const url = new URL(createRedirectUrl("state-1", "Example"));

        expect(url.searchParams.has("redirect_uri")).toBe(false);
    });

    it("percent-encodes hostile state values", () => {
        const { createRedirectUrl } = buildPlugin(makeProvider());
        const hostile = 'a"&client_id=evil';
        const url = new URL(createRedirectUrl(hostile, "Example"));

        expect(url.searchParams.get("state")).toBe(hostile);
        expect(url.search).not.toContain('"');
    });

    it("keeps authorize and token requests on the same redirect_uri", async () => {
        const provider = makeProvider({
            redirectUri: "https://app.example.com/callback",
        });
        const { createRedirectUrl, authorize } = buildPlugin(provider);

        let sentBody = "";
        globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
            sentBody = String(init.body);
            return new Response(
                JSON.stringify({ access_token: "tok", token_type: "Bearer" }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            );
        }) as unknown as typeof fetch;

        const authorizeRedirectUri = new URL(
            createRedirectUrl("state-1", "Example"),
        ).searchParams.get("redirect_uri");
        await authorize("Example", "code-1");
        const tokenRedirectUri = new URLSearchParams(sentBody).get("redirect_uri");

        expect(authorizeRedirectUri).toBeTruthy();
        expect(tokenRedirectUri).toBe(authorizeRedirectUri);
    });
});

describe("createOAuthPlugin.authorize", () => {
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function stub(response: Response) {
        const calls: { url: string; init: RequestInit }[] = [];
        globalThis.fetch = mock(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return response;
        }) as unknown as typeof fetch;
        return calls;
    }

    it("throws for an unknown provider without calling fetch", () => {
        const calls = stub(new Response("{}", { status: 200 }));
        const { authorize } = buildPlugin(makeProvider());

        expect(authorize("Nope", "code-1")).rejects.toThrow(
            'OAuth provider "Nope" not found',
        );
        expect(calls.length).toBe(0);
    });

    it("rejects a missing or empty authorization code", async () => {
        const calls = stub(new Response("{}", { status: 200 }));
        const { authorize } = buildPlugin(makeProvider());

        await expect(authorize("Example")).rejects.toThrow(
            "Authorization code is required",
        );
        await expect(authorize("Example", "")).rejects.toThrow(
            "Authorization code is required",
        );
        expect(calls.length).toBe(0);
    });

    it("POSTs the form-encoded exchange payload to the token endpoint", async () => {
        const calls = stub(
            new Response(
                JSON.stringify({ access_token: "tok", token_type: "Bearer" }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const { authorize } = buildPlugin(makeProvider());

        await authorize("Example", "code-1");

        expect(calls.length).toBe(1);
        expect(calls[0].url).toBe(
            "https://provider.example.com/login/oauth/access_token",
        );
        expect(calls[0].init.method).toBe("POST");
        const headers = new Headers(calls[0].init.headers as HeadersInit);
        expect(headers.get("Content-Type")).toBe(
            "application/x-www-form-urlencoded",
        );
        expect(headers.get("Accept")).toBe("application/json");

        const body = new URLSearchParams(String(calls[0].init.body));
        expect(body.get("client_id")).toBe("client-abc");
        expect(body.get("client_secret")).toBe("secret-xyz");
        expect(body.get("code")).toBe("code-1");
        expect(body.has("redirect_uri")).toBe(false);
    });

    it("maps the token response onto camelCase fields", async () => {
        stub(
            new Response(
                JSON.stringify({
                    access_token: "tok",
                    token_type: "bearer",
                    scope: "read:user,user:email",
                    expires_in: 28800,
                    refresh_token: "refresh-1",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const { authorize } = buildPlugin(makeProvider());

        const token = await authorize("Example", "code-1");

        expect(token).toEqual({
            accessToken: "tok",
            tokenType: "bearer",
            scope: "read:user,user:email",
            expiresIn: 28800,
            refreshToken: "refresh-1",
        });
    });

    it("defaults token_type to Bearer when the provider omits it", async () => {
        stub(
            new Response(JSON.stringify({ access_token: "tok" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { authorize } = buildPlugin(makeProvider());

        const token = await authorize("Example", "code-1");

        expect(token.tokenType).toBe("Bearer");
        expect(token.accessToken).toBe("tok");
    });

    it("throws when the token endpoint responds with an HTTP error", async () => {
        stub(new Response("nope", { status: 401, statusText: "Unauthorized" }));
        const { authorize } = buildPlugin(makeProvider());

        await expect(authorize("Example", "code-1")).rejects.toThrow(
            "Failed to exchange code for token: Unauthorized",
        );
    });

    it("throws when the endpoint returns 200 with an OAuth error payload", async () => {
        stub(
            new Response(
                JSON.stringify({
                    error: "bad_verification_code",
                    error_description: "The code passed is incorrect or expired.",
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
            ),
        );
        const { authorize } = buildPlugin(makeProvider());

        await expect(authorize("Example", "code-1")).rejects.toThrow(
            "bad_verification_code",
        );
    });

    it("throws when the endpoint returns 200 without an access_token", async () => {
        stub(
            new Response(JSON.stringify({ token_type: "Bearer" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        );
        const { authorize } = buildPlugin(makeProvider());

        await expect(authorize("Example", "code-1")).rejects.toThrow();
    });
});

describe("GitHubProvider", () => {
    it("targets GitHub endpoints and requests read:user", () => {
        const provider = new GitHubProvider({
            clientId: "gh-id",
            clientSecret: "gh-secret",
            redirectUri: "https://app.example.com/callback",
        });

        expect(provider.name).toBe("GitHub");
        expect(provider.authorizeUrl).toBe(
            "https://github.com/login/oauth/authorize",
        );
        expect(provider.tokenUrl).toBe(
            "https://github.com/login/oauth/access_token",
        );
        expect(provider.scopes).toEqual(["read:user"]);
        expect(provider.redirectUri).toBe("https://app.example.com/callback");
    });

    it("builds a GitHub authorization URL carrying the configured scope", () => {
        const { createRedirectUrl } = createOAuthPlugin({
            GitHub: new GitHubProvider({
                clientId: "gh-id",
                clientSecret: "gh-secret",
                redirectUri: "https://app.example.com/callback",
            }),
        });
        const url = new URL(createRedirectUrl("state-1", "GitHub"));

        expect(url.origin + url.pathname).toBe(
            "https://github.com/login/oauth/authorize",
        );
        expect(url.searchParams.get("client_id")).toBe("gh-id");
        expect(url.searchParams.get("scope")).toBe("read:user");
        expect(url.searchParams.get("redirect_uri")).toBe(
            "https://app.example.com/callback",
        );
    });
});
