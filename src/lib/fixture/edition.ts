import type { Article } from "../types.ts";

/**
 * The fixture edition's marker story title. A fixture build renders it on `/`,
 * which is how CI and the zero-request proof tell a fixture page from a live one.
 */
export const FIXTURE_MARKER_TITLE = "Havadis fixture edition marker: deterministic CI front page";

/**
 * The committed, hand-written stories a fixture build renders instead of the
 * 51 live feeds (D-03). Never a live capture, and consumed only behind the
 * fixture switch (`src/lib/config/fixtureMode.ts`). Every name, host and CVE ID
 * is fictional (reserved `fixture.test` host, CVE IDs in 2099). Each
 * `publishedAt` is `now` minus a fixed number of minutes, so the same `now`
 * always gives the same edition. Plan 22-02 completes the adversarial set.
 */
export function fixtureArticles(now: number): Article[] {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  return [
    {
      title: FIXTURE_MARKER_TITLE,
      url: "https://wire.fixture.test/marker",
      source: "Fixture Wire",
      sourceTier: "Tech & General",
      sourceType: "news",
      publishedAt: at(10),
      summary: "A fixed story that marks this page as the committed fixture edition.",
    },
    {
      title: "Fixture Labs details CVE-2099-10001, a flaw used in ransomware intrusions",
      url: "https://labs.fixture.test/cve-2099-10001",
      source: "Fixture Labs",
      sourceTier: "Security Research",
      sourceType: "research",
      publishedAt: at(25),
      summary: "A fictional write-up of a fictional vulnerability, written for the fixture edition.",
    },
    {
      title: "Fixture Advisory Desk tracks CVE-2099-10002 in a fictional product",
      url: "https://advisory.fixture.test/cve-2099-10002",
      source: "Fixture Advisory Desk",
      sourceTier: "Enterprise Security",
      sourceType: "advisory",
      publishedAt: at(40),
      summary: "A fictional advisory about a fictional product, written for the fixture edition.",
    },
  ];
}
