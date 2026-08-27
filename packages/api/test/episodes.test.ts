import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveEpisodeId, type EpisodeRecord } from '@playerone/contracts';
import { buildApi, hashCredential } from '../src/index.ts';
import { closeDb, db, hasDb, liveClaim, truncate, useDatabase, violates } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('episodes');

/**
 * Submission and resolution over HTTP: the point at which a measurement gets an
 * owner, or is refused one and waits for a human.
 *
 * §10.2 is the criterion everything else serves — no episode exists in any state
 * but resolved-with-a-session or quarantined. It is asserted as a query over the
 * whole table rather than per response, because "no third state" is a property of
 * the store, not of one request.
 */

const SECRET = 'k';
const uid = () => randomUUID();
const T = Date.parse('2026-08-21T09:00:00.000Z');
const min = (n: number) => n * 60_000;

function record(opts: {
  basename?: string;
  startMs?: number | null;
  serial?: string;
  declaredSession?: string | null;
}): EpisodeRecord {
  const start = opts.startMs === undefined ? T : opts.startMs;
  const path = opts.basename ?? `ego_AZER76400FE_20260813_${String(Math.random()).slice(2, 8)}`;
  return {
    schema_version: '1.1.0',
    // Derived from the basename, exactly as the engine does it — the submit
    // route re-derives and refuses anything else.
    episode_id: deriveEpisodeId(path),
    content_fingerprint: 'a'.repeat(64),
    state: 'ok',
    source: { path, ingest_tool_version: '0.3.1', ingested_at: new Date().toISOString(), ingest_host: 'test' },
    device: { serial: opts.serial ?? 'AZER76400FE', firmware_declared: '1.0.3', calibration_serial: null },
    declared:
      opts.declaredSession === undefined
        ? null
        : {
            session_id: opts.declaredSession,
            status: 'completed',
            duration_sec: 12.852,
            start_time: null,
            end_time: null,
            video_left_frame_count: null,
            video_right_frame_count: null,
            imu_accel_count: null,
            imu_gyro_count: null,
            audio_frame_count: null,
          },
    streams: [],
    timing: {
      method: 'pts_sidecar',
      confidence: 'exact',
      usable_start_us: start === null ? null : String(start * 1000),
      usable_end_us: null,
      raw_duration_s: 8.5,
      max_stream_skew_ms: 0,
    },
    calibration: { present: true, files: [] },
    source_files: [],
    discrepancies: [],
    unclassified_files: [],
  };
}

