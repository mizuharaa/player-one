# Engineering diagnostics and showcase isolation

The engineering endpoints are read-only and require an active stored `administrator` role. Transport `operator` claims alone, legacy `admin`, finance and collector/reviewer sessions do not grant access. The shared authentication layer runs first. Diagnostics do not grant financial access.

- `GET /api/engineering/status`: bounded SQL read plus capability registry. Only database read completion is called healthy. Configured integrations remain unprobed; manual payment remains manual. External archive/job liveness stays unknown because no heartbeat registry exists. Development sign-in logging is explicitly not delivery.
- `GET /api/engineering/episodes?limit=25&before=<uuid>`: at most50 metadata rows ordered by UUID (not chronology), plus next_cursor.
- `GET /api/engineering/episodes/:id`: latest ingest metadata and a deliberately lossy EpisodeRecord projection. State/timing/counts and discrepancy codes/severity survive; paths, hosts, serials, source-file names, free text and raw manifest fields do not. Malformed records are withheld. Raw JSON above256KiB is not transferred from PostgreSQL to the API.
- `GET /api/engineering/audit?limit=50&before=<decimal-id>&episode_id=<uuid>`: at most100 rows; no before/after payloads, reasons, names or account details. Non-UUID target identities are redacted. Episode filtering means direct `episodes` audit targets, not an inferred complete cross-table event graph.
- `GET /api/engineering/probes/sample-contract`: fixed in-memory real contract checks for basename parsing, deterministic identity, malformed-record rejection and discrepancy classification. No supplied SQL, URL, code, filesystem path or payload is executed. It does not claim an end-to-end ingest or provider-health test.

Diagnostics data queries use read-only transactions with a two-second statement timeout. Query schemas are strict and SQL values parameterized. JSON is data; the UI must render it as text, never HTML. Showcase filename/note fidelity is retained, with React text rendering on the existing UI; media is served only as allowed video MIME with nosniff and private/no-store.

## Showcase RLS (0028)

0028 enables and forces RLS only on showcase_footage. Each API clip read/write uses `set_config('app.showcase_operator_id', verifiedOperatorId, true)` inside its transaction. No request field can select this identity. Commit and rollback clear it before a pooled connection is reused. Missing context sees no rows; cross-owner INSERT fails; cross-owner reads/review/deletion cannot affect another owner. API owner predicates remain as an additional layer.

The separate trusted migration/table owner has an explicit maintenance policy. Fixed-purpose SECURITY DEFINER quota and expiry functions use `search_path=pg_catalog` and fully qualified table references. Runtime cannot become that owner and has neither superuser nor BYPASSRLS. It retains only verdict/note/reviewed_at column UPDATE grants. The purge function takes no arguments and can remove expired rows only. The quota trigger sees all owners so the200MiB global quota remains concurrency-safe under RLS. No production money/schema joins are added.

This protects against omitted owner predicates; it is not a claim that compromised database credentials or arbitrary SQL execution cannot set a custom PostgreSQL setting. Parameterization, authenticated server ownership of the context and absence of arbitrary execution endpoints remain necessary. Trusted database owners/superusers remain administrative boundaries.

Migration deployment must precede the new API (which calls the new expiry function). Existing applied0026/0027 remain untouched. No local operational database or production migration was applied during implementation. Test fixtures use fresh isolated databases with actual playerone_app grants and existing default privileges.
