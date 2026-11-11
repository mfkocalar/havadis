import type { DbHandle } from "./db/openDb.ts";
import type { LogEvent, LogFields, LogLevel } from "./log/logger.ts";

/** Skeleton so the tests compile and fail on their assertions; replaced by the real guard in the GREEN commit. */
export type WebStartupDeps = {
  env?: NodeJS.ProcessEnv;
  exit?: (code: number) => never;
  log?: { log(level: LogLevel, event: LogEvent, fields?: LogFields): void };
  stderr?: (text: string) => void;
  open?: () => DbHandle;
};

export async function assertWebStartup(deps: WebStartupDeps = {}): Promise<void> {
  void deps;
}
