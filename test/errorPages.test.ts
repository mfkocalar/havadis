import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Source scan of the three shell pages (UX-01, UX-02; D-13, D-14, D-15). A
 * throwing route cannot exist in a static site, so what keeps the thrown value
 * away from the reader is that neither error file ever reads it: both
 * destructure only retry. The scratch production proof (22-05 Task 3) checks
 * the rendered result; this scan pins the source. Hermetic: reads three files.
 */

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), "src/app", file), "utf8");
}

const ERROR = read("error.tsx");
const GLOBAL_ERROR = read("global-error.tsx");
const NOT_FOUND = read("not-found.tsx");

const SYSTEM_FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const ERROR_PAGES: Array<[string, string, string]> = [
  ["error.tsx", ERROR, "This page could not be shown. Trying again often fixes it."],
  ["global-error.tsx", GLOBAL_ERROR, "Havadis could not load. Try again in a moment."],
];

for (const [name, src, body] of ERROR_PAGES) {
  test(`${name} is a client component with the fixed copy and a retry() button`, () => {
    assert.ok(src.startsWith('"use client";'), "the first statement is the client directive");
    assert.ok(src.includes("Something went wrong"));
    assert.ok(src.includes(body));
    assert.ok(src.includes("Try again"));
    assert.ok(src.includes("retry()"));
    assert.ok(src.includes('role="alert"'));
    assert.equal(count(src, "<h1"), 1, "exactly one h1");
  });

  test(`${name} never reads, logs or resets with the thrown value`, () => {
    assert.ok(!/\.(message|digest|stack)\b/.test(src), "no property access on the thrown value");
    assert.ok(!src.includes("console."), "no console call");
    assert.ok(!src.includes("reset("), "retry() is the only recovery action");
  });
}

test("error.tsx links home with a plain anchor and offers no other route", () => {
  assert.ok(ERROR.includes('href="/"'));
  assert.ok(ERROR.includes("Back to the front page"));
  assert.ok(!/import[^;]*next\/link/.test(ERROR), "a plain anchor, not next/link");
});

test("global-error.tsx owns html and body and depends on nothing from the layout", () => {
  assert.ok(GLOBAL_ERROR.includes('lang="en"'));
  assert.ok(GLOBAL_ERROR.includes("<html") && GLOBAL_ERROR.includes("<body"));
  assert.ok(GLOBAL_ERROR.includes("Something went wrong · Havadis"));
  assert.ok(GLOBAL_ERROR.includes("prefers-color-scheme: dark"));
  assert.ok(GLOBAL_ERROR.includes(SYSTEM_FONT_STACK));
  assert.ok(!GLOBAL_ERROR.includes("className"), "no Tailwind class attributes");
  assert.ok(!GLOBAL_ERROR.includes("export const metadata"), "metadata is unsupported here");
  assert.ok(!GLOBAL_ERROR.includes("Back to the front page"), "the layout failed: retry() only");
});

test("not-found.tsx is a static server component with the exact copy", () => {
  assert.ok(!NOT_FOUND.includes("use client"));
  assert.ok(NOT_FOUND.includes("404"));
  assert.ok(NOT_FOUND.includes("Page not found"));
  assert.ok(
    NOT_FOUND.includes(
      "This address does not lead anywhere on Havadis. The front page has today's security news."
    )
  );
  assert.ok(NOT_FOUND.includes("Back to the front page"));
  assert.ok(NOT_FOUND.includes("This page does not exist. Go back to the Havadis front page."));
  assert.ok(/import Link from "next\/link"/.test(NOT_FOUND));
  for (const forbidden of ["params", "searchParams", "headers(", "cookies(", "usePathname"]) {
    assert.ok(!NOT_FOUND.includes(forbidden), `no ${forbidden}: the path is never read`);
  }
});

for (const [name, src] of [
  ["error.tsx", ERROR],
  ["global-error.tsx", GLOBAL_ERROR],
  ["not-found.tsx", NOT_FOUND],
] as const) {
  test(`${name} carries nothing of the rejected look`, () => {
    for (const banned of ["font-display", "uppercase", "tracking-", "accent", "orange-", "yellow-"]) {
      assert.ok(!src.includes(banned), `${name} must not contain ${banned}`);
    }
  });
}
