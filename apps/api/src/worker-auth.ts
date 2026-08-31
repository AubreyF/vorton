import type { AuthenticatedWorkerCredential } from "@vorton/kernel";

import { AuthenticationError } from "./auth.js";

export interface WorkerCredentialVerifier {
  authenticateCredential(
    token: string,
  ): Promise<AuthenticatedWorkerCredential | null>;
}

const workerTokenPattern = /^[A-Za-z0-9_-]{32,256}$/;

/**
 * Worker tokens are deliberately separate from human Supabase sessions. The
 * later SQL transaction rechecks the credential and every authority row live.
 */
export async function verifyWorkerCredential(
  authorization: string | undefined,
  verifier: WorkerCredentialVerifier,
): Promise<AuthenticatedWorkerCredential> {
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];
  if (!token || !workerTokenPattern.test(token)) {
    throw new AuthenticationError(
      "A valid worker bearer credential is required",
    );
  }
  const credential = await verifier.authenticateCredential(token);
  if (!credential?.credentialId) {
    throw new AuthenticationError(
      "A valid worker bearer credential is required",
    );
  }
  return credential;
}
