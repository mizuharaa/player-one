import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import type { ZaloPayClient } from './client-contract.ts';
import type { RiskReader } from './risk.ts';

/**
 * How the payout rail is switched on, and the two invariants that stop it
 * being switched on wrong (payout brief, §2.4).
 *
 * `PLAYERONE_PAYOUT_MODE` defaults to `manual`, and that default is the pilot:
 * the API integration is built, tested and reviewable without a single dong
 * moving, in the same shape as `PLAYERONE_REVIEWER_MEDIA` — a kill switch that
 * is off until somebody makes a deliberate decision to flip it (Part 4, G7).
 */

export type PayoutMode = 'manual' | 'api';
export type ZaloPayEnv = 'sandbox' | 'production';

/** What production needs before it may be named. Names only; values are never held here. */
export const PRODUCTION_CREDENTIALS = ['appId', 'paymentId', 'key1', 'publicKey'] as const;
export type CredentialName = (typeof PRODUCTION_CREDENTIALS)[number];

export type PayoutOptions = {
  /** Default `manual`. */
  mode?: PayoutMode;
  /** Default `sandbox`. */
  zaloPayEnv?: ZaloPayEnv;
  /**
   * Which of the production credentials are present — presence only, so that
   * this module can refuse a half-configured production without ever holding
   * `key1`. The client (Agent A) holds the values.
   */
  credentialsPresent?: Partial<Record<CredentialName, boolean>>;
  /**
   * The ZaloPay client. Absent means no credentials: verification stores
   * `unverified`, preflight reports no balance, and `mode: 'api'` refuses to
   * pay — a rail with no client is not a rail.
   */
  client?: ZaloPayClient;
  /** Agent C's read-only seam. Absent means every bill reads `clear`. */
  risk?: RiskReader;
  /** `PLAYERONE_RISK_HOLD`. Default off: holds stay advisory until tuned. */
  holdsEnabled?: boolean;
  /**
   * Per-collector-per-period cap in whole VND. The VALUE is an escalation
   * (Agent B brief, ESCALATE); undefined means no cap is applied and the
   * preflight says so. When set, a bill above it is refused by name and a
   * ticket is raised — it never silently pays the cap.
   */
  capVnd?: number;
  /**
   * SET-07's cycle in days, for `/batches/:period` with no explicit end.
   * `[ASSUMED]` weekly, like `settle.ts`; confirm before it hardens.
   */
  cycleDays?: number;
  /** Injectable clock. */
  now?: () => Date;
};

/** The options the environment describes, in the shape `serve.ts` would pass. */
export function payoutOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Pick<PayoutOptions, 'mode' | 'zaloPayEnv' | 'credentialsPresent' | 'holdsEnabled' | 'capVnd'> {
  const mode = env['PLAYERONE_PAYOUT_MODE'] ?? 'manual';
  if (mode !== 'manual' && mode !== 'api') {
    throw new Error(`PLAYERONE_PAYOUT_MODE must be 'manual' or 'api', not '${mode}'`);
  }
  const zaloPayEnv = env['PLAYERONE_ZALOPAY_ENV'] ?? 'sandbox';
  if (zaloPayEnv !== 'sandbox' && zaloPayEnv !== 'production') {
    throw new Error(`PLAYERONE_ZALOPAY_ENV must be 'sandbox' or 'production', not '${zaloPayEnv}'`);
  }
  const cap = env['PLAYERONE_PAYOUT_CAP_VND'];
  if (cap !== undefined && !/^\d+$/.test(cap)) {
    throw new Error(`PLAYERONE_PAYOUT_CAP_VND must be a whole number of dong, not '${cap}'`);
  }
  return {
    mode,
    zaloPayEnv,
    credentialsPresent: {
      appId: Boolean(env['PLAYERONE_ZALOPAY_APP_ID']),
      paymentId: Boolean(env['PLAYERONE_ZALOPAY_PAYMENT_ID']),
      key1: Boolean(env['PLAYERONE_ZALOPAY_KEY1']),
      publicKey: Boolean(env['PLAYERONE_ZALOPAY_PUBLIC_KEY']),
    },
    holdsEnabled: env['PLAYERONE_RISK_HOLD'] === '1',
    capVnd: cap === undefined ? undefined : Number(cap),
  };
}

