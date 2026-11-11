-- Havadis schema v1 (phase 14, plan 01). Frozen once shipped: a shipped migration never changes.
--
-- Conventions
--   * every table is STRICT;
--   * every *_at column is an exact Date.prototype.toISOString() string, enforced by a GLOB CHECK
--     (rejects '...Z' without milliseconds, a space instead of T, and any +hh:mm offset);
--   * *_state columns mirror the tri-state unions in src/lib/types.ts verbatim, and the CHECKs
--     below make an "unavailable" signal impossible to confuse with a negative one.
-- The runner (src/lib/db/migrator.ts) creates schema_migrations itself; sources are seeded by
-- code after migrating (src/lib/db/seed.ts), never by SQL here.

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE sources (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  tier           TEXT NOT NULL,
  source_type    TEXT NOT NULL CHECK (source_type IN ('news','research','vendor','cert','government','advisory')),
  family         TEXT NOT NULL,
  url            TEXT NOT NULL,
  lang           TEXT NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  origin         TEXT NOT NULL DEFAULT 'builtin' CHECK (origin IN ('builtin','custom')),
  max_items      INTEGER CHECK (max_items IS NULL OR max_items > 0),
  title_include  TEXT,
  allow_html     INTEGER NOT NULL DEFAULT 0 CHECK (allow_html IN (0,1)),
  max_body_bytes INTEGER CHECK (max_body_bytes IS NULL OR max_body_bytes > 0),
  etag           TEXT,
  last_modified  TEXT
) STRICT;

