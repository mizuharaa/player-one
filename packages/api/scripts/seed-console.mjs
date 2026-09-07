/**
 * A demonstrable console, for developing and for showing the product.
 *
 * `verify-review.mjs` already builds a review scenario, but it is an assertion
 * script: it truncates, proves the lane works over real HTTP, and its data
 * exists only for the length of the run. This leaves the data in place and
 * prints the credentials, so `pnpm serve` and the Vite dev server have
 * something real to render.
 *
 *   DATABASE_URL=... node packages/api/scripts/seed-console.mjs
 *   pnpm demo                     seeds, then starts the API and the console
 *
 * It **truncates every table**, so point `DATABASE_URL` at a throwaway
 * database.
 *
 * ## Where the footage comes from
 *
 * Two sources, and the closing summary always names the one it used, because a
 * demonstration on 32-byte stubs that is believed to be real footage is worse
 * than no demonstration:
 *
 * - **The real sample corpus** — five sessions from device `AZER76400FE`,
 *   located exactly the way the tests locate it (`PLAYERONE_SESSIONS`, else
 *   `docs/sample_data/`). Real H.264, real IMU, real PTS sidecars, measured by
 *   the real engine.
 * - **`fixtures/sessions/`** — committed, synthetic, one per failure mode. Its
 *   MP4s are 32-byte stubs: every measurement is real, and **playback will not
 *   work**.
 *
 * Either way the records come from `ingest()` — the same function the counter
 * runs — and go in through `POST /upload-batches/:id/episodes`. Nothing is
 * hand-shaped. The corpus has five sessions and the deck below wants six, so
 * on a machine with the corpus the last slot is topped up from the fixtures
 * and the summary says so.
 *
 * ## What it seeds, and why each piece is there
 *
 * - **Six episodes in the review lane, not one.** A queue with a single item
 *   cannot show a queue depth, a pace figure, or what the screen looks like
 *   after a verdict.
 * - **Four decided, two left waiting.** One of each verdict, so Home's approval
 *   rate and settled value are real numbers rather than zeroes — and one
 *   episode still in each of the two queues, so `/review` is not a dead end.
 * - **Two cards, so both review lanes are populated.** QR-07 routes on the
 *   collection session's two APP-17b declarations, so which queue an episode
 *   lands in is a property of the session it resolved to.
 * - **Two collectors, two cards, two tasks.** `CLAUDE.md` records a payment bug
 *   that every test was green through, because every fixture used a single
 *   handover — the exact shape that hides it.
 * - **A third card the resolver refuses to guess on.** Two collection sessions
 *   declared on one handover, both handover-origin, so the resolver has no
 *   tie-break and the episodes land `operator_confirmation_required`. That is
 *   Principle 1 working, and it is what puts rows on `/episodes` and on Home's
 *   "needs a human" strip. A quarantined delivery rides the same batch so the
 *   batch summary's quarantine count is not zero either.
 * - **Bills, one payout account, one recorded payment.** All through the real
 *   routes and the real people: `op-1` generates the cycle and declares the
 *   account at the counter, `fin-1` records the transfer — which is what
 *   `settle_generate_by_finance` and `payout_separation_of_duty` require.
 * - **The second collector deliberately has no payout account.** The refusal
 *   `no_account` is a real one and the exceptions screen exists to show it.
 *   Declaring an account for everybody would empty a screen that is supposed
 *   to have something on it.
 * - **One risk tick.** The engine evaluates the seeded bills itself; whatever
 *   it says is what it says. No flag is written by hand.
 */
