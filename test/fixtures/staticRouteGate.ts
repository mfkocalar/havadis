// RED skeleton: signatures only, no behaviour yet.
export type PrerenderManifest = {
  routes: Record<string, { initialRevalidateSeconds?: number | false; compute?: string }>;
};
export type SourceStamp = { path: string; mtimeMs: number };

export function assertStaticRoute(
  _manifest: PrerenderManifest,
  _route: string,
  _seconds: number | false
): void {}

export function findStaleSources(_buildMtimeMs: number, _files: SourceStamp[]): string[] {
  return [];
}
