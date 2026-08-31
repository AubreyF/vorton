import { createServer } from "node:http";

import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthenticationError,
  StepUpAuthenticationError,
  createSupabaseIdentityVerifier,
  requireRecentAal2,
} from "./auth.js";

const issuer = "https://abcdefghijklmnopqrst.supabase.co/auth/v1";
const audience = "authenticated";
const authUserId = "0e01b4ef-f1de-4c2b-b79b-eccc61ac5ad5";
const sessionId = "9ad0c516-419f-4415-88ad-0910797a1d01";
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
  const sign = (
    subject: string,
    key = privateKey,
    claims: Record<string, unknown> = {},
  ) =>
    new SignJWT({
      role: "authenticated",
      aal: "aal2",
      session_id: sessionId,
      is_anonymous: false,
      amr: [
        { method: "password", timestamp: Math.floor(Date.now() / 1000) - 30 },
        { method: "totp", timestamp: Math.floor(Date.now() / 1000) },
      ],
      ...claims,
    })
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
  it("accepts only a recent AAL2 authentication for sensitive actions", () => {
    const now = 2_000_000_000;
    expect(() =>
      requireRecentAal2({ authUserId, aal: "aal2", authTime: now - 60 }, now),
    ).not.toThrow();
    expect(() =>
      requireRecentAal2({ authUserId, aal: "aal1", authTime: now }, now),
    ).toThrow(StepUpAuthenticationError);
    expect(() =>
      requireRecentAal2({ authUserId, aal: "aal2", authTime: now - 601 }, now),
    ).toThrow(StepUpAuthenticationError);
  });

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
    ).resolves.toMatchObject({
      authUserId,
      aal: "aal2",
      authTime: expect.any(Number),
    });
    await expect(
      verifier.verify("Bearer definitely-not-a-jwt"),
    ).rejects.toThrow("invalid");
  });

  it("does not accept token issue time or generic OTP as recent MFA", async () => {
    const { verifier, sign } = await fixture();
    const identity = await verifier.verify(
      `Bearer ${await sign(authUserId, undefined, {
        auth_time: Math.floor(Date.now() / 1000),
        amr: [{ method: "otp", timestamp: Math.floor(Date.now() / 1000) }],
      })}`,
    );
    expect(identity.authTime).toBeUndefined();
    expect(() => requireRecentAal2(identity)).toThrow(
      StepUpAuthenticationError,
    );
  });

  it("rejects anonymous, non-authenticated, and sessionless tokens", async () => {
    const { verifier, sign } = await fixture();
    for (const claims of [
      { is_anonymous: true },
      { is_anonymous: undefined },
      { role: "service_role" },
      { session_id: undefined },
    ]) {
      await expect(
        verifier.verify(`Bearer ${await sign(authUserId, undefined, claims)}`),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }
  });

  it("rejects a forged token signed by an untrusted key", async () => {
    const { verifier, sign } = await fixture();
    const { privateKey: forgedKey } = await generateKeyPair("ES256");
    await expect(
      verifier.verify(`Bearer ${await sign(authUserId, forgedKey)}`),
    ).rejects.toThrow("invalid");
  });
});