import { randomUUID as uid } from 'node:crypto';
import { mkdtemp, mkdir, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { ingest } from '../../ingest/src/ingest.ts';
/**
 * The corpus locator the tests use, imported rather than copied: it already
 * knows about `PLAYERONE_SESSIONS`, about `docs/sample_data/`, and about the
 * one level of wrapper directory the archive arrives in.
 */
import { SESSIONS_ROOT } from '../../ingest/test/sessions.ts';
import { DEFECT_CATALOGUE, open } from '../../store/src/index.ts';
import { buildApi, hashCredential } from '../src/index.ts';
/**
 * The ZaloPay seam's test double, so one collector can have a *verified*
 * payout account and the payment screens can be walked. It is not a way past
 * a refusal — `payout_attempts_account_unverified` still refuses every
 * destination this stub did not verify, which is why the second collector
 * below has no account at all and stays refused. The stored `m_u_id` is
 * `mu-seed-0001` so the row is recognisable as seeded wherever it surfaces.
 */
import { StubZaloPay } from '../test/payout/domain/stub-client.ts';
import { RiskEngine } from '../src/risk/engine.ts';
import { tick } from '../src/risk/worker.ts';

const SECRET = 'pw';
const REPO = join(import.meta.dirname, '..', '..', '..');
/**
 * One media root, holding a directory junction per episode, because that is
 * how the media route resolves: `/media/episode/:id/part/:index` joins the
 * media root to the episode's own `source_basename` — the directory name the
 * card carried. Junctions rather than copies: the corpus is 630 MB and no
 * demonstration is worth moving it, and `symlink(..., 'junction')` needs no
 * elevation on Windows.
 */
const MEDIA_ROOT = process.env['PLAYERONE_MEDIA_ROOT'] ?? (await mkdtemp(join(tmpdir(), 'playerone-console-')));

/* ---------------------------------------------------------------- the deck */

/** Every `ego_*` directory directly under `root`, sorted, or none. */
async function egoDirs(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith('ego_'))
      .map((e) => join(root, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Every committed fixture session. One wrapper directory each, one session inside. */
async function fixtureDirs() {
  const base = join(REPO, 'fixtures', 'sessions');
  const out = [];
  for (const wrapper of (await readdir(base)).sort()) out.push(...(await egoDirs(join(base, wrapper))));
  return out;
}

/**
 * Measure a directory the way the counter measures it, and say whether the
 * result can be reviewed at all.
 *
 * Three things keep an episode out of `review.ts`'s `eligible`, and all three
 * are checked here rather than discovered as an empty queue at the end: a
 * quarantined ingest, a zero measurement, and any defect whose catalogue entry
 * says `blocks_review`. The last one is not academic: **two of the five real
 * sample sessions carry `MEDIA-TRUNCATED` and cannot be reviewed at all.**
 * 072538 and 073055 were both never closed by the device, which is the defect.
 * The corpus therefore supplies three reviewable sessions, not five, and the
 * deck below is topped up from the fixtures for the rest.
 */
function measurer(blocking) {
  return async (dir) => {
    try {
      const record = await ingest(dir);
      const blocked = record.discrepancies.some((d) => blocking.has(d.code));
      return {
        dir,
        record,
        blocked,
        reviewable: record.state !== 'quarantined' && record.timing.raw_duration_s > 0 && !blocked,
      };
    } catch (err) {
      return { dir, record: null, blocked: false, reviewable: false, error: err };
    }
  };
}

/** First wins on a duplicate episode id — `delivery-a` and `delivery-b` are one episode twice. */
function dedupe(measured) {
  const seen = new Set();
  return measured.filter((m) => m.record !== null && !seen.has(m.record.episode_id) && seen.add(m.record.episode_id));
}

/** How many reviewable sessions the deck below wants. */
const DECK_SIZE = 6;

const db = await open(undefined, { max: 8 });
/**
 * The catalogue itself, not a literal list and not a query: `defect_codes` is
 * empty on a freshly migrated database until something seeds it, so reading
 * the table here found nothing and let two unreviewable sessions into the
 * queue. `DEFECT_CATALOGUE` is what fills that table.
 */
const blocking = new Set(DEFECT_CATALOGUE.filter((d) => d.blocksReview).map((d) => d.code));
const measure = measurer(blocking);

console.log(`Looking for the real sample corpus at ${SESSIONS_ROOT}`);
const realDirs = await egoDirs(SESSIONS_ROOT);
const realMeasured = await Promise.all(realDirs.map(measure));
const real = dedupe(realMeasured.filter((m) => m.reviewable));
const allFixtures = await Promise.all((await fixtureDirs()).map(measure));
const fixtures = dedupe(allFixtures.filter((m) => m.reviewable));

if (real.length === 0 && fixtures.length === 0) throw new Error('no session directory could be measured: no corpus and no fixtures');

/**
 * The corpus decides the source. Topping a short corpus up from the fixtures
 * is stated rather than hidden — the top-ups take already-decided roles, so
 * nothing a reviewer is asked to watch on this demonstration is a stub while
 * the corpus is present.
 */
const source = real.length > 0 ? 'real' : 'fixtures';
const deck = (source === 'real' ? [...real, ...fixtures] : fixtures).slice(0, DECK_SIZE);
const toppedUp = source === 'real' ? Math.max(0, deck.length - real.length) : 0;
if (deck.length < 5) throw new Error(`only ${deck.length} reviewable session(s) found; the deck needs at least 5`);

/**
 * What each session is for, in deck order.
 *
 * The order is not arbitrary, because the deck is ordered too: the real
 * sessions come first, so whatever is listed first here is what real footage
 * is spent on. **The two waiting queues come before the extra verdicts**, so
 * on a machine with the corpus the episodes a reviewer is asked to sit down
 * and watch are real, and only the already-decided rows can be stubs.
 */
const ROLES = [
  { card: 1, decision: 'good' },
  { card: 1, decision: null },
  { card: 2, decision: null },
  { card: 1, decision: 'partial' },
  { card: 2, decision: 'good' },
  { card: 1, decision: 'bad' },
];

/**
 * The attention lane's material: always fixtures, because nothing here is ever
 * reviewed or paid, so a 32-byte stub costs nothing. `delivery-a` and
 * `delivery-b` are one episode delivered twice, which is why this is deduped.
 */
const inDeck = new Set(deck.map((m) => m.record.episode_id));
const spare = (m) => m.record !== null && !inDeck.has(m.record.episode_id);
const confirmable = dedupe(allFixtures.filter((m) => m.reviewable && spare(m))).slice(0, 2);
const quarantined = dedupe(allFixtures.filter((m) => spare(m) && m.record.state === 'quarantined')).slice(0, 1);

/* -------------------------------------------------------------- media root */

for (const m of [...deck, ...confirmable, ...quarantined]) {
  const link = join(MEDIA_ROOT, basename(m.dir));
  await mkdir(MEDIA_ROOT, { recursive: true });
  await symlink(m.dir, link, 'junction').catch((e) => {
    if (e.code !== 'EEXIST') throw e;
  });
}

/* ------------------------------------------------------------------- rows */

for (const t of ['audit_events','payout_events','payout_attempts','payout_accounts','risk_holds','risk_flags','bill_lines','bills','settlements','episode_review_spans','episode_review_reasons','episode_reviews','episode_defects','episode_files','episode_streams','episode_ingests','episodes','collection_session_devices','collection_sessions','upload_batches','handovers','operators','upload_devices','upload_centres','devices','device_types','collectors','tasks','scenarios'])
  await db.execute(sql.raw(`truncate ${t} cascade`));

const id = Object.fromEntries(
  ['centre','machine','operator','finance','reviewer','dtype','device','device2','scenario','scenarioOffice']
    .map((k) => [k, uid()]),
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
// A third account, because the sign-in screen has three doors and only two of
// them opened. PLT-10 puts PaXini's reviewers in Shenzhen, not at a VNG
// counter, so choosing "Reviewer" on `/login` drops the machine fieldset and
// posts one credential — and `session.ts` looks that up with
// `role = 'reviewer'`, which nothing here created. Every reviewer sign-in
// against a seeded database answered 401 with `credentials`, which is the same
// sentence a wrong password gets, so it read as a typo rather than as an
// account that was never made.
//
// `upload_centre_id` is null on purpose and the schema requires it to be
// possible: a reviewer belongs to no centre, which is the whole point of the
// role, and the partial indexes on `operators` are written around exactly that
// (`upload_centre_id is not null or role = 'reviewer'`).
await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.reviewer},null,'rev-1','reviewer',${hash})`);
await db.execute(sql`insert into device_types (id,code,generation) values (${id.dtype},'ego_headset','gen1')`);
await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device},${id.dtype},'AZER76400FE','active')`);
await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device2},${id.dtype},'SYNTH0000001','active')`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${id.scenario},'home','low')`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${id.scenarioOffice},'office','medium')`);

/**
 * Two tasks and two collectors.
 *
 * `CLAUDE.md`: every test was green while a payment bug sat in the resolver,
 * because candidate sessions were scoped by collector instead of by handover
 * and *every fixture used a single handover*. A second collector, a second
 * card and a second task are the shape that would have caught it, and they are
 * also what makes the back office and the settle list look like a list.
 */
const tasks = [
  { id: uid(), name: 'Housework', unitPrice: 1200 },
  { id: uid(), name: 'Warehouse handling', unitPrice: 1500 },
];
for (const t of tasks)
  await db.execute(sql`insert into tasks (id,name,unit_price,max_concurrent_claimants,status) values (${t.id},${t.name},${t.unitPrice},5,'published')`);

const collectors = [
  { id: uid(), ref: 'c-1', task: tasks[0], claim: uid() },
  { id: uid(), ref: 'c-2', task: tasks[1], claim: uid() },
];
for (const c of collectors) {
  await db.execute(sql`insert into collectors (id,external_ref,status) values (${c.id},${c.ref},'qualified')`);
  // 0016: every session below is recorded under a live claim, and the claim
  // guard (0006) wants the exam pass and all six agreements first.
  await db.execute(sql`update collectors set exam_result = 'pass', exam_decided_at = now() where id = ${c.id}`);
  await db.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
    select ${c.id}, a, 'v1', now()
      from unnest(array['user','privacy','data_collection','commercial_use','manual_review','offline_settlement']) as a`);
  await db.execute(sql`insert into task_claims (id, task_id, collector_id) values (${c.claim}, ${c.task.id}, ${c.id})`);
}

