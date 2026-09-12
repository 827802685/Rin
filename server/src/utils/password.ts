/**
 * Password hashing.
 *
 * Historically passwords were stored as a plain, unsalted SHA-256 hex digest,
 * which is fast to brute force. New hashes use PBKDF2-HMAC-SHA256 with a random
 * per-password salt and are stored as
 * `pbkdf2$<iterations>$<salt base64url>$<hash base64url>`.
 *
 * Legacy digests remain verifiable so existing installations keep working; a
 * successful legacy login transparently re-hashes the password.
 */

export const PBKDF2_ITERATIONS = 120_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export const LEGACY_SHA256_PATTERN = /^[0-9a-f]{64}$/;

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
    try {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
        const binary = atob(padded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
}

async function legacySha256Hex(password: string): Promise<string> {
    const data = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password) as BufferSource,
        "PBKDF2",
        false,
        ["deriveBits"],
    );

    const bits = await crypto.subtle.deriveBits(
        {
            name: "PBKDF2",
            salt: salt as BufferSource,
            iterations,
            hash: "SHA-256",
        },
        key,
        KEY_BYTES * 8,
    );

    return new Uint8Array(bits);
}

/** Length-independent, constant-time comparison of two byte sequences. */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) {
        return false;
    }

    let diff = 0;
    for (let i = 0; i < left.length; i += 1) {
        diff |= (left[i] as number) ^ (right[i] as number);
    }
    return diff === 0;
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await pbkdf2(password, salt, iterations);
    return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** True when the stored value is still an unsalted SHA-256 digest. */
export function needsRehash(stored: string | null | undefined): boolean {
    return !stored || !stored.startsWith("pbkdf2$");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
    if (!stored) {
        return false;
    }

    if (stored.startsWith("pbkdf2$")) {
        const [, rawIterations, rawSalt, rawHash] = stored.split("$");
        const iterations = Number.parseInt(rawIterations || "", 10);
        const salt = fromBase64Url(rawSalt || "");
        const expected = fromBase64Url(rawHash || "");

        if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expected) {
            return false;
        }

        const actual = await pbkdf2(password, salt, iterations);
        return timingSafeEqual(actual, expected);
    }

    if (LEGACY_SHA256_PATTERN.test(stored)) {
        const actual = await legacySha256Hex(password);
        return timingSafeEqual(
            new TextEncoder().encode(actual),
            new TextEncoder().encode(stored),
        );
    }

    return false;
}
