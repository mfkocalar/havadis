"use client";

const ACTION =
  "inline-flex h-11 min-w-11 items-center justify-center rounded-control bg-ink px-6 text-body font-semibold text-ground transition-colors duration-150 hover:bg-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none";

const LINK =
  "inline-flex min-h-6 items-center rounded-control text-body font-semibold text-ink underline decoration-edge underline-offset-4 transition-colors duration-150 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:transition-none";

/**
 * Route error boundary UI (UX-02, D-14), shown inside the site layout. It
 * destructures only retry: the thrown value is never named, read, logged or
 * rendered, so nothing from it can reach the reader. The link home is a plain
 * anchor on purpose: a full navigation works even when client state is broken.
 */
export default function RouteError({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
      <div role="alert">
        <h1 className="text-display font-semibold text-balance text-ink">Something went wrong</h1>
        <p className="mt-4 max-w-prose text-body text-pretty text-ink-muted">
          This page could not be shown. Trying again often fixes it.
        </p>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-6">
        <button type="button" onClick={() => retry()} className={ACTION}>
          Try again
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation is deliberate */}
        <a href="/" className={LINK}>
          Back to the front page
        </a>
      </div>
    </main>
  );
}