/* -------------------------------------------------------------------- api */

const zalopay = new StubZaloPay();
const app = buildApi({
  db,
  tokenSecret: 'k',
  mediaRoot: MEDIA_ROOT,
  currency: 'VND',
  payout: { client: zalopay },
});
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
const post = async (url, payload, method = 'POST') => {
  const res = await app.inject({ method, url, payload, headers });
  if (res.statusCode >= 300) throw new Error(`${method} ${url} -> ${res.statusCode} ${res.body}`);
  return res;
};

/**
 * One card, its handover, its declared session(s), its batch, and its episodes.
 *
 * `sessions` is a list because the third card declares two of them: both are
 * handover-origin, the resolver has no tie-break for two of those, and every
 * episode on that card therefore lands `operator_confirmation_required`
 * instead of resolving. That is the refusal working, and it is the only way to
 * put a row on `/episodes` without inventing one.
 */
async function card({ tfCardId, collector, device, scenario, othersInFrame, sessions, measured, minutesAgo }) {
  const handover = uid();
  await post('/handovers', {
    id: handover,
    collector_id: collector.id,
    device_id: device,
    tf_card_id: tfCardId,
    handover_time: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });
  const batch = uid();
  await post('/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() });
  for (let s = 0; s < sessions; s += 1)
    await post(`/handovers/${handover}/sessions`, {
      id: uid(),
      task_id: collector.task.id,
      scenario_id: scenario,
      others_in_frame: othersInFrame,
      sensitive_info_present: false,
      prepare_time: new Date(Date.now() - (minutesAgo + 60 + s * 30) * 60_000).toISOString(),
    });

  /**
   * The submission answers 200 even when every record in it was refused — the
   * per-episode result carries the refusal — so the results are read, never
   * the status code.
   */
  const results = (await post(`/upload-batches/${batch}/episodes`, { episodes: measured.map((m) => m.record) })).json().episodes ?? [];
  if (results.length !== measured.length) throw new Error(`${tfCardId}: ${results.length}/${measured.length} submitted`);
  return { batch, handover, results };
}

const REVIEW_CARDS = [
  { n: 1, tfCardId: 'CARD-1', collector: collectors[0], device: id.device, scenario: id.scenario, othersInFrame: false, lane: 'standard' },
  { n: 2, tfCardId: 'CARD-2', collector: collectors[1], device: id.device, scenario: id.scenarioOffice, othersInFrame: true, lane: 'privacy' },
];

/**
 * Which session plays which part.
 *
 * The waiting roles are dealt from the front of the deck, and the deck is real
 * footage first. That is the whole point of the split: what is left in a queue
 * is what somebody is going to sit down and watch, so it gets the real
 * sessions, and a stub can only ever end up on a row that has already been
 * decided.
 */
const wanted = ROLES.slice(0, deck.length);
const pool = [...deck];
const deal = (rs) => rs.map((r) => ({ ...r, measured: pool.shift() }));
const waiting = deal(wanted.filter((r) => r.decision === null));
const toDecide = deal(wanted.filter((r) => r.decision !== null));
const roleOf = [...waiting, ...toDecide];
for (const c of REVIEW_CARDS) {
  const mine = roleOf.filter((r) => r.card === c.n);
  if (mine.length === 0) continue;
  const { batch, results } = await card({
    tfCardId: c.tfCardId,
    collector: c.collector,
    device: id.device,
    scenario: c.scenario,
    othersInFrame: c.othersInFrame,
    sessions: 1,
    measured: mine.map((r) => r.measured),
    minutesAgo: 240 - c.n * 30,
  });
  const bad = results.filter((r) => r.resolution_state !== 'resolved');
  if (bad.length > 0) throw new Error(`${c.tfCardId}: ${bad.length} episode(s) did not resolve:\n${JSON.stringify(bad, null, 2)}`);
  for (const r of results) console.log(`  ${c.tfCardId}  ${c.lane}  ${r.episode_id}  ${r.resolution_state}`);
  /**
   * The import is completed through the real audited route (`batch.import_complete`),
   * so `/episodes` shows a batch that finished rather than one that has been
   * "importing" since the seed ran. The cloud leg is not faked: there is no
   * bucket here, so no batch reaches `uploading` or `verified` and none claims to.
   */
  const files = mine.reduce((n, r) => n + r.measured.record.source_files.length, 0);
  const bytes = mine.reduce((n, r) => n + r.measured.record.source_files.reduce((b, f) => b + f.bytes, 0), 0);
  await post(`/upload-batches/${batch}`, {
    import_completed_at: new Date().toISOString(),
    batch_status: 'imported',
    file_count: files,
    total_size_bytes: bytes,
  }, 'PATCH');
}

/**
 * The third card: two declared sessions, so the resolver refuses to guess.
 *
 * A quarantined delivery rides along, because the batch summary counts
 * quarantines separately from what blocks the batch and both figures are on
 * the screen. Its batch stays `importing`: an import with an unresolved
 * episode on it is exactly the batch an operator is meant to still be holding.
 */
const attention = [...confirmable, ...quarantined];
let attentionResults = [];
let parked = null;
if (confirmable.length > 0) {
  const { results } = await card({
    tfCardId: 'CARD-3',
    collector: collectors[0],
    device: id.device2,
    scenario: id.scenario,
    othersInFrame: false,
    sessions: 2,
    measured: attention,
    minutesAgo: 45,
  });
  attentionResults = results;
  for (const r of results) console.log(`  CARD-3  attention  ${r.episode_id}  ${r.resolution_state}`);

  /**
   * One of them parked, by the real route.
   *
   * `/episodes` has two panels and the second one — parked or held work
   * anywhere in this centre — reads empty on a happy seed. Parking IS an
   * operator's answer ("I looked at it and it cannot be judged as
   * delivered"), so it stops blocking the batch and starts showing here, and
   * the row carries the reason typed with it. The reason says it is seeded,
   * because a parked episode is a thing somebody would otherwise go looking
   * for a card about.
   */
  parked = results[results.length - 1].episode_id;
  await post(`/episodes/${parked}/park`, {
    id: uid(),
    reason: 'Seeded demonstration data: parked to show the stuck lane. Not a real card.',
  });
  console.log(`  CARD-3  parked  ${parked}`);
}

/* ---------------------------------------------------------------- verdicts */

/**
 * The verdicts go through the real endpoints rather than straight into the
 * tables — that way the settlement rows, the audit rows and the span rows are
 * all written by the code that will write them in production, and a seeded row
 * can never be shaped differently from a real one.
 */
const login = await app.inject({
  method: 'POST', url: '/api/session',
  payload: { machine_identifier: 'HCM-01', machine_secret: SECRET, external_ref: 'op-1', operator_secret: SECRET },
});
const jar = login.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
const asReviewer = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: jar } });

