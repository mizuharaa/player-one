/**
 * Form drafts, so a half-finished form survives leaving the screen.
 *
 * The reported defect: an operator part-way through New task switched to the
 * Collectors tab, came back, and every field was empty. Switching tabs
 * unmounts the panel, and the panel's answers were local `useState`.
 *
 * Three different things get confused under one name, and this file is only
 * the first of them. **Draft persistence** (this file) is unsaved input
 * surviving an unmount. **URL as state** — the route's search params — is
 * where you were, and it is what makes the tab linkable and the browser Back
 * button work; `backOfficeSearch` in `routes/BackOffice.tsx` does that half.
 * **Query cache persistence** is server data not flashing empty on return,
 * and it is deliberately NOT built: `main.tsx` already sets `staleTime` to
 * 15 s with the default five-minute `gcTime`, so the tables come back from
 * cache. A persister would be a dependency for a problem that is not there.
 *
 * ## `sessionStorage`, not `localStorage`
 *
 * This is the one real choice in the file. `localDeliveryStore` in
 * `debug-delivery/transport.ts` keeps its resume record in `localStorage` on
 * purpose, because a delivery worth resuming is worth surviving a reboot. A
 * half-typed form is not. `sessionStorage` has the same API, dies with the
 * browser tab, and on a shared back-office machine that is the posture we
 * want: the next operator, in a new tab, cannot be shown the last one's
 * typing. Cost, stated plainly: closing the tab loses the draft. One word
 * changes it back if that turns out to be the wrong trade.
 *
 * ## What must never be in here
 *
 * A draft holds **only what the user typed or picked**, and never:
 *
 * - **A credential.** No token, no one-time code, no Wi-Fi password. Same rule
 *   and same reason as the collector token in `transport.ts`: this storage
 *   outlives the screen and is readable by any script on the origin.
 * - **A server-computed number.** Money, effective minutes, a total.
 *   Restoring a stale computed figure and showing it as current is a worse
 *   defect than the empty form this file fixes. These screens already refuse
 *   to format a unit price through `Intl` for the same reason.
 * - **Payment details, or a confirm-by-retyping phrase.** Which is why nothing
 *   in `payout/` or `risk/` uses this file: every form in that lane either
 *   gates money behind a retyped total (`PreflightScreen.tsx:330`,
 *   `BillScreen.tsx:286`) or carries a bank reference. Pre-filling either one
 *   from storage would arm a payment the operator never confirmed.
 *
 * `FORBIDDEN` and `forbiddenField` enforce that last part rather than trusting
 * a comment: a draft carrying one of those names is not written, and
 * `draft.test.ts` fails naming the field. The guard is on the write and not
 * only in the test, because a test can only see the callers that exist today.
 *
 * ## The id in the draft is the point, not an afterthought
 *
 * Every create on these screens is idempotent on an id this client mints, and
 * on nothing else. A remount minted a fresh id, so a resumed submit was a
 * *different action* to the server rather than a retry. Measured against the
 * server, the three cases are not equally bad:
 *
 * - `handovers` and `collection_sessions` have **no natural key at all** —
 *   `handovers_card_idx` and `collection_sessions_*_idx` are plain indexes. So
 *   a fresh id writes a second row: one physical TF card becomes two
 *   handovers, one handover two sessions. Settlement pays on that attribution,
 *   which makes `Counter.tsx` the most dangerous caller in the console.
 * - `payout_accounts` takes the new row and supersedes the old one in the same
 *   transaction (`payout/routes/payout.ts`), so a fresh id silently changes
 *   where a collector's money goes.
 * - `collectors` and `devices` are caught by `collectors_external_ref_key` and
 *   `devices_hardware_serial_key`. A fresh id there is a confusing refusal
 *   rather than a double write — still worth fixing, but that is the severity.
 *
 * So the id travels in the draft and a resumed submit is the same action.
 * Discard is the only thing that mints a new one, because discarding is the
 * operator saying this is a different action.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'playerone.console.draft';

/**
 * A draft older than this is dropped on read.
 *
 * It bounds the id problem above: an id typed a fortnight ago, whose task was
 * since created and edited, would meet a refusal the operator cannot explain.
 * A day is longer than a shift and shorter than a memory.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Field names a draft may not carry, matched case-insensitively anywhere in
 * the key, so `code` catches `smsCode` and `cardno` catches `cardNo`.
 *
 * ponytail: deliberately matched on a substring, which makes `phone`,
 * `account`, `bank`, `code` and `reference` broad enough to refuse a
 * legitimate field one day — a `referenceMinutes` or a `phoneCountry` would be
 * turned away by name alone. That is the intended direction of the error: a
 * draft that silently fails to save costs a retype, and a draft that saves a
 * bank account number or a retyped payment total is the defect this whole
 * guard exists to prevent. If you have hit a false refusal, the fix is to
 * rename the draft field or add one exact-match exception here — not to delete
 * the list. The console log in `writeDraft` names the field so you do not have
 * to guess which one it was.
 */
const FORBIDDEN = [
  'token',
  'password',
  'secret',
  'otp',
  'code',
  'phone',
  'account',
  'bank',
  'card_no',
  'cardno',
  'typed',
  'reference',
] as const;

