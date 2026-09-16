// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { signOut } from './profile-api.ts';
import {
  clearAllDrafts,
  clearDraft,
  draftSavedAt,
  forbiddenField,
  readDraft,
  useDraft,
  writeDraft,
} from './draft.ts';

/**
 * The draft store, and the rule it exists to keep.
 *
 * The first block is the one that matters. A draft cache is exactly where the
 * money rules get broken: it is a convenient place to stash "whatever the form
 * had", and whatever the form had on the payout screens is a bank account
 * number or a retyped payment total. So the shapes that are allowed and the
 * shapes that are refused are both pinned here, by field name, and the guard
 * lives on the write as well as in this file — a test can only see the callers
 * that exist today.
 */
beforeEach(() => sessionStorage.clear());

const ACTOR = 'op-1';

describe('what a draft may and may not carry', () => {
  /**
   * The three real Cut 1 drafts. If a later change adds a field to one of
   * these screens that trips the guard, this is the test that says so before
   * an operator meets a form that silently will not save.
   */
  it('accepts every draft this console actually stores', () => {
    const taskAssign = {
      taskId: 'a-uuid',
      ids: { 'c-1': { claim: 'u1', assignment: 'u2' } },
      name: 'Kitchen, morning',
      type: 'cooking',
      price: '1200',
      target: '3600',
      capacity: '3',
      publish: true,
      chosen: ['c-1'],
      cameras: { 'c-1': 'd-1' },
      at: 4,
    };
    const counter = {
      handoverId: 'a-uuid',
      sessionId: 'b-uuid',
      landed: true,
      collectorId: 'c-1',
      deviceId: 'd-1',
      card: 'TF-0041',
      handoverAt: '2026-09-16T09:00',
      taskId: 't-1',
      scenarioId: 's-1',
      preparedAt: '2026-09-16T09:05',
      others: true,
      sensitive: false,
      at: 6,
    };
    const backOffice = { requestId: 'a-uuid' };

    expect(forbiddenField(taskAssign)).toBeNull();
    expect(forbiddenField(counter)).toBeNull();
    expect(forbiddenField(backOffice)).toBeNull();
  });

  /**
   * Every shape the plan excluded, refused **by name**, so the failure message
   * tells you which field it was.
   *
   * `typed` is the confirm-by-retyping gate in front of `payout.runBatch`
   * (`PreflightScreen.tsx:330`) and `markPaid` (`BillScreen.tsx:286`).
   * Persisting it would pre-arm a payment button, which is the single worst
   * thing this file could do. `account`/`bank` are the collector's payout
   * destination (`BackOffice.tsx:832-847`). `code` is a one-time sign-in code
   * and `password` a camera's Wi-Fi password, both from the collector app.
   */
  it.each([
    ['token', { token: 'ey.j' }],
    ['password', { password: 'wifi-pw' }],
    ['code', { code: '123456' }],
    ['smsCode', { smsCode: '123456' }],
    ['phone', { phone: '0900000000' }],
    ['account_no', { account_no: '12345678' }],
    ['bank_code', { bank_code: 'VCB' }],
    ['cardNo', { cardNo: '4111111111111111' }],
    ['typed', { typed: '679.9992' }],
    ['reference', { reference: 'FT26091600123' }],
  ])('refuses a draft carrying %s', (name, value) => {
    expect(forbiddenField(value)).toBe(name);
  });

  it('finds a forbidden field nested in an object or an array', () => {
    expect(forbiddenField({ outer: { inner: { token: 'x' } } })).toBe('token');
    expect(forbiddenField({ rows: [{ ok: 1 }, { account_no: '1' }] })).toBe('account_no');
  });

  /** The write refuses it too, not just this test. Nothing reaches storage. */
  it('does not write a draft that carries one, and says which field', () => {
    const complained = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeDraft('settle', ACTOR, { typed: '679.9992' });
    expect(sessionStorage.length).toBe(0);
    expect(complained.mock.calls[0]?.[0]).toContain('typed');
    complained.mockRestore();
  });
});

