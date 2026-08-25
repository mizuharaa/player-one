import { describe, expect, it } from 'vitest';
import { EXAM_QUESTION_COUNT, MockCollectorApi } from '../src/api/mock.ts';
import { AGREEMENTS } from '../src/api/types.ts';
import { LOCALES, MESSAGES } from '../src/i18n.ts';

/**
 * The mock is the app's server until the real one exists, so its gates are
 * pinned here: they are the same gates the server enforces (APP-02, APP-05,
 * APP-10, APP-15, APP-25), and a screen developed against a permissive mock
 * would ship expecting a permissive server.
 */

const PASSING = Array<boolean>(EXAM_QUESTION_COUNT).fill(true);

async function onboarded(): Promise<MockCollectorApi> {
  const api = new MockCollectorApi();
  await api.register('Nguyễn Văn A', '0903000001');
  await api.acceptAgreements(AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version })));
  await api.completeTraining();
  await api.submitExam(PASSING);
  return api;
}

describe('the agreement contract with the server (APP-02)', () => {
  it('names the six agreements exactly as the server CHECK does', () => {
    // This app cannot enforce anything: acceptance is only real once the
    // server has written a `collector_agreements` row, and that table's
    // `collector_agreements_name_check` accepts these six strings and no
    // others. The app shipped `data_commercial_use` against the server's
    // `commercial_use` — six agreements presented, five acceptable, and no
    // collector could ever become eligible. The list is duplicated across a
    // repository boundary, so it is pinned on both sides rather than hoped at.
    //
    // Source of truth: packages/store/src/schema.ts, collector_agreements_name_check.
    expect(AGREEMENTS.map((a) => a.id)).toEqual([
      'user',
      'privacy',
      'data_collection',
      'commercial_use',
      'manual_review',
      'offline_settlement',
    ]);
  });

  it('has a label for every agreement in every locale', () => {
    // A renamed id that slipped past the list above would still render as a
    // missing key rather than an agreement title.
    for (const locale of LOCALES) {
      for (const a of AGREEMENTS) {
        expect(MESSAGES[locale][`agreement.${a.id}`]).toBeTruthy();
      }
    }
  });
});

describe('registration and the six agreements (APP-01/02)', () => {
  it('records acceptance with version and timestamp, all six required', async () => {
    const api = new MockCollectorApi();
    await api.register('Trần Thị B', '0903000002');

    // Five of six is no acceptance.
    await expect(
      api.acceptAgreements(
        AGREEMENTS.slice(0, 5).map((a) => ({ agreementId: a.id, version: a.version })),
      ),
    ).rejects.toThrow('agreements_incomplete');

    // A stale version is no acceptance either.
    await expect(
      api.acceptAgreements(
        AGREEMENTS.map((a, i) => ({ agreementId: a.id, version: i === 0 ? '0.9' : a.version })),
      ),
    ).rejects.toThrow('agreements_incomplete');

    const profile = await api.acceptAgreements(
      AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version })),
    );
    expect(profile.agreements).toHaveLength(6);
    for (const acceptance of profile.agreements) {
      expect(acceptance.version).toBe('1.0');
      expect(Date.parse(acceptance.acceptedAt)).not.toBeNaN();
    }
  });
});

describe('exam gates claiming (APP-04/05)', () => {
  it('refuses a claim before a pass, allows it after', async () => {
    const api = new MockCollectorApi();
    await api.register('Lê Văn C', '0903000003');

    await expect(api.claimTask('task-cook')).rejects.toThrow('exam_not_passed');

    const failed = await api.submitExam([true, false, true]);
    expect(failed.passed).toBe(false);
    await expect(api.claimTask('task-cook')).rejects.toThrow('exam_not_passed');

    const passed = await api.submitExam(PASSING);
    expect(passed.passed).toBe(true);
    const claim = await api.claimTask('task-cook');
    expect(claim.taskId).toBe('task-cook');
  });
});

describe('the task hall (APP-08/10)', () => {
  it('caps claims at the seeded capacity another collector already filled', async () => {
    const api = await onboarded();
    // task-office ships at 2/2 claimants — other collectors got there first.
    await expect(api.claimTask('task-office')).rejects.toThrow('task_at_capacity');
  });

  it('refuses a second claim of the same task', async () => {
    const api = await onboarded();
    await api.claimTask('task-cook');
    await expect(api.claimTask('task-cook')).rejects.toThrow('already_claimed');
  });
});

