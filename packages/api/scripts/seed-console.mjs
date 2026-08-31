/**
 * A working review queue, for developing the console against.
 *
 * `verify-review.mjs` already builds this scenario, but it is an assertion
 * script: it truncates, proves the lane works over real HTTP, and its data
 * exists only for the length of the run. This leaves the data in place and
 * prints the credentials, so `pnpm serve` and the Vite dev server have
 * something real to render.
 *
 *   DATABASE_URL=... node packages/api/scripts/seed-console.mjs
 *
 * It makes its own footage with ffmpeg and therefore says nothing about
 * PaXini's encoder — the same caveat `verify-review.mjs` carries. It also
 * **truncates every table**, so point `DATABASE_URL` at a throwaway database.
 *
 * What it seeds, and why each piece is there:
 *
 * - **Six episodes, not one.** A queue with a single item cannot show a queue
 *   depth, a pace figure, or what the screen looks like after a verdict.
 * - **Three already decided**, one of each verdict, so Home's approval rate and
 *   settled value are real numbers rather than zeroes, and so the partial
 *   carries spans and a settlement the way a real one does.
 * - **One with a blocking defect and one unresolved**, because the flag rail
 *   and Home's "needs a human" strip are states the screen has to render and
 *   are exactly the states a happy-path seed never produces.
 * - **Two cards, so both review lanes are populated.** QR-07 routes on the
 *   collection session's two APP-17b declarations, so which queue an episode
 *   lands in is a property of the session it resolved to. Seeded from one
 *   session every episode is in one lane and the other queue reads zero.
 */
import { randomUUID as uid } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { deriveEpisodeId } from '../../contracts/src/identity.ts';
import { open } from '../../store/src/index.ts';
import { buildApi, hashCredential } from '../src/index.ts';

const SECRET = 'pw';
const MEDIA_ROOT = await mkdtemp(join(tmpdir(), 'playerone-console-'));

/**
 * One directory per episode, because that is how the media route resolves.
 *
 * `/media/episode/:id/part/:index` joins the media root to the episode's own
 * `source_basename` — the directory name the card carried. Pointing several
 * episodes at one folder therefore 404s all but the first, which presents as
 * "the footage will not play" on an otherwise healthy screen. The clip is
 * encoded once and copied, so this costs one ffmpeg run rather than six.
 */
const BASENAMES = [
  'ego_AZER76400FE_20260813_073055',
  'ego_AZER76400FE_20260813_081402',
  'ego_AZER76400FE_20260813_084915',
  'ego_AZER76400FE_20260813_092230',
  'ego_AZER76400FE_20260813_101745',
  'ego_AZER76400FE_20260813_110388',
];

const master = join(MEDIA_ROOT, 'master.mp4');
execFileSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y',
   '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=24',
   '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24',
   '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
   '-movflags', '+faststart', master],
  { stdio: 'inherit' },
);

for (const basename of BASENAMES) {
  await mkdir(join(MEDIA_ROOT, basename), { recursive: true });
  await copyFile(master, join(MEDIA_ROOT, basename, `${basename}_camera_left_part0001.mp4`));
}
const { size: clipBytes } = await stat(master);
const CLIP = BASENAMES[0];

const db = await open(undefined, { max: 8 });
for (const t of ['audit_events','settlements','episode_review_spans','episode_review_reasons','episode_reviews','episode_defects','episode_files','episode_streams','episode_ingests','episodes','collection_session_devices','collection_sessions','upload_batches','handovers','operators','upload_devices','upload_centres','devices','device_types','collectors','tasks','scenarios'])
  await db.execute(sql.raw(`truncate ${t} cascade`));

