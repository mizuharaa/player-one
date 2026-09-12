/**
 * One collector's whole Path C story, as one JSON. Read-only.
 *
 * Given any one of a collector / session / episode / ingest / handover /
 * batch / bill / attempt id, this walks the foreign keys out to that
 * collector and back down through every row that traces to them: sessions,
 * handovers, upload batches, episodes and their ingests, files (with their
 * sha256), cloud verifications, reviews (measured vs effective duration),
 * settlements, bills, bill lines, payout accounts, attempts and events.
 *
 * It writes nothing and prints nothing that was not already in the database
 * or in `git rev-parse HEAD` of this checkout — no STORAGE_* var is read, and
 * the database URL is redacted the same way `redact()` in `store/src/db.ts`
 * redacts it everywhere else.
 *
 *   DATABASE_URL=... node packages/api/scripts/demo-evidence.mjs --episode <uuid>
 *
 * One of: --collector --session --episode --ingest --handover --batch --bill --attempt
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { filesOf, ingestsOf, open, redact, schema, streamsOf } from '../../store/src/index.ts';

const KINDS = ['collector', 'session', 'episode', 'ingest', 'handover', 'batch', 'bill', 'attempt'];

function usageFail(message) {
  console.error(message);
  console.error(`usage: DATABASE_URL=... node demo-evidence.mjs --<${KINDS.join('|')}> <uuid>`);
  process.exit(2);
}

function parseArgs(argv) {
  let kind, id;
  for (const k of KINDS) {
    const i = argv.indexOf(`--${k}`);
    if (i !== -1) {
      if (kind !== undefined) usageFail(`only one of --${KINDS.join(', --')} may be given`);
      kind = k;
      id = argv[i + 1];
    }
  }
  if (kind === undefined || id === undefined) usageFail('an id is required');
  return { kind, id };
}

/** `git rev-parse HEAD` of the checkout this script lives in, or null if that fails. */
function sourceSha() {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const { kind, id } = parseArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) usageFail('DATABASE_URL is required');

const db = await open(databaseUrl, { max: 1 });
const {
  collectors,
  collectionSessions,
  handovers,
  uploadBatches,
  episodes,
  episodeIngests,
  episodeReviews,
  settlements,
  bills,
  billLines,
  payoutAccounts,
  payoutAttempts,
  payoutEvents,
  cloudVerifications,
} = schema;

async function one(table, column, value) {
  const [row] = await db.select().from(table).where(eq(column, value));
  return row;
}

/** Walks whichever id kind was given up to the collector it belongs to. */
async function collectorIdFor(kind, id) {
  switch (kind) {
    case 'collector':
      return id;
    case 'session': {
      const row = await one(collectionSessions, collectionSessions.id, id);
      if (!row) usageFail(`no session ${id}`);
      return row.collectorId;
    }
    case 'episode': {
      const row = await one(episodes, episodes.episodeId, id);
      if (!row) usageFail(`no episode ${id}`);
      if (!row.collectionSessionId) usageFail(`episode ${id} is quarantined, not resolved to a session`);
      return collectorIdFor('session', row.collectionSessionId);
    }
    case 'ingest': {
      const row = await one(episodeIngests, episodeIngests.ingestId, id);
      if (!row) usageFail(`no ingest ${id}`);
      return collectorIdFor('episode', row.episodeId);
    }
    case 'handover': {
      const row = await one(handovers, handovers.id, id);
      if (!row) usageFail(`no handover ${id}`);
      return row.collectorId;
    }
    case 'batch': {
      const row = await one(uploadBatches, uploadBatches.id, id);
      if (!row) usageFail(`no batch ${id}`);
      return collectorIdFor('handover', row.handoverId);
    }
    case 'bill': {
      const row = await one(bills, bills.id, id);
      if (!row) usageFail(`no bill ${id}`);
      return row.collectorId;
    }
    case 'attempt': {
      const row = await one(payoutAttempts, payoutAttempts.id, id);
      if (!row) usageFail(`no attempt ${id}`);
      return collectorIdFor('bill', row.billId);
    }
  }
}

const collectorId = await collectorIdFor(kind, id);
const collector = await one(collectors, collectors.id, collectorId);
if (!collector) usageFail(`collector ${collectorId} does not exist`);

const sessions = await db
  .select()
  .from(collectionSessions)
  .where(eq(collectionSessions.collectorId, collectorId));
const sessionIds = sessions.map((s) => s.id);

const handoverRows = await db.select().from(handovers).where(eq(handovers.collectorId, collectorId));
const handoverIds = handoverRows.map((h) => h.id);

const batchRows = handoverIds.length
  ? await db.select().from(uploadBatches).where(inArray(uploadBatches.handoverId, handoverIds))
  : [];

const episodeRows = sessionIds.length
  ? await db.select().from(episodes).where(inArray(episodes.collectionSessionId, sessionIds))
  : [];

const episodesOut = [];
for (const ep of episodeRows) {
  const ingestRows = await ingestsOf(db, ep.episodeId);
  const ingestsOut = [];
  for (const ing of ingestRows) {
    const [files, streams, verifications] = await Promise.all([
      filesOf(db, ing.ingestId),
      streamsOf(db, ing.ingestId),
      db.select().from(cloudVerifications).where(eq(cloudVerifications.ingestId, ing.ingestId)),
    ]);
    // `record_json` is the raw EpisodeRecord already reachable through
    // `files`/`streams` above; dropped here so one ingest is not printed twice.
    const { recordJson, ...ingestFields } = ing;
    ingestsOut.push({ ...ingestFields, files, streams, cloudVerifications: verifications });
  }
  const reviews = await db.select().from(episodeReviews).where(eq(episodeReviews.episodeId, ep.episodeId));
  episodesOut.push({ ...ep, ingests: ingestsOut, reviews });
}

const reviewIds = episodesOut.flatMap((e) => e.reviews.map((r) => r.id));
const settlementRows = reviewIds.length
  ? await db.select().from(settlements).where(inArray(settlements.episodeReviewId, reviewIds))
  : [];

const billRows = await db.select().from(bills).where(eq(bills.collectorId, collectorId));
const billIds = billRows.map((b) => b.id);

const billLineRows = billIds.length
  ? await db.select().from(billLines).where(inArray(billLines.billId, billIds))
  : [];
const billsOut = billRows.map((b) => ({
  ...b,
  lines: billLineRows.filter((l) => l.billId === b.id).map((l) => l.settlementId),
}));

const payoutAccountRows = await db
  .select()
  .from(payoutAccounts)
  .where(eq(payoutAccounts.collectorId, collectorId));

const attemptRows = billIds.length
  ? await db.select().from(payoutAttempts).where(inArray(payoutAttempts.billId, billIds))
  : [];

const eventRows = await db.select().from(payoutEvents).where(eq(payoutEvents.collectorId, collectorId));

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      queriedBy: { kind, id },
      database: redact(databaseUrl),
      serverSourceSha: sourceSha(),
      collector,
      sessions,
      handovers: handoverRows,
      uploadBatches: batchRows,
      episodes: episodesOut,
      settlements: settlementRows,
      bills: billsOut,
      payoutAccounts: payoutAccountRows,
      payoutAttempts: attemptRows,
      payoutEvents: eventRows,
    },
    null,
    2,
  ),
);

await db.close();
