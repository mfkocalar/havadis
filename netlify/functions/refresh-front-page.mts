/**
 * Keeps the front page fresh without waiting for a reader.
 *
 * The page is ISR with a 900-second window, and on Netlify an expired page is
 * only rebuilt when a request arrives: the first reader after a quiet spell
 * gets the stale copy (observed 55 hours old) and their visit triggers the
 * rebuild. This scheduled function is that request, every 5 minutes, so a
 * reader sees an edition at most about 20 minutes old. Requests while the page
 * is fresh are cache hits and cost nothing upstream; only the first one after
 * expiry causes the single crawl the snapshot already does.
 *
 * Only `/` is requested. The feed routes call `getFrontPage()` directly rather
 * than the shared snapshot, so warming them would crawl all sources once per
 * feed URL each window.
 */
export default async function refreshFrontPage(): Promise<void> {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (!site) throw new Error("SITE_URL is not set; cannot refresh the front page");

  const res = await fetch(`${site}/`, {
    headers: { "User-Agent": "HavadisRefresh/1.0 (Netlify scheduled function)" },
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`refresh ${site}/ -> ${res.status} age=${res.headers.get("age") ?? "-"}`);
  if (!res.ok) throw new Error(`front page refresh returned ${res.status}`);
}

export const config = { schedule: "*/5 * * * *" };
