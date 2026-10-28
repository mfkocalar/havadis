import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import { siteUrl } from "@/lib/config/site";
import "./globals.css";

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Havadis — Security News, Aggregated",
  description:
    "Havadis is a public, source-independent security newspaper for security experts, aggregating current cybersecurity coverage into one fast front page.",
  // Feed autodiscovery: readers and agents given the site URL find the feeds.
  alternates: {
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: "Havadis: security news (RSS)" }],
      "application/feed+json": [{ url: "/feed.json", title: "Havadis: security news (JSON Feed)" }],
    },
  },
};

const FOOTER_LINK =
  "rounded-xs font-semibold text-stone-900 underline decoration-stone-400 underline-offset-4 hover:decoration-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 dark:text-stone-100 dark:decoration-stone-600 dark:hover:decoration-stone-100 dark:focus-visible:outline-stone-100";

const HEADER_LINK =
  "rounded-xs text-stone-200 underline decoration-stone-600 underline-offset-4 hover:text-white hover:decoration-orange-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <header className="bg-stone-950 text-stone-50 dark:border-b dark:border-stone-800 dark:bg-black">
          <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-3.5 sm:px-6 lg:px-8">
            <p className="flex items-center gap-3 font-display text-[1.75rem] leading-none font-extrabold tracking-wide uppercase">
              <span aria-hidden="true" className="size-3.5 rotate-45 bg-orange-500" />
              Havadis
            </p>
            <p className="hidden text-sm text-stone-300 sm:block">
              A source-independent security newspaper for security experts.
            </p>
            <nav aria-label="Feeds" className="ml-auto flex gap-4 text-sm font-semibold">
              <a href="/feed.xml" className={HEADER_LINK}>RSS</a>
              <a href="/feed.json" className={HEADER_LINK}>JSON Feed</a>
              <a href="/feeds" className={HEADER_LINK}>All feeds</a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="border-t-2 border-stone-950 dark:border-stone-700">
          <div className="mx-auto flex w-full max-w-[96rem] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-stone-700 sm:px-6 lg:px-8 dark:text-stone-300">
            <span>Connect a reader or agent:</span>
            <a href="/feed.xml" className={FOOTER_LINK}>RSS</a>
            <a href="/feed.json" className={FOOTER_LINK}>JSON Feed</a>
            <a href="/feeds" className={FOOTER_LINK}>All feeds</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
