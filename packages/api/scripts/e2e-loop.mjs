/**
 * The whole money path, once, in one process. §10.4.4 of the brief as a script.
 *
 *   register -> train -> pass the exam -> claim a task -> bind a camera ->
 *   declare a session -> Path C (handover, import, cloud verify) ->
 *   review verdict -> settle -> the collector sees the money
 *
 *   DATABASE_URL=... node packages/api/scripts/e2e-loop.mjs
 *
 * Green means a person who did not exist when the run started finishes it with
 * a bill, and `unit_price x effective_minutes` reproduces the amount they are
 * shown. That last identity is the one an auditor checks first when an invoice
 * is disputed, so it is what this script exists to keep true end to end.
 *
 * Not a test, for the same reason `verify-review.mjs` and `verify-e2e.mjs` are
 * not. The suite proves each leg in isolation against its own fixture; nothing
 * proved that the legs still line up when a single collector walks the whole
 * chain, and a chain is exactly the shape a per-leg fixture cannot show. It
 * runs nightly (`.github/workflows/nightly.yml`).
 *
 * It makes its own footage with ffmpeg, so it needs no sample corpus. If
 * `PLAYERONE_SESSIONS` names the five real sessions it runs a second time over
 * one of them, through the same legs — synthetic footage says nothing about
 * PaXini's encoder, and the loop should be walked at least once on bytes a
 * camera actually produced.
 *
 * Truncates every table first, so point DATABASE_URL at a throwaway database.
 * It does NOT migrate: like the other two scripts it opens a database somebody
 * has already migrated (`pnpm db:migrate`). The vitest suite migrates itself
 * through `useDatabase`; a script has no such hook.
 */
import { createHash, randomUUID as uid } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { contentFingerprint, deriveEpisodeId } from '../../contracts/src/identity.ts';
import { ingest } from '../../ingest/src/ingest.ts';
import { open } from '../../store/src/index.ts';
import { wholeVnd } from '../src/payout/domain/attempts.ts';
import { verifyExport } from '../src/payout/domain/export.ts';
import { shadowDiff, shadowRun } from '../src/payout/recon/index.ts';
import {
  buildApi,
  hashCredential,
  CURRENT_AGREEMENTS,
  EXAM_ANSWERS,
  MONEY_SCALE,
  fromDecimal,
  mul,
  quantise,
} from '../src/index.ts';

/**
 * Exits on the first failure rather than collecting a report.
 *
 * `verify-review.mjs` sets `exitCode` and carries on, which is right there:
 * its checks are independent readings of one already-finished state. Here they
 * are a chain, and every leg after a broken one asserts against a world that
 * never happened — twenty red lines whose first line is the only true one.
 */
const fail = (message, detail) => {
  console.error(`FAIL  ${message}`);
  if (detail !== undefined) console.error(`      ${detail}`);
  process.exit(1);
};
const ok = (message) => console.log(`ok    ${message}`);
const check = (condition, message, detail) => (condition ? ok(message) : fail(message, detail));

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Every ZaloPay call this script must never make. Thrown, not stubbed: a
 * silent zero would let a leg pass that had quietly reached for the rail.
 */
const noRail = async () => {
  throw new Error('the manual pilot has no ZaloPay rail: this script may only verify');
};

/**
 * The cloud, as an fs-backed stub of the two-method `ObjectStore` seam.
 *
 * `upload.test.ts` has a richer one — it can corrupt an object on write and
 * interrupt a run partway — and this is deliberately not that. Those knobs
 * exist to prove the failure paths, which that file already does; a loop that
 * re-proved them would be a slower copy of a test that passes on every push.
 * What this needs from a cloud is only that real bytes go in and the same real
 * bytes come back out, because the verdict `uploadEpisode` writes is a
 * read-back and never a metadata claim.
 *
 * ponytail: no corruption or interruption injection, and no presign. Add them
 * here only if the loop itself ever has to assert a failure path; until then
 * `upload.test.ts` is where that lives.
 */
class FsObjectStore {
  #meta = new Map();

  constructor(root) {
    this.root = root;
  }