/** A partial keeps roughly the middle 60% of what was measured, in two spans. */
const spansFor = (seconds) => [
  { start_seconds: Number((seconds * 0.05).toFixed(3)), end_seconds: Number((seconds * 0.45).toFixed(3)) },
  { start_seconds: Number((seconds * 0.6).toFixed(3)), end_seconds: Number((seconds * 0.8).toFixed(3)) },
];

/**
 * Claim until the queue offers the episode this role names, then give the rest
 * back.
 *
 * `POST /api/review/claim` serves whatever is next and nothing lets a caller
 * ask for one by name, which is correct — a reviewer does not shop. So the
 * seed holds the ones it did not want (a claim takes a lease, so they are not
 * served twice) and releases them once it has its target. Both the claim and
 * the release are the real endpoints; nothing here reaches past them.
 */
async function claimNamed(lane, episodeId) {
  const held = [];
  let found = null;
  for (let i = 0; i < 20 && found === null; i += 1) {
    const res = await asReviewer('POST', `/api/review/claim?queue=${lane}`);
    // 204 is an empty queue, and breaking on it silently is how this script
    // used to report six refused episodes as a successful seed.
    if (res.statusCode !== 200) throw new Error(`claim from the ${lane} queue -> ${res.statusCode} ${res.body}`);
    const ep = res.json();
    if (ep.episode_id === episodeId) found = ep;
    else held.push(ep.episode_id);
  }
  for (const id of held) await asReviewer('POST', `/api/review/release/${id}`);
  if (found === null) throw new Error(`the ${lane} queue never offered ${episodeId}`);
  return found;
}

