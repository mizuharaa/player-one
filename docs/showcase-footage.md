# Private demo footage workflow

`/showcase` lets an active operator upload a short video, play the stored bytes
back, and record a clearly labelled **demo** decision on their own footage.
It does not insert episodes, production reviews, settlements, bills, or payment
attempts. There is no effective-minute field, payout action, or path to promote
a demo decision to production approval. Production reviewer authorization is
unchanged. Reviewer-only and collector tokens cannot use this operator lane.

## Storage and deployment

Clips live in the existing PostgreSQL service in the separate `showcase_footage`
table. This survives Railway web-container replacement; nothing depends on the
web container filesystem. This is deliberately small showcase storage, not a
replacement for the existing S3-compatible production upload pipeline.

Bounds: 20 MiB per clip, five clips per operator, 200 MiB total logical video
bytes. A PostgreSQL trigger takes a transaction advisory lock before checking
both quotas, so concurrent replicas cannot overfill them. The API admits two
buffered uploads at once per replica. The database keeps content and its SHA-256
digest; lists and review responses never return the binary column.

Migration `0026_showcase_footage` adds only this isolated table, its indexes and
quota function/trigger. Corrective `0027_showcase_review_grants` removes inherited table UPDATE before granting only review columns. Runtime grants are SELECT/INSERT/DELETE on the table and
UPDATE on the three demo-review fields. Runtime cannot replace a clip's owner,
bytes or expiry using UPDATE. No financial tables or authorization grants change.

Before deploying the corresponding web image, use the **existing separate owner
migration job**, documented in [deploy-showcase.md](deploy-showcase.md#database-setup-stays-separate):

```sh
docker build --target migrate -t playerone-showcase-migrate .
docker run --rm --env-file /secure/path/playerone-owner.env playerone-showcase-migrate
```

For Railway, run that one-off migration image on the private database network,
with the migration owner's DATABASE_URL supplied by the existing private
provisioning process. Never copy owner credentials into the web service, image,
repository or command text. The web service continues using `playerone_app`.
Do not run migrations on web startup. No remote migration is performed merely
by building this code. An older database must be migrated before this feature
is enabled through its navigation link.

## Retention and boundaries

Every media/list/review/delete query includes the authenticated operator ID.
UUIDs are not access credentials. Media requires the same private cookies as the
app, sends `private, no-store` and `nosniff`, and supports a single byte range for
seeking. MP4/WebM signatures are checked; there is no transcoder. Browser codec
failures are reported as playback errors, not claimed to be verified footage.

Mutating endpoints require `X-Showcase-Request: 1` alongside the existing strict
same-site cookies; no CORS access is enabled. Uploaded filenames are metadata,
never filesystem paths. Upload, self-review and explicit deletion use `mutate`
for attributable audit records without embedding video bytes in the audit.

Clips expire after seven days and become unreadable immediately. An hourly
application timer garbage-collects expired rows; each new upload also removes
expired rows before checking quotas. If the service is stopped, expired bytes
remain until an upload or the next hourly cleanup after restart. Audited demo
actions remain as metadata after binary deletion; expiry cleanup is system
retention, not a claimed human review/deletion action. A user can delete a clip
immediately from the studio. PostgreSQL backups follow the database provider's
own retention, independently of this live-table deletion.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/showcase/footage` | Own unexpired metadata and upload limits |
| POST | `/api/showcase/footage?filename=clip.mp4` | Raw `video/mp4` or `video/webm` body, bounded to 20 MiB |
| GET | `/api/showcase/footage/:id/media` | Authenticated playback/readback, optional single Range |
| POST | `/api/showcase/footage/:id/review` | `{ verdict: "good" | "partial" | "bad", note: string }`, demo only |
| DELETE | `/api/showcase/footage/:id` | Delete own unexpired clip |

The browser shows upload progress, cancellation, quota/request failures,
playback errors, a saved decision only after server success, and deletion.
English, Vietnamese and Chinese copy is isolated in the studio module.

