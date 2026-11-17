import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FIXTURE_GUARD_MESSAGE,
  FIXTURE_KEY_SUFFIX,
  fixtureCacheKey,
  fixtureEditionEnabled,
} from "./fixtureMode.ts";

/**
 * Table test of the fixture switch's allow-list guard (D-02, MOB-01). Every case
 * passes its own env object, so process.env is never mutated here.
 */

// Not NodeJS.ProcessEnv: next/types makes NODE_ENV required there, which fails the build type-check.
type Env = Record<string, string | undefined>;

const SWITCH = "HAVADIS_FIXTURE_EDITION";
const LOCAL = "HAVADIS_FIXTURE_LOCAL";

const allowed: Array<[string, Env]> = [
  ["switch 1 with GITHUB_ACTIONS true", { [SWITCH]: "1", GITHUB_ACTIONS: "true" }],
  ["switch 1 with HAVADIS_FIXTURE_LOCAL 1", { [SWITCH]: "1", [LOCAL]: "1" }],
  [
    "an unrelated VERCEL_ variable beside the local opt-in (no prefix matching)",
    { [SWITCH]: "1", [LOCAL]: "1", VERCEL_PLUGIN_BOOTSTRAP_HINTS: "x" },
  ],
];

const off: Array<[string, Env]> = [
  ["switch unset", {}],
  ["switch 0", { [SWITCH]: "0" }],
  ["switch true", { [SWITCH]: "true" }],
];

const throwing: Array<[string, Env]> = [
  ["switch alone", { [SWITCH]: "1" }],
  ["CI 1", { [SWITCH]: "1", CI: "1" }],
  ["VERCEL 1", { [SWITCH]: "1", VERCEL: "1" }],
  ["VERCEL_ENV production", { [SWITCH]: "1", VERCEL_ENV: "production" }],
  ["VERCEL_ENV production with CI 1", { [SWITCH]: "1", VERCEL_ENV: "production", CI: "1" }],
  ["GITHUB_ACTIONS false", { [SWITCH]: "1", GITHUB_ACTIONS: "false" }],
  ["GITHUB_ACTIONS 1 (not exact)", { [SWITCH]: "1", GITHUB_ACTIONS: "1" }],
  ["HAVADIS_FIXTURE_LOCAL true (not exact)", { [SWITCH]: "1", [LOCAL]: "true" }],
  ["HAVADIS_FIXTURE_LOCAL 0", { [SWITCH]: "1", [LOCAL]: "0" }],
];

for (const [name, env] of off) {
  test(`fixtureEditionEnabled is false: ${name}`, () => {
    assert.equal(fixtureEditionEnabled(env), false);
  });
}

for (const [name, env] of allowed) {
  test(`fixtureEditionEnabled is true: ${name}`, () => {
    assert.equal(fixtureEditionEnabled(env), true);
  });
}

for (const [name, env] of throwing) {
  test(`fixtureEditionEnabled throws the guard message: ${name}`, () => {
    assert.throws(
      () => fixtureEditionEnabled(env),
      (err: unknown) => err instanceof Error && err.message === FIXTURE_GUARD_MESSAGE,
    );
  });
}

test("the guard message is fixed text and names no environment value", () => {
  assert.equal(
    FIXTURE_GUARD_MESSAGE,
    "HAVADIS_FIXTURE_EDITION=1 is honoured only in GitHub Actions or with HAVADIS_FIXTURE_LOCAL=1 from the local npm scripts",
  );
});

test("fixtureCacheKey is unchanged when off, suffixed when allowed, and throws when disallowed", () => {
  assert.equal(fixtureCacheKey("edition-v1", {}), "edition-v1");
  assert.equal(fixtureCacheKey("edition-v1", { [SWITCH]: "0" }), "edition-v1");
  assert.equal(FIXTURE_KEY_SUFFIX, "-fixture");
  assert.equal(fixtureCacheKey("edition-v1", { [SWITCH]: "1", GITHUB_ACTIONS: "true" }), "edition-v1-fixture");
  assert.equal(fixtureCacheKey("edition-v1", { [SWITCH]: "1", [LOCAL]: "1" }), "edition-v1-fixture");
  assert.throws(() => fixtureCacheKey("edition-v1", { [SWITCH]: "1", CI: "1" }), {
    message: FIXTURE_GUARD_MESSAGE,
  });
});

test("HAVADIS_FIXTURE_EDITION is not set in the npm test process", () => {
  // Assumes node:test runs each test file in its own child process (the default
  // --test isolation), so noUpstream.test.ts, which sets the switch inside its
  // own process, cannot leak it into this one.
  assert.notEqual(
    process.env.HAVADIS_FIXTURE_EDITION,
    "1",
    "HAVADIS_FIXTURE_EDITION=1 must never be set for the whole npm test process: the switch belongs on the build step and the viewport job only",
  );
});

test("snapshot.ts routes both cache seams through fixtureCacheKey exactly twice", () => {
  const text = readFileSync(new URL("../snapshot.ts", import.meta.url), "utf8");
  assert.equal(text.split("[fixtureCacheKey(key)]").length - 1, 2);
});