describe.skipIf(!hasDb())('episode submission and resolution', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function harness() {
    const d = await db();
    const ids = {
      centre: uid(), machine: uid(), operator: uid(), collector: uid(),
      /** The next collector in the device's rotation. See the crosscheck tests. */
      collector2: uid(),
      deviceType: uid(), device: uid(), task: uid(), scenario: uid(),
    };
    const hash = await hashCredential('pw');
    await d.execute(sql`insert into upload_centres (id, region, name, status) values (${ids.centre}, 'HCM', 'c', 'active')`);
    await d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash) values (${ids.machine}, ${ids.centre}, 'M1', 'active', ${hash})`);
    await d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash) values (${ids.operator}, ${ids.centre}, 'op', 'centre_operator', ${hash})`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector}, 'c1', 'qualified')`);
    await d.execute(sql`insert into collectors (id, external_ref, status) values (${ids.collector2}, 'c2', 'qualified')`);
    await d.execute(sql`insert into device_types (id, code, generation) values (${ids.deviceType}, 'ego', 'g1')`);
    await d.execute(sql`insert into devices (id, device_type_id, hardware_serial, status) values (${ids.device}, ${ids.deviceType}, 'AZER76400FE', 'active')`);
    await d.execute(sql`insert into tasks (id, name, unit_price, max_concurrent_claimants, status) values (${ids.task}, 'housework', 1200, 5, 'published')`);
    await liveClaim(d, ids.task, ids.collector);
    await d.execute(sql`insert into scenarios (id, code, privacy_risk_level) values (${ids.scenario}, 'home', 'low')`);
    /**
     * The device's allotted period: open, and starting a month before every
     * episode in this file.
     *
     * Daniel, 2026-08-25: one collector holds a headset for about three months,
     * and the resolver crosschecks each candidate session against that. So a
     * fixture with no assignment row is a fixture in which every episode
     * legitimately routes to a human — true, and it would say nothing at all
     * about the rest of the decision table.
     */
    await d.execute(sql`
      insert into device_assignments (id, device_id, collector_id, valid_from)
      values (${uid()}, ${ids.device}, ${ids.collector}, ${new Date(T - min(60 * 24 * 30)).toISOString()})`);

    const app = buildApi({ db: d, tokenSecret: SECRET });
    const m = await app.inject({ method: 'POST', url: '/auth/machine', payload: { machine_identifier: 'M1', secret: 'pw' } });
    const o = await app.inject({ method: 'POST', url: '/auth/operator', payload: { external_ref: 'op', secret: 'pw' } });
    const headers = {
      'x-machine-token': `Bearer ${m.json().token}`,
      authorization: `Bearer ${o.json().token}`,
    };
    const send = async (method: 'POST' | 'GET', url: string, payload?: Record<string, unknown>) =>
      (await app.inject({ method, url, payload, headers })) as unknown as LightMyRequestResponse;

    const handover = uid();
    await send('POST', '/handovers', {
      id: handover,
      collector_id: ids.collector,
      device_id: ids.device,
      tf_card_id: 'CARD-1',
      handover_time: new Date(T).toISOString(),
    });
    const batch = uid();
    await send('POST', '/upload-batches', {
      id: batch,
      handover_id: handover,
      import_started_at: new Date(T).toISOString(),
    });

    /** Sessions are handover-origin by API design; `origin` overrides for app-path tests. */
    const addSession = async (offsetMin: number, origin?: 'app') => {
      const id = uid();
      const res = await send('POST', `/handovers/${handover}/sessions`, {
        id,
        task_id: ids.task,
        scenario_id: ids.scenario,
        others_in_frame: false,
        sensitive_info_present: false,
        prepare_time: new Date(T + min(offsetMin)).toISOString(),
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      if (origin === 'app') {
        await d.execute(sql`update collection_sessions set session_origin = 'app' where id = ${id}`);
      }
      return id;
    };

    const submit = (episodes: EpisodeRecord[]) =>
      send('POST', `/upload-batches/${batch}/episodes`, { episodes });

    /** A second card from the same collector, days later. */
    const newHandover = async (card: string) => {
      const h2 = uid();
      const b2 = uid();
      await send('POST', '/handovers', {
        id: h2,
        collector_id: ids.collector,
        device_id: ids.device,
        tf_card_id: card,
        handover_time: new Date(T + min(60 * 24 * 7)).toISOString(),
      });
      await send('POST', '/upload-batches', {
        id: b2,
        handover_id: h2,
        import_started_at: new Date(T + min(60 * 24 * 7)).toISOString(),
      });
      return { handover: h2, batch: b2 };
    };

    const addSessionOn = async (h2: { handover: string }, offsetMin: number) => {
      const id = uid();
      const res = await send('POST', `/handovers/${h2.handover}/sessions`, {
        id,
        task_id: ids.task,
        scenario_id: ids.scenario,
        others_in_frame: false,
        sensitive_info_present: false,
        prepare_time: new Date(T + min(60 * 24 * 7 + offsetMin)).toISOString(),
      });
      expect(res.statusCode, res.body).toBeLessThan(300);
      return id;
    };

    const submitTo = (b: string, episodes: EpisodeRecord[]) =>
      send('POST', `/upload-batches/${b}/episodes`, { episodes });

    /** The end of one allotment and the start of the next, as the back office writes it. */
    const reassignTo = async (collectorId: string, atMs: number) => {
      const at = new Date(atMs).toISOString();
      await d.execute(sql`
        update device_assignments set valid_to = ${at}
         where device_id = ${ids.device} and valid_to is null`);
      await d.execute(sql`
        insert into device_assignments (id, device_id, collector_id, valid_from)
        values (${uid()}, ${ids.device}, ${collectorId}, ${at})`);
    };

    /** Everything the resolver considered, off the audit row it was written to. */
    const evaluatedOf = async (episodeId: string) => {
      const rows = (await d.execute(sql`
        select after from audit_events
         where action = 'episode.submit' and target_id = ${episodeId}`)) as unknown as {
        after: { evaluated: { collection_session_id: string; rejection_reason: string | null }[] };
      }[];
      return rows[0]!.after.evaluated;
    };

    return {
      d, ids, handover, batch, send, addSession, submit, newHandover, addSessionOn, submitTo,
      reassignTo, evaluatedOf,
    };
  }

  /** §10.2, as a property of the table rather than of a response. */
  const assertNoThirdState = async () => {
    const rows = (await (await db()).execute(sql`
      select count(*)::int as bad from episodes
      where not (
        (resolution_state = 'resolved' and collection_session_id is not null)
        or (resolution_state = 'quarantined' and collection_session_id is null)
      )`)) as unknown as { bad: number }[];
    expect(rows[0]!.bad).toBe(0);
  };

  it('resolves every episode when the card carries one declared session', async () => {
    const h = await harness();
    const session = await h.addSession(-60);
    const res = await h.submit([record({}), record({}), record({})]);

    expect(res.statusCode, res.body).toBe(200);
    const out = res.json().episodes as Record<string, unknown>[];
    expect(out).toHaveLength(3);
    for (const e of out) {
      expect(e['resolution_state']).toBe('resolved');
      expect(e['resolution_method']).toBe('automatic_single');
      expect(e['needs_confirmation']).toBe(false);
    }

    const rows = (await h.d.execute(sql`
      select distinct collection_session_id, upload_path, upload_batch_id from episodes
    `)) as unknown as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!['collection_session_id']).toBe(session);
    expect(rows[0]!['upload_path']).toBe('C');
    expect(rows[0]!['upload_batch_id']).toBe(h.batch);
    await assertNoThirdState();
  });

  it('refuses an episode id that does not derive from its own basename', async () => {
    const h = await harness();
    await h.addSession(-60);
    const honest = record({ basename: 'ego_AZER76400FE_20260813_072310' });
    expect((await h.submit([honest])).json().episodes[0].resolution_state).toBe('resolved');

    /**
     * The id is global by design — a card at the counter and a cloud
     * re-download of one session are one episode and one payment. A caller who
     * could choose it could therefore name an episode belonging to another
     * centre and, two transactions later, have it attached to this machine's
     * batch. The basename is the only input the id has.
     */
    const forged = { ...record({ basename: 'ego_AZER76400FE_20260813_073055' }), episode_id: honest.episode_id };
    const res = await h.submit([forged]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().episodes[0].error).toMatch(/does not derive/);
    expect(res.json().episodes[0].expected_episode_id).not.toBe(honest.episode_id);

    // Nothing moved: one episode, still on its own delivery.
    const rows = (await h.d.execute(sql`select count(*) as n from episodes`)) as unknown as { n: string }[];
    expect(Number(rows[0]!.n)).toBe(1);
    await assertNoThirdState();
  });

  it('quarantines when the handover declared no sessions at all', async () => {
    const h = await harness();
    const res = await h.submit([record({})]);
    expect(res.json().episodes[0].resolution_state).toBe('quarantined');
    expect(res.json().episodes[0].reason).toBe('no_sessions');
    await assertNoThirdState();
  });

  // -- §10.3 ---------------------------------------------------------------

  it('§10.3 resolves two app-origin sessions by window, and quarantines the ambiguous one', async () => {
    const h = await harness();
    const morning = await h.addSession(-120, 'app');
    const afternoon = await h.addSession(240, 'app');
    // A third task starting two minutes after the second. Ambiguity is two
    // sessions close enough together to be indistinguishable — not merely an
    // episode landing soon after one of them, which is perfectly clear.
    const evening = await h.addSession(242, 'app');

    const res = await h.submit([
      record({ startMs: T }), // after morning, hours before the rest
      record({ startMs: T + min(300) }), // after all three
      record({ startMs: T + min(241) }), // between afternoon and evening: ambiguous
    ]);
    const out = res.json().episodes as Record<string, string>[];

    expect(out[0]!['resolution_state']).toBe('resolved');
    expect(out[0]!['resolution_method']).toBe('automatic_time_window');
    expect(out[1]!['resolution_state']).toBe('resolved');
    expect(out[2]!['resolution_state']).toBe('quarantined');
    expect(out[2]!['reason']).toBe('ambiguous_within_tolerance');

    const rows = (await h.d.execute(sql`
      select collection_session_id from episodes where resolution_state = 'resolved'
    `)) as unknown as Record<string, string>[];
    expect(new Set(rows.map((r) => r['collection_session_id']))).toEqual(
      new Set([morning, evening]),
    );
    expect(afternoon).toBeTruthy();
    await assertNoThirdState();
  });

  it('sends a two-session handover to the operator instead of guessing', async () => {
    // The pilot's normal path: both sessions were reconstructed at the counter.
    const h = await harness();
    await h.addSession(-120);
    await h.addSession(240);
    const res = await h.submit([record({ startMs: T })]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('quarantined');
    expect(e.reason).toBe('operator_confirmation_required');
    // A proposal is offered so the console can order the work.
    expect(e.proposed_session_id).not.toBeNull();
    await assertNoThirdState();
  });

  // -- §10.4 ---------------------------------------------------------------

  it('§10.4 ingests, resolves and flags an episode whose manifest names another session', async () => {
    const h = await harness();
    const session = await h.addSession(-60);
    const res = await h.submit([record({ declaredSession: 'device-invented-this' })]);

    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('resolved');
    expect(e.collection_session_id ?? session).toBeTruthy();
    expect(e.defects).toContain('SESSION-CONFLICT');

    // Recorded against the ingest, exactly as CHECKSUM-MISMATCH is.
    const rows = (await h.d.execute(sql`
      select code, severity from episode_defects where code = 'SESSION-CONFLICT'
    `)) as unknown as Record<string, string>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!['severity']).toBe('flag');
    await assertNoThirdState();
  });

  it('flags a card that came off a different device, without blocking it', async () => {
    const h = await harness();
    await h.addSession(-60);
    const res = await h.submit([record({ serial: 'BZER99900AA' })]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('resolved');
    expect(e.defects).toContain('SERIAL-CONFLICT');
  });

  // -- §10.5 ---------------------------------------------------------------

  it('§10.5 traverses episode → batch → handover → machine → centre, one row', async () => {
    const h = await harness();
    await h.addSession(-60);
    await h.submit([record({})]);

    const rows = (await h.d.execute(sql`
      select e.episode_id, uc.id as centre, ud.id as machine, ho.id as handover,
             t.id as task, c.id as collector, dev.id as device
      from episodes e
      join upload_batches b on b.id = e.upload_batch_id
      join handovers ho on ho.id = b.handover_id
      join upload_devices ud on ud.id = b.upload_device_id
      join upload_centres uc on uc.id = ud.upload_centre_id
      join collection_sessions cs on cs.id = e.collection_session_id
      join tasks t on t.id = cs.task_id
      join collectors c on c.id = cs.collector_id
      join collection_session_devices csd on csd.collection_session_id = cs.id
      join devices dev on dev.id = csd.device_id
    `)) as unknown as Record<string, string>[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!['centre']).toBe(h.ids.centre);
    expect(rows[0]!['machine']).toBe(h.ids.machine);
    expect(rows[0]!['handover']).toBe(h.handover);
    expect(rows[0]!['collector']).toBe(h.ids.collector);
  });

  /**
   * The bug the audit found. Candidate sessions were scoped by collector, so
   * every session a collector had ever declared was a candidate for every later
   * card. One card per collector hides it completely; the second card
   * quarantined wholesale, and under time-window matching it could have paid
   * this week's footage against last week's task at last week's unit price.
   */
  it('only considers sessions declared against THIS card', async () => {
    const h = await harness();
    await h.addSession(-60);
    await h.submit([record({})]);

    // The same collector, a week later, a different card, again one declared task.
    const second = await h.newHandover('CARD-2');
    const later = await h.addSessionOn(second, -60);
    const res = await h.submitTo(second.batch, [record({})]);

    const e = res.json().episodes[0];
    expect(e.resolution_state, 'a second card with one task must still auto-resolve').toBe(
      'resolved',
    );
    expect(e.resolution_method).toBe('automatic_single');

    const rows = (await h.d.execute(sql`
      select collection_session_id from episodes where upload_batch_id = ${second.batch}
    `)) as unknown as Record<string, string>[];
    expect(rows[0]!['collection_session_id']).toBe(later);
    await assertNoThirdState();
  });

  // -- the device-assignment crosscheck (Daniel, 2026-08-25) ----------------

  /**
   * A device belongs to one collector for an allotted period, so device serial
   * plus recording start names a collector. The resolver crosschecks each
   * candidate against that, and the three outcomes below are the whole rule.
   *
   * The handover scope is untouched by any of it: these episodes all arrive on
   * a card their collector handed across a counter, and the crosscheck only
   * ever narrows the set that scope produced.
   */
  it('treats footage from before the first recorded period as untracked, not as a gap', async () => {
    // Bridge F-33. Custody tracking starts with the first bind or typed
    // period. A backlog card recorded before that instant must not be
    // quarantined by the bind that came after it: before the record begins
    // there is nothing to disagree with.
    const h = await harness();
    const session = await h.addSession(-60);
    await h.d.execute(sql`
      update device_assignments set valid_from = ${new Date(T + min(60 * 24)).toISOString()}
       where device_id = ${h.ids.device}`);

    const res = await h.submit([record({})]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('resolved');
    expect(e.reason).toBe('single_session');
    const evaluated = await h.evaluatedOf(e.episode_id);
    expect(evaluated).toEqual([
      expect.objectContaining({ collectionSessionId: session, survived: true, rejectionReason: null }),
    ]);
    await assertNoThirdState();
  });

  it('does not run the crosscheck for a device with no custody history at all', async () => {
    // Bridge F-20. On the upgrade path nothing seeds `device_assignments`, so
    // every pilot device starts with no history. That is "not tracked yet", not
    // "a gap in the record": the crosscheck stays off until the first bind or
    // typed period exists for the device, and the episode resolves as before.
    const h = await harness();
    const session = await h.addSession(-60);
    await h.d.execute(sql`delete from device_assignments where device_id = ${h.ids.device}`);

    const res = await h.submit([record({})]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('resolved');
    expect(e.reason).toBe('single_session');
    const evaluated = await h.evaluatedOf(e.episode_id);
    expect(evaluated).toEqual([
      expect.objectContaining({ collectionSessionId: session, survived: true, rejectionReason: null }),
    ]);
    await assertNoThirdState();
  });

  it('resolves when the card holder held the device when the recording started', async () => {
    const h = await harness();
    const session = await h.addSession(-60);
    const res = await h.submit([record({})]);

    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('resolved');
    expect(e.reason).toBe('single_session');
    const evaluated = await h.evaluatedOf(e.episode_id);
    expect(evaluated).toEqual([
      expect.objectContaining({ collectionSessionId: session, survived: true, rejectionReason: null }),
    ]);
    await assertNoThirdState();
  });

  it('drops a session whose collector had already handed the device on', async () => {
    const h = await harness();
    const session = await h.addSession(-60);
    // The allotment swapped to the second collector a week before this
    // recording, so this card's own declared task cannot own the footage.
    await h.reassignTo(h.ids.collector2, T - min(60 * 24 * 7));

    const res = await h.submit([record({})]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('quarantined');
    expect(e.reason).toBe('all_candidates_ineligible');

    // The drop is on the record with its own reason, like every other drop.
    const evaluated = await h.evaluatedOf(e.episode_id);
    expect(evaluated).toEqual([
      expect.objectContaining({
        collectionSessionId: session,
        survived: false,
        rejectionReason: 'device_not_assigned_to_collector',
      }),
    ]);
    await assertNoThirdState();
  });

  it('sends an episode to a human when no allotment covers its start, dropping nobody', async () => {
    const h = await harness();
    const session = await h.addSession(-60);
    // The record has a hole: the first allotment ended two hours before this
    // recording and the next starts tomorrow. Nobody is on record as holding
    // the device at the moment this was recorded — which is not the same fact
    // as "this collector was not", so nothing is refused, and the absence
    // itself is what the operator is shown.
    await h.d.execute(sql`
      update device_assignments set valid_to = ${new Date(T - min(120)).toISOString()}
       where device_id = ${h.ids.device}`);
    await h.d.execute(sql`
      insert into device_assignments (id, device_id, collector_id, valid_from)
      values (${uid()}, ${h.ids.device}, ${h.ids.collector}, ${new Date(T + min(60 * 24)).toISOString()})`);

    const res = await h.submit([record({})]);
    const e = res.json().episodes[0];
    expect(e.resolution_state).toBe('quarantined');
    expect(e.reason).toBe('device_assignment_unknown');

    const evaluated = await h.evaluatedOf(e.episode_id);
    expect(evaluated).toEqual([
      expect.objectContaining({ collectionSessionId: session, survived: true, rejectionReason: null }),
    ]);
    await assertNoThirdState();
  });

  it('refuses a handover-origin session with no handover, at the database', async () => {
    const h = await harness();
    await violates(
      'collection_sessions_handover_required_check',
      h.d.execute(sql`
        insert into collection_sessions (id, task_id, collector_id, scenario_id,
          others_in_frame, sensitive_info_present, session_origin)
        values (${uid()}, ${h.ids.task}, ${h.ids.collector}, ${h.ids.scenario}, false, false, 'handover')`),
    );
  });

  it('answers 409 rather than crashing for an episode that never came through a batch', async () => {
    // Stored by the CLI, so upload_batch_id is null. This used to reach Postgres
    // as an empty uuid and answer 500.
    const h = await harness();
    const session = await h.addSession(-60);
    const orphan = uid();
    await h.d.execute(sql`
      insert into episodes (episode_id, device_serial, session_started_at, first_seen_at,
                            last_seen_at, ingest_count, resolution_state)
      values (${orphan}, 'AZER76400FE', '20260813_072310', now(), now(), 1, 'quarantined')`);
    const res = await h.send('POST', `/episodes/${orphan}/resolve`, {
      collection_session_id: session,
      reason: 'trying to attach a CLI-stored episode',
    });
    expect(res.statusCode).toBe(409);
  });

  it('seeds the defect catalogue on boot, so routing is never empty', async () => {
    const h = await harness();
    const rows = (await h.d.execute(
      sql`select count(*)::int n from defect_codes`,
    )) as unknown as { n: number }[];
    expect(rows[0]!.n).toBeGreaterThan(25);
  });

  // -- idempotency ---------------------------------------------------------

  it('re-submitting the same episodes creates nothing new', async () => {
    const h = await harness();
    await h.addSession(-60);
    const episodes = [record({}), record({})];

    const first = await h.submit(episodes);
    expect(first.json().episodes.map((e: { outcome: string }) => e.outcome)).toEqual(['new', 'new']);

    const before = (await h.d.execute(sql`
      select (select count(*)::int from episodes) as e,
             (select count(*)::int from episode_ingests) as i,
             (select count(*)::int from audit_events) as a`)) as unknown as Record<string, number>[];

    const second = await h.submit(episodes);
    expect(second.json().episodes.map((e: { outcome: string }) => e.outcome)).toEqual([
      'duplicate',
      'duplicate',
    ]);

    const after = (await h.d.execute(sql`
      select (select count(*)::int from episodes) as e,
             (select count(*)::int from episode_ingests) as i,
             (select count(*)::int from audit_events) as a`)) as unknown as Record<string, number>[];

    expect(after[0]!['e']).toBe(before[0]!['e']);
    expect(after[0]!['i']).toBe(before[0]!['i']);
    // Two more audit rows: re-stating the resolution is a real UPDATE each time.
    // The episode and ingest counts are what §10.6 protects.
    expect(after[0]!['a']).toBe(before[0]!['a']! + 2);
  });

  // -- the human resolution path -------------------------------------------

  it('lets an operator attach a quarantined episode, and demands a reason', async () => {
    const h = await harness();
    const morning = await h.addSession(-120);
    await h.addSession(240);
    const res = await h.submit([record({ startMs: T })]);
    const episodeId = res.json().episodes[0].episode_id as string;

    const noReason = await h.send('POST', `/episodes/${episodeId}/resolve`, {
      collection_session_id: morning,
    });
    expect(noReason.statusCode).toBe(400);

    const ok = await h.send('POST', `/episodes/${episodeId}/resolve`, {
      collection_session_id: morning,
      reason: 'collector confirmed the morning task at the counter',
    });
    expect(ok.statusCode, ok.body).toBe(200);

    const rows = (await h.d.execute(sql`
      select resolution_state, resolution_method, collection_session_id from episodes
    `)) as unknown as Record<string, string>[];
    expect(rows[0]!['resolution_state']).toBe('resolved');
    expect(rows[0]!['resolution_method']).toBe('manual');
    expect(rows[0]!['collection_session_id']).toBe(morning);

    // The audit row keeps what was proposed and what was chosen.
    const audit = (await h.d.execute(sql`
      select reason, before, after from audit_events where action = 'episode.resolve_manual'
    `)) as unknown as { reason: string; after: Record<string, string> }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toContain('collector confirmed');
    expect(audit[0]!.after['collection_session_id']).toBe(morning);
    await assertNoThirdState();
  });

  it('refuses a session that belongs to a different delivery', async () => {
    const h = await harness();
    await h.addSession(-60);
    const res = await h.submit([record({})]);
    const episodeId = res.json().episodes[0].episode_id as string;

    const foreign = uid();
    await h.d.execute(sql`
      insert into collection_sessions (id, task_id, collector_id, scenario_id,
        others_in_frame, sensitive_info_present, session_origin)
      values (${foreign}, ${h.ids.task}, ${uid()}, ${h.ids.scenario}, false, false, 'handover')
    `).catch(() => undefined); // a different collector fails the FK, which is the point

    const bad = await h.send('POST', `/episodes/${episodeId}/resolve`, {
      collection_session_id: foreign,
      reason: 'trying it on',
    });
    expect(bad.statusCode).toBe(409);
  });

  it('separates confirming the machine from choosing instead of it', async () => {
    const h = await harness();
    await h.addSession(-120, 'app');
    await h.addSession(240, 'app');
    const res = await h.submit([record({ startMs: T })]);
    const e = res.json().episodes[0];
    expect(e.needs_confirmation).toBe(true);

    const confirm = await h.send('POST', `/episodes/${e.episode_id}/confirm`);
    expect(confirm.statusCode, confirm.body).toBe(200);
    expect(confirm.json().already_confirmed).toBe(false);

    // Idempotent, and a second call is not a second confirmation.
    const again = await h.send('POST', `/episodes/${e.episode_id}/confirm`);
    expect(again.json().already_confirmed).toBe(true);

    const actions = (await h.d.execute(sql`
      select action from audit_events where action like 'episode.resolve%'
    `)) as unknown as { action: string }[];
    expect(actions.map((a) => a.action)).toEqual(['episode.resolve_confirm']);
  });

  it('will not confirm an episode the machine never proposed', async () => {
    const h = await harness();
    const res = await h.submit([record({})]); // no sessions: quarantined
    const episodeId = res.json().episodes[0].episode_id as string;
    const confirm = await h.send('POST', `/episodes/${episodeId}/confirm`);
    expect(confirm.statusCode).toBe(409);
  });

  // -- the exception view --------------------------------------------------

  it('shows what blocks batch close, and the ratio worth a glance', async () => {
    const h = await harness();
    await h.addSession(-60);
    const res = await h.submit([record({}), record({}), record({}), record({})]);
    expect(res.statusCode).toBe(200);

    const view = await h.send('GET', `/upload-batches/${h.batch}/exceptions`);
    const body = view.json();
    expect(body.summary.episodes).toBe(4);
    expect(body.summary.sessions).toBe(1);
    // Four episodes against one declared task: not wrong, but an operator should
    // see it rather than meet it in a settlement report (SET-08).
    expect(body.summary.episodes_per_session).toBe(4);
    expect(body.summary.quarantined).toBe(0);
    expect(body.blocking).toHaveLength(0);
  });

  it('lists quarantined episodes as needing assignment', async () => {
    const h = await harness();
    await h.addSession(-120);
    await h.addSession(240);
    await h.submit([record({ startMs: T }), record({ startMs: T + min(300) })]);

    const view = await h.send('GET', `/upload-batches/${h.batch}/exceptions`);
    const body = view.json();
    expect(body.summary.quarantined).toBe(2);
    expect(body.blocking).toHaveLength(2);
    expect(body.blocking.every((b: { needs: string }) => b.needs === 'assignment')).toBe(true);
    expect(body.sessions).toHaveLength(2);
  });

  it('reports batch counts for the status view', async () => {
    const h = await harness();
    await h.addSession(-60);
    await h.submit([record({}), record({})]);
    const list = await h.send('GET', '/upload-batches');
    const batch = list.json().batches.find((b: { id: string }) => b.id === h.batch);
    expect(batch.resolved).toBe(2);
    expect(batch.quarantined).toBe(0);
  });
});
