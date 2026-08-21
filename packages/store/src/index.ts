import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  Discrepancy,
  EpisodeRecord as EpisodeRecordSchema,
  parseSessionBasename,
  stateFrom,
  type EpisodeRecord,
} from '@playerone/contracts';
import type { Db } from './db.ts';
import { episodeDefects, episodeFiles, episodeIngests, episodes, episodeStreams } from './schema.ts';

export { DATABASE_URL, migrateTo, open, redact, StoreUnreachableError, type Db } from './db.ts';
export * as schema from './schema.ts';

/** One source file of one delivery. Matches `SourceInventory` in the engine. */
export type SourceFile = { relative_path: string; bytes: number; sha256: string };

export type MismatchPayload = {
  prior_ingest_id: string;
  prior_fingerprint: string;
  current_fingerprint: string;
  /** A reviewer must be able to name the file from the record alone. */
  changed: { relative_path: string; prior_sha256: string; current_sha256: string }[];
  added: { relative_path: string; sha256: string }[];
  removed: { relative_path: string; sha256: string }[];
};

export type StoreResult = {
  outcome: 'new' | 'duplicate' | 'mismatch';
  episodeId: string;
  ingestId: string | null;
  /**
   * The record as stored. Identical to the input except when a mismatch was
   * discovered — see `storeEpisode`.
   */
  record: EpisodeRecord;
  mismatch: MismatchPayload | null;
};

/** numeric columns are written as strings. A JS number here is the bug this store exists to avoid. */
const dec = (n: number, scale: number): string => n.toFixed(scale);

/**
 * Writes one ingest, in one transaction. Either the ingest row and all of its
 * children commit, or nothing does: a partial write is worse than no write,
 * because it reads like a complete record.
 *
 * Three cases, and the difference between them is money.
 *
 *   new        the episode has not been seen. Insert everything.
 *   duplicate  seen, and the fingerprint matches the latest ingest. The same
 *              session arrived twice by two routes — card at the upload centre
 *              and a cloud re-download. Touch `last_seen_at` and nothing else,
 *              so one session is one episode and not two payments.
 *   mismatch   seen, and the bytes differ. Insert a second ingest and attach
 *              CHECKSUM-MISMATCH itemising what changed. This is the one defect
 *              in the catalogue that can only be found at store time, because
 *              it needs a prior state to compare against.
 *
 * The mismatch is also the one intentional exception to "--store must not alter
 * the record": it is attached to the returned record as well as to the stored
 * ingest, so what is printed and what is persisted agree. Everything else about
 * the record is measured before this function is called and is untouched here.
 *
 * A mismatch is flagged and stored. What it costs a collector is settlement's
 * decision, and settlement is not in this milestone.
 */
export async function storeEpisode(
  db: Db,
  input: EpisodeRecord,
  now: Date = new Date(),
): Promise<StoreResult> {
  const episodeId = input.episode_id;
  /**
   * The record carries its own inventory as of schema 1.1.0, so the store no
   * longer takes one alongside. Passing it separately meant `episode_files`
   * could disagree with `content_fingerprint` — and made the fingerprint
   * checkable only by a caller holding both, which is exactly the property the
   * record is supposed to have on its own.
   */
  const files = input.source_files;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(episodes).where(eq(episodes.episodeId, episodeId));

    if (existing === undefined) {
      // The episode row goes in first: episode_ingests.episode_id references it,
      // and latest_ingest_id references back, so the pair is written in two steps
      // inside the one transaction rather than with a deferred constraint.
      await tx.insert(episodes).values({
        episodeId,
        deviceSerial: input.device.serial,
        sessionStartedAt: sessionStartedAt(input.source.path),
        firstSeenAt: now,
        lastSeenAt: now,
        latestIngestId: null,
        ingestCount: 0,
      });
      const ingestId = await writeIngest(tx, input, files, now);
      await tx
        .update(episodes)
        .set({ latestIngestId: ingestId, ingestCount: 1 })
        .where(eq(episodes.episodeId, episodeId));
      return { outcome: 'new', episodeId, ingestId, record: input, mismatch: null };
    }

    const [latest] = existing.latestIngestId
      ? await tx
          .select()
          .from(episodeIngests)
          .where(eq(episodeIngests.ingestId, existing.latestIngestId))
      : await tx
          .select()
          .from(episodeIngests)
          .where(eq(episodeIngests.episodeId, episodeId))
          .orderBy(desc(episodeIngests.ingestedAt))
          .limit(1);

    if (latest !== undefined && latest.contentFingerprint === input.content_fingerprint) {
      // Duplicate delivery. No new ingest row, no second payment.
      await tx.update(episodes).set({ lastSeenAt: now }).where(eq(episodes.episodeId, episodeId));
      return {
        outcome: 'duplicate',
        episodeId,
        ingestId: latest.ingestId,
        record: input,
        mismatch: null,
      };
    }

    const prior = latest
      ? await tx
          .select({ path: episodeFiles.relativePath, sha256: episodeFiles.sha256 })
          .from(episodeFiles)
          .where(eq(episodeFiles.ingestId, latest.ingestId))
      : [];

    const mismatch = diffFiles(latest, prior, files, input.content_fingerprint);
    const record = withMismatch(input, mismatch);
    const ingestId = await writeIngest(tx, record, files, now, mismatch);

    await tx
      .update(episodes)
      .set({
        lastSeenAt: now,
        latestIngestId: ingestId,
        ingestCount: existing.ingestCount + 1,
        deviceSerial: record.device.serial,
      })
      .where(eq(episodes.episodeId, episodeId));

    return { outcome: 'mismatch', episodeId, ingestId, record, mismatch };
  });
}

