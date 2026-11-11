import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HAVADIS_VERSION } from "./version.ts";

test("HAVADIS_VERSION equals the version field read from package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8")) as {
    version: string;
  };
  assert.equal(HAVADIS_VERSION, pkg.version);
});
