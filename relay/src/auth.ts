import jwt, { type SignOptions } from "jsonwebtoken";

const secret = process.env.JWT_SECRET ?? "dev-secret-change-me";

export type TokenClaims = {
  sub: string;
  role: "mobile" | "agent";
  agentId?: string;
  deviceId?: string;
};

export function signToken(claims: TokenClaims, expiresIn: SignOptions["expiresIn"] = "30d") {
  return jwt.sign(claims, secret, { expiresIn });
}

export function verifyToken(token: string): TokenClaims {
  return jwt.verify(token, secret) as TokenClaims;
}
