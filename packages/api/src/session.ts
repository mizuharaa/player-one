import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { clearCookie, MACHINE_COOKIE, OPERATOR_COOKIE, sessionCookie } from './cookies.ts';
import { signToken, verifyCredential, type MachineClaims, type OperatorClaims } from './credentials.ts';

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

export async function authenticateOperator(
  db: Db,
  externalRef: string,
  secret: string,
): Promise<OperatorClaims | null> {
  const [operator] = await db
    .select()
    .from(schema.operators)
    .where(eq(schema.operators.externalRef, externalRef));

  if (operator === undefined || !(await verifyCredential(secret, operator.credentialHash))) {
    return null;
  }

  await auditLogin(db, 'operator.login', 'operators', operator.id, {
    operatorId: operator.id,
    uploadCentreId: operator.uploadCentreId,
  });
  return { kind: 'operator', operatorId: operator.id, uploadCentreId: operator.uploadCentreId };
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
  options: { tokenSecret: string; secureCookies: boolean },
): void {
  app.post('/api/session', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string): string => (typeof body[k] === 'string' ? (body[k] as string) : '');

    const machine = await authenticateMachine(db, str('machine_identifier'), str('machine_secret'));
    const operator = await authenticateOperator(db, str('external_ref'), str('operator_secret'));

    /**
     * One failure for both credentials, and no hint about which one was wrong.
     * `reason` is a stable token the client localises — the server does not
     * pick the language a message is read in.
     */
    if (machine === null || operator === null) {
      return reply.code(401).send({ error: 'credentials', reason: 'credentials' });
    }

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
