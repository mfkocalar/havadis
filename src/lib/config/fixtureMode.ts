/**
 * The one fail-closed switch that puts the build's data behind committed
 * fixtures (Phase 22, D-01, D-02, D-04). With `HAVADIS_FIXTURE_EDITION=1` the
 * edition, KEV, EPSS and SSVC producers read `src/lib/fixture/` instead of the
 * network, so a CI build needs no upstream and the viewport check measures
 * stable content.
 *
 * Allow-list, not deny-list. The switch is honoured only when
 * `GITHUB_ACTIONS` is exactly "true" (the CI runner) or `HAVADIS_FIXTURE_LOCAL`
 * is exactly "1" (set only by the `build:fixture` npm script). Every other
 * environment that carries the switch throws `FIXTURE_GUARD_MESSAGE`. There is
 * no deny-list because none is reliable: Vercel sets `CI=1`, its `VERCEL_*`
 * system variables are optional, and developer shells export unrelated
 * `VERCEL_*` names. So this file never reads `CI`, `NODE_ENV` or a `VERCEL`
 * variable, and never matches a variable name by prefix.
 *
 * The switch must only ever be set on a build step or the viewport job, never
 * for the whole `npm test` process: the unit tests rely on the guard staying
 * off.
 *
 * Imports nothing, so it loads under `node --test`, in `next.config.ts` and in
 * server code alike.
 */

/** The environment variable that turns the fixture edition on. */
export const FIXTURE_SWITCH = "HAVADIS_FIXTURE_EDITION";

/** The local opt-in; only the `build:fixture` npm script sets it. */
export const FIXTURE_LOCAL_OPT_IN = "HAVADIS_FIXTURE_LOCAL";

/** Appended to every cache key in fixture mode, so a fixture entry never sits under a live key. */
export const FIXTURE_KEY_SUFFIX = "-fixture";

/** Fixed text of the guard error; never an environment value. */
export const FIXTURE_GUARD_MESSAGE =
  "HAVADIS_FIXTURE_EDITION=1 is honoured only in GitHub Actions or with HAVADIS_FIXTURE_LOCAL=1 from the local npm scripts";

/**
 * False unless `HAVADIS_FIXTURE_EDITION` is exactly "1". When it is, true only
 * in an allowed environment; otherwise throws `FIXTURE_GUARD_MESSAGE`.
 */
export function fixtureEditionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[FIXTURE_SWITCH] !== "1") return false;
  if (env.GITHUB_ACTIONS === "true" || env[FIXTURE_LOCAL_OPT_IN] === "1") return true;
  throw new Error(FIXTURE_GUARD_MESSAGE);
}

/**
 * `key` plus `FIXTURE_KEY_SUFFIX` in fixture mode, `key` unchanged otherwise.
 * A disallowed switch throws here too, through `fixtureEditionEnabled`.
 */
export function fixtureCacheKey(key: string, env: NodeJS.ProcessEnv = process.env): string {
  return fixtureEditionEnabled(env) ? key + FIXTURE_KEY_SUFFIX : key;
}
