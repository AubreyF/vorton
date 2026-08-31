import { describe, expect, it } from "vitest";

import type { AuthenticatedWorkerCredential } from "@vorton/kernel";

import { AuthenticationError } from "./auth.js";
import {
  verifyWorkerCredential,
  type WorkerCredentialVerifier,
} from "./worker-auth.js";

const credential: AuthenticatedWorkerCredential = {
  credentialId: "11111111-1111-4111-8111-111111111111",
  installationId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  workerId: "44444444-4444-4444-8444-444444444444",
  expiresAt: "2026-08-31T20:00:00.000Z",
};

describe("worker credential verification", () => {
  it("resolves a dedicated opaque worker bearer token", async () => {
    let observed = "";
    const verifier: WorkerCredentialVerifier = {
      authenticateCredential: async (token) => {
        observed = token;
        return credential;
      },
    };
    const token = "a".repeat(43);
    await expect(
      verifyWorkerCredential(`Bearer ${token}`, verifier),
    ).resolves.toEqual(credential);
    expect(observed).toBe(token);
  });

  it("rejects human JWTs, malformed headers, and unknown credentials alike", async () => {
    const verifier: WorkerCredentialVerifier = {
      authenticateCredential: async () => null,
    };
    for (const authorization of [
      undefined,
      "Basic abc",
      "Bearer human.jwt.value",
      `Bearer ${"a".repeat(43)}`,
    ]) {
      await expect(
        verifyWorkerCredential(authorization, verifier),
      ).rejects.toEqual(
        new AuthenticationError("A valid worker bearer credential is required"),
      );
    }
  });
});
