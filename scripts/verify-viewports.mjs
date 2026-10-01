/**
 * UI-05 tier 2: emulated real-width verification of the production build.
 *
 * Runs the Verification Contract from 04-UI-SPEC.md against `next start` in
 * Chromium at six widths (360, 390, 768, 1024, 1280, 1440) and prints one
 * PASS / FAIL / SKIP line per check. Checks: no sideways scroll, grid column
 * counts (D-02), the self-contained pill scroller (D-11), tap-target sizes,
 * sticky-bar height and pinning, focus never hidden under the bar (WCAG 2.2
 * SC 2.4.11), relative "Updated" text after hydration (D-13), zero network
 * requests while filtering and expanding (FILTER-01), and a clean console.
 *
 * Playwright is AD HOC. It is never a dependency of this project and must
 * never appear in package.json or package-lock.json:
 *
 *     npm install --no-save playwright@1.63.0
 *
 * (If Chromium is reported missing: `npx playwright install chromium`.)
 *
 * This file lives in scripts/, not test/, on purpose: Node's default
 * `node --test` glob runs every .js / .mjs / .ts file under any test/
 * directory, so a file there would be executed by `npm test`.
 *
 * Usage:
 *     npm run build && node scripts/verify-viewports.mjs
 *
 * Environment: VIEWPORT_PORT overrides the port (default 3200). The server
 * binds 127.0.0.1 only.
 *
 * Exit codes: 0 everything passed (prints VIEWPORTS_OK), 1 at least one check
 * failed (prints VIEWPORTS_FAILED <count>), 2 Playwright is not installed.
 *
 * focus-not-obscured moves focus with the locator's focus() method (the
 * programmatic path was reliable in Chromium 153; no Shift+Tab fallback
 * was needed).
 *
 * A failing check is a defect in the page: fix the page, never the check.
 */

import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = Number(process.env.VIEWPORT_PORT ?? 3200);
const BASE_URL = `http://127.0.0.1:${PORT}/`;
const READY_TIMEOUT_MS = 30_000;
const SECTION_SEL = "section[data-section]";
const BAR_SEL = "[data-filter-bar]";
const PILL_SEL = "button[data-filter-pill]";
const EXPANDER_SEL = "button[data-expander]";
const UPDATED_RE = /^Updated (just now|\d+m ago|\d+h ago)$/;

const MOBILE = { deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const CONFIGS = [
  { name: "mobile-360", width: 360, height: 800, ...MOBILE },
  { name: "mobile-390", width: 390, height: 844, ...MOBILE },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1024", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const SCREENSHOT_CONFIGS = new Set(["mobile-360", "desktop-1024", "desktop-1280"]);

let failures = 0;
const pass = (cfg, check) => console.log(`PASS ${cfg} ${check}`);
const skip = (cfg, check, why) => console.log(`SKIP ${cfg} ${check}: ${why}`);
const fail = (cfg, check, detail) => {
  failures += 1;
  console.log(`FAIL ${cfg} ${check}: ${detail}`);
};

/** Runs one check; a thrown error is a FAIL. `fn` returns null for pass, a string for fail. */
async function check(cfg, name, fn) {
  try {
    const detail = await fn();
    if (detail === null || detail === undefined) pass(cfg, name);
    else fail(cfg, name, detail);
  } catch (err) {
    fail(cfg, name, `threw ${err instanceof Error ? err.message : String(err)}`);
  }
}

let playwright;
try {
  playwright = await import("playwright");
} catch {
  console.error(
    "Playwright is not installed. Install it ad hoc (never as a dependency):\n" +
      "    npm install --no-save playwright@1.63.0",
  );
  process.exit(2);
}
const chromium = playwright.chromium ?? playwright.default?.chromium;

let server = null;
let stderrLog = "";

function stopServer() {
  if (server) {
    server.kill();
    server = null;
  }
}
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

async function startServer() {
  const nextBin = path.join(process.cwd(), "node_modules", ".bin", "next");
  server = spawn(nextBin, ["start", "-H", "127.0.0.1", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env },
  });
  server.stderr?.on("data", (chunk) => {
    stderrLog += chunk.toString();
  });
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
      await res.body?.cancel();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `Production server never answered on ${BASE_URL} within ${READY_TIMEOUT_MS}ms.\n` +
      `Captured stderr:\n${stderrLog}`,
  );
}

