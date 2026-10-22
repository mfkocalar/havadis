import type { Metadata } from "next";
import { siteUrl } from "@/lib/config/site";
import { FEED_VARIANTS, feedPath } from "@/lib/feeds/buildFeed";

export const metadata: Metadata = {
  title: "Feeds — Havadis",
  description: "RSS and JSON Feed endpoints for connecting services and agents to Havadis.",
};

const CODE_CLASSES =
  "rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";

const FIELDS: [string, string][] = [
  ["section", "One of the seven front-page sections, e.g. Vulnerabilities."],
  ["importance", "critical, high or normal."],
  ["importance_reason", "The signal that set the level, e.g. \"Actively exploited\"; null when normal."],
  ["cves", "CVE IDs found in the title and summary."],
  ["source / source_tier", "Publisher name and its source category."],
  ["source_type", "news, research, vendor, cert or government."],
];

/**
 * Human-readable index of the outbound feeds (the `_havadis.about` link in
 * every JSON Feed points here). Static: it lists config, not live data.
 */
export default function FeedsPage() {
  const origin = siteUrl();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Feeds</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every story on the front page is published as <strong>RSS 2.0</strong> for feed readers and
          as <strong>JSON Feed 1.1</strong> for services and agents. Feeds cover the last 24 hours,
          newest first, refresh every 15 minutes, need no key and allow cross-origin requests.
        </p>
      </div>

      <section aria-labelledby="endpoints" className="flex flex-col gap-4">
        <h2 id="endpoints" className="text-xl font-bold tracking-tight">Endpoints</h2>
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Feed</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">RSS</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">JSON</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {FEED_VARIANTS.map((variant) => (
                <tr key={variant.slug}>
                  <th scope="row" className="px-4 py-2.5 font-medium">{variant.title}</th>
                  {(["xml", "json"] as const).map((format) => (
                    <td key={format} className="px-4 py-2.5">
                      <a
                        href={feedPath(variant, format)}
                        className="font-mono text-[0.85em] text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-700 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                      >
                        {feedPath(variant, format)}
                      </a>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="fields" className="flex flex-col gap-4">
        <h2 id="fields" className="text-xl font-bold tracking-tight">Triage fields</h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          Each JSON item carries a <code className={CODE_CLASSES}>_havadis</code> object. RSS items
          carry the same values as <code className={CODE_CLASSES}>havadis:</code> namespaced elements
          and <code className={CODE_CLASSES}>&lt;category&gt;</code> tags.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {FIELDS.map(([name, text]) => (
            <div key={name} className="contents">
              <dt><code className={CODE_CLASSES}>{name}</code></dt>
              <dd className="text-zinc-600 dark:text-zinc-400">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="example" className="flex flex-col gap-4">
        <h2 id="example" className="text-xl font-bold tracking-tight">Example</h2>
        <pre className="overflow-x-auto rounded-2xl bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-100 dark:bg-black">
          <code>{`curl -s ${origin}/feed/critical.json \\
  | jq '.items[] | {title, url, why: ._havadis.importance_reason, cves: ._havadis.cves}'`}</code>
        </pre>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Poll no more often than every 15 minutes; the content does not change faster than that.
        </p>
      </section>
    </main>
  );
}
