import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthenticatedIdentity {
  authUserId: string;
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
        return { authUserId: payload.sub };
      } catch (error) {
        if (error instanceof AuthenticationError) throw error;
        throw new AuthenticationError("The bearer token is invalid");
      }
    },
  };
}
