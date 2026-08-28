/**
 * The review lane end to end, over real HTTP.
 *
 * Not a test — a script, for the same reason `verify-e2e.mjs` is one. The suite
 * drives the routes through `app.inject`, which is fast and covers the logic but
 * never opens a socket. Three of the things this screen depends on only exist on
 * a real connection: byte ranges as a browser issues them, `Set-Cookie` as a
 * browser stores it, and a redirect a browser follows. This runs them.
 *
 *   DATABASE_URL=... node packages/api/scripts/verify-review.mjs
 *
 * It makes its own footage with ffmpeg, so it needs no sample corpus — but it
 * therefore says nothing about PaXini's encoder. For that, run
 * `node packages/api/scripts/moov.ts` over the real files.
 *
 * Truncates every table first, so point DATABASE_URL at a throwaway database.
 */
import { randomUUID as uid } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { open } from '../../store/src/index.ts';
import { buildApi, hashCredential } from '../src/index.ts';

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exitCode = 1;
};
const ok = (message) => console.log(`ok    ${message}`);
const check = (condition, message) => (condition ? ok(message) : fail(message));

const BASENAME = 'ego_AZER76400FE_20260813_073055';
const root = await mkdtemp(join(tmpdir(), 'playerone-review-'));
const sessionDir = join(root, BASENAME);
await mkdir(sessionDir, { recursive: true });
const mediaPath = join(sessionDir, `${BASENAME}_camera_left_part0001.mp4`);

// A real, seekable MP4 rather than a stub: the whole point of the range
// assertions below is that a browser can jump into the middle of one.
execFileSync(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-y',
   '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=20',
   '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mediaPath],
  { stdio: 'inherit' },
);
const { size: mediaBytes } = await stat(mediaPath);
ok(`made ${mediaBytes} bytes of footage at ${mediaPath}`);

const db = await open(undefined, { max: 8 });
for (const t of ['audit_events','settlements','episode_review_spans','episode_review_reasons','episode_reviews','episode_defects','episode_files','episode_streams','episode_ingests','episodes','collection_session_devices','collection_sessions','upload_batches','handovers','operators','upload_devices','upload_centres','devices','device_types','collectors','tasks','scenarios'])
  await db.execute(sql.raw(`truncate ${t} cascade`));

const id = Object.fromEntries(['centre','machine','operator','collector','dtype','device','task','scenario'].map((k) => [k, uid()]));
const hash = await hashCredential('pw');
await db.execute(sql`insert into upload_centres (id,region,name,status) values (${id.centre},'HCM','D7','active')`);
await db.execute(sql`insert into upload_devices (id,upload_centre_id,machine_identifier,status,credential_hash) values (${id.machine},${id.centre},'HCM-01','active',${hash})`);
await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.operator},${id.centre},'op-1','centre_operator',${hash})`);
await db.execute(sql`insert into collectors (id,external_ref,status) values (${id.collector},'c-1','qualified')`);
await db.execute(sql`insert into device_types (id,code,generation) values (${id.dtype},'ego_headset','gen1')`);
await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device},${id.dtype},'AZER76400FE','active')`);
await db.execute(sql`insert into tasks (id,name,unit_price,max_concurrent_claimants,status) values (${id.task},'housework',1200,5,'published')`);
// 0016: a session is recorded under a live claim; the claim guard (0006) wants the exam and the six agreements first.
await db.execute(sql`update collectors set exam_result = 'pass', exam_decided_at = now() where id = ${id.collector}`);
await db.execute(sql`insert into collector_agreements (collector_id, agreement, version, accepted_at)
  select ${id.collector}, a, 'v1', now()
    from unnest(array['user','privacy','data_collection','commercial_use','manual_review','offline_settlement']) as a`);
await db.execute(sql`insert into task_claims (id, task_id, collector_id) values (${uid()}, ${id.task}, ${id.collector})`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${id.scenario},'home','low')`);

const app = buildApi({ db, tokenSecret: 'k', mediaRoot: root, currency: 'VND' });
await app.listen({ host: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${app.server.address().port}`;
ok(`listening on ${base}`);

// -- the counter path, to get one resolved episode in front of a reviewer ----

