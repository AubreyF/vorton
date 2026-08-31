import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthenticatedIdentity {
  authUserId: string;
  aal: "aal1" | "aal2";
  authTime: number | undefined;
}

export interface IdentityVerifier {
  verify(authorization: string | undefined): Promise<AuthenticatedIdentity>;
}

export interface SupabaseJwtConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthenticationError extends Error {}
export class StepUpAuthenticationError extends Error {}

export const recentAal2MaxAgeSeconds = 10 * 60;
const explicitSecondFactorMethods = new Set([
  "totp",
  "mfa/totp",
  "mfa/phone",
  "mfa/webauthn",
]);

function explicitSecondFactorTime(amr: unknown): number | undefined {
  if (!Array.isArray(amr)) return undefined;
  let latest: number | undefined;
  for (const entry of amr) {
    if (!entry || typeof entry !== "object") continue;
    const method = Reflect.get(entry, "method");
    const timestamp = Reflect.get(entry, "timestamp");
    if (
      typeof method === "string" &&
      explicitSecondFactorMethods.has(method) &&
      typeof timestamp === "number" &&
      Number.isInteger(timestamp) &&
      (latest === undefined || timestamp > latest)
    ) {
      latest = timestamp;
    }
  }
  return latest;
}

export function requireRecentAal2(
  identity: AuthenticatedIdentity,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  const authTime = identity.authTime;
  if (
    identity.aal !== "aal2" ||
    authTime === undefined ||
    !Number.isInteger(authTime) ||
    authTime > nowSeconds + 60 ||
    nowSeconds - authTime > recentAal2MaxAgeSeconds
  ) {
    throw new StepUpAuthenticationError(
      "Recent AAL2 step-up authentication is required for this action",
    );
  }
}

export function createSupabaseIdentityVerifier(
  config: SupabaseJwtConfig,
): IdentityVerifier {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
  return {
    async verify(authorization) {
      const match = authorization?.match(/^Bearer ([^\s]+)$/);
      if (!match?.[1])
        throw new AuthenticationError("A bearer token is required");
      try {
        const { payload } = await jwtVerify(match[1], jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["ES256", "RS256"],
        });
        if (typeof payload.sub !== "string" || !uuidPattern.test(payload.sub)) {
          throw new AuthenticationError(
            "The verified token subject must be a UUID",
          );
        }
        if (
          (payload.aal !== "aal1" && payload.aal !== "aal2") ||
          payload.role !== "authenticated" ||
          payload.is_anonymous !== false ||
          typeof payload.session_id !== "string" ||
          !uuidPattern.test(payload.session_id)
        ) {
          throw new AuthenticationError(
            "The verified token must identify an authenticated Supabase session",
          );
        }
        return {
          authUserId: payload.sub,
          aal: payload.aal,
          authTime: explicitSecondFactorTime(payload.amr),
        };
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError("The bearer token is invalid");
      }
    },
  };
}
