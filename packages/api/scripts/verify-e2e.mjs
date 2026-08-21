/**
 * The counter workflow end to end, against the five real sample sessions.
 *
 * Not a test — a script, because it needs the real corpus (which is not in the
 * repo) and it is the thing to run when someone asks "does the whole path
 * actually work". The suite covers the same criteria with synthetic records.
 *
 *   node packages/ingest/bin/ingest.ts "<session>" --json --out .tmp-x/<id>.json   (x5)
 *   DATABASE_URL=... node packages/api/scripts/verify-e2e.mjs
 *
 * Truncates every table first, so point DATABASE_URL at a throwaway database.
 */
import { randomUUID as uid } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { open } from '../../store/src/index.ts';
import { buildApi, hashCredential } from '../src/index.ts';

const db = await open();
for (const t of ['audit_events','episode_defects','episode_files','episode_streams','episode_ingests','episodes','collection_session_devices','collection_sessions','upload_batches','handovers','operators','upload_devices','upload_centres','devices','device_types','collectors','tasks','scenarios'])
  await db.execute(sql.raw(`truncate ${t} cascade`));

const id = Object.fromEntries(['centre','machine','operator','collector','dtype','device','task','scenario'].map(k=>[k,uid()]));
const hash = await hashCredential('pw');
await db.execute(sql`insert into upload_centres (id,region,name,status) values (${id.centre},'HCM','D7','active')`);
await db.execute(sql`insert into upload_devices (id,upload_centre_id,machine_identifier,status,credential_hash) values (${id.machine},${id.centre},'HCM-01','active',${hash})`);
await db.execute(sql`insert into operators (id,upload_centre_id,external_ref,role,credential_hash) values (${id.operator},${id.centre},'op-1','centre_operator',${hash})`);
await db.execute(sql`insert into collectors (id,external_ref,status) values (${id.collector},'c-1','qualified')`);
await db.execute(sql`insert into device_types (id,code,generation) values (${id.dtype},'ego_headset','gen1')`);
await db.execute(sql`insert into devices (id,device_type_id,hardware_serial,status) values (${id.device},${id.dtype},'AZER76400FE','active')`);
await db.execute(sql`insert into tasks (id,name,unit_price,max_concurrent_claimants,status) values (${id.task},'housework',1200,5,'published')`);
await db.execute(sql`insert into scenarios (id,code,privacy_risk_level) values (${id.scenario},'home','low')`);

const app = buildApi({ db, tokenSecret: 'k' });
const tok = async (url, payload) => (await app.inject({ method:'POST', url, payload })).json().token;
const headers = {
  'x-machine-token': `Bearer ${await tok('/auth/machine',{machine_identifier:'HCM-01',secret:'pw'})}`,
  authorization: `Bearer ${await tok('/auth/operator',{external_ref:'op-1',secret:'pw'})}`,
};
const post = async (url, payload) => await app.inject({ method:'POST', url, payload, headers });
const get = async (url) => await app.inject({ method:'GET', url, headers });

const handover = uid(), batch = uid();
await post('/handovers', { id: handover, collector_id: id.collector, device_id: id.device, tf_card_id:'CARD-0001', handover_time:'2026-08-13T08:00:00Z' });
await post('/upload-batches', { id: batch, handover_id: handover, import_started_at:'2026-08-13T08:05:00Z' });
const session = uid();
await post(`/handovers/${handover}/sessions`, { id: session, task_id:id.task, scenario_id:id.scenario, others_in_frame:false, sensitive_info_present:false, prepare_time:'2026-08-13T07:00:00Z' });

const episodes = ['072310','072415','072516','072538','073055'].map(s => JSON.parse(readFileSync(`${process.cwd()}/.tmp-x/${s}.json`,'utf8')));
const res = await post(`/upload-batches/${batch}/episodes`, { episodes });
console.log('  submit HTTP', res.statusCode);
for (const e of res.json().episodes)
  console.log('   ', e.episode_id.slice(0,8), e.outcome.padEnd(10), e.resolution_state.padEnd(11), String(e.resolution_method).padEnd(17), 'defects='+(e.defects.join(',')||'-'));

const rows = (await db.execute(sql`
  select count(*)::int n, sum(case when resolution_state='resolved' and collection_session_id is not null then 1 else 0 end)::int good
  from episodes`));
console.log('  episodes', rows[0].n, ' resolved-with-session', rows[0].good);

const trace = (await db.execute(sql`
  select count(*)::int n from episodes e
  join upload_batches b on b.id=e.upload_batch_id
  join handovers h on h.id=b.handover_id
  join upload_devices ud on ud.id=b.upload_device_id
  join upload_centres uc on uc.id=ud.upload_centre_id
  join collection_sessions cs on cs.id=e.collection_session_id
  join tasks t on t.id=cs.task_id join collectors c on c.id=cs.collector_id
  join collection_session_devices csd on csd.collection_session_id=cs.id
  join devices dev on dev.id=csd.device_id`));
console.log('  UPL-07 full traversal rows:', trace[0].n, '(expect 5)');

const ex = (await get(`/upload-batches/${batch}/exceptions`)).json();
console.log('  exceptions summary:', JSON.stringify(ex.summary));
const paid = (await db.execute(sql`select round(sum(i.measured_duration_s)/60,4) m from episodes e join episode_ingests i on i.ingest_id=e.latest_ingest_id where e.resolution_state='resolved'`));
console.log('  payable minutes attributed:', paid[0].m);
await db.close();
