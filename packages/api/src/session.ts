import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { clearCookie, MACHINE_COOKIE, OPERATOR_COOKIE, sessionCookie } from './cookies.ts';
import { rateLimited, signInAttempt, type SignInLimiter } from './ratelimit.ts';
import {
  signToken,
  verifyCredential,
  type MachineClaims,
  type OperatorClaims,
  type ReviewerClaims,
} from './credentials.ts';

/**
 * Checking the two credentials, in one place.
 *
 * Both the machine-client auth routes and the browser console's sign-in form
 * need exactly this, and an authentication path that exists twice is one that
 * can be fixed once. The console does not get its own rules: same lookup, same
 * failure handling, same audit row.
 */

/**
 * One message for "no such machine", "wrong secret" and "retired machine".
 *
 * An unauthenticated caller learns nothing about the fleet from a failure —
 * not which identifiers exist, and not which of them have been retired.
 */
export async function authenticateMachine(
  db: Db,
  machineIdentifier: string,
  secret: string,
): Promise<MachineClaims | null> {
  const [device] = await db
    .select()
    .from(schema.uploadDevices)
    .where(eq(schema.uploadDevices.machineIdentifier, machineIdentifier));

  if (
    device === undefined ||
    device.status !== 'active' ||
    !(await verifyCredential(secret, device.credentialHash))
  ) {
    return null;
  }

  await auditLogin(db, 'machine.login', 'upload_devices', device.id, {
    uploadDeviceId: device.id,
    uploadCentreId: device.uploadCentreId,
  });
  return { kind: 'machine', uploadDeviceId: device.id, uploadCentreId: device.uploadCentreId };
}

/**
 * Reviewer rows are excluded, and that is the whole of it: `operators` now holds
 * both kinds, and without the filter a reviewer credential presented here would
 * mint an *operator* token — a token whose whole job is to say which upload
 * centre its holder may write to, held by somebody who belongs to none. It
 * would fail verification a moment later on the null centre, which is a fail
 * closed, but failing closed by accident three functions away is not a rule.
 */
export async function authenticateOperator(
  db: Db,
  externalRef: string,
  secret: string,
): Promise<OperatorClaims | null> {
  const [operator] = await db
    .select()
    .from(schema.operators)
    .where(
      and(eq(schema.operators.externalRef, externalRef), ne(schema.operators.role, 'reviewer')),
    );

  if (
    operator === undefined ||
    operator.uploadCentreId === null ||
    !(await verifyCredential(secret, operator.credentialHash))
  ) {
    return null;
  }

  await auditLogin(db, 'operator.login', 'operators', operator.id, {
    operatorId: operator.id,
    uploadCentreId: operator.uploadCentreId,
  });
  return { kind: 'operator', operatorId: operator.id, uploadCentreId: operator.uploadCentreId };
}

/**
 * PLT-10. One credential, no machine and no centre.
 *
 * The second credential exists because PRD §8.3.2 rule 1 wants an operator
 * logged in to a *fixed upload device* before importing data. There is no fixed
 * upload device in Shenzhen, so demanding one would either block the reviewer or
 * be satisfied by handing PaXini a machine credential for a VNG counter — which
 * is worse than having none, because from then on the audit trail names a
 * counter that nobody was standing at.
 *
 * `operators_reviewer_ref_key` is what makes the lookup by reference alone
 * safe: reviewer references are unique across the table, so there is one row or
 * none, never a first row.
 */
export async function authenticateReviewer(
  db: Db,
  externalRef: string,
  secret: string,
): Promise<ReviewerClaims | null> {
  const [reviewer] = await db
    .select()
    .from(schema.operators)
    .where(
      and(eq(schema.operators.externalRef, externalRef), eq(schema.operators.role, 'reviewer')),
    );

  if (reviewer === undefined || !(await verifyCredential(secret, reviewer.credentialHash))) {
    return null;
  }

  await auditLogin(db, 'reviewer.login', 'operators', reviewer.id, { operatorId: reviewer.id });
  return { kind: 'reviewer', reviewerId: reviewer.id };
}

/**
 * Sign-in and sign-out for a client that speaks JSON.
 *
 * The existing `/review/login` is a form POST that answers with HTML on failure
 * and a 303 on success. That is the right shape for a server-rendered page and
 * the wrong one for a SPA, which needs to know *why* a sign-in failed without
 * parsing a document to find out. These routes are the same authentication —
 * same lookups, same centre check, same audit rows, same cookies — with a
 * different envelope, exactly as `cookies.ts` is the same tokens with a
 * different transport.
 *
 * `POST /api/session` and `DELETE /api/session`, deliberately not under
 * `/review/`: the session belongs to the whole back office and the review lane
 * is one of the things it opens.
 */
