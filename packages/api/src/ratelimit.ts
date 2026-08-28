import { auditLogin } from './audit.ts';
import type { Db } from '@playerone/store';

/**
 * SEC-03. Rate limiting on the four sign-in routes, and nowhere else.
 *
 * Measured before this existed, on a freshly migrated database with one
 * operator: sixty concurrent wrong passwords against `POST /auth/operator` all
 * answered 401 in 1,239 ms — 48 guesses a second — the next wrong attempt was
 * not locked, the correct password immediately after answered 200, and
 * `audit_events` grew by ONE row across sixty-two sign-in calls. That one row
 * was the success. The other three sign-in routes took thirty wrong attempts
 * each without refusing one. Two things follow: a short operator secret is
 * guessable over a weekend, and nothing in the trail would say it had happened.
 *
 * There is a second cost. `verifyCredential` is scrypt and runs on the libuv
 * thread pool, which is four threads by default and is the same pool `media.ts`
 * reads review footage from. Measured on this machine: a 64 KiB read costs p50
 * 0.3 ms and at worst 2.6 ms with the pool idle; under two hundred concurrent
 * verifies the same read costs p50 3.5 ms, p99 69.8 ms and at worst 3,429 ms.
 * So an attacker hammering sign-in does not only guess passwords, they also
 * stall the reviewer this service exists to keep busy. The check below runs
 * *before* the verify for that reason: a refused attempt costs a Map lookup,
 * not a hash.
 *
 * ## Not `@fastify/rate-limit`
 *
 * It is not a dependency of this workspace today, and it would not carry this
 * limit if it were. Its hook keys off the request, and the credential this has
 * to count is in the *body* — an `onRequest` hook runs before the body is
 * parsed, so the credential axis below cannot exist there. It also has no way
 * to clear a counter when a password turns out to be right. Adding a dependency
 * and then hand-rolling both halves anyway is worse than the ninety lines here.
 *
 * ## Two counters, not one
 *
 * Every attempt is counted twice: once against the source address and once
 * against each credential reference it names. Either alone is wrong here.
 *
 *   - By address alone, one shared upload-centre NAT locks out the whole
 *     centre — and the pilot's counter PCs sit behind exactly that.
 *   - By credential alone, an attacker sprays one guess at each of five hundred
 *     collectors' operator references and is never counted.
 *
 * ## The numbers, and why these
 *
 * Ten failures per personal credential, thirty per shared one, in a five-minute
 * window. They come from the deployment, not from a table of defaults: a handful
 * of counter PCs on a LAN, staff typing passwords they know, and about twenty
 * devices. A person who has forgotten a password types it wrong three or four
 * times, not ten; thirty wrong sign-ins in five minutes from one machine is not
 * a shift, it is a script.
 *
 * A machine identifier is shared, not personal, and it is on the thirty. That
 * was measured the wrong way round first: with the machine identifier on the
 * ten, ten different staff each mistyping their own password once at one counter
 * PC — every one of them naming the correct machine secret — locked the whole
 * counter out of `POST /api/session`, and the eleventh person answered 429 with
 * fully correct credentials. The address and the machine identifier name the
 * same thing on a LAN, a counter PC, so they carry the same budget.
 *
 * ## Getting back in, and what this cannot do
 *
 * The window expires by itself. An operator who exhausts their ten waits at
 * most five minutes and needs no administrator, no second account and no
 * restart — which is the whole reason the window is short and the count is not a
 * lockout. The refusal carries `retry_after` in seconds and a `retry-after`
 * header, so the screen can say how long. A correct password clears that
 * credential's own counter, so a shift of near misses does not accumulate; it
 * does not clear the address counter, because a correct password proves who is
 * typing and says nothing about where from.
 *
 * That covers the operator who mistypes. It does NOT cover an attacker who
 * keeps going: the fixed window bounds one lock, not a campaign of them.
 * Simulated over two hours of limiter clock, an attacker who fires ten guesses
 * at `op-HCM` whenever the limiter lets them held that reference refused for
 * 7,200 seconds out of 7,200, and the real operator — at a different address,
 * with the correct password — could not sign in for one of them. Every
 * credential-keyed limit anywhere has this shape, because the check has to
 * happen before the password is looked at or it is not a defence against a
 * burst. Nothing here softens it, deliberately: letting a caller past the
 * credential counter because their own address looks clean is exactly the
 * distributed attack the credential counter exists to catch.
 *
 * So the recovery path from a sustained attack is not a wait, it is stopping the
 * source. That is now possible: every refused attempt leaves an audit row naming
 * the address it came from, which is the whole reason the audit half of this
 * change exists. Moving to another counter PC does not help, because it is the
 * reference that is held down and not the machine. If somebody has to be let in
 * before the source is cut off, the service is restarted: the counters are in
 * memory and nothing survives it.
 *
 * ## Which routes, and which not
 *
 * Limited: `POST /auth/machine`, `POST /auth/operator`, `POST /api/session`,
 * `POST /review/login`. Those four take a credential from an unauthenticated
 * caller and burn a scrypt verify on it.
 *
 * Not limited, deliberately:
 *
 *   - `DELETE /api/session`, `POST /review/logout`, `GET /review/login`,
 *     `GET /review`, `GET /review/assets/:file` — the rest of what is
 *     unauthenticated. None of them takes a credential or reaches the database,
 *     and the asset names are a whitelist of two extensions.
 *   - Everything behind `requireActor`. It is authenticated traffic from a
 *     handful of counter PCs on a LAN; a limit there would mostly get in the way
 *     of an operator working a queue, and a caller who holds both tokens is
 *     already named in the audit trail and can be stopped by hand.
 *   - `GET /media/episode/:id/part/:index`. A player issues many range requests
 *     for one file, so a per-route limit would be a stall in the review lane —
 *     the thing this file exists to protect.
 *   - `POST /api/payout/batches/:period/run`. Already serialised: it takes a
 *     transaction-scoped advisory lock and a second caller gets 409
 *     `payout_batch_running`. A rate limit would be a second, weaker control
 *     over the same thing.
 *   - `GET /api/settle/export.csv`, `GET /api/payout/batches/:period` and
 *     `GET /api/payout/export/:period` are expensive and take a period window
 *     with no cap on its length, which is a real finding — but the fix there is
 *     a bounded window, not a limit that lets the expensive query run six times
 *     first.
 *
 * ## The address is the socket, not a header
 *
 * Fastify is built with `trustProxy` off, so `req.ip` is the peer on the other
 * end of the connection and cannot be set by the caller. That is right for the
 * pilot, where clients reach this process directly on the centre LAN. Put a
 * reverse proxy in front without turning `trustProxy` on and every request
 * arrives from the proxy: the source counter then measures one address for the
 * whole site and thirty failures anywhere lock out everybody. The credential
 * counter still works, which is the reason there are two.
 *
 * What changes that: the collector app. `APP-*` puts routes on the public
 * internet with five hundred phones behind carrier NAT, and then the address
 * counter is measuring a whole province. When that lands, the source axis has to
 * become the device or the collector, and the read routes above need their
 * window capped. This file is where that decision goes.
 *
 * The first two of those routes have landed: `POST /auth/collector/request-code`
 * and `POST /auth/collector/verify`. Their personal axis is the phone number, on
 * the ten, which is the axis that matters — it is the one an attacker guessing
 * codes is held down by, and it works the same wherever they call from. The
 * address axis is unchanged and still on the thirty, which is right for a pilot
 * of about twenty phones and wrong at five hundred behind one carrier: thirty
 * wrong codes anywhere on that carrier would refuse everybody else on it for up
 * to five minutes.
 *
 * ponytail: left as it is, because the pilot cannot reach it and every softening
 * of the address axis is a hole in the distributed case. The upgrade when the
 * fleet grows is to key the source axis for the collector routes on the app
 * installation rather than the socket, which needs a device identifier the app
 * does not send yet.
 */

