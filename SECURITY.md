# Security policy

Havadis is a security tool, so we take reports about its own security seriously.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub's
[private vulnerability reporting](https://github.com/mfkocalar/havadis/security/advisories/new).

Include what you can of:

- the affected URL, route or file;
- steps to reproduce, or a proof of concept;
- the impact you expect.

You should get an acknowledgement within 5 working days. We will keep you updated while we fix it and credit you in the advisory unless you prefer otherwise.

## Scope

In scope:

- the site at https://havadis.netlify.app and its feeds;
- this repository's code, including the feed fetcher (redirect validation, size caps, timeouts), parsing, rendering and the scheduled refresh function.

Out of scope:

- content of third-party articles Havadis links to; report those to the publisher;
- findings that need a compromised browser or device;
- volumetric denial of service, and automated scanner output without a demonstrated impact.

Please test only against your own local instance (`npm run dev`), not the public site.

## Supported versions

Only the latest commit on `main`, which is what runs in production, receives fixes.