let decided = 0;
for (const r of roleOf) {
  if (r.decision === null) continue;
  const lane = REVIEW_CARDS.find((c) => c.n === r.card).lane;
  const episode = await claimNamed(lane, r.measured.record.episode_id);
  const seconds = Number(episode.measured_duration_seconds ?? r.measured.record.timing.raw_duration_s);
  const body = {
    verdict_id: uid(),
    episode_id: episode.episode_id,
    decision: r.decision,
    spans: r.decision === 'partial' ? spansFor(seconds) : [],
    reject_reasons: r.decision === 'bad' ? ['VQ-DARK'] : [],
    time_to_verdict_seconds: 24 + Math.random() * 22,
  };
  const res = await asReviewer('POST', '/api/review/verdict', body);
  if (res.statusCode !== 200) throw new Error(`verdict ${r.decision} -> ${res.statusCode} ${res.body}`);
  decided += 1;
  console.log(`  verdict ${r.decision} on ${episode.session_folder}`);
}

const shift = (await asReviewer('GET', '/api/review/shift')).json();
if (shift.queue_depth === 0 || shift.privacy_queue_depth === 0)
  throw new Error(`a queue is empty after seeding: ${shift.queue_depth} standard, ${shift.privacy_queue_depth} privacy`);

/* -------------------------------------------------------------- the money */

