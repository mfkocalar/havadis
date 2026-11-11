import type { DbHandle } from "./openDb.ts";

export const BACKUP_CHOWN_HINT = "mkdir -p backups && sudo chown 65532:65532 backups (or use a named volume for /backups)";

export function assertBackupDirWritable(_dir: string): { ok: true } | { ok: false; message: string } {
  return { ok: true };
}

export async function backupDatabase(_handle: DbHandle, _dir: string, _now: number, _label: string): Promise<string> {
  throw new Error("not implemented");
}