export function registerSessionRoutes(
  app: FastifyInstance,
  db: Db,
  options: { tokenSecret: string; secureCookies: boolean; limiter: SignInLimiter },
): void {
  app.post('/api/session', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');

    /**
     * The reviewer path is tried first and returns on its own.
     *
     * PLT-10 scopes a reviewer to review, so the session it gets carries no
     * machine token — and the stale one a shared workstation may still hold is
     * cleared rather than left to combine with a reviewer token into something
     * neither credential earned.
     *
     * A reviewer whose secret is wrong falls through to the counter path and is
     * refused there, with the same opaque `credentials` answer as everybody
     * else: the form does not confirm which references exist.
     *
     * `role` is the form's own choice and it is honoured where it *narrows*,
     * never where it would widen. Reviewer references are globally unique
     * (`operators_reviewer_ref_key`) but a counter operator at some centre may
     * still share one, and somebody who picked "Upload centre" should not be
     * handed a reviewer session — with their machine cookie cleared — because
     * the reference collided. An absent `role` keeps the old behaviour, so a
     * machine client that never sent one is unaffected.
     */
    const wanted = str('role');
    /**
     * A role this service does not know is a refusal, not a shrug. Falling
     * through as if it were absent means a typo, an older client or a probe
     * silently gets whichever path happens to match — the opposite of what an
     * explicit choice is for. `str` answers `''` for a field that is not there,
     * and that stays the "no preference" value: a machine client which never
     * sent a role is entitled to the original behaviour.
     */
    if (wanted !== '' && wanted !== 'operator' && wanted !== 'reviewer') {
      return reply.code(400).send({ error: 'unknown role' });
    }

    /**
     * SEC-03. Both references this form can name are counted, and the row is
     * filed against the one the person typed for themselves. A reviewer chose
     * "Reviewer" explicitly; anybody else is refused as an operator, which is
     * also what the fall-through below does with a reviewer whose secret is
     * wrong.
     */
    const attempt = signInAttempt(
      db,
      options.limiter,
      req.ip,
      wanted === 'reviewer' ? 'reviewer.login_failed' : 'operator.login_failed',
      [
        { id: str('external_ref'), kind: 'operator' },
        { id: str('machine_identifier'), kind: 'machine' },
      ],
    );
    const wait = await attempt.blocked();
    if (wait !== null) {
      return reply.code(429).header('retry-after', String(wait)).send(rateLimited(wait));
    }

    const reviewer =
      wanted === 'operator'
        ? null
        : await authenticateReviewer(db, str('external_ref'), str('operator_secret'));
    if (reviewer !== null) {
      attempt.ok();
      return reply
        .headers({
          'set-cookie': [
            clearCookie(MACHINE_COOKIE),
            sessionCookie(
              OPERATOR_COOKIE,
              signToken(options.tokenSecret, reviewer),
              options.secureCookies,
            ),
          ],
        })
        .send({ role: 'reviewer', reviewer_id: reviewer.reviewerId });
    }

    if (wanted === 'reviewer') {
      await attempt.wrong();
      return reply.code(401).send({ error: 'credentials', reason: 'credentials' });
    }

    const machine = await authenticateMachine(db, str('machine_identifier'), str('machine_secret'));
    const operator = await authenticateOperator(db, str('external_ref'), str('operator_secret'));

    /**
     * One failure for both credentials, and no hint about which one was wrong.
     * `reason` is a stable token the client localises — the server does not
     * pick the language a message is read in.
     */
    if (machine === null || operator === null) {
      await attempt.wrong();
      return reply.code(401).send({ error: 'credentials', reason: 'credentials' });
    }
    /**
     * Both credentials were right, so the counters for them are cleared even
     * though the centre check below may still refuse the session: a
     * misconfigured machine is not a guessing attempt, and counting it would
     * lock out the operator who keeps trying at the counter it is standing on.
     */
    attempt.ok();

    /**
     * The same centre check the header path makes, for the same reason: two
     * valid credentials from different centres is either a misconfigured
     * machine or spliced credentials.
     */
    if (machine.uploadCentreId !== operator.uploadCentreId) {
      return reply.code(403).send({ error: 'mismatch', reason: 'mismatch' });
    }

    return reply
      .headers({
        'set-cookie': [
          sessionCookie(MACHINE_COOKIE, signToken(options.tokenSecret, machine), options.secureCookies),
          sessionCookie(
            OPERATOR_COOKIE,
            signToken(options.tokenSecret, operator),
            options.secureCookies,
          ),
        ],
      })
      .send({
        role: 'operator',
        upload_centre_id: machine.uploadCentreId,
        operator_id: operator.operatorId,
      });
  });

  app.delete('/api/session', async (_req, reply) =>
    reply
      .headers({ 'set-cookie': [clearCookie(MACHINE_COOKIE), clearCookie(OPERATOR_COOKIE)] })
      .send({ signed_out: true }),
  );
}
