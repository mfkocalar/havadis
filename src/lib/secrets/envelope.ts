import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { Secret } from "./secret.ts";

/** Why open() refused an envelope. The code is the only detail an error carries. */
export type EnvelopeErrorCode = "envelope_version" | "envelope_format" | "envelope_auth";

const MESSAGES: Record<EnvelopeErrorCode, string> = {
  envelope_version: "Unsupported envelope version.",
  envelope_format: "Malformed envelope.",
  envelope_auth: "Envelope authentication failed.",
};

/** Thrown by open(). The message is fixed text: never plaintext, key material or envelope content. */
export class EnvelopeError extends Error {
  readonly code: EnvelopeErrorCode;

  constructor(code: EnvelopeErrorCode) {
    super(MESSAGES[code]);
    this.name = "EnvelopeError";
    this.code = code;
  }
}

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
/** HKDF info string: binds the subkey to this construction and version (RESEARCH A5). */
const HKDF_INFO = "havadis/secrets/v1";
const SUBKEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function subkeyFor(key: Secret): Buffer {
  const ikm = Buffer.from(key.reveal(), "base64");
  return Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), HKDF_INFO, SUBKEY_BYTES));
}

/** Canonical unpadded base64url: decodes to bytes of the expected length and re-encodes to the same text. */
function decodePart(part: string, expectedBytes: number | null): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) throw new EnvelopeError("envelope_format");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new EnvelopeError("envelope_format");
  if (expectedBytes !== null && bytes.length !== expectedBytes) throw new EnvelopeError("envelope_format");
  return bytes;
}

/**
 * Encrypts `plaintext` under a subkey derived from the operator key with
 * AES-256-GCM, a random 12-byte IV and the purpose string as AAD. The result is
 * "v1:" + base64url(iv) + ":" + base64url(tag) + ":" + base64url(ciphertext).
 * No consumer exists in Phase 14; Phase 15 stores the OIDC client secret here.
 */
export function seal(key: Secret, purpose: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, subkeyFor(key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

/** Reverses seal(). Throws EnvelopeError for an unknown version, a malformed envelope, or a failed authentication. */
export function open(key: Secret, purpose: string, envelope: string): string {
  const parts = envelope.split(":");
  const version = parts[0] ?? "";
  if (version !== VERSION) {
    throw new EnvelopeError(/^v\d+$/.test(version) ? "envelope_version" : "envelope_format");
  }
  if (parts.length !== 4) throw new EnvelopeError("envelope_format");
  const iv = decodePart(parts[1]!, IV_BYTES);
  const tag = decodePart(parts[2]!, TAG_BYTES);
  const ciphertext = decodePart(parts[3]!, null);

  try {
    const decipher = createDecipheriv(ALGORITHM, subkeyFor(key), iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new EnvelopeError("envelope_auth");
  }
}