/** How long a counter lives once it is opened. */
const WINDOW_MS = 5 * 60_000;
/** Failed sign-ins one person's own reference may accumulate inside a window. */
const PER_CREDENTIAL = 10;
/**
 * Failed sign-ins anything a whole counter shares may accumulate inside a
 * window: the source address, and the machine identifier every operator at that
 * counter types. One number and not two, because on a LAN they name the same
 * counter PC and a budget that fits one fits the other.
 */
const PER_SHARED = 30;
/**
 * How long a reference may be before it is truncated for the key and the audit
 * row. Every real one is far shorter; the value is whatever the caller posted.
 */
const REF_MAX = 200;
/**
 * When the map is bigger than this, expired entries are swept on the next
 * failure.
 *
 * ponytail: a sweep rather than a timer, because the map only grows on a failed
 * sign-in and the source counter already caps that at thirty per address per
 * window — reaching ten thousand live keys needs about three hundred distinct
 * addresses, which the pilot LAN does not have. If the collector app puts this
 * on the public internet, swap the Map for a bounded LRU.
 */
const MAX_KEYS = 10_000;

/** The refusal name a rate-limited sign-in carries. `bo.refused.<name>` in i18n.ts. */
export const SIGN_IN_RATE_LIMITED = 'sign_in_rate_limited';

/**
 * The body all three JSON sign-in routes answer a limit with.
 *
 * `constraint` is what the back-office console reads off a refusal and
 * `reason` is what the sign-in screen reads; both carry the same name, so
 * neither client needs a special case for the one refusal that is not a 409.
 */
