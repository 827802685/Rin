import { afterEach, describe, expect, it } from "bun:test";
import { createJWT } from "../jwt";
import { SignJWT } from "jose";

const SECRET = "test-secret-that-is-long-enough";

describe("createJWT", () => {
    it("rejects an empty secret instead of signing everything with it", () => {
        expect(() => createJWT("")).toThrow();
    });

    it("signs a round-trippable token", async () => {
        const { sign, verify } = createJWT(SECRET);
        const token = await sign({ id: 42, name: "zjkl" });

        expect(typeof token).toBe("string");
        expect(token.split(".")).toHaveLength(3);

        const payload = await verify(token);
        expect(payload.id).toBe(42);
        expect(payload.name).toBe("zjkl");
    });

    it("stamps an issued-at claim", async () => {
        const before = Math.floor(Date.now() / 1000);
        const { sign, verify } = createJWT(SECRET);

        const payload = await verify(await sign({ id: 1 }));

        expect(payload.iat).toBeGreaterThanOrEqual(before - 1);
        expect(payload.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 1);
    });

    it("marks HS256 in the protected header", async () => {
        const { sign } = createJWT(SECRET);
        const header = JSON.parse(
            Buffer.from((await sign({ id: 1 })).split(".")[0]!, "base64url").toString()
        );

        expect(header.alg).toBe("HS256");
    });

    it("returns false for a missing token", async () => {
        const { verify } = createJWT(SECRET);

        expect(await verify()).toBe(false);
        expect(await verify("")).toBe(false);
    });

    it("returns false for a token signed with another secret", async () => {
        const { sign } = createJWT("some-other-secret");
        const { verify } = createJWT(SECRET);

        expect(await verify(await sign({ id: 1 }))).toBe(false);
    });

    it("returns false for garbage instead of throwing", async () => {
        const { verify } = createJWT(SECRET);

        expect(await verify("not.a.jwt")).toBe(false);
        expect(await verify("aaaa")).toBe(false);
    });

    it("returns false once the token has expired", async () => {
        const { sign, verify } = createJWT(SECRET);
        const expired = await new SignJWT({ id: 1 })
            .setProtectedHeader({ alg: "HS256" })
            .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
            .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
            .sign(new TextEncoder().encode(SECRET));

        expect(await verify(expired)).toBe(false);
    });

    it("rejects the same claim set signed with a different algorithm", async () => {
        const key = new TextEncoder().encode(SECRET);
        const { verify } = createJWT(SECRET);

        // The verification key is the shared secret either way, so without a
        // pinned algorithm the server would accept a token minted against
        // another HMAC variant of that secret.
        const hs512 = await new SignJWT({ id: 1, admin: true })
            .setProtectedHeader({ alg: "HS512" })
            .setIssuedAt()
            .sign(key);

        expect(await verify(hs512)).toBe(false);
    });

    it("rejects an unsigned (alg: none) token", async () => {
        const { verify } = createJWT(SECRET);
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const payloadPart = Buffer.from(JSON.stringify({ id: 1, admin: true })).toString("base64url");

        expect(await verify(`${header}.${payloadPart}.`)).toBe(false);
    });

    it("accepts a Uint8Array secret as well as a string", async () => {
        const key = new TextEncoder().encode(SECRET);
        const { sign, verify } = createJWT(key);

        expect((await verify(await sign({ id: 7 }))).id).toBe(7);
    });
});

afterEach(() => {
    // Nothing global is patched by this file; kept for symmetry with the other
    // utility suites that restore `globalThis.fetch`.
});
