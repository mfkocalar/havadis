import path from "node:path";

/** The only reader of HAVADIS_DATA_DIR and HAVADIS_BACKUP_DIR. */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.HAVADIS_DATA_DIR?.trim();
  return value ? value : "./data";
}

export function backupDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.HAVADIS_BACKUP_DIR?.trim();
  return value ? value : "./backups";
}

export function dbFile(dir: string): string {
  return path.join(dir, "havadis.db");
}