export const rateLimited = (retryAfter: number) => ({
  error: 'refused',
  constraint: SIGN_IN_RATE_LIMITED,
  reason: SIGN_IN_RATE_LIMITED,
  retry_after: retryAfter,
});

type Counter = { failures: number; expiresAt: number; refused: boolean };

/**
 * One credential a sign-in named, and whether it belongs to a person or to the
 * counter they are standing at. The kind picks the budget, and it picks the
 * table the audit row is filed against.
 */
export type SignInRef = { id: string; kind: 'operator' | 'machine' | 'collector' };

/**
 * The key prefix each kind counts under. They are separate namespaces on
 * purpose: a phone number and an operator reference are different strings in
 * different tables, and one budget shared between them would let an attack on
 * either lock out the other.
 */
const PREFIX: Record<SignInRef['kind'], string> = {
  operator: 'ref',
  machine: 'mach',
  collector: 'tel',
};

/**
 * Whether a key names something a whole counter shares rather than one person.
 * Shared keys carry the bigger budget and a correct password does not clear
 * them — see `succeeded`.
 */
const isShared = (key: string): boolean => key.startsWith('ip:') || key.startsWith('mach:');

export type SignInLimiter = {
  /**
   * Seconds the caller must wait, or `null` when the attempt may proceed.
   * Call it before verifying anything.
   */
  refusedFor(source: string, refs: readonly SignInRef[]): number | null;
  /**
   * Count one attempt. Called *before* the credential is checked, not after it
   * turns out to be wrong.
   *
   * That ordering is the whole defence against the shape actually measured,
   * which was sixty *concurrent* wrong passwords. Counting a failure only after
   * its scrypt returns means every request in a burst reads a counter that no
   * other request has written yet, and all sixty are verified before any of
   * them is refused — a limit that stops a slow guesser and not a fast one.
   * Counting on the way in caps the burst at the limit itself.
   */
  attempted(source: string, refs: readonly SignInRef[]): void;
  /**
   * Give back an attempt that turned out to be right: the credential's counter
   * is cleared, and the address gets its one attempt back rather than keeping
   * a count that a successful sign-in raised.
   */
  succeeded(source: string, refs: readonly SignInRef[]): void;
  /**
   * Record that this attempt was refused, and say whether it is the first
   * refusal of the windows that refused it.
   *
   * It exists so the trail records the event and not every repeat of it.
   * Measured with a row per repeat: three hundred requests that were refused
   * without a password being checked at all wrote three hundred permanent rows
   * in 783 ms, about 380 a second, into a table an append-only trigger will not
   * let anybody prune. One row per window says the same thing — this reference
   * was under a limit, from here, then — and cannot be used to fill a disk.
   */
  noteRefusal(source: string, refs: readonly SignInRef[]): boolean;
};

/**
 * One limiter per service instance, held in memory.
 *
 * In memory and not in Postgres on purpose: the counter must work with the link
 * down — that property is why the counter workflow exists at all — and a
 * sign-in that needs a database round trip to decide whether it may check a
 * password has made the database a dependency of being refused. One process per
 * upload centre is also the deployment, so a shared store would be a second
 * moving part for a count that is already local.
 *
 * `now` is a parameter so the window can be tested without waiting five
 * minutes. It is not configuration; nothing outside a test passes it.
 */
