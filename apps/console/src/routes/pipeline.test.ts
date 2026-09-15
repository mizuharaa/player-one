// @vitest-environment jsdom
// Pipeline.tsx reaches `AppShell`, which reaches `lib/i18n.ts`, which reads
// `localStorage` while it is being imported. Nothing here uses the DOM;
// jsdom is only what makes that import legal (see episode-attention.test.ts).
import { describe, expect, it } from 'vitest';
import { ROWS } from './Pipeline.tsx';

/**
 * Pins the rows corrected against `apps/collector` and `packages/api` code
 * and tests, so a future edit that regresses one of them back to an
 * undersold or overclaimed state fails here instead of on a stakeholder.
 */
describe('Pipeline ROWS', () => {
  const byCapability = (name: string) => {
    const row = ROWS.find((r) => r.capability === name);
    expect(row, name).toBeDefined();
    return row!;
  };

  it('task hall and claiming is built, scoped to the requirements that are (APP-08 → APP-11)', () => {
    // APP-12 (task instruction structure) and APP-13 (release a claimed
    // task) are not built — see TaskDetail.tsx and collector-app.ts, which
    // has no collector-initiated release route. Narrowed, not widened.
    expect(byCapability('Task hall and claiming')).toMatchObject({
      requirement: 'APP-08 → APP-11',
      state: 'built',
    });
  });

  it('training and exam stays partial: the gate is built, the content is not', () => {
    // Training.tsx and Exam.tsx ship and are screen-tested (guidance-flow,
    // onboarding-recovery), but Training.tsx's own comment says "Not built.
    // No video player... No quiz", and Exam.tsx is three hardcoded
    // questions with no question bank (BO-13). Overclaiming this was the
    // failure mode this test guards against as much as underclaiming it.
    expect(byCapability('Training and exam')).toMatchObject({
      requirement: 'APP-03 → APP-05',
      state: 'partial',
    });
  });

  it('the scoped remote reviewer role is built, not merely buildable', () => {
    // packages/api/test/reviewer.test.ts is 1100+ lines; the scope is
    // enforced in actor.ts, credentials.ts, session.ts, media.ts and
    // checked from backoffice-role, park, review and settle tests too.
    expect(byCapability('Scoped remote reviewer role')).toMatchObject({
      requirement: 'PLT-10',
      state: 'built',
    });
  });

  it('bill export and mark paid is built, cited by the requirements the code names', () => {
    // settle.ts labels its own routes "// SET-06: export" and payout.ts's
    // mark-paid route "the manual rail (SET-03 ...)". BO-14 (collection-
    // point archive) has zero references anywhere and is not this feature.
    expect(byCapability('Bill export and mark paid')).toMatchObject({
      requirement: 'SET-03 · SET-06',
      state: 'built',
    });
  });

  it('cloud verification (checksum, multipart resume, cache-cleanup gate) is built, not blocked', () => {
    // collector-upload.ts, upload-worker.ts and the UPL-06 CHECK in
    // schema.ts implement this; D2 blocks Path B (UPL-02) only.
    const row = byCapability('Cloud verification');
    expect(row).toMatchObject({ requirement: 'UPL-04 → UPL-06', state: 'built' });
    expect(row.blocker).toBeUndefined();
  });
});