describe('reading a draft back', () => {
  it('round-trips what was written', () => {
    writeDraft('counter', ACTOR, { card: 'TF-0041', at: 3 });
    expect(readDraft<{ card: string; at: number }>('counter', ACTOR)).toEqual({ card: 'TF-0041', at: 3 });
  });

  /**
   * Scoped to the operator. On a shared back-office machine two operators must
   * not see each other's typing, and this is the guard that does not depend on
   * anybody remembering to sign out.
   */
  it('does not hand one operator another operator’s draft', () => {
    writeDraft('counter', 'op-1', { card: 'TF-0041' });
    expect(readDraft('counter', 'op-2')).toBeNull();
  });

  /** A draft past the age bound is gone, and the key with it. */
  it('drops a draft older than a day and clears the key', () => {
    const then = Date.UTC(2026, 8, 15, 9, 0, 0);
    writeDraft('counter', ACTOR, { card: 'TF-0041' }, then);
    expect(readDraft('counter', ACTOR, then + 23 * 60 * 60 * 1000)).not.toBeNull();
    expect(readDraft('counter', ACTOR, then + 25 * 60 * 60 * 1000)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  /** Corrupt JSON is not a crash and is not a draft; it is cleared. */
  it('clears a half-written value rather than throwing', () => {
    sessionStorage.setItem(`playerone.console.draft.${ACTOR}.counter`, '{not json');
    expect(readDraft('counter', ACTOR)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  /** A value with no stamp cannot be aged, so it is not trusted. */
  it('rejects a record with no savedAt', () => {
    sessionStorage.setItem(`playerone.console.draft.${ACTOR}.counter`, JSON.stringify({ value: { card: 'x' } }));
    expect(readDraft('counter', ACTOR)).toBeNull();
    expect(draftSavedAt('counter', ACTOR)).toBeNull();
  });
});

describe('clearing', () => {
  it('clears one form without touching another', () => {
    writeDraft('counter', ACTOR, { card: 'a' });
    writeDraft('task-assign', ACTOR, { name: 'b' });
    clearDraft('counter', ACTOR);
    expect(readDraft('counter', ACTOR)).toBeNull();
    expect(readDraft('task-assign', ACTOR)).not.toBeNull();
  });

  /**
   * Sign-out. Every draft in the tab, every operator, every form — and nothing
   * that is not a draft, because the theme and the avatar are preferences an
   * operator keeps.
   */
  it('clears every draft on sign-out and leaves preferences alone', () => {
    writeDraft('counter', 'op-1', { card: 'a' });
    writeDraft('task-assign', 'op-2', { name: 'b' });
    sessionStorage.setItem('playerone.theme', 'dark');
    clearAllDrafts();
    expect(readDraft('counter', 'op-1')).toBeNull();
    expect(readDraft('task-assign', 'op-2')).toBeNull();
    expect(sessionStorage.getItem('playerone.theme')).toBe('dark');
  });
});

/**
 * The hook's own contract, exercised without a DOM tree.
 *
 * `useDraft` is a hook, so it needs a render to run. The three properties worth
 * pinning are the ones the screens depend on: an unknown actor touches nothing,
 * a held draft reaches `onRestore` exactly once, and `discard` empties the key.
 * The screens' own behaviour — the fields coming back, the id surviving — is
 * tested against the real components in `routes/counter-draft.test.tsx`.
 */
describe('useDraft', () => {
  it('waits for identity, restores under StrictMode, and keeps completed work cleared', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    const root = createRoot(host);
    function Form({ actor, complete = false }: { actor?: string; complete?: boolean }) {
      const [value, setValue] = useState({ name: '' });
      useDraft('task', actor, value, setValue, !complete);
      return createElement('span', null, value.name);
    }
    const render = async (actor?: string, complete = false) => act(async () => {
      root.render(createElement(StrictMode, null, createElement(Form, { actor, complete })));
    });
    await render();
    expect(sessionStorage.length).toBe(0);
    writeDraft('task', ACTOR, { name: 'Saved task' });
    await render(ACTOR);
    expect(host.textContent).toBe('Saved task');
    expect(readDraft('task', ACTOR)).toEqual({ name: 'Saved task' });
    await render(ACTOR, true);
    expect(readDraft('task', ACTOR)).toBeNull();
    await render(ACTOR, true);
    expect(readDraft('task', ACTOR)).toBeNull();
    await act(async () => root.unmount());
  });
});

it.each([true, false])('sign-out clears drafts when the server succeeds=%s', async (ok) => {
  writeDraft('task', ACTOR, { name: 'Unfinished' });
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    expect(readDraft('task', ACTOR)).toBeNull();
    return new Response(null, { status: ok ? 204 : 500 });
  });
  try {
    if (ok) await signOut();
    else await expect(signOut()).rejects.toThrow();
    expect(readDraft('task', ACTOR)).toBeNull();
  } finally {
    request.mockRestore();
  }
});
