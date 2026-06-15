import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const LENS_OAUTH_NONCE_COOKIE_NAME = "cmo_lens_google_oauth_nonce";
export const LENS_OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface LensOAuthStatePayload {
  tenant_id?: string;
  workspace_id?: string;
  app_id?: string;
  return_to?: string;
  nonce?: string;
  expires_at?: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

function getLensOAuthStateSecret(): string {
  const secret = envValue("LENS_OAUTH_STATE_SECRET");

  if (!secret) {
    throw new Error("Missing Lens OAuth state env: LENS_OAUTH_STATE_SECRET");
  }

  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Invalid Lens OAuth state secret: LENS_OAUTH_STATE_SECRET must be at least 32 bytes");
  }

  return secret;
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getLensOAuthStateSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createLensOAuthNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function createLensOAuthState(payload: LensOAuthStatePayload): string {
  const expiresAt = payload.expires_at ?? new Date(Date.now() + LENS_OAUTH_STATE_TTL_SECONDS * 1000).toISOString();
  const encodedPayload = Buffer.from(
    JSON.stringify({
      ...payload,
      expires_at: expiresAt,
    }),
    "utf8",
  ).toString("base64url");

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyLensOAuthState(state: string): Required<Pick<LensOAuthStatePayload, "expires_at">> & LensOAuthStatePayload {
  const [encodedPayload, signature] = state.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid Lens OAuth state");
  }

  if (!safeEqual(signPayload(encodedPayload), signature)) {
    throw new Error("Invalid Lens OAuth state signature");
  }

  let payload: LensOAuthStatePayload;

  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as LensOAuthStatePayload;
  } catch {
    throw new Error("Invalid Lens OAuth state payload");
  }

  if (!payload.expires_at || Number.isNaN(Date.parse(payload.expires_at))) {
    throw new Error("Invalid Lens OAuth state expiry");
  }

  if (Date.parse(payload.expires_at) <= Date.now()) {
    throw new Error("Expired Lens OAuth state");
  }

  return payload as Required<Pick<LensOAuthStatePayload, "expires_at">> & LensOAuthStatePayload;
}
