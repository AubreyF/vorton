import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthenticatedIdentity {
  authUserId: string;
  aal: "aal1" | "aal2";
  authTime: number;
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

export function requireRecentAal2(
  identity: AuthenticatedIdentity,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (
    identity.aal !== "aal2" ||
    !Number.isInteger(identity.authTime) ||
    identity.authTime > nowSeconds + 60 ||
    nowSeconds - identity.authTime > recentAal2MaxAgeSeconds
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
          typeof payload.auth_time !== "number" ||
          !Number.isInteger(payload.auth_time)
        ) {
          throw new AuthenticationError(
            "The verified token must include AAL and authentication time claims",
          );
        }
        return {
          authUserId: payload.sub,
          aal: payload.aal,
          authTime: payload.auth_time,
        };
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError("The bearer token is invalid");
      }
    },
  };
}
