import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { siteUrl } from "@/lib/config/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <p className="text-3xl font-bold tracking-tight">Havadis</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              A source-independent security newspaper for security experts.
            </p>
          </div>
        </header>
        {children}
        <footer className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-sm text-zinc-600 sm:px-6 dark:text-zinc-400">
            <span>Connect a reader or agent:</span>
            <a href="/feed.xml" className="font-medium underline-offset-4 hover:underline">RSS</a>
            <a href="/feed.json" className="font-medium underline-offset-4 hover:underline">JSON Feed</a>
            <a href="/feeds" className="font-medium underline-offset-4 hover:underline">All feeds</a>
          </div>
        </footer>
      </body>
    </html>
  );
}
