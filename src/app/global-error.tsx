"use client";

/**
 * Root error boundary UI (UX-02, D-14). It replaces the root layout, so it owns
 * html and body and depends on no layout, web font or Tailwind class: the
 * inline style below carries one light and one dark value set and the system
 * font stack. It destructures only retry and never names, reads, logs or
 * renders the thrown value. No metadata export is allowed here, so the title is
 * a React title element.
 */
const CSS = `
body {
  margin: 0;
  background: #f2f0e9;
  color: #1c1917;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
main {
  max-width: 48rem;
  margin: 0 auto;
  padding: 48px 16px;
  min-height: 100vh;
  box-sizing: border-box;
}
h1 {
  margin: 0;
  font-size: 32px;
  line-height: 40px;
  font-weight: 600;
}
p {
  margin: 16px 0 0;
  max-width: 65ch;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: #44403c;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  margin-top: 32px;
  padding: 0 24px;
  border: 0;
  border-radius: 4px;
  background: #1c1917;
  color: #f2f0e9;
  font: inherit;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 150ms;
}
button:hover {
  background: #44403c;
}
button:focus-visible {
  outline: 2px solid #1c1917;
  outline-offset: 2px;
}
@media (min-width: 640px) {
  main {
    padding: 64px 24px;
  }
}
@media (prefers-reduced-motion: reduce) {
  button {
    transition: none;
  }
}
@media (prefers-color-scheme: dark) {
  body {
    background: #151311;
    color: #f5f5f4;
  }
  p {
    color: #d6d3d1;
  }
  button {
    background: #f5f5f4;
    color: #151311;
  }
  button:hover {
    background: #d6d3d1;
  }
  button:focus-visible {
    outline-color: #f5f5f4;
  }
}
`;

export default function GlobalError({ retry }: { retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Havadis</title>
        <style>{CSS}</style>
        <main>
          <div role="alert">
            <h1>Something went wrong</h1>
            <p>Havadis could not load. Try again in a moment.</p>
          </div>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
