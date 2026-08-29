import { createServer } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import { AuthenticationError, createSupabaseIdentityVerifier } from "./auth.js";

const issuer = "https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const audience = "authenticated";
const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        keys: [{ ...jwk, kid: "fixture-key", alg: "ES256", use: "sig" }],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("JWKS fixture failed to listen");
  const verifier = createSupabaseIdentityVerifier({
    issuer,
    audience,
    jwksUrl: `http://127.0.0.1:${String(address.port)}`,
  });
  const sign = (subject: string, key = privateKey) =>
    new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "ES256", kid: "fixture-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
  return { verifier, sign };
}

describe("Supabase JWT identity boundary", () => {
  it("requires a bearer token", async () => {
    const { verifier } = await fixture();
    await expect(verifier.verify(undefined)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("derives the auth user only from a valid issuer and audience token", async () => {
    const { verifier, sign } = await fixture();
    await expect(
      verifier.verify(`Bearer ${await sign(authUserId)}`),
    ).resolves.toEqual({ authUserId });
    await expect(
      verifier.verify("Bearer definitely-not-a-jwt"),
    ).rejects.toThrow("invalid");
  });

  it("rejects a forged token signed by an untrusted key", async () => {
    const { verifier, sign } = await fixture();
    const { privateKey: forgedKey } = await generateKeyPair("ES256");
    await expect(
      verifier.verify(`Bearer ${await sign(authUserId, forgedKey)}`),
    ).rejects.toThrow("invalid");
  });
});
