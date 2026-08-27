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
 * Ten failures per credential and thirty per address, in a five-minute window.
 * They come from the deployment, not from a table of defaults: a handful of
 * counter PCs on a LAN, staff typing passwords they know, and about twenty
 * devices. A person who has forgotten a password types it wrong three or four
 * times, not ten; thirty wrong sign-ins in five minutes from one machine is not
 * a shift, it is a script. Against a guesser the two together cap one account at
 * two guesses a minute and one machine at six, against the 48 a second measured
 * above.
 *
 * ## Getting back in
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
 */

/** How long a counter lives once it is opened. */
const WINDOW_MS = 5 * 60_000;
/** Failed sign-ins one credential reference may accumulate inside a window. */
const PER_CREDENTIAL = 10;
/** Failed sign-ins one source address may accumulate inside a window. */
const PER_SOURCE = 30;
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

type Counter = { failures: number; expiresAt: number };

export type SignInLimiter = {
  /**
   * Seconds the caller must wait, or `null` when the attempt may proceed.
   * Call it before verifying anything.
   */
  refusedFor(source: string, refs: readonly string[]): number | null;
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
  attempted(source: string, refs: readonly string[]): void;
  /**
   * Give back an attempt that turned out to be right: the credential's counter
   * is cleared, and the address gets its one attempt back rather than keeping
   * a count that a successful sign-in raised.
   */
  succeeded(source: string, refs: readonly string[]): void;
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
  const keysOf = (source: string, refs: readonly string[]): string[] => [
    `ip:${source}`,
    ...new Set(refs.filter((r) => r !== '').map((r) => `ref:${r.slice(0, REF_MAX)}`)),
  ];

  const limitOf = (key: string): number => (key.startsWith('ip:') ? PER_SOURCE : PER_CREDENTIAL);

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
        // extend it, so a guesser cannot hold a legitimate operator out for
        // longer than five minutes by keeping up the attempts.
        if (counter === undefined) counters.set(key, { failures: 1, expiresAt: now() + WINDOW_MS });
        else counter.failures += 1;
      }
    },

    succeeded(source, refs) {
      for (const key of keysOf(source, refs)) {
        // The credential is cleared outright, so a shift of near misses does
        // not accumulate. The address only gives back this one attempt: a
        // correct password proves who is typing and says nothing about where
        // from, and clearing the address would let one valid account wipe the
        // count for every guess sprayed from the same machine.
        if (!key.startsWith('ip:')) counters.delete(key);
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
 * `refs` is every reference the attempt named, and its first entry is the one
 * the row is filed under: the operator reference where there is one, because
 * that is the person a shift supervisor asks about.
 */
export function signInAttempt(
  db: Db,
  limiter: SignInLimiter,
  source: string,
  action: `${string}.login_failed`,
  refs: readonly string[],
) {
  // From the action, the way `auditLogin` derives the actor role: a machine
  // sign-in is filed against the fleet, everything else against a person.
  const table = action.startsWith('machine.') ? 'upload_devices' : 'operators';
  const target = (refs[0] ?? '').slice(0, REF_MAX);

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
        await auditLogin(db, action, table, target, { source, outcome: 'rate_limited' });
        return wait;
      }
      limiter.attempted(source, refs);
      return null;
    },
    /** The credential was wrong. It is counted already; this records it. */
    async wrong(): Promise<void> {
      await auditLogin(db, action, table, target, { source, outcome: 'credentials' });
    },
    /** The credential was right. Gives the attempt back; the success is audited already. */
    ok(): void {
      limiter.succeeded(source, refs);
    },
  };
}
