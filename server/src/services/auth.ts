import { getClientIP } from "../utils/request";
import { hashPassword, needsRehash, timingSafeEqual, verifyPassword } from "../utils/password";
import { consumeRateLimit } from "../utils/rate-limit";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { loginSchema, parseSchema } from "@rin/api";
import type { AppContext, Variables } from "../core/hono-types";
import { profileAsync } from "../core/server-timing";
import { setJWTCookie } from "../core/hono-middleware";
import { users } from "../db/schema";
import {
    BadRequestError,
    ForbiddenError,
    InternalServerError,
    RateLimitError,
} from "../errors";

const LOGIN_RATE_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 300;

function sameString(left: string, right: string) {
    const encoder = new TextEncoder();
    return timingSafeEqual(encoder.encode(left), encoder.encode(right));
}

function publicUser(user: { id: number; username: string; avatar: string | null; permission: number | null }) {
    return {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        permission: user.permission === 1,
    };
}

export function PasswordAuthService(): Hono<{
        Bindings: Env;
        Variables: Variables;
    }> {
    const app = new Hono<{
        Bindings: Env;
        Variables: Variables;
    }>();
    // Login with username and password
    app.post("/login", async (c: AppContext) => {
        const jwt = c.get('jwt');
        const db = c.get('db');
        const env = c.env;

        // Throttle brute force attempts before touching the database.
        const throttle = await consumeRateLimit(db, {
            scope: "login",
            identifier: getClientIP(c),
            limit: LOGIN_RATE_LIMIT,
            windowSeconds: LOGIN_WINDOW_SECONDS,
        });

        if (!throttle.allowed) {
            throw new RateLimitError('Too many login attempts, please try again later');
        }

        // Check if admin credentials are configured
        const adminUsername = env.ADMIN_USERNAME;
        const adminPassword = env.ADMIN_PASSWORD;

        if (!adminUsername || !adminPassword) {
            throw new BadRequestError('Admin credentials not configured');
        }

        const body = await profileAsync(c, 'auth_login_parse', () => c.req.json());

        const parsed = parseSchema<{ username: string; password: string }>(loginSchema, body);
        if (!parsed.success) {
            throw new BadRequestError('Username and password are required');
        }

        const { username, password } = parsed.data;

        // Check if this is the admin login
        if (username === adminUsername) {
            // The configured admin credential is authoritative, so rotating
            // ADMIN_PASSWORD in the environment keeps working on every deploy.
            if (!sameString(password, adminPassword)) {
                throw new ForbiddenError('Invalid credentials');
            }

            // Find or create admin user
            let user = await profileAsync(c, 'auth_admin_lookup', () => db.query.users.findFirst({
                where: eq(users.openid, "admin")
            }));

            if (!user) {
                const adminHash = await profileAsync(c, 'auth_admin_hash', () => hashPassword(adminPassword));

                // Create admin user if not exists
                const result = await profileAsync(c, 'auth_admin_insert', () => db.insert(users).values({
                    username: adminUsername,
                    openid: "admin",
                    avatar: "",
                    permission: 1,
                    password: adminHash,
                }).returning({ insertedId: users.id }));

                if (!result || result.length === 0) {
                    throw new InternalServerError('Failed to create admin user');
                }

                user = await profileAsync(c, 'auth_admin_reload', () => db.query.users.findFirst({
                    where: eq(users.id, result[0].insertedId)
                }));
            } else if (user && needsRehash(user.password)) {
                const adminHash = await profileAsync(c, 'auth_admin_hash', () => hashPassword(adminPassword));
                const adminId = user.id;

                // Migrate the legacy unsalted digest (or sync a rotated password).
                await profileAsync(c, 'auth_admin_sync', () => db.update(users)
                    .set({ password: adminHash, username: adminUsername })
                    .where(eq(users.id, adminId)));
            }

            if (!user) {
                throw new InternalServerError('Failed to get admin user');
            }

            const admin = user;

            // Generate JWT token
            const token = await profileAsync(c, 'auth_admin_token', () => jwt.sign({ id: admin.id }));

            // Set JWT cookie using Hono helper
            setJWTCookie(c, token);

            return c.json({
                success: true,
                token: token,
                user: publicUser(admin),
            });
        }

        // Regular user login (if we want to support multiple users with passwords in the future)
        const user = await profileAsync(c, 'auth_user_lookup', () => db.query.users.findFirst({
            where: eq(users.username, username)
        }));

        if (!user || !user.password) {
            throw new ForbiddenError('Invalid credentials');
        }

        const passwordMatches = await profileAsync(c, 'auth_user_verify', () => verifyPassword(password, user.password));

        if (!passwordMatches) {
            throw new ForbiddenError('Invalid credentials');
        }

        if (needsRehash(user.password)) {
            const upgradedHash = await profileAsync(c, 'auth_user_hash', () => hashPassword(password));

            // Upgrade legacy SHA-256 digests to PBKDF2 on the next successful login.
            await profileAsync(c, 'auth_user_rehash', () => db.update(users)
                .set({ password: upgradedHash })
                .where(eq(users.id, user.id)));
        }

        // Generate JWT token
        const token = await profileAsync(c, 'auth_user_token', () => jwt.sign({ id: user.id }));

        // Set JWT cookie using Hono helper
        setJWTCookie(c, token);

        return c.json({
            success: true,
            token: token,
            user: publicUser(user),
        });
    });

    // Check if password login is available
    app.get("/status", async (c: AppContext) => {
        const env = c.env;

        return c.json({
            github: !!(env.RIN_GITHUB_CLIENT_ID && env.RIN_GITHUB_CLIENT_SECRET),
            password: !!(env.ADMIN_USERNAME && env.ADMIN_PASSWORD),
        });
    });

    return app;
}
