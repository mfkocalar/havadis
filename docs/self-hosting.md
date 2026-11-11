# Self-hosting Havadis

Havadis runs as three containers from one image: `migrate` (runs once and exits), `web` (the newspaper) and `worker` (the only process that talks to the internet). They share one named volume for the database, and your backups go to `./backups` on the host.

## Requirements

- Docker Engine with Compose v2 (`docker compose version` works).
- An amd64 or arm64 host. Both are built and tested natively.
- About 1 GB of RAM and a few hundred MB of disk, plus room for backups.

## Install

```bash
git clone https://github.com/mfkocalar/havadis.git
cd havadis
mkdir -p backups
sudo chown 65532:65532 backups   # Linux only: the containers run as uid 65532
cp .env.example .env
```

Generate a secret key and put it in `.env` as `HAVADIS_SECRET_KEY`:

```bash
openssl rand -base64 32
# or, without openssl on the host:
docker compose run --rm migrate havadis keygen
```

Start everything:

```bash
docker compose up -d --build
```

Open http://127.0.0.1:4000, or tunnel it over SSH from your laptop (`ssh -L 4000:127.0.0.1:4000 your-vm`). Until the first ingestion cycle finishes, the page says it is waiting for the first ingestion. The worker starts right away and fills the page in after a few minutes.

The first build compiles the app from source, so it needs network access for the base images and the npm registry. The Next.js build step itself runs with no network.

## Configuration reference

Configuration is environment variables in `.env`. Compose passes the file to all three services. Leave a variable empty or out to use its default.