const id = Object.fromEntries(
  ['centre','machine','operator','finance','collector','dtype','device','task','scenario'].map((k) => [k, uid()]),
);
const hash = await hashCredential(SECRET);
await db.execute(sql`insert into upload_centres (id,region,name,status) values (${id.centre},'HCM','D7','active')`);
await db.execute(sql`insert into upload_devices (id,upload_centre_id,machine_identifier,status,credential_hash) values (${id.machine},${id.centre},'HCM-01','active',${hash})`);
// op-1 is an `administrator`, not a `centre_operator`. BO-11 (0020) put the
// nine shaping routes — tasks, collectors, devices, bind, unbind, assignments
// — behind that role, and 0020 backfills every existing centre_operator to it,
// so an administrator is what a seeded operator would be on a real deployment.
// The counter work (GETs, claim, release) is open to either.
await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.operator},${id.centre},'op-1','administrator',${hash})`);
// Two accounts, because the money path needs two people. The settle and payout
// screens are finance's, and `settle_generate_by_finance` refuses finance the
// generate: whoever issues a bill is the operator 0013 will not let pay it.
await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.finance},${id.centre},'fin-1','finance',${hash})`);
await db.execute(sql`insert into collectors (id,external_ref,status) values (${id.collector},'c-1','qualified')`);
await db.execute(sql`insert into device_types (id,code,generation) values (${id.dtype},'ego_headset','gen1')`);
await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device},${id.dtype},'AZER76400FE','active')`);
await db.execute(sql`insert into tasks (id,name,unit_price,max_concurrent_claimants,status) values (${id.task},'Housework',1200,5,'published')`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${id.scenario},'home','low')`);
// 0016: the session below is recorded under a live claim, and the claim guard
// (0006) wants the exam pass and all six agreements first.
await db.execute(sql`update collectors set exam_result = 'pass', exam_decided_at = now() where id = ${id.collector}`);
await db.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
  select ${id.collector}, a, 'v1', now()
    from unnest(array['user','privacy','data_collection','commercial_use','manual_review','offline_settlement']) as a`);
await db.execute(sql`insert into task_claims (id, task_id, collector_id) values (${uid()}, ${id.task}, ${id.collector})`);

const app = buildApi({ db, tokenSecret: 'k', mediaRoot: MEDIA_ROOT, currency: 'VND' });
const tok = async (url, payload) => (await app.inject({ method: 'POST', url, payload })).json().token;
const headers = {
  'x-machine-token': `Bearer ${await tok('/auth/machine', { machine_identifier: 'HCM-01', secret: SECRET })}`,
  authorization: `Bearer ${await tok('/auth/operator', { external_ref: 'op-1', secret: SECRET })}`,
};
/**
 * Every write is checked here rather than at each call site. A seed that posts
 * a handover, is refused, and carries on printing "Seeded." is the failure this
 * script already had once: the console then shows zeroes that read as real.
 */
const post = async (url, payload) => {
  const res = await app.inject({ method: 'POST', url, payload, headers });
  if (res.statusCode >= 300) throw new Error(`POST ${url} -> ${res.statusCode} ${res.body}`);
  return res;
};

/**
 * `declaredSec` is deliberately about a third above the measured span on most
 * of these: UPL-08 says the manifest's duration is wall clock and overstates
 * media, and the discrepancy row on the review rail is one of the things a
 * reviewer is meant to notice.
 */
function record({ basename, spanSeconds, declaredSec, minutesAgo }) {
  const startUs = String(BigInt(Date.now() - minutesAgo * 60_000) * 1000n);
  const endUs = String(BigInt(startUs) + BigInt(Math.round(spanSeconds * 1_000_000)));
  return {
    schema_version: '1.1.0',
    // Global and derived from the basename, never chosen: `POST /upload-batches/:id/episodes`
    // re-derives it and refuses a record that disagrees with itself (docs/episode-identity.md).
    episode_id: deriveEpisodeId(basename),
    content_fingerprint: uid().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
    state: 'ok',
    source: {
      path: basename,
      ingest_tool_version: '0.3.1',
      ingested_at: new Date().toISOString(),
      ingest_host: 'seed',
    },
    device: { serial: 'AZER76400FE', firmware_declared: '1.0.3', calibration_serial: null },
    declared: {
      session_id: null, status: 'completed', duration_sec: declaredSec, start_time: null,
      end_time: null, video_left_frame_count: null, video_right_frame_count: null,
      imu_accel_count: null, imu_gyro_count: null, audio_frame_count: null,
    },
    streams: [{
      role: 'camera_left',
      /** Its own directory, matching `source.path`, so the media route resolves. */
      parts: [{ file: `${basename}_camera_left_part0001.mp4`, bytes: clipBytes, sha256: 'b'.repeat(64) }],
      pts_source: 'sidecar',
      first_pts_us: startUs,
      last_pts_us: endUs,
      sample_count: Math.round(spanSeconds * 30),
      span_s: spanSeconds,
      nominal_rate_hz: 30,
    }],
    timing: {
      method: 'pts_sidecar', confidence: 'exact',
      usable_start_us: startUs, usable_end_us: endUs,
      raw_duration_s: spanSeconds, max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
}

const episodes = [
  record({ basename: BASENAMES[0], spanSeconds: 132.961, declaredSec: 178, minutesAgo: 240 }),
  record({ basename: BASENAMES[1], spanSeconds: 96.4, declaredSec: 128, minutesAgo: 210 }),
  record({ basename: BASENAMES[2], spanSeconds: 203.2, declaredSec: 271, minutesAgo: 180 }),
  record({ basename: BASENAMES[3], spanSeconds: 74.8, declaredSec: 99, minutesAgo: 150 }),
  record({ basename: BASENAMES[4], spanSeconds: 158.05, declaredSec: 210, minutesAgo: 120 }),
  record({ basename: BASENAMES[5], spanSeconds: 112.3, declaredSec: 149, minutesAgo: 90 }),
];

/**
 * One card per lane, and one session per card.
 *
 * Two sessions on a single handover is not the same thing and does not work:
 * both are handover-origin, the resolver has no tie-break for two of those
 * (`operator_confirmation_required`), and every episode would quarantine
 * unresolved instead of reaching either queue.
 *
 * Four standard against two privacy, because the three verdicts below are taken
 * from the standard queue and both depths still have to be non-zero after them.
 */
const cards = [
  { tfCardId: 'CARD-1', othersInFrame: false, lane: 'standard', episodes: episodes.slice(0, 4) },
  { tfCardId: 'CARD-2', othersInFrame: true, lane: 'privacy', episodes: episodes.slice(4) },
];

for (const card of cards) {
  const handover = uid();
  await post('/handovers', {
    id: handover,
    collector_id: id.collector,
    device_id: id.device,
    tf_card_id: card.tfCardId,
    handover_time: new Date().toISOString(),
  });
  const batch = uid();
  await post('/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date().toISOString() });
  await post(`/handovers/${handover}/sessions`, {
    id: uid(),
    task_id: id.task,
    scenario_id: id.scenario,
    others_in_frame: card.othersInFrame,
    sensitive_info_present: false,
    prepare_time: new Date(Date.now() - 7_200_000).toISOString(),
  });

  /**
   * The submission answers 200 even when every record in it was refused — the
   * per-episode result carries the refusal. An unresolved episode is not in any
   * queue either, so both are fatal to a seed and both are named here.
   */
  const results = (await post(`/upload-batches/${batch}/episodes`, { episodes: card.episodes })).json().episodes ?? [];
  const bad = results.filter((r) => r.resolution_state !== 'resolved');
  if (bad.length > 0 || results.length !== card.episodes.length) {
    throw new Error(`${card.tfCardId}: ${results.length}/${card.episodes.length} submitted, ${bad.length} not resolved:
