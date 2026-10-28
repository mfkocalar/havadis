import type { Metadata } from "next";
import { siteUrl } from "@/lib/config/site";
import { FEED_VARIANTS, feedPath } from "@/lib/feeds/buildFeed";

export const metadata: Metadata = {
  title: "Feeds — Havadis",
  description: "RSS and JSON Feed endpoints for connecting services and agents to Havadis.",
};

const CODE_CLASSES =
  "rounded-xs bg-stone-200 px-1.5 py-0.5 font-mono text-[0.85em] text-stone-900 dark:bg-stone-800 dark:text-stone-100";

const H1_CLASSES = "font-display text-4xl leading-none font-extrabold tracking-wide uppercase";

const H2_CLASSES =
  "border-b-2 border-stone-950 pb-2 font-display text-2xl leading-none font-extrabold tracking-wide uppercase dark:border-stone-600";

const MUTED = "text-stone-700 dark:text-stone-300";

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
        <h1 className={H1_CLASSES}>Feeds</h1>
        <p className={MUTED}>
          Every story on the front page is published as <strong>RSS 2.0</strong> for feed readers and
          as <strong>JSON Feed 1.1</strong> for services and agents. Feeds cover the last 24 hours,
          newest first, refresh every 15 minutes, need no key and allow cross-origin requests.
        </p>
      </div>

      <section aria-labelledby="endpoints" className="flex flex-col gap-4">
        <h2 id="endpoints" className={H2_CLASSES}>Endpoints</h2>
        <div className="overflow-x-auto rounded-xs ring-2 ring-stone-950 ring-inset dark:ring-stone-600">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-950 font-display tracking-wider text-stone-50 uppercase dark:bg-stone-800">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-bold">Feed</th>
                <th scope="col" className="px-4 py-2.5 font-bold">RSS</th>
                <th scope="col" className="px-4 py-2.5 font-bold">JSON</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-300 dark:divide-stone-800">
              {FEED_VARIANTS.map((variant) => (
                <tr key={variant.slug}>
                  <th scope="row" className="px-4 py-2.5 font-semibold">{variant.title}</th>
                  {(["xml", "json"] as const).map((format) => (
                    <td key={format} className="px-4 py-2.5">
                      <a
                        href={feedPath(variant, format)}
                        className="rounded-xs font-mono text-[0.85em] text-stone-800 underline decoration-stone-400 underline-offset-4 hover:decoration-orange-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 dark:text-stone-200 dark:decoration-stone-600 dark:focus-visible:outline-stone-100"
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
        <h2 id="fields" className={H2_CLASSES}>Triage fields</h2>
        <p className={MUTED}>
          Each JSON item carries a <code className={CODE_CLASSES}>_havadis</code> object. RSS items
          carry the same values as <code className={CODE_CLASSES}>havadis:</code> namespaced elements
          and <code className={CODE_CLASSES}>&lt;category&gt;</code> tags.
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          {FIELDS.map(([name, text]) => (
            <div key={name} className="contents">
              <dt><code className={CODE_CLASSES}>{name}</code></dt>
              <dd className={MUTED}>{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="example" className="flex flex-col gap-4">
        <h2 id="example" className={H2_CLASSES}>Example</h2>
        <pre className="overflow-x-auto rounded-xs bg-stone-950 p-4 text-sm leading-relaxed text-stone-100 dark:bg-black dark:ring-1 dark:ring-stone-700">
          <code>{`curl -s ${origin}/feed/critical.json \\
  | jq '.items[] | {title, url, why: ._havadis.importance_reason, cves: ._havadis.cves}'`}</code>
        </pre>
        <p className={`text-sm ${MUTED}`}>
          Poll no more often than every 15 minutes; the content does not change faster than that.
        </p>
      </section>
    </main>
  );
}