describe('session creation (APP-14/15/16/17b)', () => {
  it('needs a bound device and a claimed task, and captures both declarations', async () => {
    const api = await onboarded();
    await api.claimTask('task-warehouse');

    // APP-15: no device binding, no collection preparation.
    await expect(
      api.createSession({
        taskId: 'task-warehouse',
        deviceSerial: 'EGO1-PILOT-0007',
        scenario: 'warehouse',
        othersInFrame: true,
        sensitiveInfo: false,
      }),
    ).rejects.toThrow('device_not_bound');

    await api.bindDevice('EGO1-PILOT-0007');

    await expect(
      api.createSession({
        taskId: 'task-cook', // not claimed
        deviceSerial: 'EGO1-PILOT-0007',
        scenario: 'home',
        othersInFrame: false,
        sensitiveInfo: false,
      }),
    ).rejects.toThrow('task_not_claimed');

    const session = await api.createSession({
      taskId: 'task-warehouse',
      deviceSerial: 'EGO1-PILOT-0007',
      scenario: 'warehouse',
      othersInFrame: true,
      sensitiveInfo: false,
    });
    // APP-16: task + collector + device + scenario, bound into one identifier.
    expect(session.id).toMatch(/^ses-/);
    expect(session.collectorId).toMatch(/^col-/);
    expect(session.taskId).toBe('task-warehouse');
    expect(session.deviceSerial).toBe('EGO1-PILOT-0007');
    expect(session.scenario).toBe('warehouse');
    expect(session.othersInFrame).toBe(true);
    expect(session.sensitiveInfo).toBe(false);
    // The client sent no duration and no amount, and the session carries none.
    expect(Object.keys(session)).not.toContain('durationSec');
    expect(Object.keys(session).join()).not.toMatch(/amount|minutes/i);
  });
});

describe('uploads are manual, never automatic, never silent (APP-23/24/25)', () => {
  it('moves an episode only through confirmUpload, and only from pending', async () => {
    const api = await onboarded();
    const before = await api.episodes();
    const pending = before.filter((e) => e.state === 'pending_upload');
    expect(pending.length).toBeGreaterThan(0);

    // Time passing and re-listing change nothing: no upload starts on its own.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const relisted = await api.episodes();
    expect(relisted).toEqual(before);

    const first = pending[0]!;
    const confirmed = await api.confirmUpload(first.episodeId);
    expect(confirmed.state).toBe('uploading');

    // Confirming again is a client bug, not a second upload.
    await expect(api.confirmUpload(first.episodeId)).rejects.toThrow('not_pending');
    // Nor can an episode in review be "uploaded" again.
    await expect(api.confirmUpload('ego1-20260820-1830')).rejects.toThrow('not_pending');
  });

  it('names APP-23’s six states verbatim, and seeds the ones no tap can produce', async () => {
    const { EPISODE_STATES } = await import('../src/api/types.ts');
    expect(EPISODE_STATES).toEqual([
      'pending_upload',
      'uploading',
      'uploaded',
      'under_review',
      'review_passed',
      'review_failed',
    ]);
    // uploading/uploaded exist only downstream of a confirmation; the rest
    // must be visible without one.
    const api = await onboarded();
    const states = new Set((await api.episodes()).map((e) => e.state));
    expect(states).toEqual(new Set(['pending_upload', 'under_review', 'review_passed', 'review_failed']));
    const failed = (await api.episodes()).find((e) => e.state === 'review_failed');
    // APP-27: the reason arrives in the collector's language.
    expect(failed?.rejectReason).toBeTruthy();
  });
});

describe('income (APP-33/34)', () => {
  it('keeps estimated and confirmed apart, figures server-authored', async () => {
    const api = await onboarded();
    const entries = await api.income();
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['estimated', 'confirmed']));
    // Amounts are strings from the server — the app never computes money.
    for (const entry of entries) {
      if (entry.amountVnd !== null) expect(typeof entry.amountVnd).toBe('string');
    }
  });
});