  #pathOf(key) {
    return join(this.root, key.replaceAll('/', '__'));
  }

  async put(key, localPath, sha256, force = false) {
    const { size } = await stat(localPath);
    if (!force) {
      const m = this.#meta.get(key);
      const stored = m === undefined ? null : await stat(this.#pathOf(key)).catch(() => null);
      if (m !== undefined && m.sha256 === sha256 && stored?.size === size) return 'kept';
    }
    await mkdir(this.root, { recursive: true });
    await writeFile(this.#pathOf(key), await readFile(localPath));
    this.#meta.set(key, { sha256 });
    return 'uploaded';
  }

  async read(key, from = 0) {
    if (!this.#meta.has(key)) return null;
    return createReadStream(this.#pathOf(key), { start: from });
  }
}

const db = await open(undefined, { max: 8 });
/**
 * The same list `verify-review.mjs` truncates, plus the tables the legs before
 * review write to: the collector's own columns are on `collectors`, but their
 * consent, claim, custody period and bill are rows of their own.
 */
for (const t of [
  'audit_events', 'bill_lines', 'bills', 'settlements', 'episode_review_spans',
  'episode_review_reasons', 'episode_reviews', 'episode_defects', 'episode_files',
  'cloud_verifications', 'episode_streams', 'episode_ingests', 'episodes',
  'collection_session_devices', 'collection_sessions', 'upload_batches', 'handovers',
  'operators', 'upload_devices', 'upload_centres', 'device_assignments', 'devices',
  'device_types', 'task_claims', 'collector_agreements', 'collectors', 'tasks', 'scenarios',
])
  await db.execute(sql.raw(`truncate ${t} cascade`));

const cloudRoot = await mkdtemp(join(tmpdir(), 'playerone-loop-cloud-'));
const scratch = [cloudRoot];

/**
 * Catalogue rows, seeded once for every run.
 *
 * `device_types.code` and `scenarios.code` are unique across the whole
 * database, so these are not per-run fixtures and cannot be: two runs asking
 * for a second `ego_headset` collide on `device_types_code_key`. Everything a
 * run must not share with another run — its collector, centre, machine,
 * operator, camera, task and card — it still creates for itself.
 */
const catalogue = { dtype: uid(), scenario: uid(), scenarioCode: 'home' };
await db.execute(sql`insert into device_types (id,code,generation) values (${catalogue.dtype},'ego_headset','gen1')`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${catalogue.scenario},${catalogue.scenarioCode},'low')`);

/**
 * One collector's whole working life, from a phone number nobody has used to a
 * line on a bill.
 *
 * Everything after the sign-in goes through a route. What is seeded in SQL is
 * only what has no route to seed it with: the reference data (`verify-e2e.mjs`
 * seeds the same set), and the collector's phone number — see `seed` below.
 *
 * A run brings its own centre, machine, operator, collector, device, task and
 * card, so two runs never contend. That is not only isolation: `CLAUDE.md`
 * records that a fixture with one collector and one card is the exact shape
 * that hid a real payment bug in the resolver, and two runs against one
 * database is the cheapest way to have two of everything.
 */
async function runLoop({ label, mediaRoot, basename, record, spans, prepareTime, serial, period }) {
  console.log(`\n--- ${label} -------------------------------------------------`);
  const n = label.replaceAll(/[^a-z0-9]/g, '').slice(0, 8);
  const id = {
    ...Object.fromEntries(
      ['centre', 'machine', 'operator', 'finance', 'collector', 'device', 'task'].map((k) => [k, uid()]),
    ),
    ...catalogue,
  };
  const phone = `+8490${String(Date.now()).slice(-7)}`;
  const hash = await hashCredential('pw');

  await db.execute(sql`insert into upload_centres (id,region,name,status) values (${id.centre},'HCM',${`centre ${n}`},'active')`);
  await db.execute(sql`insert into upload_devices (id,upload_centre_id,machine_identifier,status,credential_hash) values (${id.machine},${id.centre},${`M-${n}`},'active',${hash})`);
  await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.operator},${id.centre},${`op-${n}`},'centre_operator',${hash})`);
  /**
   * A second operator, with the finance role, because the money leg needs two
   * people and the database says so. `payout_separation_of_duty` (0013) refuses
   * a payment by the operator who issued the bill, and `settle_generate_by_finance`
   * refuses a cycle run BY finance — so the counter operator above runs the
   * cycle and this one pays it. One operator cannot walk this leg alone, and
   * that is the control, not an inconvenience.
   */
  await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.finance},${id.centre},${`fin-${n}`},'finance',${hash})`);
  /**
   * The phone is seeded, and it is the ONE credential in this script that no
   * route could have set. BO-03 enrols a collector by `external_ref`:
   * `POST /api/collectors` takes `id`, `external_ref`, `status` and
   * `agreements`, and `PATCH /api/collectors/:id` takes status, exam and
   * agreements. Neither carries a phone, and `collectors.phone` is what
   * `/auth/collector/request-code` matches on — so a collector enrolled purely
   * through the back office cannot sign in to the app at all. That is a real
   * gap and it is reported rather than papered over with a new route here.
   * `collector-auth.test.ts` seeds it the same way and for the same reason.
   *
   * `qualified` because only an operator may set it (BO-03, SEC-02) and the
   * app cannot; the exam below is the half the collector does supply.
   */
  await db.execute(sql`insert into collectors (id,external_ref,status,phone) values (${id.collector},${`c-${n}`},'qualified',${phone})`);
  await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device},${id.dtype},${serial},'active')`);
  await db.execute(sql`insert into tasks (id,name,unit_price,max_concurrent_claimants,status) values (${id.task},'housework',1200,5,'published')`);

  /**
   * The sign-in code, caught the way the suite catches it: an injected
   * `SendSignInCode` that appends to an array. There is no debug route to read
   * a live code out of and there must never be one — `collector.ts` is explicit
   * that the code is never written to the audit trail either, because a trail
   * an operator can read a live code out of is a way in, not a control.
   */
  const outbox = [];
  const app = buildApi({
    db,
    tokenSecret: 'k',
    mediaRoot,
    currency: 'VND',
    objectStore: new FsObjectStore(cloudRoot),
    /**
     * QR-02 as written, rather than the ADR 0001 deviation.
     *
     * Under the 'local' default an episode is reviewable the moment the engine
     * has measured it, so the arrow from "upload" to "review" in the acceptance
     * line would be untested — the loop would pass with the cloud leg deleted.
     * Under 'cloud' only `verification_state = 'verified'` enters the queue, so
     * leg 13 below (an unverified episode is NOT served) and leg 16 (the same
     * episode IS served, after the read-back) are what make the upload
     * load-bearing. A script-local choice; it changes no default anywhere.
     */
    verificationGate: 'cloud',
    sendSignInCode: async (to, code) => void outbox.push({ phone: to, code }),
    /**
     * The pilot rail, pinned rather than inherited: `manual` is the default
     * (`payoutOptionsFromEnv`), and pinning it here means a machine that has
     * exported `PLAYERONE_PAYOUT_MODE=api` still runs the loop this script is
     * about. `/pay` answers 409 `payout_mode_manual` throughout; nothing below
     * calls it.
     *
     * `client` is Verify Account and NOTHING else, deliberately.
     *
     * Manual mode removes the need to DISBURSE through ZaloPay. It does not
     * remove the need to VERIFY through them: `payout_attempts_account_unverified`
     * (0018) refuses to record a payment to a destination ZaloPay never
     * confirmed — "a pilot with no ZaloPay credentials verifies nobody and can
     * therefore pay nobody", in the migration's own words — and `refusalFor`
     * asks the same question on the route. So the manual rail needs the
     * read-only verify credential even though it moves no money through the
     * API. That is the shape modelled here: an in-process double that answers
     * one call and throws on the other four, so a transfer cannot be sent from
     * this script even by accident. It speaks no network and holds no
     * credential. `routes.test.ts` pins the other half — every non-verified
     * status is a 409 on `mark-paid`.
     */
    payout: {
      mode: 'manual',
      client: {
        verifyAccount: async () => ({ kind: 'verified', verifiedName: `Nguyen ${n}`, mUId: `mu-${n}` }),
        transferFund: noRail,
        queryTransaction: noRail,
        balance: noRail,
        bankCodes: noRail,
      },
    },
  });
  await app.ready();

  const post = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
  const get = (url, headers) => app.inject({ method: 'GET', url, headers });

  // -- 1-2. the collector signs in, with a code that was sent to their phone --

  const asked = await post('/auth/collector/request-code', { phone });
  check(asked.statusCode === 204, 'asking for a sign-in code answers 204', asked.body);
  /**
   * The delivery is started and not awaited on the request's clock — that is
   * `constantLatency`'s whole point — so the outbox can legitimately be empty
   * for a tick after the 204 lands.
   */
  for (let i = 0; i < 50 && outbox.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  const sent = outbox.at(-1);
  check(sent?.phone === phone, 'a code was sent to that number and to no other');

  const verified = await post('/auth/collector/verify', { phone, code: sent?.code });
  check(verified.statusCode === 200, 'the code buys a token', verified.body);
  const me = { authorization: `Bearer ${verified.json().token}` };

  // -- 3-5. register, consent, training (APP-01, APP-02/PRV-01, APP-03) -------

  const registered = await post('/api/me/register', { name: `Nguyen ${n}` }, me);
  check(registered.statusCode === 201, 'registration is recorded', registered.body);
  check(registered.json().name === `Nguyen ${n}`, 'the profile comes back with the name that was sent');

  const consented = await post('/api/me/agreements', { agreements: [...CURRENT_AGREEMENTS] }, me);
  check(consented.statusCode === 200, 'the six agreements are accepted', consented.body);
  check(consented.json().agreements.length === CURRENT_AGREEMENTS.length,
    `all ${CURRENT_AGREEMENTS.length} agreements are on record`);

  const trained = await post('/api/me/training', undefined, me);
  check(trained.json().training_done === true, 'training is recorded (APP-03)');

  // -- 6. APP-05: no exam, no claim. The gate is the database's, not a route's.

  const tooSoon = await post(`/api/me/tasks/${id.task}/claims`, { id: uid() }, me);
  /**
   * `exam_not_passed` and not one of the other four refusals, which is the
   * whole value of this leg. `task_claims_guard` (migration 0006) asks in
   * order: published, exam, qualified, consent, capacity. The task is
   * published, the collector was seeded `qualified`, the six agreements went in
   * two legs ago and the task has five slots — so the exam is the only gate
   * left standing, and this is the one refusal it can be.
   */
  check(tooSoon.statusCode === 409 && tooSoon.json().constraint === 'exam_not_passed',
    'APP-05: claiming is refused before the exam is passed', tooSoon.body);

  // -- 7-8. the exam, then the claim (APP-04, APP-10) -------------------------

  const exam = await post('/api/me/exam', { answers: [...EXAM_ANSWERS] }, me);
  check(exam.json().passed === true, 'the exam is passed', exam.body);

  const claimId = uid();
  const claimed = await post(`/api/me/tasks/${id.task}/claims`, { id: claimId }, me);
  check(claimed.statusCode === 201 && claimed.json().replayed === false,
    'the same claim that was refused a moment ago is now allowed', claimed.body);

  // -- 9. bind the camera by the serial stamped on it (APP-14) ---------------

  const bound = await post('/api/me/devices', { hardware_serial: serial }, me);
  check(bound.statusCode === 201, `the camera ${serial} is bound to this collector`, bound.body);
  const boundAt = new Date(bound.json().bound_at);
  check(!Number.isNaN(boundAt.getTime()), 'the binding carries the instant custody started');

  // -- 10. the session the collector declares before recording (APP-16/17b) --

  const appSession = await post('/api/me/sessions', {
    id: uid(),
    task_id: id.task,
    device_serial: serial,
    scenario: catalogue.scenarioCode,
    // APP-17b, and the whole of it: two declarations, no third invented.
    others_in_frame: true,
    sensitive_info_present: false,
  }, me);
  check(appSession.statusCode === 201, 'the app session is declared', appSession.body);
  check(appSession.json().others_in_frame === true && appSession.json().sensitive_info_present === false,
    'both APP-17b declarations come back exactly as declared');

  // -- 11. the card reaches a counter (BO-10) --------------------------------

  const tok = async (url, payload) => (await post(url, payload)).json().token;
  const counter = {
    'x-machine-token': `Bearer ${await tok('/auth/machine', { machine_identifier: `M-${n}`, secret: 'pw' })}`,
    authorization: `Bearer ${await tok('/auth/operator', { external_ref: `op-${n}`, secret: 'pw' })}`,
  };

  const handover = uid();
  const opened = await post('/handovers', {
    id: handover,
    collector_id: id.collector,
    device_id: id.device,
    tf_card_id: `CARD-${n}`,
    handover_time: new Date().toISOString(),
  }, counter);
  check(opened.statusCode === 201, 'the card is handed over at the counter', opened.body);

  const batch = uid();
  const opened2 = await post('/upload-batches', {
    id: batch, handover_id: handover, import_started_at: new Date().toISOString(),
  }, counter);
  check(opened2.statusCode === 201, 'an import batch is opened on this machine', opened2.body);

  /**
   * The counter's own session, and the reason there are now two.
   *
   * This is not a duplicate of the app session above. `CLAUDE.md`: *"Session
   * creation is split: the app binds a session before recording (APP-16); the
   * operator creates the handover when the card arrives (BO-10) … In the pilot
   * the operator also creates the session, stamped `session_origin =
   * 'handover'`, so the drift is measurable."* And it is the handover-origin
   * one the card resolves against, because `episodes.ts` scopes resolution
   * candidates to the sessions declared against THIS handover — an app-origin
   * session carries no handover (APP-16 happens before the card exists), so it
   * is not a candidate and cannot be. The app session is what proves APP-16 and
   * APP-17b; this one is what the footage attaches to.
   */
  const counterSession = await post(`/handovers/${handover}/sessions`, {
    id: uid(),
    task_id: id.task,
    scenario_id: id.scenario,
    others_in_frame: true,
    sensitive_info_present: false,
    prepare_time: prepareTime.toISOString(),
  }, counter);
  check(counterSession.statusCode === 201, 'the operator records the handover session', counterSession.body);

  // -- 12. the import (Path C) ------------------------------------------------

  const submitted = await post(`/upload-batches/${batch}/episodes`, { episodes: [record] }, counter);
  check(submitted.statusCode === 200, 'the episode is submitted', submitted.body);
  const outcome = submitted.json().episodes[0];
  check(outcome.resolution_state === 'resolved',
    `the episode resolved to the declared session (${outcome.resolution_method})`,
    JSON.stringify(outcome));

  // -- 13-15. the cloud leg, and the gate it holds (UPL-04/05/06) ------------

  /**
   * `?queue=privacy`, because the session declared somebody else in frame.
   *
   * QR-07 routes on the two APP-17b declarations, and `POST /api/review/claim`
   * with no `queue` serves the standard lane only — so asking the privacy lane
   * here is not a workaround for an empty queue, it is the assertion that the
   * declaration actually moved the footage. A collector who says "there are
   * other people in this" must not have it land in front of whoever is next.
   */
  const early = await post('/api/review/claim?queue=privacy', undefined, counter);
  check(early.statusCode === 204,
    'before the cloud has verified it, the episode is not served to a reviewer', early.body);
  const wrongLane = await post('/api/review/claim', undefined, counter);
  check(wrongLane.statusCode === 204,
    'QR-07: a declared privacy risk is never in the standard queue', wrongLane.body);

  const uploaded = await post(`/upload-batches/${batch}/upload`, undefined, counter);
  check(uploaded.statusCode === 200, 'the batch uploads', uploaded.body);
  const up = uploaded.json();
  check(up.cloud_verified === true && up.episodes.every((e) => e.verification_state === 'verified'),
    'every object was read back from the cloud and matched its sha256', JSON.stringify(up.episodes));

  const cleaned = await post(`/upload-batches/${batch}/cache-clean`, undefined, counter);
  check(cleaned.statusCode === 200,
    'UPL-06: the local cache may be recorded clean, which it could not be a moment ago', cleaned.body);

  // -- 16-18. review, and the payment it writes (QR-02, SET-02) --------------

  const forReview = await post('/api/review/claim?queue=privacy', undefined, counter);
  check(forReview.statusCode === 200, 'the verified episode reaches a reviewer', forReview.body);
  const episode = forReview.json();
  check(episode.episode_id === record.episode_id, 'and it is this run’s episode');
  check(episode.queue === 'privacy', 'in the lane its declarations routed it to');

  const measured = Number(episode.measured_duration_seconds);
  const verdict = await post('/api/review/verdict', {
    verdict_id: uid(),
    episode_id: episode.episode_id,
    decision: 'partial',
    spans,
    time_to_verdict_seconds: 31.25,
  }, counter);
  check(verdict.statusCode === 200, 'the verdict is accepted', verdict.body);
  const paid = verdict.json();
  check(paid.replayed === false, 'the verdict wrote, rather than replaying an earlier one');
  ok(`${measured}s measured, ${paid.effective_duration_seconds}s judged payable, ${paid.amount} VND`);

  /**
   * The identity an auditor checks first, asserted with the service's own
   * single rounding site rather than with arithmetic of this script's own.
   *
   * `unit_price x effective_minutes` must reproduce `amount` exactly — which is
   * why the amount comes from the ROUNDED minutes and not from the exact
   * seconds. Sixteen seconds at 1200 a minute stores `0.266667` and `320.0004`,
   * where the exact product is `320.0000`; `CLAUDE.md` records that as
   * deliberate and says not to "fix" it. A bill whose own three numbers do not
   * multiply out is the one an auditor stops trusting.
   */
  const reproduces = (unitPrice, minutes, amount, where) =>
    check(
      quantise(mul(fromDecimal(unitPrice), fromDecimal(minutes)), MONEY_SCALE) === amount,
      `${where}: unit_price x effective_minutes reproduces the amount`,
      `${unitPrice} x ${minutes} != ${amount}`,
    );
  reproduces('1200.0000', paid.effective_minutes, paid.amount, 'the verdict');

  const [rows] = await db.execute(sql`
    select (select count(*) from settlements s
              join episode_reviews r on r.id = s.episode_review_id
             where r.episode_id = ${episode.episode_id})::int as settlements`);
  check(rows.settlements === 1, 'exactly one payment row, reachable only from the review (SET-02)');

  // -- 19. the cycle (SET-07) ------------------------------------------------

  const billed = await post('/api/settle/bills', {
    period_start: period.start.toISOString(),
    period_end: period.end.toISOString(),
  }, counter);
  check(billed.statusCode === 200, 'the settlement cycle runs', billed.body);
  const mine = billed.json().bills.find((b) => b.collector_ref === `c-${n}`);
  check(mine !== undefined, 'this collector got a bill', billed.body);
  /**
   * The exact line sum, never a floored figure. `bills_total_matches_lines`
   * (0011) says the total IS the sum of its lines, and `CLAUDE.md` is explicit
   * that the round-down lives on the payout attempt alone — "Not on the line …
   * Not on `bills.total` either". A floored total here would be the first sign
   * somebody had moved it.
   */
  check(mine.total === paid.amount, 'the bill total is exactly what the verdict was worth',
    `${mine.total} != ${paid.amount}`);

  // -- 20. and the collector can see it (APP-33) -----------------------------

  const income = (await get('/api/me/income', me)).json();
  check(income.episodes.length === 1, 'the collector sees one recording', JSON.stringify(income.episodes));
  const line = income.episodes[0];
  check(line.amount === paid.amount, 'for the amount the reviewer judged it worth',
    `${line.amount} != ${paid.amount}`);
  check(line.confirmed === true, 'marked confirmed, because a human decided it');
  reproduces(line.unit_price, line.effective_minutes, line.amount, 'the income screen');
  /**
   * Billed is asserted as "off the unbilled bucket and onto a period", not as
   * `state === 'on_a_bill'`.
   *
   * `stateOf` reports the worst thing standing between the collector and the
   * money, and on a deployment with no ZaloPay client every bill carries
   * `no_account` or `account_unverified` — `verifyDeclaration` returns
   * `unverified` when it holds no client, and `payout_accounts_append_only`
   * means that answer is permanent for the row. Both map to `action_needed`.
   * So `on_a_bill` is not reachable here at all, and asserting it would mean
   * standing up a payout rail this loop deliberately does not touch.
   *
   * What IS asserted is the thing the cycle actually did: `not_yet_billed` went
   * to nothing and a period appeared carrying the bill's exact total. `state`
   * is still checked, negatively — `approved` is "reviewed, worth money, not
   * yet on a bill", so a settlement run that quietly billed nothing would show
   * up here.
   */
  check(line.state !== 'approved', `it is no longer waiting for a bill (state: ${line.state})`);
  check(income.not_yet_billed.episodes === 0 && income.not_yet_billed.amount === '0.0000',
    'nothing of theirs is left unbilled', JSON.stringify(income.not_yet_billed));
  check(income.periods.length === 1 && income.periods[0].amount === mine.total,
    'the period total on the collector’s screen is the bill finance will pay',
    JSON.stringify(income.periods));

  // -- 21. where the money goes, and the verification that gates it (G3) -----

  /**
   * A different person from the one who ran the cycle. `settle_generate_by_finance`
   * refuses a cycle run by finance and `payout_separation_of_duty` refuses a
   * payment by whoever issued the bill, so the two roles above are both needed
   * and neither can do the other's half.
   */
  const finance = {
    'x-machine-token': counter['x-machine-token'],
    authorization: `Bearer ${await tok('/auth/operator', { external_ref: `fin-${n}`, secret: 'pw' })}`,
  };

  /**
   * Declared at the COUNTER, by the operator, and not by finance.
   *
   * `POST /api/payout/accounts` exists and finance may call it — but 0018
   * added a third separation-of-duty question, and it is asked of the payer:
   * an operator who declared the account an attempt names may not pay that
   * bill. Measured, not assumed: this leg was written against the finance
   * route first and every walk of it ended in `payout_separation_of_duty` on
   * `mark-paid`, which is exactly what that migration says will happen — "In a
   * one-finance-person pilot that reads as a deadlock, and it is the intended
   * one: the counter route is the way out." So the pilot's flow is this one,
   * and the collector is at the counter anyway, which is the whole argument
   * for the route.
   */
  const declared = await post(`/api/payout/collectors/${id.collector}/accounts`, {
    id: uid(),
    method: 'WALLET',
    declared_name: `Nguyen ${n}`,
    phone: `09${String(Date.now()).slice(-8)}`,
  }, counter);
  check(declared.statusCode === 201, 'the payout destination is declared', declared.body);
  check(declared.json().verify_status === 'verified',
    'and the holder ZaloPay names is the collector who was declared', declared.body);

  // -- 22. what the API rail WOULD have sent, before anybody pays anything ---

  /**
   * The window is this run's own cycle, one day wide, because the script walks
   * the loop twice against one database and each walk must diff its own cycle
   * and nobody else's. `loadBatch` selects bills by `period_start`, and the two
   * runs' period starts are eight days apart.
   *
   * The client is `undefined`, which is the pilot exactly: no wallet to read a
   * balance from. `preflight_ok` is therefore false and says why, and per-bill
   * intention is recorded anyway — the batch refusal is about the wallet and
   * says nothing about whether this bill was right to pay.
   */
  const window = { start: period.start, end: new Date(period.start.getTime() + 24 * 60 * 60 * 1000) };
  const shadow = await shadowRun(db, undefined, window, { now: new Date() });
  check(shadow.preflight_ok === false && /no ZaloPay client/.test(shadow.refusal ?? ''),
    'shadow mode records that this deployment has no wallet to pay from', shadow.refusal);
  check(shadow.intended.length === 1, 'the shadow run sees exactly this cycle’s one bill',
    JSON.stringify(shadow.intended.map((i) => i.bill_id)));
  const intent = shadow.intended[0];
  const whole = wholeVnd(mine.total);
  check(intent.bill_id === mine.id, 'and it is this collector’s bill');
  check(intent.would_send === true && intent.issues.length === 0,
    'the API rail would have sent it, with nothing standing in the way', JSON.stringify(intent.issues));
  check(intent.amount_vnd === whole,
    `the rail would have sent ${whole} VND: ${mine.total} floored to whole dong`,
    `${intent.amount_vnd} != ${whole}`);

  // -- 23. the file finance is handed (BUILD 6) ------------------------------

  const exportUrl = `/api/payout/export/${encodeURIComponent(window.start.toISOString())}`
    + `?period_end=${encodeURIComponent(window.end.toISOString())}`;
  const csv = await get(exportUrl, finance);
  check(csv.statusCode === 200, 'the payout CSV exports', csv.body);
  check(verifyExport(csv.body).ok,
    'the hash in its trailer is the hash of the bytes above it');
  check(csv.headers['x-playerone-file-hash'] === verifyExport(csv.body).actual,
    'and the header names the same hash');
  /**
   * `gross_vnd` is the bill's exact total, NOT the floored figure. The floor
   * lives on the attempt and nowhere else; a CSV carrying 320 where the bill
   * says 320.0004 would be the first sign it had moved.
   */
  check(csv.body.includes(`"${mine.total}"`),
    'and it carries the bill total exactly as stored, unfloored', mine.total);
  check((await get(exportUrl, finance)).body === csv.body,
    'the same period exported twice is byte-identical');

  // -- 24. the operator pays by hand and types the reference back (SET-03) ---

  const mistyped = await post(`/api/payout/bills/${mine.id}/mark-paid`, {
    manual_reference: `VCB-${n}-0001`, amount_vnd: whole + 1,
  }, finance);
  check(mistyped.statusCode === 409 && mistyped.json().constraint === 'payout_attempts_amount_check',
    'a retyped amount that is not the floored total is refused by the database', mistyped.body);

  const marked = await post(`/api/payout/bills/${mine.id}/mark-paid`, {
    manual_reference: `VCB-${n}-0001`, amount_vnd: whole,
  }, finance);
  check(marked.statusCode === 201, 'the transfer the operator made is recorded', marked.body);
  check(marked.json().amount_vnd === whole && marked.json().status === 'succeeded',
    `${whole} VND is on the ledger against reference ${marked.json().manual_reference}`, marked.body);

  const [states] = await db.execute(sql`
    select bool_and(s.settlement_state = 'manually_paid') as all_paid
      from bill_lines l join settlements s on s.id = l.settlement_id
     where l.bill_id = ${mine.id}`);
  check(states.all_paid === true, 'and every settlement on the bill moved to manually_paid');

  const settled = (await get('/api/me/income', me)).json();
  check(settled.episodes[0].state === 'paid',
    'the collector’s own screen now says paid', settled.episodes[0].state);

  // -- 25. the API rail still cannot fire, and never did ---------------------

  const refusedPay = await post(`/api/payout/bills/${mine.id}/pay`, {}, finance);
  check(refusedPay.statusCode === 409 && refusedPay.json().constraint === 'payout_mode_manual',
    'the API rail answers 409 payout_mode_manual, as it did all the way through', refusedPay.body);
  const attempts = await db.execute(sql`
    select mode, status from payout_attempts where bill_id = ${mine.id}`);
  check(attempts.length === 1 && attempts[0].mode === 'manual' && attempts[0].status === 'succeeded',
    'exactly one attempt exists on this bill and it is the manual one',
    JSON.stringify(attempts));

  // -- 26. intention against outcome ----------------------------------------

  const diff = await shadowDiff(db, shadow.runId, { now: new Date() });
  check(diff.bills === 1 && diff.agreed === 1 && diff.raised === 0,
    'the shadow cycle diffed clean: what the rail would have sent is what was paid',
    JSON.stringify(diff));

  await app.close();
  return { amount: paid.amount, diff };
}