export function signInLimiter(now: () => number = Date.now): SignInLimiter {
  const counters = new Map<string, Counter>();

  /**
   * The keys one attempt touches: its address, and each distinct non-empty
   * reference it named. A blank field is not a reference — the routes answer
   * `''` for a field that is not there, and counting that would put every
   * malformed request into one bucket.
   */
  const keysOf = (source: string, refs: readonly SignInRef[]): string[] => [
    `ip:${source}`,
    ...new Set(
      refs
        .filter((r) => r.id !== '')
        .map((r) => `${PREFIX[r.kind]}:${r.id.slice(0, REF_MAX)}`),
    ),
  ];

  const limitOf = (key: string): number => (isShared(key) ? PER_SHARED : PER_CREDENTIAL);

  /** The counter for `key`, or nothing when it never existed or has expired. */
  const live = (key: string): Counter | undefined => {
    const counter = counters.get(key);
    if (counter === undefined) return undefined;
    if (counter.expiresAt <= now()) {
      counters.delete(key);
      return undefined;
    }
    return counter;
  };

  return {
    refusedFor(source, refs) {
      let waitMs = 0;
      for (const key of keysOf(source, refs)) {
        const counter = live(key);
        // The longest of the counters that are full, so the number the caller
        // is told is the one that actually lets them back in.
        if (counter !== undefined && counter.failures >= limitOf(key)) {
          waitMs = Math.max(waitMs, counter.expiresAt - now());
        }
      }
      return waitMs === 0 ? null : Math.ceil(waitMs / 1000);
    },

    attempted(source, refs) {
      if (counters.size > MAX_KEYS) {
        const t = now();
        for (const [key, counter] of counters) if (counter.expiresAt <= t) counters.delete(key);
      }
      for (const key of keysOf(source, refs)) {
        const counter = live(key);
        // A fixed window: the first attempt opens it and later ones do not
        // extend it, so one lock lasts five minutes and not longer. It does not
        // bound a campaign — see "what this cannot do" at the top of the file.
        if (counter === undefined)
          counters.set(key, { failures: 1, expiresAt: now() + WINDOW_MS, refused: false });
        else counter.failures += 1;
      }
    },

    noteRefusal(source, refs) {
      let first = false;
      for (const key of keysOf(source, refs)) {
        const counter = live(key);
        if (counter === undefined || counter.failures < limitOf(key)) continue;
        if (!counter.refused) {
          counter.refused = true;
          first = true;
        }
      }
      return first;
    },

    succeeded(source, refs) {
      for (const key of keysOf(source, refs)) {
        // The person's own credential is cleared outright, so a shift of near
        // misses does not accumulate. Anything shared — the address, the
        // machine identifier — only gives back this one attempt: a correct
        // password proves who is typing and says nothing about where from, and
        // clearing a shared counter would let one valid account wipe the count
        // for every guess sprayed from the same counter PC.
        if (!isShared(key)) counters.delete(key);
        else {
          const counter = live(key);
          if (counter === undefined) continue;
          counter.failures -= 1;
          if (counter.failures <= 0) counters.delete(key);
        }
      }
    },
  };
}

/**
 * One sign-in attempt: what it is allowed to do, and the audit row it leaves.
 *
 * The audit half is the point. Before this, a wrong password left nothing at
 * all — the trail could not say whether the sixty guesses above had happened,
 * which makes the limit above unverifiable after the fact. Each attempt now
 * writes one row, whichever way it is refused, and `audit_events_attributed_check`
 * exempts `%.login_failed` the way it already exempts `%.login`: a failed
 * sign-in has no operator to attribute to, and may not even name one that
 * exists.
 *
 * What the row records is the reference typed, the address it came from and
 * which refusal it got. **Never the secret, and never any part of it.** The
 * reference is a `target_id`, which is `text` and carries no foreign key, so an
 * attempt on an operator who does not exist still records what was tried.
 *
 * `refs` is every reference the attempt named. The row is filed under the first
 * one that is not blank — the operator reference where there is one, because
 * that is the person a shift supervisor asks about, and the machine identifier
 * where the caller named nothing else. Filing under `refs[0]` regardless was
 * measured writing `target_id = ''` against `operators` for a sign-in that had
 * named only a machine: a row saying an attack happened and not what it was on.
 */
export function signInAttempt(
  db: Db,
  limiter: SignInLimiter,
  source: string,
  action: `${string}.login_failed`,
  refs: readonly SignInRef[],
) {
  // The credential the row is about, and with it the table it is filed against
  // and the actor `auditLogin` derives: a machine sign-in goes to the fleet,
  // everything else to a person.
  const attacked = refs.find((ref) => ref.id !== '');
  const machine = attacked?.kind === 'machine';
  const filed = machine ? 'machine.login_failed' : action;
  const table =
    attacked?.kind === 'machine'
      ? 'upload_devices'
      : attacked?.kind === 'collector'
        ? 'collectors'
        : 'operators';
  const target = (attacked?.id ?? '').slice(0, REF_MAX);

  return {
    /**
     * Seconds to wait, or `null` to go ahead. Counts the attempt it lets
     * through, and audits the one it refuses.
     *
     * Both halves happen here so that no route can check the limit and then
     * forget to count against it — the counting is not a second call the next
     * sign-in route to be written has to remember.
     */
    async blocked(): Promise<number | null> {
      const wait = limiter.refusedFor(source, refs);
      if (wait !== null) {
        // Once per window, not once per repeat. A refused repeat costs the
        // attacker nothing, so a row for each of them is a way to grow an
        // append-only table without a password ever being checked.
        if (limiter.noteRefusal(source, refs)) {
          await auditLogin(db, filed, table, target, { source, outcome: 'rate_limited' });
        }
        return wait;
      }
      limiter.attempted(source, refs);
      return null;
    },
    /** The credential was wrong. It is counted already; this records it. */
    async wrong(): Promise<void> {
      await auditLogin(db, filed, table, target, { source, outcome: 'credentials' });
    },
    /** The credential was right. Gives the attempt back; the success is audited already. */
    ok(): void {
      limiter.succeeded(source, refs);
    },
  };
}