${JSON.stringify(bad, null, 2)}`);
  }
  for (const r of results) console.log(`  ${card.tfCardId}  ${card.lane}  ${r.episode_id}  ${r.resolution_state}`);
}

/**
 * Three verdicts, so the shift figures are not all zero.
 *
 * These go through the real endpoints rather than straight into the tables —
 * that way the settlement rows, the audit rows and the span rows are all
 * written by the code that will write them in production, and a seeded row can
 * never be shaped differently from a real one.
 */
const login = await app.inject({
  method: 'POST', url: '/api/session',
  payload: { machine_identifier: 'HCM-01', machine_secret: SECRET, external_ref: 'op-1', operator_secret: SECRET },
});
const jar = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
const asReviewer = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: jar } });

const decisions = [
  { decision: 'good', spans: [], reject_reasons: [] },
  { decision: 'partial', spans: [{ start_seconds: 4.5, end_seconds: 61.2 }, { start_seconds: 74.0, end_seconds: 96.4 }], reject_reasons: [] },
  { decision: 'bad', spans: [], reject_reasons: ['VQ-DARK'] },
];

for (const d of decisions) {
  // No `?queue=`, which is the standard lane — CARD-1's four. The privacy lane
  // is `?queue=privacy` and is deliberately left undecided, so the console has
  // something in it.
  const claim = await asReviewer('POST', '/api/review/claim');
  // 204 is an empty queue, and breaking on it silently is how this script used
  // to report six refused episodes as a successful seed.
  if (claim.statusCode !== 200) throw new Error(`claim from the standard queue -> ${claim.statusCode} ${claim.body}`);
  const episode = claim.json();
  const res = await asReviewer('POST', '/api/review/verdict', {
    verdict_id: uid(),
    episode_id: episode.episode_id,
    ...d,
    time_to_verdict_seconds: 24 + Math.random() * 22,
  });
  if (res.statusCode !== 200) throw new Error(`verdict ${d.decision} -> ${res.statusCode} ${res.body}`);
  console.log(`  verdict ${d.decision} on ${episode.session_folder}`);
}

const shift = await asReviewer('GET', '/api/review/shift');
console.log('\nshift:', JSON.stringify(shift.json(), null, 2));

const figures = shift.json();
/**
 * The URL is named, not printed. This block is meant to be pasted into the
 * shell that just ran the seed, so `"$DATABASE_URL"` is the same value with
 * none of it on the screen or in the scrollback — every other site that
 * prints a connection string puts it through `redact()` first.
 */
console.log(`
Seeded. Queue depth ${figures.queue_depth} standard, ${figures.privacy_queue_depth} privacy;
${figures.decided} decided (${figures.approved} approved); ${figures.settled_amount} ${figures.currency} settled;
${figures.needs_human} needing a human. Zeroes on that line mean the seed did nothing.

Now run, in two shells (the second line needs the same DATABASE_URL
this seed ran with; in PowerShell write it "$env:DATABASE_URL"):

  DATABASE_URL="$DATABASE_URL" \\
  PLAYERONE_TOKEN_SECRET=dev \\
  PLAYERONE_MEDIA_ROOT=${MEDIA_ROOT} \\
  pnpm serve

  pnpm -F @playerone/console dev

Sign in with  HCM-01 / ${SECRET}  and  op-1 / ${SECRET}  for the counter and
the review lane, or  fin-1 / ${SECRET}  for the settle and payout screens.
`);

await app.close();
process.exit(0);