// ---------------------------------------------------------------------------
// Run one: footage this script made, so it needs no corpus.

const SERIAL = 'SYNTH76400FE';
// `yyyymmdd_hhmmss`, which is the only stamp `parseSessionBasename` accepts.
const stamp = new Date().toISOString().slice(0, 19).replaceAll('-', '').replace('T', '_').replaceAll(':', '');
const BASENAME = `ego_${SERIAL}_${stamp}`;
const mediaRoot = await mkdtemp(join(tmpdir(), 'playerone-loop-media-'));
scratch.push(mediaRoot);
const sessionDir = join(mediaRoot, BASENAME);
await mkdir(sessionDir, { recursive: true });
const mediaName = `${BASENAME}_camera_left_part0001.mp4`;
const mediaPath = join(sessionDir, mediaName);

// A real, seekable MP4 rather than a stub: the cloud leg hashes these bytes for
// real on the way out and again on the way back, so they have to be bytes.
execFileSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=20',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath,
], { stdio: 'inherit' });
const media = await readFile(mediaPath);
ok(`made ${media.length} bytes of footage at ${mediaPath}`);

/**
 * The recording starts a second after the camera was bound and runs twenty.
 *
 * The ordering is not decoration. `resolve.ts` crosschecks the device's custody
 * period against the episode's start instant, and an episode that starts before
 * every period on record is "not checkable" — the crosscheck is skipped and
 * proves nothing. Starting after the bind makes it run, and pass, with this
 * collector as the assignee.
 */