| Variable | Default | Meaning |
| --- | --- | --- |
| `HAVADIS_SECRET_KEY` | none, required | Base64 of exactly 32 bytes. Without it migrate, web and worker refuse to start. Never generated for you and never stored in the data volume or in backups. |
| `HAVADIS_SECRET_KEY_FILE` | none | Path of a file that holds the key, for example a Docker secret mounted at `/run/secrets/havadis_key`. Set exactly one of this and `HAVADIS_SECRET_KEY`. |
| `HAVADIS_BASE_URL` | `http://localhost:4000` | The address people use for this instance. An http or https URL without credentials, query or fragment. |
| `HAVADIS_BIND` | `127.0.0.1` | The host address the web port is published on. See the warning below. |
| `HAVADIS_PORT` | `4000` | The host port. The container always listens on 4000. |
| `HAVADIS_INGEST_INTERVAL_MINUTES` | `15` | Minutes between ingestion cycles. 5 to 1440. |
| `HAVADIS_ENRICH_INTERVAL_HOURS` | `6` | Hours before a CVE record or the KEV list is refreshed. 1 to 168. |
| `HAVADIS_SSVC_MAX_LOOKUPS` | `300` | The most CVE lookups per enrichment run. 0 to 5000. |
| `HAVADIS_SSVC_BUDGET_MS` | `60000` | The time budget for those lookups per run, in milliseconds. 1000 to 600000. |
| `HAVADIS_FETCH_CONCURRENCY` | `8` | How many feeds are fetched at once. 1 to 32. |
| `HAVADIS_EGRESS_ALLOW_HOSTS` | empty | Internal feed hosts the worker may contact: exact hostnames or IP addresses, comma-separated. No CIDR ranges, wildcards, ports or schemes. |
| `HAVADIS_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |

Two settings are read by Compose itself, so they only work from a file named `.env` next to `compose.yaml` or from your shell: `HAVADIS_BIND` and `HAVADIS_PORT`. `HAVADIS_ENV_FILE` (default `.env`) picks which file is passed into the containers.

**Warning about `HAVADIS_BIND`.** There is no sign-in until the accounts release. The web port is published on `127.0.0.1` so only the host itself can reach it. Setting `HAVADIS_BIND=0.0.0.0` exposes an unauthenticated instance to your whole network. Do not do that unless something in front of it (a reverse proxy with authentication, a VPN) controls who can connect.

The containers run as uid 65532 with a read-only root filesystem, all capabilities dropped and `no-new-privileges`. Only `/data` (the named volume `havadis_data`) and `/backups` are writable, plus a tmpfs at `/tmp`.

## Upgrades

```bash
git pull
docker compose up -d --build
```

The `migrate` service runs first. Before it applies any pending migration to an existing database, it writes a verified backup into `./backups` (named `...-pre-migrate-vX-to-vY.db`). A fresh database has nothing to back up. Web and worker start only after migrate finishes cleanly.

Migrate refuses a database that is newer than the image, so you cannot start an older version against newer data. Roll back by building the older version and restoring a backup (see Restore).

## Backups

Take a backup whenever you like, while everything keeps running:

```bash
docker compose exec worker havadis backup
```

It prints the file it wrote, for example `/backups/havadis-20261111T030000Z-manual.db`, which is `./backups/...` on the host. The copy is made with SQLite's online backup, checked with `PRAGMA integrity_check`, and has mode 0600. Backups live outside the data volume, so losing the volume does not lose them.

To back up every night, add a host cron entry:

```cron
0 3 * * * cd /opt/havadis && docker compose exec -T worker havadis backup
```

Havadis never deletes old backups. Prune `./backups` yourself, for example `find /opt/havadis/backups -name 'havadis-*.db' -mtime +30 -delete` (run it with `sudo` on Linux, because the files belong to uid 65532).

Keep the secret key out of your backups and away from the data volume. Store it separately, because encrypted values in a restored database can only be read with the same key.

If `./backups` is not writable by uid 65532, migrate and backup stop with a message that names the fix: `mkdir -p backups && sudo chown 65532:65532 backups`.

## Restore

Restore needs web and worker stopped.

```bash
docker compose stop web worker
# copy the backup into ./backups first if it is somewhere else
docker compose run --rm migrate havadis restore /backups/havadis-20261111T030000Z-manual.db
docker compose up -d
```

Restore checks the backup with `PRAGMA integrity_check` first and refuses a corrupt file, a file outside `/backups`, a symlink, or a backup from a newer version than the image. It also refuses while web or worker still hold the database. Your current database is not thrown away: it is kept as `/data/havadis.db.pre-restore` in the data volume. If that file already exists from an earlier restore, restore refuses until you remove it (see Troubleshooting).

The `docker compose up -d` at the end runs migrate again, so a backup from an older version is brought up to date, with its own backup first.

## Egress and proxies

Only the worker contacts the internet. The web container does not fetch anything. The worker contacts:

- the feed URLs listed in `src/lib/config/sources.ts` (51 curated sources),
- `www.cisa.gov` (the KEV list),
- `api.first.org` (EPSS scores),
- `cveawg.mitre.org` (CVE records for SSVC).

Without a proxy the worker resolves each host itself and refuses any address in a private, loopback, link-local, CGNAT or metadata range, including IPv4-mapped IPv6 forms and redirects into them. To let it reach an internal feed host, list that host in `HAVADIS_EGRESS_ALLOW_HOSTS` with its exact hostname or IP address.

To go through a proxy, set it in `.env`:

```bash
HTTPS_PROXY=http://proxy.example:3128
NO_PROXY=localhost,127.0.0.1,::1
```

- Set one form of each variable, upper case or lower case, not both.
- Keep `localhost,127.0.0.1,::1` in `NO_PROXY`. The image sets it as a default, and your own value replaces it.
- CIDR ranges in `NO_PROXY` are not documented by Node.js and may be ignored. Use hostnames and addresses.
- HTTPS goes through the proxy with CONNECT. Credentials in the proxy URL are never logged.
- If your proxy inspects TLS, mount its CA certificate into the worker and point `NODE_EXTRA_CA_CERTS` at it, for example with a `compose.override.yaml` that adds `NODE_EXTRA_CA_CERTS: /certs/ca.pem` to the worker's environment and mounts the file read-only at that path.

**Proxy mode limit.** With a proxy, the proxy resolves DNS, not Havadis. Havadis can only check the hostname and literal IP address in each URL, so a public-looking name that resolves to an internal address is not caught. Your proxy must block internal address ranges (loopback, RFC 1918, link-local, cloud metadata) itself. Havadis does not protect you from that in proxy mode.

## Telemetry

There is none. Next.js telemetry is disabled in the build and in the running image (`NEXT_TELEMETRY_DISABLED=1`). There is no analytics, no tracking and no call home. Fonts are self-hosted, so pages load nothing from third parties, and the Content-Security-Policy is restrictive.

## Logs and health

All three services write one JSON object per line to stdout. Read them with `docker compose logs -f worker`. Each line has `ts`, `level`, `event` and a few fields. Events come from a fixed list: `startup_refused`, `worker_started`, `worker_stopping`, `worker_stopped`, `lease_claimed`, `lease_busy`, `cycle_started`, `cycle_finished`, `cycle_failed`, `source_failed`, `egress_denied`, `source_backoff`, `enrich_finished`, `enrich_provider_failed`, `heartbeat_failed`, `migrate_applied`, `migrate_noop`, `migrate_refused`, `backup_written`, `backup_failed`, `restore_refused`, `restore_done` and `web_db_busy`.

Failures carry a fixed reason code and a source id, never response text, URLs with credentials or resolved IP addresses. The codes are `egress_denied_scheme`, `egress_denied_private`, `egress_denied_redirect`, `egress_denied_credentials`, `timeout`, `http_error`, `content_type`, `body_too_large`, `parse_error`, `network_error` and `redirect_error`.

`GET /api/health` answers with exactly four keys:

| Key | Values | Meaning |
| --- | --- | --- |
| `status` | `ok`, `degraded`, `unavailable` | `ok` when everything is fine, `degraded` when the worker is late or has not started, `unavailable` when the database cannot be used. |
| `web` | `ok` | The web process is answering. |
| `worker` | `ok`, `stale`, `waiting`, `unknown` | `ok` when the worker's heartbeat is at most 45 seconds old, `stale` when it is older, `waiting` before the first heartbeat. |
| `schema` | `ok`, `ahead`, `pending`, `unknown` | `ok` when the database matches the image. |

The endpoint returns 200 unless the schema is not `ok` or the database cannot be read, in which case it returns 503. A late worker is `degraded` with 200, so Docker does not restart a healthy web.

Two Docker healthchecks run every 30 seconds: `havadis healthcheck web` asks `127.0.0.1` inside the container for `/api/health` and wants a 200, and `havadis healthcheck worker` reads the worker heartbeat and wants it `ok`. See them with `docker compose ps`.

## Troubleshooting

**"HAVADIS_SECRET_KEY or HAVADIS_SECRET_KEY_FILE must hold a base64-encoded 32-byte key."** The key is missing, malformed, or both variables are set. Generate one with `openssl rand -base64 32`, put it in `.env`, and run `docker compose up -d` again.

**"Backups directory /backups is not writable by this container user (uid 65532)."** On Linux run `mkdir -p backups && sudo chown 65532:65532 backups` in the project directory, or mount a named volume at `/backups` instead.

**"database schema is newer than this image."** The data was written by a newer version. Use an image at least as new as the database, or restore a backup taken before the upgrade.

**Restore says `havadis.db.pre-restore` already exists.** It is the copy of the database that an earlier restore set aside. Once you are sure you no longer need it, remove it and run restore again:

```bash
docker compose run --rm migrate /nodejs/bin/node -e "require('node:fs').rmSync('/data/havadis.db.pre-restore')"
```

**The page stays on the waiting text.** Check `docker compose ps` for a worker that is restarting, then `docker compose logs worker`. A `startup_refused` line names the reason code (for example `key_missing` or `db_missing`).

**A source never shows new stories.** After repeated failures a host is retried later and later: the wait starts at 15 minutes and doubles up to 6 hours (`source_backoff` in the logs). Look for `source_failed` lines with that source id and read the reason code. `egress_denied_private` means the host resolves to an internal address (see `HAVADIS_EGRESS_ALLOW_HOSTS`), `network_error` and `timeout` usually mean a proxy or firewall in the way.

## Development

For contributors: copy `.env.example` to `.env`, set the key, run `mkdir -p backups` and `npm run havadis -- migrate`, then `npm run dev` for the web app and `npm run worker` for the worker. Both use `./data/havadis.db`. Compose is for testing the real container: `bash scripts/compose-smoke.sh` runs the same smoke CI does.