const tok = async (url, payload) => (await app.inject({ method: 'POST', url, payload })).json().token;
const headers = {
  'x-machine-token': `Bearer ${await tok('/auth/machine', { machine_identifier: 'HCM-01', secret: 'pw' })}`,
  authorization: `Bearer ${await tok('/auth/operator', { external_ref: 'op-1', secret: 'pw' })}`,
};
const post = (url, payload) => app.inject({ method: 'POST', url, payload, headers });

const handover = uid();
await post('/handovers', { id: handover, collector_id: id.collector, device_id: id.device, tf_card_id: 'CARD-1', handover_time: new Date().toISOString() });
const batch = uid();
await post('/upload-batches', { id: batch, handover_id: handover, import_started_at: new Date().toISOString() });
await post(`/handovers/${handover}/sessions`, { id: uid(), task_id: id.task, scenario_id: id.scenario, others_in_frame: false, sensitive_info_present: false, prepare_time: new Date(Date.now() - 600_000).toISOString() });

const startUs = String(BigInt(Date.now() - 300_000) * 1000n);
const submitted = await post(`/upload-batches/${batch}/episodes`, {
  episodes: [{
    schema_version: '1.1.0',
    episode_id: uid(),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: { path: BASENAME, ingest_tool_version: '0.3.1', ingested_at: new Date().toISOString(), ingest_host: 'verify' },
    device: { serial: 'AZER76400FE', firmware_declared: '1.0.3', calibration_serial: null },
    // The manifest overstating the media by about a third, as UPL-08 describes.
    declared: { session_id: null, status: 'completed', duration_sec: 26.8, start_time: null, end_time: null, video_left_frame_count: null, video_right_frame_count: null, imu_accel_count: null, imu_gyro_count: null, audio_frame_count: null },
    streams: [{ role: 'camera_left', parts: [{ file: `${BASENAME}_camera_left_part0001.mp4`, bytes: mediaBytes, sha256: 'b'.repeat(64) }], pts_source: 'sidecar', first_pts_us: startUs, last_pts_us: String(BigInt(startUs) + 20_000_000n), sample_count: 600, span_s: 20, nominal_rate_hz: 30 }],
    timing: { method: 'pts_sidecar', confidence: 'exact', usable_start_us: startUs, usable_end_us: String(BigInt(startUs) + 20_000_000n), raw_duration_s: 20, max_stream_skew_ms: 0 },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  }],
});
check(submitted.json().episodes[0].resolution_state === 'resolved', 'the episode resolved to the declared session');

// -- the console, over the wire ---------------------------------------------

