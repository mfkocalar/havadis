import type { ColumnType, Generated } from "kysely";
import type { Importance, Section, SourceType } from "../types.ts";

/** A nullable column that may be left out of an insert. */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export const SOURCE_FETCH_OUTCOMES = ["ok", "not_modified", "failed", "skipped_backoff"] as const;
export type SourceFetchOutcome = (typeof SOURCE_FETCH_OUTCOMES)[number];

export type FetchRunStatus = "running" | "ok" | "partial" | "failed" | "abandoned";

export type KevStateColumn = "listed" | "not-listed" | "unavailable";
export type EpssStateColumn = "scored" | "no-row" | "unavailable";
export type SsvcStateColumn = "assessed" | "not-assessed" | "skipped" | "unavailable";
export type SsvcExploitationColumn = "none" | "poc" | "active";
export type SignalCause = "kev" | "epss" | "ssvc";

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface MetaTable {
  key: string;
  value: string;
}

export interface SourcesTable {
  id: string;
  name: string;
  tier: string;
  source_type: SourceType;
  family: string;
  url: string;
  lang: string;
  enabled: Generated<number>;
  origin: Generated<"builtin" | "custom">;
  max_items: Nullable<number>;
  title_include: Nullable<string>;
  allow_html: Generated<number>;
  max_body_bytes: Nullable<number>;
  etag: Nullable<string>;
  last_modified: Nullable<string>;
}

export interface HostBackoffTable {
  host: string;
  failures: Generated<number>;
  next_attempt_at: Nullable<string>;
  last_outcome: Nullable<string>;
}

export interface JobTable {
  kind: string;
  next_run_at: string;
  lease_owner: Nullable<string>;
  lease_until: Nullable<string>;
  last_started_at: Nullable<string>;
  last_status: Nullable<string>;
}

export interface WorkerHeartbeatTable {
  id: number;
  beat_at: string;
  state: string;
}

export interface FetchRunsTable {
  id: Generated<number>;
  started_at: string;
  finished_at: Nullable<string>;
  status: FetchRunStatus;
  trigger: string;
  sources_total: Generated<number>;
  sources_ok: Generated<number>;
  articles_new: Generated<number>;
  articles_seen: Generated<number>;
}

export interface SourceFetchesTable {
  run_id: number;
  source_id: string;
  outcome: SourceFetchOutcome;
  http_status: Nullable<number>;
  item_count: Nullable<number>;
  newest_item_at: Nullable<string>;
  duration_ms: Nullable<number>;
  /** A FetchErrorCode (src/lib/reasonCodes.ts), validated in code, not by the database. */
  reason_code: Nullable<string>;
}

export interface StoriesTable {
  id: string;
  merged_into: Nullable<string>;
  first_seen_at: string;
  section: Section;
  importance: Importance;
  importance_reason: Nullable<string>;
  derive_version: number;
  last_activity_at: string;
}

export interface ArticlesTable {
  id: Generated<number>;
  story_id: string;
  source_id: string;
  url: string;
  canonical_url: string;
  title: string;
  summary: Nullable<string>;
  published_at: Nullable<string>;
  first_seen_at: string;
  last_seen_at: string;
}

export interface StoryCvesTable {
  story_id: string;
  cve_id: string;
}

export interface KevCatalogTable {
  cve_id: string;
  added: string;
  due: Nullable<string>;
  ransomware: number;
  vendor: Nullable<string>;
  product: Nullable<string>;
  name: Nullable<string>;
  required_action: Nullable<string>;
}

export interface ProviderStateTable {
  provider: SignalCause;
  last_success_at: Nullable<string>;
  last_attempt_at: Nullable<string>;
  last_error_code: Nullable<string>;
  catalog_version: Nullable<string>;
}

export interface CveSignalsTable {
  cve_id: string;
  first_seen_at: string;
  kev_state: Generated<KevStateColumn>;
  kev_added: Nullable<string>;
  kev_due: Nullable<string>;
  kev_ransomware: Nullable<number>;
  kev_checked_at: Nullable<string>;
  epss_state: Generated<EpssStateColumn>;
  epss_score: Nullable<number>;
  epss_date: Nullable<string>;
  epss_checked_at: Nullable<string>;
  epss_attempt_at: Nullable<string>;
  ssvc_state: Generated<SsvcStateColumn>;
  ssvc_exploitation: Nullable<SsvcExploitationColumn>;
  ssvc_automatable: Nullable<"yes" | "no">;
  ssvc_technical_impact: Nullable<"partial" | "total">;
  ssvc_checked_at: Nullable<string>;
  ssvc_attempt_at: Nullable<string>;
}

export interface CveSignalSnapshotsTable {
  id: Generated<number>;
  cve_id: string;
  observed_at: string;
  cause: SignalCause;
  kev_state: KevStateColumn;
  epss_state: EpssStateColumn;
  epss_score: Nullable<number>;
  ssvc_state: SsvcStateColumn;
  ssvc_exploitation: Nullable<SsvcExploitationColumn>;
  ssvc_automatable: Nullable<"yes" | "no">;
  ssvc_technical_impact: Nullable<"partial" | "total">;
  run_id: Nullable<number>;
}

/** The Kysely view of schema v1: one entry per table created by 0001_init.sql plus schema_migrations. */
export interface Database {
  schema_migrations: SchemaMigrationsTable;
  meta: MetaTable;
  sources: SourcesTable;
  host_backoff: HostBackoffTable;
  job: JobTable;
  worker_heartbeat: WorkerHeartbeatTable;
  fetch_runs: FetchRunsTable;
  source_fetches: SourceFetchesTable;
  stories: StoriesTable;
  articles: ArticlesTable;
  story_cves: StoryCvesTable;
  kev_catalog: KevCatalogTable;
  provider_state: ProviderStateTable;
  cve_signals: CveSignalsTable;
  cve_signal_snapshots: CveSignalSnapshotsTable;
}
