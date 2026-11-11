/**
 * Runs once when a server instance starts, before it serves requests (D-06, D-11). Only the Node runtime
 * has the filesystem and the database, so the guard is imported there and nowhere else. `next build`
 * does not call register, so building needs neither a key nor a database.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertWebStartup } = await import("./lib/webStartup.ts");
  await assertWebStartup();
}
