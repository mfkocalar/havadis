import { test } from "node:test";
import assert from "node:assert/strict";
import { siteUrl as siteUrlOf } from "./site.ts";

/**
 * Table test of the Vercel production guard (D-18). Env objects are passed
 * in; process.env is never mutated.
 */

// Next's types make NODE_ENV required on ProcessEnv; the guard reads neither.
const siteUrl = (env: Record<string, string>) => siteUrlOf(env as NodeJS.ProcessEnv);

const GUARD_MESSAGE = "SITE_URL must be set for a Vercel production build";

test("production with a set SITE_URL returns it trimmed without trailing slashes", () => {
  assert.equal(
    siteUrl({ VERCEL_ENV: "production", SITE_URL: "https://havadis-news.vercel.app/" }),
    "https://havadis-news.vercel.app",
  );
  assert.equal(
    siteUrl({ VERCEL_ENV: "production", SITE_URL: "  https://havadis-news.vercel.app//  " }),
    "https://havadis-news.vercel.app",
  );
});

test("production with an empty or blank SITE_URL throws the fixed message", () => {
  for (const SITE_URL of ["", "   "]) {
    assert.throws(
      () => siteUrl({ VERCEL_ENV: "production", SITE_URL }),
      { message: GUARD_MESSAGE },
    );
  }
});

test("production with SITE_URL unset throws the fixed message", () => {
  assert.throws(() => siteUrl({ VERCEL_ENV: "production" }), {
    message: GUARD_MESSAGE,
  });
});

test("preview with an empty SITE_URL falls back to localhost", () => {
  assert.equal(siteUrl({ VERCEL_ENV: "preview", SITE_URL: "" }), "http://localhost:4000");
});

test("no VERCEL_ENV with an empty SITE_URL falls back to localhost", () => {
  assert.equal(siteUrl({ SITE_URL: "" }), "http://localhost:4000");
  assert.equal(siteUrl({}), "http://localhost:4000");
});

test("the thrown message is fixed text and contains no env value passed in", () => {
  const env = {
    VERCEL_ENV: "production",
    SITE_URL: "   ",
    VERCEL_URL: "secret-deploy-host.example",
    TOKEN: "s3cr3t-value",
  };
  assert.throws(
    () => siteUrl(env),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, GUARD_MESSAGE);
      assert.ok(!err.message.includes(env.VERCEL_URL));
      assert.ok(!err.message.includes(env.TOKEN));
      return true;
    },
  );
});
