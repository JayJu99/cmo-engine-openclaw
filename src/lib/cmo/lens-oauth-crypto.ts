import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTED_TOKEN_VERSION = "v1";

function envValue(name: string): string {
  return (process.env[name] ?? "").trim();
}

function decodeEncryptionKey(configured: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(configured)) {
    return Buffer.from(configured, "hex");
  }

  const base64Candidate = configured.replaceAll("-", "+").replaceAll("_", "/");
  const base64Padding = "=".repeat((4 - (base64Candidate.length % 4)) % 4);
  const decoded = Buffer.from(`${base64Candidate}${base64Padding}`, "base64");

  if (decoded.length === 32) {
    return decoded;
  }

  return Buffer.from(configured, "utf8");
}

function getLensOAuthEncryptionKey(): Buffer {
  const configured = envValue("LENS_OAUTH_TOKEN_ENCRYPTION_KEY");

  if (!configured) {
    throw new Error("Missing Lens OAuth token encryption env: LENS_OAUTH_TOKEN_ENCRYPTION_KEY");
  }

  const key = decodeEncryptionKey(configured);

  if (key.length !== 32) {
    throw new Error("Invalid Lens OAuth token encryption key: LENS_OAUTH_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }

  return key;
}

export function encryptLensOAuthToken(plainText: string): string {
  if (!plainText) {
    throw new Error("Cannot encrypt an empty Lens OAuth token");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getLensOAuthEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTED_TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptLensOAuthToken(encrypted: string): string {
  const [version, ivText, tagText, ciphertextText] = encrypted.split(":");

  if (version !== ENCRYPTED_TOKEN_VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Invalid Lens OAuth encrypted token payload");
  }

  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getLensOAuthEncryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
