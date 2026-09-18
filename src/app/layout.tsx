import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Havadis — Security News, Aggregated",
  description:
    "Havadis is a public, source-independent security newspaper for security experts, aggregating current cybersecurity coverage into one fast front page.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
            <p className="text-3xl font-bold tracking-tight">Havadis</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              A source-independent security newspaper for security experts.
            </p>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