/**
 * The settlement cycle, generated by `op-1`.
 *
 * Not by `fin-1`: `settle_generate_by_finance` refuses a cycle run by the
 * person who will pay it. The console disables the button for a non-finance
 * session, which means today the generate cannot be reached from the UI at
 * all — so the seed does it, and the settle screens have bills to show.
 */
const period = new Date();
period.setUTCDate(period.getUTCDate() - ((period.getUTCDay() + 6) % 7));
const PERIOD = period.toISOString().slice(0, 10);
const generated = (await post('/api/settle/bills', { period_start: PERIOD })).json();

/**
 * One risk tick, before anything is paid.
 *
 * The engine reads the media and the bills and writes whatever it finds — no
 * flag is written by hand here, because a fabricated flag on a demonstration
 * is how a threshold gets tuned against a number nobody measured. It runs
 * before the payment below and not after, so the preflight and the bill screen
 * show the engine's opinion at the moment somebody would have acted on it.
 * `holdsEnabled` is off, which is `PLAYERONE_RISK_HOLD`'s own default: the
 * bands are advisory until the false-positive report says the thresholds are
 * right, so a flagged bill is still payable and says so on the screen.
 */
const engine = new RiskEngine(db, { mediaRoot: MEDIA_ROOT, holdsEnabled: false });
const risk = await tick(db, engine, { enabled: true });
const [flags] = await db.execute(sql`select count(*)::int as n from risk_flags`);