const started = Date.now() + 1000;
const startUs = String(BigInt(started) * 1000n);
const endUs = String(BigInt(started + 20_000) * 1000n);
const sourceFiles = [{ relative_path: mediaName, bytes: media.length, sha256: sha(media) }];

/**
 * One cycle per walk, eight days apart, because the payout window selects
 * bills by `period_start` and each walk must diff its own cycle alone. The end
 * is in the future in both: `settleable` bills every settlement created before
 * the period's end, and these were created a moment ago.
 */
const CYCLE_ONE = { start: new Date(Date.now() - 10 * 24 * 3600_000), end: new Date(Date.now() + 24 * 3600_000) };
const CYCLE_TWO = { start: new Date(Date.now() - 2 * 24 * 3600_000), end: new Date(Date.now() + 24 * 3600_000) };

const synthetic = await runLoop({
  label: 'synthetic footage',
  period: CYCLE_ONE,
  mediaRoot,
  basename: BASENAME,
  serial: SERIAL,
  prepareTime: new Date(started - 60_000),
  /**
   * Three overlapping, out-of-order marks over twenty seconds of footage. The
   * server is what makes them disjoint, so the same second is never paid twice,
   * and sixteen payable seconds at 1200 a minute is the arithmetic
   * `money.test.ts`, `settle.test.ts` and `verify-review.mjs` all already pin.
   */
  spans: [
    { start_seconds: 12, end_seconds: 18 },
    { start_seconds: 2, end_seconds: 8 },
    { start_seconds: 6, end_seconds: 14 },
  ],
  record: {
    schema_version: '1.1.0',
    // Derived from the basename and never chosen; the submit route re-derives
    // it and refuses a record that disagrees with itself.
    episode_id: deriveEpisodeId(BASENAME),
    content_fingerprint: contentFingerprint(sourceFiles),
    state: 'ok',
    source: { path: BASENAME, ingest_tool_version: '0.3.1', ingested_at: new Date().toISOString(), ingest_host: 'e2e-loop' },
    device: { serial: SERIAL, firmware_declared: '1.0.3', calibration_serial: null },
    // The manifest overstating the media by about a third, as UPL-08 describes.
    declared: { session_id: null, status: 'completed', duration_sec: 26.8, start_time: null, end_time: null, video_left_frame_count: null, video_right_frame_count: null, imu_accel_count: null, imu_gyro_count: null, audio_frame_count: null },
    streams: [{ role: 'camera_left', parts: [{ file: mediaName, bytes: media.length, sha256: sha(media) }], pts_source: 'sidecar', first_pts_us: startUs, last_pts_us: endUs, sample_count: 600, span_s: 20, nominal_rate_hz: 30 }],
    timing: { method: 'pts_sidecar', confidence: 'exact', usable_start_us: startUs, usable_end_us: endUs, raw_duration_s: 20, max_stream_skew_ms: 0 },
    calibration: { present: true, files: [] },
    source_files: sourceFiles,
    discrepancies: [],
    unclassified_files: [],
  },
});
check(synthetic.amount === '320.0004',
  'sixteen seconds at 1200 a minute is 320.0004, from the rounded minutes and not the exact seconds',
  synthetic.amount);

