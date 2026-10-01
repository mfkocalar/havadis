# Deferred Items — Phase 3

Out-of-scope discoveries logged during plan execution, per the executor's scope-boundary rule
(fix only issues directly caused by the current task's changes).

## 03-01 Task 1

**Krebs on Security `fetchSource` fails with content-type gate, unrelated to this plan's changes.**

- **Status:** resolved
- **Resolution:** `allowHtmlContentType: true` added to the `krebs` entry in `sources.ts` by commit `da6dbba` (2026-09-27); live Krebs e2e test passes.
- **File:** `src/lib/config/sources.ts` (the `krebs` `SourceConfig` entry) / `src/lib/pipeline/fetchSource.ts` (the content-type gate) — neither file is in 03-01's `files_modified` list.
- **Symptom:** `src/lib/pipeline/frontpage.e2e.test.ts`'s test `"fetchSource(Krebs) yields at least one normalized article before lookback filtering"` fails with `{ status: "error", reason: 'krebs: unexpected content-type "text/html; charset=UTF-8"' }`.
- **Confirmed pre-existing / live-environment, not a Task 1 regression:** `curl -sI https://krebsonsecurity.com/feed/` (run live during this session) confirms Krebs is currently serving `content-type: text/html; charset=UTF-8` — this is the same source and same content-type behavior PROJECT.md's Key Decisions table already documents ("Krebs on Security's live `/feed` serves genuinely valid RSS under `text/html`"), but the `krebs` entry in `sources.ts` does not currently set `allowHtmlContentType: true`, the per-source opt-in Phase 2 (`02-02`) introduced specifically for this exact case. Nothing in this plan's task touches `sources.ts` or `fetchSource.ts`.
- **Why not auto-fixed here:** out of this task's file scope (`src/lib/types.ts`, `src/lib/config/sections.ts`, `src/lib/pipeline/classify.ts`, `src/lib/pipeline/groupBySection.ts`, `src/lib/pipeline/getFrontPage.ts`, `src/app/page.tsx`, `src/components/ArticleCard.tsx`, `src/lib/pipeline/frontpage.e2e.test.ts`); per the executor's scope boundary, pre-existing failures in unrelated files are logged, not fixed.
- **Suggested fix (for a future plan or a maintainer):** add `allowHtmlContentType: true` to the `krebs` entry in `src/lib/config/sources.ts` — a one-line, already-precedented config change (this exact flag exists for this exact purpose).
- **Impact on this plan's verification:** all of this plan's own assertions (classification, section grouping, field-shape, `fanOut.test.ts`'s six-field/copy contracts, `npm run build`, `npm run lint`) pass. Only this one live-network test — unrelated to dedupe/classify/rank — fails, and would fail identically with or without this plan's changes.
