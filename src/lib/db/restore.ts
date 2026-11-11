export type RestoreRefusal =
  | "db_in_use"
  | "outside_backups"
  | "not_regular_file"
  | "not_found"
  | "integrity_failed"
  | "backup_newer_than_image"
  | "pre_restore_exists"
  | "live_unreadable";

export class RestoreRefused extends Error {
  readonly code: RestoreRefusal;

  constructor(code: RestoreRefusal, message: string) {
    super(message);
    this.name = "RestoreRefused";
    this.code = code;
  }
}

export async function assertNoOtherHolder(_dataFile: string): Promise<void> {
  throw new Error("not implemented");
}

export async function restoreDatabase(_opts: {
  file: string;
  dataFile: string;
  backupsDir: string;
  latest?: number;
}): Promise<{ restoredFrom: string; preRestore: string | null }> {
  throw new Error("not implemented");
}