const cycles = [synthetic.diff];

// ---------------------------------------------------------------------------
// Run two: one real session, when this machine has the corpus.

const corpus = process.env['PLAYERONE_SESSIONS'] ?? '';
const sessions = corpus === '' ? [] : (await readdir(corpus).catch(() => [])).filter((e) => e.startsWith('ego_'));
if (sessions.length !== 5) {
  console.log(`\n--- real corpus: SKIPPED (PLAYERONE_SESSIONS ${corpus === '' ? 'is not set' : `holds ${sessions.length} sessions, not 5`})`);
  console.log('    The loop above ran on footage this script made, which says nothing about');
  console.log("    PaXini's encoder. CI has no corpus; on the org PC, export PLAYERONE_SESSIONS.");
} else {
  /**
   * ponytail: one session, not five. `verify-e2e.mjs` already walks all five
   * through the counter, which is where the encoder's variety matters; this
   * script is about the shape of the loop, and the smallest real session
   * exercises every leg of it that the largest would.
   */
  const real = sessions.sort()[0];
  const record = await ingest(join(corpus, real));
  /**
   * Not `state === 'ok'`. All five real sessions come back `flagged` — the
   * manifest inflates the duration, the frame counts disagree, the manifest
   * names files that are not on the card, and the calibration and the manifest
   * disagree about what the cameras are called. `CLAUDE.md` records every one
   * of those as the device's own behaviour rather than a fault, and `UPL-08`
   * makes the manifest advisory. What must not happen is `quarantined`: that
   * one means the engine could not measure the footage, and there is then
   * nothing to pay for.
   */
  check(record.state !== 'quarantined', `${real} ingests (state: ${record.state})`,
    JSON.stringify(record.discrepancies));
  const measured = (Number(record.timing.usable_end_us) - Number(record.timing.usable_start_us)) / 1e6;
  const realRun = await runLoop({
    label: `real corpus: ${real}`,
    period: CYCLE_TWO,
    mediaRoot: corpus,
    basename: real,
    serial: record.device.serial,
    // Before the recording, which happened in August 2026 and long before the
    // bind this run performs — so the custody crosscheck correctly declines to
    // judge it rather than dropping the only candidate.
    prepareTime: new Date(Number(record.timing.usable_start_us) / 1000 - 60_000),
    /**
     * Ten payable seconds, or all of it if it is shorter. Deliberately no
     * assertion about what the measured duration SHOULD be: `CLAUDE.md` says
     * the engine's intersection is right and the brief's appendix reads ~3%
     * high, so a literal here would be the appendix's number smuggled into a
     * check.
     */
    spans: [{ start_seconds: 0, end_seconds: Math.min(10, Math.floor(measured)) }],
    record,
  });
  ok(`the real session paid ${realRun.amount} VND`);
  cycles.push(realRun.diff);
}

/**
 * The gate `shadow.ts` names: *"Two shadow cycles diffed clean is the gate
 * before `api` becomes discussable."* Two cycles means two, so a machine with
 * no corpus is told plainly that it ran one and has not met the bar.
 */
if (cycles.length === 2 && cycles.every((c) => c.raised === 0)) {
  ok(`two shadow cycles diffed clean (${cycles.map((c) => `${c.agreed}/${c.bills}`).join(', ')} bills agreed, 0 findings)`);
} else {
  console.log(`\nNOTE  ${cycles.length} shadow cycle(s) ran, ${cycles.reduce((a, c) => a + c.raised, 0)} finding(s) raised.`);
  console.log('      The G7 gate wants TWO clean cycles; one walk is not two.');
}

await db.close();
for (const dir of scratch) await rm(dir, { recursive: true, force: true }).catch(() => {});
console.log('\nall checks passed');
