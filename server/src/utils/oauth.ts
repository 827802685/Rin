export interface OAuthProvider {
    name: string;
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string[];
}

export interface OAuthToken {
    accessToken: string;
    tokenType: string;
    scope?: string;
    expiresIn?: number;
    refreshToken?: string;
}

export interface GitHubConfig {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
}

export class GitHubProvider implements OAuthProvider {
    name = "GitHub";
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
    authorizeUrl = "https://github.com/login/oauth/authorize";
    tokenUrl = "https://github.com/login/oauth/access_token";
    scopes: string[] = ["read:user"];

    constructor(config: GitHubConfig) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.redirectUri = config.redirectUri;
    }
}

export interface OAuth2Utils {
    generateState: () => string;
    createRedirectUrl: (state: string, providerName: string) => string;
    authorize: (providerName: string, code?: string) => Promise<OAuthToken>;
}

export function createOAuthPlugin(providers: Record<string, OAuthProvider>): OAuth2Utils {
    return {
        generateState: () => {
            const array = new Uint8Array(32);
            crypto.getRandomValues(array);
            return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
        },
        
        createRedirectUrl: (state: string, providerName: string): string => {
            const provider = providers[providerName];
            if (!provider) {
                throw new Error(`OAuth provider "${providerName}" not found`);
            }

            const params = new URLSearchParams({
                client_id: provider.clientId,
                state: state,
            });

            // `authorize` below sends `redirect_uri` whenever the provider declares
            // one, so the browser redirect must carry exactly the same value.
            // Sending it on only one leg makes providers reject the exchange with
            // a redirect_uri mismatch.
            if (provider.redirectUri) {
                params.set("redirect_uri", provider.redirectUri);
            }

            if (Array.isArray(provider.scopes) && provider.scopes.length > 0) {
                params.set("scope", provider.scopes.join(","));
            }

            return `${provider.authorizeUrl}?${params.toString()}`;
        },

        authorize: async (providerName: string, code?: string): Promise<OAuthToken> => {
            const provider = providers[providerName];
            if (!provider) {
                throw new Error(`OAuth provider "${providerName}" not found`);
            }

            if (!code) {
                throw new Error("Authorization code is required");
            }

            const params = new URLSearchParams({
                client_id: provider.clientId,
                client_secret: provider.clientSecret,
                code: code,
            });

            if (provider.redirectUri) {
                params.set("redirect_uri", provider.redirectUri);
            }

            const response = await fetch(provider.tokenUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                body: params.toString(),
            });

            if (!response.ok) {
                throw new Error(`Failed to exchange code for token: ${response.statusText}`);
            }

            const data = await response.json() as {
                access_token?: string;
                token_type?: string;
                scope?: string;
                expires_in?: number;
                refresh_token?: string;
                error?: string;
                error_description?: string;
            };

            // A rejected code is reported as HTTP 200 with an `error` field, which
            // used to be read as a successful token with an undefined access token.
            if (data.error) {
                throw new Error(
                    `Failed to exchange code for token: ${data.error}${data.error_description ? ` - ${data.error_description}` : ""}`,
                );
            }

            if (!data.access_token) {
                throw new Error(
                    "Failed to exchange code for token: response did not include an access_token",
                );
            }

            return {
                accessToken: data.access_token,
                tokenType: data.token_type || "Bearer",
                scope: data.scope,
                expiresIn: data.expires_in,
                refreshToken: data.refresh_token,
            };
        },
    };
}

export { createOAuthPlugin as createOAuth2 };
