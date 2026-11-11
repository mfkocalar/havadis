/**
 * The crawler's version, sent in the User-Agent (SAFE-03). Pinned to the `version` field of
 * package.json by src/lib/config/version.test.ts, so a release bump that forgets this line fails
 * the test run instead of shipping a stale identity.
 */
export const HAVADIS_VERSION = "2.0.0-dev";
