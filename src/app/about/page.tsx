import type { Metadata } from "next";
import Link from "next/link";
import { SOURCES } from "@/lib/config/sources";
import { CRAWLER_CONTACT_CHANNEL_URL, USER_AGENT } from "@/lib/config/crawler";

export const metadata: Metadata = {
  title: "About Havadis",
  description:
    "Havadis is a public security news aggregator; this page describes its HavadisBot crawler and how to contact or opt out.",
};

const HEADING = "text-zinc-900 dark:text-zinc-50";
const BODY = "text-zinc-600 dark:text-zinc-400";

/**
 * Static page for publishers and readers (D-12, PLAT-04): what Havadis is,
 * what HavadisBot fetches, and how to contact or opt out. The crawler's
 * User-Agent contact URL points here. It uses no request-time APIs and no
 * route segment config, so Next prerenders it as a static route. Every value
 * is rendered as a JSX text node or attribute.
 */
export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className={`text-3xl font-bold tracking-tight ${HEADING}`}>About Havadis</h1>
      <p className={`mt-4 leading-7 ${BODY}`}>
        Havadis is a public, source-independent security newspaper. It aggregates{" "}
        {SOURCES.length} curated public feeds into one front page. There are no accounts and
        no tracking cookies.
      </p>

      <h2 className={`mt-10 text-xl font-semibold ${HEADING}`}>HavadisBot</h2>
      <p className={`mt-4 leading-7 ${BODY}`}>
        HavadisBot is the crawler behind the front page. It fetches only the public RSS or
        Atom feed URL configured for each source, at most about once per 15 minutes per feed,
        and never crawls article pages. It identifies itself with exactly this User-Agent:
      </p>
      <p className="mt-4">
        <code
          className={`block break-all rounded bg-zinc-100 px-3 py-2 font-mono text-sm dark:bg-zinc-900 ${HEADING}`}
        >
          {USER_AGENT}
        </code>
      </p>

      <h2 className={`mt-10 text-xl font-semibold ${HEADING}`}>Contact and opt-out</h2>
      <p className={`mt-4 leading-7 ${BODY}`}>
        A publisher can ask to be removed, or anyone can report a problem, through{" "}
        <a
          href={CRAWLER_CONTACT_CHANNEL_URL}
          className="underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          {CRAWLER_CONTACT_CHANNEL_URL}
        </a>
        .
      </p>

      <p className="mt-10">
        <Link
          href="/"
          className={`underline underline-offset-2 ${BODY} hover:text-zinc-900 dark:hover:text-zinc-50`}
        >
          Back to the front page
        </Link>
      </p>
    </main>
  );
}