/**
 * One payout account, declared at the counter by `op-1`.
 *
 * `payout_separation_of_duty` refuses a payment by whoever declared the
 * account, so the counter route is the one that leaves `fin-1` able to pay.
 * The stub ZaloPay above answers the verify with the declared name, which is
 * what a real Verify Account does when the destination is right.
 *
 * The second collector gets nothing on purpose: `no_account` is a real refusal
 * and the exceptions screen is where it is meant to be read.
 */
const DECLARED_NAME = 'SEED DEMO C-1';
zalopay.verify = { kind: 'verified', verifiedName: DECLARED_NAME, mUId: 'mu-seed-0001' };
await post(`/api/payout/collectors/${collectors[0].id}/accounts`, {
  id: uid(),
  collector_id: collectors[0].id,
  method: 'WALLET',
  declared_name: DECLARED_NAME,
  phone: '0900000001',
});

/** `fin-1` records the transfer. Manual is the pilot's rail: `/pay` answers 409 by design. */
const finLogin = await app.inject({
  method: 'POST', url: '/api/session',
  payload: { machine_identifier: 'HCM-01', machine_secret: SECRET, external_ref: 'fin-1', operator_secret: SECRET },
});
const finJar = finLogin.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
const asFinance = (method, url, payload) => app.inject({ method, url, payload, headers: { cookie: finJar } });

const batchView = (await asFinance('GET', `/api/payout/batches/${PERIOD}`)).json();
const payable = (batchView.bills ?? []).filter((b) => b.issues.length === 0 && b.amount_vnd > 0);
let paid = 0;
for (const bill of payable.slice(0, 1)) {
  const res = await asFinance('POST', `/api/payout/bills/${bill.id}/mark-paid`, {
    manual_reference: `SEED-DEMO-${bill.id.slice(0, 8)}`,
    amount_vnd: bill.amount_vnd,
  });
  if (res.statusCode >= 300) throw new Error(`mark-paid -> ${res.statusCode} ${res.body}`);
  paid += 1;
  console.log(`  marked paid  ${bill.collector_ref}  ${bill.amount_vnd} VND`);
}
/**
 * Not fatal, and not silent either. A deck of very short sessions can floor to
 * under one dong, which `under_one_dong` refuses by name — a correct refusal,
 * and also a payout screen with no attempt on it, which somebody would read as
 * a broken seed rather than as short footage.
 */
if (paid === 0)
  console.warn(`  NO BILL WAS PAYABLE. Issues on the ${batchView.bills?.length ?? 0} bill(s): ` +
    `${(batchView.bills ?? []).map((b) => `${b.collector_ref} ${b.amount_vnd} VND [${b.issues.join(', ') || 'none'}]`).join('; ')}`);


/* --------------------------------------------------------------- the story */

const [stuck] = await db.execute(sql`select count(*)::int as n from episodes where resolution_state <> 'resolved'`);
const finalShift = (await asReviewer('GET', '/api/review/shift')).json();

export const summary = {
  source,
  sourceRoot: source === 'real' ? SESSIONS_ROOT : join(REPO, 'fixtures', 'sessions'),
  toppedUp,
  mediaRoot: MEDIA_ROOT,
  period: PERIOD,
  episodes: deck.length + attentionResults.length,
  decided,
  queueStandard: finalShift.queue_depth,
  queuePrivacy: finalShift.privacy_queue_depth,
  needsHuman: stuck.n,
  bills: generated.created,
  notPayable: generated.not_payable,
  paid,
  riskEvaluated: risk.evaluated.episodes + risk.evaluated.collectors + risk.evaluated.bills,
  riskFlags: flags.n,
  settled: `${finalShift.settled_amount} ${finalShift.currency}`,
};

