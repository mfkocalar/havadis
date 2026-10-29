# Contributing to Havadis

Thanks for helping. Havadis aims to be a calm, trustworthy front page, so changes are judged on whether they make the morning triage pass faster or more reliable.

## Ways to help

- **Suggest a source.** Open a [source request](https://github.com/mfkocalar/havadis/issues/new?template=source_request.yml). Good sources publish original security reporting or advisories, have a working RSS or Atom feed, and are not already covered.
- **Report a bug or a misclassified story.** Open a [bug report](https://github.com/mfkocalar/havadis/issues/new?template=bug_report.yml) with the story link and what you expected.
- **Send a pull request.** For anything larger than a fix, open an issue first so we can agree on the approach.

## Local setup

```bash
npm install
npm run dev        # http://localhost:4000
```

Before you open a pull request:

```bash
npm run lint
npm run build && npm test
```

`npm test` reads the last production build, so always build first. CI runs the same steps.

## Guidelines

- **Keep it deterministic.** Section and importance rules are keyword- and rule-based so every decision can be explained on the page. Add tests for any rule you change (`src/lib/pipeline/`).
- **Follow the design system.** Colour carries meaning only; read [DESIGN.md](DESIGN.md) before touching the UI. Contrast checks run in `npm test`.
- **Stay accessible.** Never convey state by colour alone; check keyboard use and both themes.
- **No tracking, no accounts.** Reader state stays in the browser.
- **Small, focused commits** with [Conventional Commit](https://www.conventionalcommits.org) prefixes (`feat:`, `fix:`, `docs:`, …).

## Security issues

Please don't file them as issues; see [SECURITY.md](SECURITY.md).