/** The first forbidden field name in `value`, or null. Recursive, so a nested object counts. */
export function forbiddenField(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (FORBIDDEN.some((name) => lowered.includes(name))) return key;
    const deeper = forbiddenField(held);
    if (deeper !== null) return deeper;
  }
  return null;
}

/**
 * Scoped to the signed-in operator as well as to the tab.
 *
 * `sessionStorage` already stops one operator seeing another's draft, and
 * sign-out clears the lot. This is the third guard and the cheap one: the same
 * shape `OperatorAvatar` uses for its per-operator key.
 */
const keyFor = (form: string, actor: string) => `${PREFIX}.${actor}.${form}`;

type Held<T> = { savedAt: number; value: T };

/** The raw held record, or null. Every failure is "there is no draft". */
function held<T>(form: string, actor: string): Held<T> | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(keyFor(form, actor));
  } catch {
    // Private browsing, or storage denied. Not having a draft is the state
    // this screen was always in, and it renders correctly.
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Held<T>;
    return typeof parsed?.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read a draft, or null. A parse failure or an expired draft clears the key,
 * the way `localDeliveryStore` does — the only thing it costs is retyping a
 * form that was unreadable anyway.
 */
export function readDraft<T>(form: string, actor: string, now: number = Date.now()): T | null {
  const record = held<T>(form, actor);
  if (record === null) {
    clearDraft(form, actor);
    return null;
  }
  if (now - record.savedAt > MAX_AGE_MS) {
    clearDraft(form, actor);
    return null;
  }
  return record.value;
}

/** When the held draft was saved, or null. What the banner reports. */
export function draftSavedAt(form: string, actor: string, now: number = Date.now()): number | null {
  const record = held<unknown>(form, actor);
  if (record === null || now - record.savedAt > MAX_AGE_MS) return null;
  return record.savedAt;
}

/** Write a draft. Refuses a value carrying a forbidden field, and names it. */
export function writeDraft<T>(form: string, actor: string, value: T, now: number = Date.now()): void {
  const forbidden = forbiddenField(value);
  if (forbidden !== null) {
    // Not thrown: a refused draft must not take the form down with it. The
    // test is what makes this loud, and this line is what makes it findable.
    console.error(`draft ${form} not saved: the field ${forbidden} may not be persisted`);
    return;
  }
  try {
    sessionStorage.setItem(keyFor(form, actor), JSON.stringify({ savedAt: now, value } satisfies Held<T>));
  } catch {
    /* Quota, or denied storage. A draft is a convenience; the form still works. */
  }
}

export function clearDraft(form: string, actor: string): void {
  try {
    sessionStorage.removeItem(keyFor(form, actor));
  } catch {
    /* nothing to do about it, and nothing depends on it */
  }
}

/**
 * Every draft in this tab, whoever typed it. Called on sign-out.
 *
 * By prefix rather than from a list of form names: a form added later is
 * covered without anybody remembering to come back here, and forgetting would
 * leave one operator's typing on screen for the next one.
 */
export function clearAllDrafts(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`${PREFIX}.`)) sessionStorage.removeItem(key);
    }
  } catch {
    /* as above */
  }
}

/**
 * Save `value` as it changes, and hand a held draft back to `onRestore` once.
 *
 * `onRestore` rather than a returned value because the caller's answers are
 * its own `useState`s, and the caller is the only thing that knows how to put
 * them back. It fires at most once per mount, and only when there is something
 * to restore.
 *
 * `actor` may be undefined for a render or two — `useOperatorProfile` is a
 * query and has not answered on a cold load. Nothing is read or written until
 * it has: an unscoped key would be the shared-machine leak this file exists to
 * avoid. On the path that actually broke — a tab switch inside a live session
 * — the profile is already cached, so the restore is synchronous.
 *
 * `restoredAt` is the stamp of the draft that was put back, or null. It is what
 * the screen renders its banner from: a form that refills itself silently is
 * its own bug, so a restore has to be visible and has to be refusable.
 */
export function useDraft<T>(
  form: string,
  actor: string | undefined,
  value: T,
  onRestore: (draft: T) => void,
  enabled = true,
): { restoredAt: number | null; discard: () => void } {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  /** So a late-arriving actor cannot restore over answers already being typed. */
  const tried = useRef(false);
  const restoring = useRef<T | undefined>(undefined);
  /** Held in a ref: a new closure every render must not re-run the restore. */
  const restore = useRef(onRestore);
  restore.current = onRestore;

  useEffect(() => {
    if (actor === undefined || tried.current || !enabled) return;
    tried.current = true;
    const savedAt = draftSavedAt(form, actor);
    const draft = readDraft<T>(form, actor);
    if (draft === null || savedAt === null) return;
    restoring.current = value;
    restore.current(draft);
    setRestoredAt(savedAt);
  }, [form, actor, enabled, value]);

  useEffect(() => {
    // Nothing is written before the restore has been attempted, or the empty
    // first render would overwrite the draft it is about to read.
    if (actor === undefined || !tried.current) return;
    if (!enabled) {
      clearDraft(form, actor);
      return;
    }
    if (restoring.current === value) return;
    restoring.current = undefined;
    writeDraft(form, actor, value);
  }, [form, actor, value, enabled]);

  const discard = useCallback(() => {
    if (actor !== undefined) clearDraft(form, actor);
    setRestoredAt(null);
  }, [form, actor]);

  return { restoredAt, discard };
}
