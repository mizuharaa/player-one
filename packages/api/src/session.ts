import { eq } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { verifyCredential, type MachineClaims, type OperatorClaims } from './credentials.ts';

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