const REAL_NOTE = `real sample corpus — ${SESSIONS_ROOT}
  ${toppedUp > 0 ? `Topped up with ${toppedUp} committed fixture session(s): the corpus holds fewer than ${DECK_SIZE}.\n  The top-ups carry already-decided verdicts, so nothing waiting in a queue is a stub.` : 'Every episode in the queue is real footage.'}`;
const FIXTURE_NOTE = `fixtures/sessions/ — SYNTHETIC
  The real corpus was not found at ${SESSIONS_ROOT}.
  Every measurement below is real, and every MP4 is a 32-byte stub:
  the review player WILL NOT PLAY. Do not demonstrate encoding, seeking or
  picture quality from this. Set PLAYERONE_SESSIONS at the corpus and re-run.`;

console.log(`
Seeded, and the footage came from:

  ${source === 'real' ? REAL_NOTE : FIXTURE_NOTE}

What is now on each screen
  /            ${summary.decided} verdicts today, ${summary.settled} settled, ${summary.needsHuman} needing a human
  /review      ${summary.queueStandard} waiting in the standard queue, ${summary.queuePrivacy} in the privacy queue
  /episodes    ${attentionResults.length} episode(s) on CARD-3 the resolver refused to guess on, ${parked === null ? 'none' : 'one of them'} parked
  /backoffice  ${tasks.length} tasks, ${collectors.length} collectors, 2 devices
  /settle      ${summary.bills} bill(s) for ${PERIOD}, ${summary.notPayable} settlement(s) not payable
  /settle/exceptions  c-2 has no payout account, which is a real refusal and not a gap
  /risk        ${summary.riskFlags} flag(s) from ${summary.riskEvaluated} subject(s) the engine evaluated itself
               — several of them are ABOUT THE SEED and are correct: a script commits a
               verdict in a tenth of a second (OPS.REVIEW_TOO_FAST) and the fixture
               sessions share timestamps (VOL.NO_GAP). Read them as the engine working,
               not as findings about a collector.
  /pipeline    static: what is built, what is blocked, and on whose deliverable
  /counter     deliberately "not built" — ADR 0003 records the BO-09 cut

Zeroes on the review or settle lines mean the seed did nothing.

Payments: c-1's payout account was verified by a STUB ZaloPay (m_u_id
mu-seed-0001, reference SEED-DEMO-…) because this machine has no ZaloPay
credentials. ${paid} bill(s) recorded as paid by fin-1. c-2 is refused, correctly.
`);

/** `pnpm demo` starts both servers itself and prints its own card; this is for the seed run alone. */
if (process.env['PLAYERONE_SEED_QUIET'] !== '1') console.log(`
Now run, in two shells (the second line needs the same DATABASE_URL
this seed ran with; in PowerShell write it "$env:DATABASE_URL"):

  DATABASE_URL="$DATABASE_URL" \\
  PLAYERONE_TOKEN_SECRET=dev \\
  PLAYERONE_MEDIA_ROOT=${MEDIA_ROOT} \\
  REVIEW_VERIFICATION_GATE=local \\
  pnpm serve

  pnpm -F @playerone/console dev

REVIEW_VERIFICATION_GATE=local is not optional here and is the single reason a
seeded /review used to read "Nothing to review": the served default is 'cloud',
which admits only an episode with a cloud read-back receipt, and seeded footage
has never been uploaded anywhere. ADR 0001 allows the local gate on a machine
with no bucket. Nothing about the queue is loosened — a failed verification is
still refused under either gate.

Then http://localhost:5173 and sign in as "Upload centre" with  HCM-01 / ${SECRET}
and one of:

  op-1  / ${SECRET}   home, review, episodes, back office, pipeline, counter
  fin-1 / ${SECRET}   settle, preflight, the bill, exceptions, risk
                 (and only fin-1: the settle lane's READS are finance's too,
                  so an op-1 session sees "this period did not load")

or switch the toggle to "Reviewer" and use  rev-1 / ${SECRET}  with no machine
— a reviewer belongs to no upload centre, which is why that half of the form
asks for one credential instead of two.

The collector app is a separate surface and needs no database:

  pnpm -F @playerone/collector web      then  http://localhost:5177
`);

await app.close();
await db.close();
