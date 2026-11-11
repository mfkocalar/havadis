import type { Kysely } from "kysely";
import type { SourceConfig } from "../types.ts";
import type { Database } from "./schema.ts";

/**
 * Seeds the curated sources, run as code after migrating (never as SQL inside 0001) because
 * sources.ts changes between releases while a shipped migration must never change.
 *
 * Every column except enabled, etag and last_modified is overwritten on re-seed (D-07): an operator's
 * enabled choice and the conditional-GET validators survive an upgrade.
 */
export async function seedBuiltins(
  db: Kysely<Database>,
  sources: readonly SourceConfig[],
  now: number,
): Promise<{ inserted: number; updated: number }> {
  const nowIso = new Date(now).toISOString();

  return db.transaction().execute(async (trx) => {
    // ON CONFLICT DO UPDATE reports changes = 1 for new and existing rows alike, so count beforehand.
    const existing = new Set(
      (await trx.selectFrom("sources").select("id").execute()).map((r) => r.id),
    );

    let inserted = 0;
    let updated = 0;
    for (const s of sources) {
      const curated = {
        name: s.name,
        tier: s.tier,
        source_type: s.sourceType,
        family: s.family,
        url: s.url,
        lang: s.lang,
        origin: "builtin" as const,
        max_items: s.maxItems ?? null,
        title_include: s.titleInclude ? s.titleInclude.toString() : null,
        allow_html: s.allowHtmlContentType ? 1 : 0,
        max_body_bytes: s.maxBodyBytes ?? null,
      };
      await trx
        .insertInto("sources")
        .values({ id: s.id, ...curated })
        .onConflict((oc) => oc.column("id").doUpdateSet(curated))
        .execute();
      if (existing.has(s.id)) updated++;
      else inserted++;
    }

    // A fresh install is due at once; re-seeding never reschedules or resets provider state.
    await trx
      .insertInto("job")
      .values({ kind: "ingest", next_run_at: "1970-01-01T00:00:00.000Z" })
      .onConflict((oc) => oc.doNothing())
      .execute();
    for (const provider of ["kev", "epss", "ssvc"] as const) {
      await trx
        .insertInto("provider_state")
        .values({ provider })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    await trx
      .insertInto("meta")
      .values({ key: "sources_seeded_at", value: nowIso })
      .onConflict((oc) => oc.column("key").doUpdateSet({ value: nowIso }))
      .execute();

    return { inserted, updated };
  });
}
