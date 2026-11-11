import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Secret } from "./secret.ts";

/** The one-line key-generation command every refusal message names (D-06). */
export const KEYGEN_COMMAND = "openssl rand -base64 32";

/** Length of the operator key in bytes: AES-256 input keying material. */
const KEY_BYTES = 32;

/** Never-throws result of loading the operator key. Messages are fixed text that name variables, never values. */
export type KeyLoad =
  | { ok: true; key: Secret }
  | {
      ok: false;
      code: "key_missing" | "key_conflict" | "key_malformed" | "key_file_unreadable";
      message: string;
    };

const HOW_TO_GENERATE = `Generate one with: ${KEYGEN_COMMAND} (or: docker compose run --rm migrate havadis keygen)`;

const MESSAGES = {
  key_missing: `HAVADIS_SECRET_KEY or HAVADIS_SECRET_KEY_FILE must hold a base64-encoded 32-byte key. ${HOW_TO_GENERATE}`,
  key_conflict: `HAVADIS_SECRET_KEY and HAVADIS_SECRET_KEY_FILE are both set; set exactly one. ${HOW_TO_GENERATE}`,
  key_malformed: `The key in HAVADIS_SECRET_KEY or HAVADIS_SECRET_KEY_FILE is not base64 of exactly 32 bytes. ${HOW_TO_GENERATE}`,
  key_file_unreadable: `HAVADIS_SECRET_KEY_FILE is set but the file could not be read. Check the path and its permissions, or use HAVADIS_SECRET_KEY instead. ${HOW_TO_GENERATE}`,
} as const;

function refuse(code: keyof typeof MESSAGES): KeyLoad {
  return { ok: false, code, message: MESSAGES[code] };
}

/** Strict standard-alphabet base64 with padding; the decode must round-trip so no stray trailing bits pass. */
function decodesToKey(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64");
  return bytes.length === KEY_BYTES && bytes.toString("base64") === value;
}

/**
 * Loads the operator key from HAVADIS_SECRET_KEY or, as a file path, from
 * HAVADIS_SECRET_KEY_FILE. Exactly one must be non-empty. The key is never
 * generated implicitly and never written anywhere by this module (D-06).
 * `readFile` is a seam so tests never touch the real filesystem.
 */
export function loadOperatorKey(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): KeyLoad {
  const direct = (env.HAVADIS_SECRET_KEY ?? "").trim();
  const filePath = (env.HAVADIS_SECRET_KEY_FILE ?? "").trim();
  if (direct === "" && filePath === "") return refuse("key_missing");
  if (direct !== "" && filePath !== "") return refuse("key_conflict");

  let value = direct;
  if (filePath !== "") {
    try {
      value = readFile(filePath).trim();
    } catch {
      return refuse("key_file_unreadable");
    }
  }
  if (!decodesToKey(value)) return refuse("key_malformed");
  return { ok: true, key: new Secret(value) };
}

/** A fresh random key in the format loadOperatorKey accepts. Called only by the explicit keygen command. */
export function generateKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}