/** Per-section wrapper hidden flags, in document order. */
const wrapperHiddenFlags = (page) =>
  page.$$eval(SECTION_SEL, (els) => els.map((el) => el.parentElement.hasAttribute("hidden")));

const pillPressedFlags = (page) =>
  page.$$eval(PILL_SEL, (els) => els.map((el) => el.getAttribute("aria-pressed")));

async function runConfig(browser, cfg, ctxExtra = {}) {
  const { name, width, height } = cfg;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: cfg.deviceScaleFactor ?? 1,
    isMobile: cfg.isMobile ?? false,
    hasTouch: cfg.hasTouch ?? false,
    colorScheme: "light",
    ...ctxExtra,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  const press = (locator) => (cfg.hasTouch ? locator.tap() : locator.click());

  const sectionCount = await page.locator(SECTION_SEL).count();
  if (sectionCount === 0) {
    console.log(`NOTE ${name}: EMPTY STATE on this build (no section[data-section])`);
    await check(name, "empty-state-no-bar", async () =>
      (await page.locator(BAR_SEL).count()) === 0 ? null : "filter bar rendered in the empty state",
    );
    for (const c of [
      "no-horizontal-overflow", "grid-columns", "pill-row", "tap-targets", "bar-height",
      "sticky", "focus-not-obscured", "hydrated-updated", "filter-zero-network",
      "expander-zero-network",
    ]) {
      skip(name, c, "empty state on this build");
    }
    await check(name, "console-clean", async () => (problems.length ? problems.join(" | ") : null));
    await context.close();
    return;
  }

  // a. no sideways scroll
  await check(name, "no-horizontal-overflow", async () => {
    // Mobile browsers widen the LAYOUT viewport (innerWidth) when content
    // overflows, so innerWidth alone is a vacuous reference. Compare against
    // the configured device width as well.
    const r = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    if (r.iw !== width) return `layout viewport widened to ${r.iw} (device width ${width})`;
    return r.sw <= width ? null : `scrollWidth ${r.sw} > device width ${width}`;
  });

  // a2. card text stays inside its card (an unbreakable token, such as a URL
  // in a title, must wrap instead of being clipped by line-clamp's overflow).
  await check(name, "card-text-contained", async () => {
    const bad = await page.$$eval("article h3, article p", (els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.tagName} ${el.scrollWidth}>${el.clientWidth}: ${el.textContent.slice(0, 50)}`),
    );
    return bad.length ? `${bad.length} clipped: ${bad.slice(0, 3).join(" | ")}` : null;
  });

  // b. grid columns
  await check(name, "grid-columns", async () => {
    const want = width < 768 ? 1 : width < 1024 ? 2 : 3;
    const cols = await page.$$eval(SECTION_SEL, (els) =>
      els.map((el) => {
        const grid = el.querySelector(".grid");
        return grid
          ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
          : -1;
      }),
    );
    const bad = cols.filter((c) => c !== want);
    return bad.length ? `expected ${want} columns, got [${cols.join(",")}]` : null;
  });

  // c. pill row
  await check(name, "pill-row", async () => {
    const s = await page.$eval('[role="group"][aria-label="Filter by section"]', (el) => {
      const cs = getComputedStyle(el);
      return { wrap: cs.flexWrap, ox: cs.overflowX };
    });
    // UI-SPEC amendment (04-03, "768 bar: A"): scroller below 1024, wrap from
    // 1024 (the spec said 768, which makes a 133px bar at 768).
    if (width < 1024) {
      return s.wrap === "nowrap" && s.ox === "auto"
        ? null
        : `expected nowrap/auto, got ${s.wrap}/${s.ox}`;
    }
    return s.wrap === "wrap" ? null : `expected wrap, got ${s.wrap}`;
  });

  // d. tap targets
  await check(name, "tap-targets", async () => {
    const pillMin = width < 768 ? 44 : 32;
    const pills = await page.$$eval(PILL_SEL, (els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    const exps = await page.$$eval(EXPANDER_SEL, (els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    const badPills = pills.filter((h) => h < pillMin - 0.01);
    const badExps = exps.filter((h) => h < 44 - 0.01);
    if (badPills.length) return `pill heights [${pills.join(",")}] below ${pillMin}`;
    if (badExps.length) return `expander heights [${exps.join(",")}] below 44`;
    return null;
  });

  // e. bar height
  await check(name, "bar-height", async () => {
    const h = await page.$eval(BAR_SEL, (el) => el.getBoundingClientRect().height);
    return h <= 96 ? null : `bar height ${h} > 96`;
  });

  const long = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight > 400,
  );

  // f. sticky
  if (long) {
    await check(name, "sticky", async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const top = await page.$eval(BAR_SEL, (el) => el.getBoundingClientRect().top);
      return Math.abs(top) <= 1 ? null : `bar top ${top} after scrolling to mid-page`;
    });
  } else {
    skip(name, "sticky", "page not taller than viewport + 400px");
  }

  // g. focus not obscured
  if (long && sectionCount >= 2) {
    await check(name, "focus-not-obscured", async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const link = page.locator(SECTION_SEL).nth(1).locator("article a").first();
      await link.focus();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      const r = await page.evaluate(
        ([barSel]) => ({
          linkTop: document.activeElement?.getBoundingClientRect().top ?? NaN,
          barBottom: document.querySelector(barSel).getBoundingClientRect().bottom,
        }),
        [BAR_SEL],
      );
      return r.linkTop >= r.barBottom - 1
        ? null
        : `focused link top ${r.linkTop} is under the bar (bottom ${r.barBottom})`;
    });
  } else {
    skip(name, "focus-not-obscured", "page too short or fewer than two sections");
  }

  // h. hydrated Updated text
  await check(name, "hydrated-updated", async () => {
    try {
      await page.waitForFunction(
        (re) => {
          const t = document.querySelector("time[data-last-updated]")?.textContent?.trim() ?? "";
          return new RegExp(re).test(t);
        },
        UPDATED_RE.source,
        { timeout: 5_000 },
      );
      return null;
    } catch {
      const t = await page.$eval("time[data-last-updated]", (el) => el.textContent);
      return `text after 5s was "${t}"`;
    }
  });

  // i. filter, zero network
  let requests = 0;
  page.on("request", () => {
    requests += 1;
  });
  await check(name, "filter-zero-network", async () => {
    requests = 0;
    const pills = page.locator(PILL_SEL);
    const n = await pills.count();
    await page.evaluate(() => window.scrollTo(0, 0));

    await press(pills.nth(0));
    if ((await pills.nth(0).getAttribute("aria-pressed")) !== "true") {
      return "first pill did not become aria-pressed=true";
    }
    let hidden = await wrapperHiddenFlags(page);
    if (hidden[0] !== false || hidden.slice(1).some((h) => h !== true)) {
      return `after first pill, hidden flags were [${hidden.join(",")}]`;
    }
    if (n >= 2) {
      await press(pills.nth(1));
      hidden = await wrapperHiddenFlags(page);
      if (hidden[0] !== false || hidden[1] !== false || hidden.slice(2).some((h) => h !== true)) {
        return `after second pill, hidden flags were [${hidden.join(",")}]`;
      }
      await press(pills.nth(1));
    }
    await press(pills.nth(0));
    hidden = await wrapperHiddenFlags(page);
    if (hidden.some((h) => h)) return `after deselecting all, hidden flags were [${hidden.join(",")}]`;
    const pressed = await pillPressedFlags(page);
    if (pressed.some((p) => p !== "false")) return `pills still pressed [${pressed.join(",")}]`;
    return requests === 0 ? null : `${requests} network request(s) while filtering`;
  });

  // j. expander, zero network
  const expanders = page.locator(EXPANDER_SEL);
  if ((await expanders.count()) > 0) {
    await check(name, "expander-zero-network", async () => {
      const before = requests;
      const btn = expanders.first();
      const total = await page.$eval(EXPANDER_SEL, (el) => el.textContent);
      await press(btn);
      if ((await btn.getAttribute("aria-expanded")) !== "true") return "aria-expanded did not become true";
      const regionId = await btn.getAttribute("aria-controls");
      const regionHidden = () =>
        page.evaluate((id) => document.getElementById(id).hasAttribute("hidden"), regionId);
      if (await regionHidden()) return "region still hidden after expanding";
      if ((await btn.textContent())?.trim() !== "Show fewer") {
        return `label after expand was "${await btn.textContent()}"`;
      }
      await press(btn);
      if (!(await regionHidden())) return "region not hidden after collapsing";
      const label = (await btn.textContent())?.trim() ?? "";
      if (!label.startsWith("Show all")) return `label after collapse was "${label}" (was "${total}")`;
      return requests === before ? null : `${requests - before} network request(s) while expanding`;
    });
    console.log("EXPANDER_EXERCISED yes");
  } else {
    skip(name, "expander-zero-network", "no section had 9 or more articles on this build");
    console.log("EXPANDER_EXERCISED no (no section had 9 or more articles on this build)");
  }

  // Title clamp evidence (reported, never asserted). Overflow regions are
  // unhidden so every card is measured.
  if (name === "desktop-1024" || name === "desktop-1280") {
    const r = await page.evaluate(() => {
      document.querySelectorAll("[data-overflow]").forEach((el) => el.removeAttribute("hidden"));
      const titles = [...document.querySelectorAll("article h3")];
      const clamped = titles.filter((h) => h.scrollHeight - h.clientHeight > 1).length;
      return { clamped, n: titles.length };
    });
    console.log(`TITLE_CLAMP_RATE ${name} ${r.clamped}/${r.n}`);
  }

  // k. console clean
  await check(name, "console-clean", async () => (problems.length ? problems.join(" | ") : null));

  await context.close();
}

async function screenshots(browser, dir) {
  for (const cfg of CONFIGS.filter((c) => SCREENSHOT_CONFIGS.has(c.name))) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: cfg.width, height: cfg.height },
        deviceScaleFactor: cfg.deviceScaleFactor ?? 1,
        isMobile: cfg.isMobile ?? false,
        hasTouch: cfg.hasTouch ?? false,
        colorScheme: scheme,
      });
      const page = await context.newPage();
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(dir, `${cfg.name}-${scheme}.png`), fullPage: true });
      await context.close();
    }
  }
}

let exitCode = 0;
try {
  await startServer();
  const browser = await chromium.launch();
  try {
    for (const cfg of CONFIGS) {
      console.log(`--- ${cfg.name} (${cfg.width}x${cfg.height}) ---`);
      await runConfig(browser, cfg);
    }
    const dir = await mkdtemp(path.join(tmpdir(), "havadis-viewports-"));
    await screenshots(browser, dir);
    console.log(`SCREENSHOTS ${dir}`);
  } finally {
    await browser.close();
  }
  if (failures === 0) {
    console.log("VIEWPORTS_OK");
  } else {
    console.log(`VIEWPORTS_FAILED ${failures}`);
    exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  exitCode = 1;
} finally {
  stopServer();
}
process.exit(exitCode);