CREATE TABLE host_backoff (
  host            TEXT PRIMARY KEY,
  failures        INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  next_attempt_at TEXT CHECK (next_attempt_at IS NULL OR next_attempt_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_outcome    TEXT
) STRICT;

CREATE TABLE job (
  kind            TEXT PRIMARY KEY,
  next_run_at     TEXT NOT NULL CHECK (next_run_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  lease_owner     TEXT,
  lease_until     TEXT CHECK (lease_until IS NULL OR lease_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_started_at TEXT CHECK (last_started_at IS NULL OR last_started_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_status     TEXT
) STRICT;

CREATE TABLE worker_heartbeat (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  beat_at TEXT NOT NULL CHECK (beat_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  state   TEXT NOT NULL
) STRICT;

CREATE TABLE fetch_runs (
  id            INTEGER PRIMARY KEY,
  started_at    TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  finished_at   TEXT CHECK (finished_at IS NULL OR finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  status        TEXT NOT NULL CHECK (status IN ('running','ok','partial','failed','abandoned')),
  "trigger"     TEXT NOT NULL,
  sources_total INTEGER NOT NULL DEFAULT 0,
  sources_ok    INTEGER NOT NULL DEFAULT 0,
  articles_new  INTEGER NOT NULL DEFAULT 0,
  articles_seen INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE UNIQUE INDEX one_running_cycle ON fetch_runs(status) WHERE status = 'running';

CREATE TABLE source_fetches (
  run_id         INTEGER NOT NULL REFERENCES fetch_runs(id),
  source_id      TEXT NOT NULL REFERENCES sources(id),
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok','not_modified','failed','skipped_backoff')),
  http_status    INTEGER,
  item_count     INTEGER,
  newest_item_at TEXT CHECK (newest_item_at IS NULL OR newest_item_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  duration_ms    INTEGER,
  reason_code    TEXT,
  PRIMARY KEY (run_id, source_id),
  CHECK ((outcome = 'failed') = (reason_code IS NOT NULL))
) STRICT;

CREATE INDEX source_fetches_success ON source_fetches(source_id, run_id) WHERE outcome IN ('ok','not_modified');

CREATE TABLE stories (
  id               TEXT PRIMARY KEY,
  merged_into      TEXT REFERENCES stories(id),
  first_seen_at    TEXT NOT NULL CHECK (first_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  section          TEXT NOT NULL CHECK (section IN ('Vulnerabilities','Advisories','Ransomware','Breaches','Threat Intelligence','Tools/Techniques','Industry/Policy')),
  importance       TEXT NOT NULL CHECK (importance IN ('critical','high','normal')),
  importance_reason TEXT,
  derive_version   INTEGER NOT NULL,
  last_activity_at TEXT NOT NULL CHECK (last_activity_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (merged_into IS NULL OR merged_into <> id)
) STRICT;

CREATE TABLE articles (
  id            INTEGER PRIMARY KEY,
  story_id      TEXT NOT NULL REFERENCES stories(id),
  source_id     TEXT NOT NULL REFERENCES sources(id),
  url           TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,
  published_at  TEXT CHECK (published_at IS NULL OR published_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  first_seen_at TEXT NOT NULL CHECK (first_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_seen_at  TEXT NOT NULL CHECK (last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE(source_id, canonical_url)
) STRICT;

CREATE INDEX articles_story ON articles(story_id);
CREATE INDEX articles_published ON articles(published_at);

-- cves and cve_signals are one table: the signal row is the CVE registry.
CREATE TABLE cve_signals (
  cve_id TEXT PRIMARY KEY CHECK (
    cve_id GLOB 'CVE-[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]*'
    AND length(cve_id) BETWEEN 13 AND 16
    AND substr(cve_id, 10) NOT GLOB '*[^0-9]*'
  ),
  first_seen_at TEXT NOT NULL CHECK (first_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),

  kev_state      TEXT NOT NULL DEFAULT 'unavailable' CHECK (kev_state IN ('listed','not-listed','unavailable')),
  kev_added      TEXT CHECK (kev_added IS NULL OR kev_added GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  kev_due        TEXT CHECK (kev_due IS NULL OR kev_due GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  kev_ransomware INTEGER CHECK (kev_ransomware IN (0,1)),
  kev_checked_at TEXT CHECK (kev_checked_at IS NULL OR kev_checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),

  epss_state      TEXT NOT NULL DEFAULT 'unavailable' CHECK (epss_state IN ('scored','no-row','unavailable')),
  epss_score      REAL CHECK (epss_score BETWEEN 0 AND 1),
  epss_date       TEXT CHECK (epss_date IS NULL OR epss_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  epss_checked_at TEXT CHECK (epss_checked_at IS NULL OR epss_checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  epss_attempt_at TEXT CHECK (epss_attempt_at IS NULL OR epss_attempt_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),

  ssvc_state            TEXT NOT NULL DEFAULT 'unavailable' CHECK (ssvc_state IN ('assessed','not-assessed','skipped','unavailable')),
  ssvc_exploitation     TEXT CHECK (ssvc_exploitation IN ('none','poc','active')),
  ssvc_automatable      TEXT CHECK (ssvc_automatable IN ('yes','no')),
  ssvc_technical_impact TEXT CHECK (ssvc_technical_impact IN ('partial','total')),
  ssvc_checked_at       TEXT CHECK (ssvc_checked_at IS NULL OR ssvc_checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ssvc_attempt_at       TEXT CHECK (ssvc_attempt_at IS NULL OR ssvc_attempt_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),

  -- honesty guards enforced by the database
  CHECK ((kev_state = 'unavailable')  = (kev_checked_at  IS NULL)),
  CHECK ((epss_state = 'unavailable') = (epss_checked_at IS NULL)),
  CHECK ((ssvc_state = 'unavailable') = (ssvc_checked_at IS NULL)),
  CHECK ((ssvc_state = 'assessed') = (ssvc_exploitation IS NOT NULL)),
  CHECK ((ssvc_state = 'assessed') = (ssvc_automatable IS NOT NULL)),
  CHECK ((ssvc_state = 'assessed') = (ssvc_technical_impact IS NOT NULL)),
  CHECK ((epss_state = 'scored') = (epss_score IS NOT NULL)),
  CHECK ((kev_state = 'listed') = (kev_added IS NOT NULL))
) STRICT;

CREATE TABLE story_cves (
  story_id TEXT NOT NULL REFERENCES stories(id),
  cve_id   TEXT NOT NULL REFERENCES cve_signals(cve_id),
  PRIMARY KEY (story_id, cve_id)
) STRICT;

CREATE INDEX story_cves_cve ON story_cves(cve_id);

-- Re-fetched on every refresh, so nothing in it is ever backfilled; the slim validated KEV map
-- carries only added/due/ransomware, hence the nullable descriptive columns.
CREATE TABLE kev_catalog (
  cve_id          TEXT PRIMARY KEY,
  added           TEXT NOT NULL CHECK (added GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  due             TEXT CHECK (due IS NULL OR due GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  ransomware      INTEGER NOT NULL CHECK (ransomware IN (0,1)),
  vendor          TEXT,
  product         TEXT,
  name            TEXT,
  required_action TEXT
) STRICT;

CREATE TABLE provider_state (
  provider        TEXT PRIMARY KEY CHECK (provider IN ('kev','epss','ssvc')),
  last_success_at TEXT CHECK (last_success_at IS NULL OR last_success_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_attempt_at TEXT CHECK (last_attempt_at IS NULL OR last_attempt_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_error_code TEXT,
  catalog_version TEXT
) STRICT;

CREATE TABLE cve_signal_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  cve_id                TEXT NOT NULL REFERENCES cve_signals(cve_id),
  observed_at           TEXT NOT NULL CHECK (observed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  cause                 TEXT NOT NULL CHECK (cause IN ('kev','epss','ssvc')),
  kev_state             TEXT NOT NULL CHECK (kev_state IN ('listed','not-listed','unavailable')),
  epss_state            TEXT NOT NULL CHECK (epss_state IN ('scored','no-row','unavailable')),
  epss_score            REAL CHECK (epss_score BETWEEN 0 AND 1),
  ssvc_state            TEXT NOT NULL CHECK (ssvc_state IN ('assessed','not-assessed','skipped','unavailable')),
  ssvc_exploitation     TEXT CHECK (ssvc_exploitation IN ('none','poc','active')),
  ssvc_automatable      TEXT CHECK (ssvc_automatable IN ('yes','no')),
  ssvc_technical_impact TEXT CHECK (ssvc_technical_impact IN ('partial','total')),
  run_id                INTEGER REFERENCES fetch_runs(id),
  CHECK ((epss_state = 'scored') = (epss_score IS NOT NULL)),
  CHECK ((ssvc_state = 'assessed') = (ssvc_exploitation IS NOT NULL))
) STRICT;

CREATE INDEX cve_signal_snapshots_cve ON cve_signal_snapshots(cve_id, id);

CREATE TRIGGER cve_signal_snapshots_no_update BEFORE UPDATE ON cve_signal_snapshots
BEGIN
  SELECT RAISE(ABORT, 'cve_signal_snapshots is append-only');
END;

CREATE TRIGGER cve_signal_snapshots_no_delete BEFORE DELETE ON cve_signal_snapshots
BEGIN
  SELECT RAISE(ABORT, 'cve_signal_snapshots is append-only');
END;
