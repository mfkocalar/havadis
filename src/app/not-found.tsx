import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  description: "This page does not exist. Go back to the Havadis front page.",
};

const BODY = "This address does not lead anywhere on Havadis. The front page has today's security news.";

const ACTION =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-control bg-ink px-6 text-body font-semibold text-ground transition-colors duration-150 hover:bg-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none";

/**
 * Branded 404 inside the site layout (UX-01, D-13). Static: it reads no
 * params, search params, headers, cookies or pathname, so the requested path
 * (attacker-chosen text) is never rendered and the route stays prerendered.
 * Next sends the 404 status and the noindex robots tag itself.
 */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <p className="font-mono text-meta text-ink-subtle">404</p>
      <h1 className="mt-2 text-display font-semibold text-balance text-ink">Page not found</h1>
      <p className="mt-4 max-w-prose text-body text-pretty text-ink-muted">{BODY}</p>
      <div className="mt-8">
        <Link href="/" className={ACTION}>
          Back to the front page
        </Link>
      </div>
    </main>
  );
}