/**
 * Whether one outcome is a simulation.
 *
 * Not the same question as "which provider environment is this", which is what
 * `/api/payout/environment` and the engineering status print and what the
 * console header shows. That word stays as it is. This one is about a single
 * verification or payment.
 *
 * `PLAYERONE_PAYOUT_MODE=manual` is the pilot's default rail, and on it a
 * finance operator types the reference of a transfer they really made. Deriving
 * the label from `PLAYERONE_ZALOPAY_ENV` alone printed "Simulation. No live
 * transfer." over exactly those payments — false, and false in the direction
 * that matters, because both example env files set `sandbox` and production
 * refuses to boot without four ZaloPay credentials nobody has. So a manual
 * attempt carrying a reference is never a simulation. Anything the provider
 * produced — an API-rail transfer, or a verification — is a simulation when the
 * provider is the sandbox.
 *
 * ponytail: one predicate, and the outcome is its only new input. A surface
 * that describes no single outcome (a period list, an income summary) passes
 * `null` and keeps saying what the environment is.
 */
export function isSimulation(
  sandbox: boolean,
  outcome: { mode: string | null; reference: string | null } | null,
): boolean {
  if (outcome !== null && outcome.mode === 'manual' && (outcome.reference ?? '').trim() !== '') return false;
  return sandbox;
}

/**
 * The two invariants that throw at boot, in the style of `buildApi`'s
 * `reviewerMediaEnabled` check: a service invariant, not an entrypoint check,
 * so an embedded caller cannot assemble the unsafe combination either.
 *
 * The messages name the environment variables although this is a library,
 * because the only thing anybody will do with the error is set them.
 */
export function assertPayoutBootInvariants(options: PayoutOptions): void {
  const mode = options.mode ?? 'manual';
  const env = options.zaloPayEnv ?? 'sandbox';

  // Never let sandbox credentials sit behind a live payout path.
  if (mode === 'api' && env === 'sandbox') {
    throw new Error(
      'PLAYERONE_PAYOUT_MODE=api with PLAYERONE_ZALOPAY_ENV=sandbox: a live payout path ' +
        'must not run on sandbox credentials. Set PLAYERONE_ZALOPAY_ENV=production, or keep ' +
        'PLAYERONE_PAYOUT_MODE=manual.',
    );
  }

  if (env === 'production') {
    const present = options.credentialsPresent ?? {};
    const missing = PRODUCTION_CREDENTIALS.filter((name) => present[name] !== true);
    if (missing.length > 0) {
      throw new Error(
        `PLAYERONE_ZALOPAY_ENV=production without ${missing.join(', ')}: production needs ` +
          'all of app_id, payment_id, key1 and the ZaloPay RSA public key ' +
          '(PLAYERONE_ZALOPAY_APP_ID, PLAYERONE_ZALOPAY_PAYMENT_ID, PLAYERONE_ZALOPAY_KEY1, PLAYERONE_ZALOPAY_PUBLIC_KEY).',
      );
    }
  }

  if (options.capVnd !== undefined && (!Number.isInteger(options.capVnd) || options.capVnd <= 0)) {
    throw new Error(`the per-collector cap must be a positive whole number of dong, not ${options.capVnd}`);
  }
}

/** Immutable outcome evidence survives a later switch of provider credentials. */
export async function storedSimulation(
  db: Pick<Db, 'execute'>,
  table: 'payout_accounts' | 'payout_attempts',
  id: string,
  payment?: { mode: string; reference: string | null },
): Promise<boolean> {
  if (payment?.mode === 'manual' && payment.reference?.trim()) return false;
  const [evidence] = await db.execute<{ environment: string | null }>(sql`
    select "after"->>'provider_environment' as environment from audit_events
    where target_table = ${table} and target_id = ${id}
      and action = ${table === 'payout_accounts' ? 'payout_account.declare' : 'payout_attempt.create'}
    order by occurred_at, id limit 1
  `);
  // Legacy outcomes without evidence are never promoted to live payment proof.
  return evidence?.environment !== 'production';
}