const login = await fetch(`${base}/review/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: 'machine_identifier=HCM-01&machine_secret=pw&external_ref=op-1&operator_secret=pw',
  redirect: 'manual',
});
check(login.status === 303, 'sign-in redirects rather than rendering a page');
const jar = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
check(jar.includes('po_machine=') && jar.includes('po_operator='), 'both session cookies were set');

const cookie = { cookie: jar };
const pageRes = await fetch(`${base}/review`, { headers: cookie });
const html = await pageRes.text();
check(pageRes.status === 200, 'the review page renders for a signed-in session');
check(html.includes('id="video-a"') && html.includes('id="video-b"'), 'both video elements are in the first paint');
check(!/<video[^>]*\scontrols/.test(html), 'native video controls are off, so the keyboard layer owns focus');

const zh = await (await fetch(`${base}/review?lang=zh`, { headers: cookie })).text();
check(zh.includes('lang="zh-Hans"') && zh.includes('提交并继续'), 'the page renders in Chinese');

for (const asset of ['review.js', 'review.css']) {
  const res = await fetch(`${base}/review/assets/${asset}`);
  check(res.status === 200, `${asset} is served`);
}

const claim = await fetch(`${base}/api/review/claim`, { method: 'POST', headers: cookie });
const episode = await claim.json();
check(claim.status === 200, 'an episode was claimed through the cookie session');
check(episode.measured_duration_seconds === '20.000000', 'the payable duration is the measured one');
check(episode.claimed_duration_seconds === '26.800000', "the device's own claim travels beside it, not instead of it");

// -- ranges, as a browser issues them ---------------------------------------

const mediaUrl = `${base}${episode.media.parts[0].url}`;
const plain = await fetch(mediaUrl, { headers: cookie });
check(plain.headers.get('accept-ranges') === 'bytes', 'range support is advertised on a plain response');

const at80 = Math.floor(mediaBytes * 0.8);
const started = performance.now();
const ranged = await fetch(mediaUrl, { headers: { ...cookie, range: `bytes=${at80}-${at80 + 65_535}` } });
const chunk = Buffer.from(await ranged.arrayBuffer());
const elapsed = performance.now() - started;
check(ranged.status === 206, 'a range request is answered 206');
check(
  ranged.headers.get('content-range') === `bytes ${at80}-${Math.min(at80 + 65_535, mediaBytes - 1)}/${mediaBytes}`,
  'the content-range names the right window of the right file',
);
const source = await readFile(mediaPath);
check(chunk.equals(source.subarray(at80, at80 + chunk.length)), 'the bytes returned are the bytes at that offset');
check(chunk.length < mediaBytes, `seeking to 80% moved ${chunk.length} bytes, not ${mediaBytes}`);
ok(`the range round trip took ${elapsed.toFixed(0)}ms`);

const bad = await fetch(mediaUrl, { headers: { ...cookie, range: `bytes=${mediaBytes + 10}-` } });
check(bad.status === 416, 'a range past the end is 416, not an empty 206');

// -- the verdict -------------------------------------------------------------

const verdictId = uid();
const body = {
  verdict_id: verdictId,
  episode_id: episode.episode_id,
  decision: 'partial',
  // Deliberately overlapping and out of order: the server is what makes them
  // disjoint, so the same second is never paid for twice.
  spans: [
    { start_seconds: 12, end_seconds: 18 },
    { start_seconds: 2, end_seconds: 8 },
    { start_seconds: 6, end_seconds: 14 },
  ],
  time_to_verdict_seconds: 31.25,
};
const send = () =>
  fetch(`${base}/api/review/verdict`, {
    method: 'POST',
    headers: { ...cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const first = await send();
check(first.effective_duration_seconds === '16.000000', 'three overlapping marks became sixteen payable seconds');
/*
 * 16 seconds is 0.2666... minutes, and the amount is computed from the *rounded*
 * minutes rather than from the exact seconds — so 1200 x 0.266667 is 320.0004
 * and not the exact 320.0000. That is deliberate: anybody who multiplies the two
 * stored columns of a bill has to get the stored amount back, and a bill whose
 * own three numbers do not multiply out is the one an auditor stops trusting.
 * The cost is at most a millionth of a minute of price. See `settlementFor`.
 */
check(first.effective_minutes === '0.266667', 'sixteen seconds is 0.266667 minutes');
check(first.amount === '320.0004', 'the amount is the unit price times the minutes as stored');
check(first.replayed === false, 'the first submission wrote');

const [again, andAgain] = await Promise.all([send(), send()]);
check(again.replayed === true && andAgain.replayed === true, 'a repeat is answered from the original');
check(again.amount === first.amount, 'a repeat answers with the same money');

const rows = (await db.execute(sql`
  select (select count(*) from episode_reviews where verdict_id = ${verdictId})::int as reviews,
         (select count(*) from settlements)::int as settlements,
         (select count(*) from episode_review_spans)::int as spans,
         (select count(*) from audit_events where action = 'episode.review')::int as audits
`))[0];
check(rows.reviews === 1, 'one review row');
check(rows.settlements === 1, 'one payment row');
check(rows.spans === 1, 'the three marks were stored as one merged span');
check(rows.audits === 1, 'one audit row, written with the verdict');

const stored = (await db.execute(sql`select start_s, end_s from episode_review_spans`))[0];
check(stored.start_s === '2.000000' && stored.end_s === '18.000000', 'the stored span is the merged range');

// A settlement can be reached from a review and from nowhere else (SET-02).
const routes = (await db.execute(sql`
  select ccu.table_name as target
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
   where tc.table_name = 'settlements' and tc.constraint_type = 'FOREIGN KEY'
`)).map((r) => r.target);
check(!routes.includes('episodes') && routes.includes('episode_reviews'), 'a payment still points only at a review');

const empty = await fetch(`${base}/api/review/claim`, { method: 'POST', headers: cookie });
check(empty.status === 204, 'the queue is empty once everything is decided');

await app.close();
await db.close();
await rm(root, { recursive: true, force: true });
console.log(process.exitCode ? '\nFAILED' : '\nall checks passed');