/**
 * `YYYYMMDD_HHMMSS` from the basename, or the basename itself when it does not
 * parse (the EPISODE-ID-FALLBACK case — the row is still written, ING-17).
 * Same parser the id is derived from, so the two can never drift apart.
 */
function sessionStartedAt(basename: string): string {
  const id = parseSessionBasename(basename);
  return id ? `${id.date}_${id.time}` : basename;
}

const sortedByPath = (m: Map<string, string>): [string, string][] =>
  [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function diffFiles(
  latest: { ingestId: string; contentFingerprint: string } | undefined,
  prior: { path: string; sha256: string }[],
  current: readonly SourceFile[],
  currentFingerprint: string,
): MismatchPayload {
  const before = new Map(prior.map((f) => [f.path, f.sha256]));
  const after = new Map(current.map((f) => [f.relative_path, f.sha256]));
  const payload: MismatchPayload = {
    prior_ingest_id: latest?.ingestId ?? '',
    prior_fingerprint: latest?.contentFingerprint ?? '',
    current_fingerprint: currentFingerprint,
    changed: [],
    added: [],
    removed: [],
  };
  for (const [path, sha256] of sortedByPath(after)) {
    const was = before.get(path);
    if (was === undefined) payload.added.push({ relative_path: path, sha256 });
    else if (was !== sha256) {
      payload.changed.push({ relative_path: path, prior_sha256: was, current_sha256: sha256 });
    }
  }
  for (const [path, sha256] of sortedByPath(before)) {
    if (!after.has(path)) payload.removed.push({ relative_path: path, sha256 });
  }
  return payload;
}

/** Appends CHECKSUM-MISMATCH and re-derives the state. Never mutates the input. */
function withMismatch(input: EpisodeRecord, m: MismatchPayload): EpisodeRecord {
  const named = [
    ...m.changed.map((c) => c.relative_path),
    ...m.added.map((a) => `+${a.relative_path}`),
    ...m.removed.map((r) => `-${r.relative_path}`),
  ];
  const discrepancies = [
    ...input.discrepancies,
    Discrepancy.parse({
      code: 'CHECKSUM-MISMATCH',
      severity: 'flag',
      detail:
        `${m.changed.length} changed, ${m.added.length} added, ${m.removed.length} removed ` +
        `against ingest ${m.prior_ingest_id.slice(0, 8)}: ${named.join(', ')}`,
    }),
  ];
  return { ...input, discrepancies, state: stateFrom(discrepancies) };
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Children are written in a deterministic order — files by relative path,
 * streams by name, defects by code then first-seen order. Two ingests of the
 * same episode then diff line for line, and the tests are stable.
 */
async function writeIngest(
  tx: Tx,
  record: EpisodeRecord,
  files: readonly SourceFile[],
  now: Date,
  mismatch: MismatchPayload | null = null,
): Promise<string> {
  const ingestId = randomUUID();

  await tx.insert(episodeIngests).values({
    ingestId,
    episodeId: record.episode_id,
    contentFingerprint: record.content_fingerprint,
    state: record.state,
    sourceBasename: record.source.path,
    declaredDurationS:
      record.declared?.duration_sec === null || record.declared === null
        ? null
        : dec(record.declared.duration_sec, 6),
    measuredDurationS: dec(record.timing.raw_duration_s, 6),
    timingSource: record.timing.method,
    timingConfidence: record.timing.confidence,
    streamSkewMs: dec(record.timing.max_stream_skew_ms, 3),
    deviceFirmware: record.device.firmware_declared,
    calibrationSerial: record.device.calibration_serial,
    manifestPresent: record.declared !== null,
    engineVersion: record.source.ingest_tool_version,
    host: record.source.ingest_host,
    ingestedAt: now,
    recordJson: record,
  });

  const sorted = [...files].sort((a, b) => (a.relative_path < b.relative_path ? -1 : 1));
  if (sorted.length > 0) {
    await tx.insert(episodeFiles).values(
      sorted.map((f) => ({
        ingestId,
        relativePath: f.relative_path,
        sizeBytes: f.bytes,
        sha256: f.sha256,
      })),
    );
  }

  /**
   * A stream excluded from the usable window is still stored, with why. ING-17:
   * the clock-fault sensor is kept and described, not dropped from the episode.
   */
  const excludedBy = new Map(
    record.discrepancies
      .filter((d) => d.code === 'STREAM-CLOCK-FAULT')
      .map((d) => [d.detail.split(':')[0]!, d.detail]),
  );
  const streams = [...record.streams].sort((a, b) => (a.role < b.role ? -1 : 1));
  if (streams.length > 0) {
    await tx.insert(episodeStreams).values(
      streams.map((s) => ({
        ingestId,
        streamName: s.role,
        sampleCount: s.sample_count,
        durationS: dec(s.span_s, 6),
        timingSource: s.pts_source,
        firstTimestampUs: s.first_pts_us,
        lastTimestampUs: s.last_pts_us,
        excluded: excludedBy.has(s.role),
        exclusionReason: excludedBy.get(s.role) ?? null,
      })),
    );
  }

  // Defect codes are validated in TypeScript, not by a CHECK: the catalogue grows.
  const defects = record.discrepancies
    .map((d, i) => ({ d: Discrepancy.parse(d), i }))
    .sort((a, b) => (a.d.code === b.d.code ? a.i - b.i : a.d.code < b.d.code ? -1 : 1));
  if (defects.length > 0) {
    await tx.insert(episodeDefects).values(
      defects.map(({ d }) => ({
        ingestId,
        code: d.code,
        severity: d.severity,
        payload:
          d.code === 'CHECKSUM-MISMATCH' && mismatch
            ? { detail: d.detail, ...mismatch }
            : { detail: d.detail },
      })),
    );
  }

  return ingestId;
}

// ---------------------------------------------------------------------------
// Read path

export type EpisodeSummary = {
  episodeId: string;
  state: string | null;
  measuredDurationS: string | null;
  declaredDurationS: string | null;
  ingestCount: number;
  lastSeenAt: Date;
};

export async function listEpisodes(
  db: Db,
  opts: { state?: string; limit?: number } = {},
): Promise<EpisodeSummary[]> {
  const limit = opts.limit ?? 50;
  const where = opts.state ? eq(episodeIngests.state, opts.state) : undefined;
  return db
    .select({
      episodeId: episodes.episodeId,
      state: episodeIngests.state,
      measuredDurationS: episodeIngests.measuredDurationS,
      declaredDurationS: episodeIngests.declaredDurationS,
      ingestCount: episodes.ingestCount,
      lastSeenAt: episodes.lastSeenAt,
    })
    .from(episodes)
    .leftJoin(episodeIngests, eq(episodes.latestIngestId, episodeIngests.ingestId))
    .where(where)
    .orderBy(desc(episodes.lastSeenAt))
    .limit(limit);
}

export class AmbiguousEpisodeError extends Error {}

/** Accepts a full UUID or an unambiguous prefix. An ambiguous prefix is an error, never a guess. */
export async function resolveEpisodeId(db: Db, idOrPrefix: string): Promise<string> {
  const rows = await db
    .select({ id: episodes.episodeId })
    .from(episodes)
    .where(sql`${episodes.episodeId}::text like ${idOrPrefix.toLowerCase() + '%'}`)
    .limit(11);

  if (rows.length === 0) throw new AmbiguousEpisodeError(`no episode matches ${idOrPrefix}`);
  if (rows.length > 1) {
    const shown = rows.slice(0, 10).map((r) => r.id);
    throw new AmbiguousEpisodeError(
      `${idOrPrefix} matches ${rows.length > 10 ? 'more than 10' : rows.length} episodes:\n  ` +
        shown.join('\n  '),
    );
  }
  return rows[0]!.id;
}

export type EpisodeDetail = {
  episodeId: string;
  ingestCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  latest: { ingestId: string; record: EpisodeRecord } | null;
  /**
   * Every earlier ingest, newest first. History is append-only and never edited.
   *
   * `record_json` is `jsonb`, which normalises key order, so what comes back is
   * re-parsed through the EpisodeRecord schema on the way out. zod rebuilds the
   * object in schema order, which is the order `ingest()` produced in the first
   * place — so a stored record re-serialises byte-identically to the one that
   * was printed, and a row that somehow does not validate is caught on read
   * rather than trusted downstream.
   */
  prior: { ingestId: string; fingerprint: string; ingestedAt: Date; engineVersion: string }[];
};

export async function showEpisode(db: Db, idOrPrefix: string): Promise<EpisodeDetail> {
  const episodeId = await resolveEpisodeId(db, idOrPrefix);
  const [ep] = await db.select().from(episodes).where(eq(episodes.episodeId, episodeId));
  const history = await db
    .select({
      ingestId: episodeIngests.ingestId,
      fingerprint: episodeIngests.contentFingerprint,
      ingestedAt: episodeIngests.ingestedAt,
      engineVersion: episodeIngests.engineVersion,
      recordJson: episodeIngests.recordJson,
    })
    .from(episodeIngests)
    .where(eq(episodeIngests.episodeId, episodeId))
    .orderBy(desc(episodeIngests.ingestedAt));

  const latestId = ep!.latestIngestId ?? history[0]?.ingestId;
  const latest = history.find((h) => h.ingestId === latestId);

  return {
    episodeId,
    ingestCount: ep!.ingestCount,
    firstSeenAt: ep!.firstSeenAt,
    lastSeenAt: ep!.lastSeenAt,
    latest: latest
      ? { ingestId: latest.ingestId, record: EpisodeRecordSchema.parse(latest.recordJson) }
      : null,
    prior: history
      .filter((h) => h.ingestId !== latestId)
      .map(({ ingestId, fingerprint, ingestedAt, engineVersion }) => ({
        ingestId,
        fingerprint,
        ingestedAt,
        engineVersion,
      })),
  };
}

/** Files of one ingest, in stored order. Used by the tests and by mismatch review. */
export async function filesOf(db: Db, ingestId: string): Promise<SourceFile[]> {
  const rows = await db
    .select()
    .from(episodeFiles)
    .where(eq(episodeFiles.ingestId, ingestId))
    .orderBy(episodeFiles.relativePath);
  return rows.map((r) => ({ relative_path: r.relativePath, bytes: r.sizeBytes, sha256: r.sha256 }));
}

/** Defects of one ingest. */
export async function defectsOf(
  db: Db,
  ingestId: string,
): Promise<{ code: string; severity: string; payload: unknown }[]> {
  return db
    .select({ code: episodeDefects.code, severity: episodeDefects.severity, payload: episodeDefects.payload })
    .from(episodeDefects)
    .where(eq(episodeDefects.ingestId, ingestId))
    .orderBy(episodeDefects.id);
}

/** Streams of one ingest, in stored order. */
export async function streamsOf(db: Db, ingestId: string) {
  return db
    .select()
    .from(episodeStreams)
    .where(eq(episodeStreams.ingestId, ingestId))
    .orderBy(episodeStreams.streamName);
}

/** Every ingest of one episode, newest first. */
export async function ingestsOf(db: Db, episodeId: string) {
  return db
    .select()
    .from(episodeIngests)
    .where(and(eq(episodeIngests.episodeId, episodeId)))
    .orderBy(desc(episodeIngests.ingestedAt));
}
