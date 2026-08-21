import { eq } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { schema, type Db } from '@playerone/store';
import { auditLogin } from './audit.ts';
import { registerCounter } from './counter.ts';
import type { Actor } from './actor.ts';
import {
  signToken,
  verifyCredential,
  verifyToken,
  type MachineClaims,
  type OperatorClaims,
} from './credentials.ts';

export * from './credentials.ts';
export * from './audit.ts';
export type { Actor } from './actor.ts';

/**
 * The operator API. The upload-centre console never touches Postgres — PRD
 * §11.3.2 rule 4 scopes those machines to controlled upload paths, and a
 * regional machine holding database credentials would make the PLT-08 audit
 * trail unenforceable. Console → here → DB, including for reads.
 */

/** Both tokens on every mutation: the machine proves where, the operator proves who. */
declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export type ApiOptions = {
  db: Db;
  /** Token signing key. Fails closed at construction rather than defaulting. */
  tokenSecret: string;
};

export function buildApi({ db, tokenSecret }: ApiOptions): FastifyInstance {
  if (!tokenSecret) throw new Error('tokenSecret is required');
  const app = Fastify({ logger: false });

  const bearer = (req: FastifyRequest, header: string): string | undefined => {
    const raw = req.headers[header];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value?.startsWith('Bearer ') ? value.slice(7) : value;
  };

  /**
   * PRD §8.3.2 rule 1: "Upload center operators must log in to fixed upload
   * devices before importing data." A machine token alone can do nothing.
   *
   * Both tokens must also name the SAME centre. Two valid tokens from different
   * centres is either a misconfigured machine or someone splicing credentials;
   * either way it is not a write we can attribute.
   */
  const requireActor = async (req: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const machine = verifyToken(tokenSecret, bearer(req, 'x-machine-token'));
    const operator = verifyToken(tokenSecret, bearer(req, 'authorization'));
    if (machine?.kind !== 'machine') return reply.code(401).send({ error: 'machine token required' });
    if (operator?.kind !== 'operator') return reply.code(401).send({ error: 'operator token required' });
    if (machine.uploadCentreId !== operator.uploadCentreId) {
      return reply.code(403).send({ error: 'operator and machine belong to different centres' });
    }
    req.actor = { machine, operator };
  };

  /**
   * BO-11 / SEC-02. The centre comes from the token, never from the request, so
   * an operator at centre A cannot address centre B by asking nicely.
   */
  const sameCentre = (req: FastifyRequest, centreId: string): boolean =>
    req.actor?.operator.uploadCentreId === centreId;

  app.post('/auth/machine', async (req, reply) => {
    const { machine_identifier, secret } = (req.body ?? {}) as Record<string, string>;
    if (!machine_identifier || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const [device] = await db
      .select()
      .from(schema.uploadDevices)
      .where(eq(schema.uploadDevices.machineIdentifier, machine_identifier));

    // One message for "no such machine", "wrong secret" and "retired machine":
    // an unauthenticated caller learns nothing about the fleet.
    if (
      device === undefined ||
      device.status !== 'active' ||
      !(await verifyCredential(secret, device.credentialHash))
    ) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const claims: MachineClaims = {
      kind: 'machine',
      uploadDeviceId: device.id,
      uploadCentreId: device.uploadCentreId,
    };
    await auditLogin(db, 'machine.login', 'upload_devices', device.id, {
      uploadDeviceId: device.id,
      uploadCentreId: device.uploadCentreId,
    });
    return { token: signToken(tokenSecret, claims), upload_centre_id: device.uploadCentreId };
  });

  app.post('/auth/operator', async (req, reply) => {
    const { external_ref, secret } = (req.body ?? {}) as Record<string, string>;
    if (!external_ref || !secret) return reply.code(400).send({ error: 'missing credentials' });

    const [operator] = await db
      .select()
      .from(schema.operators)
      .where(eq(schema.operators.externalRef, external_ref));

    if (operator === undefined || !(await verifyCredential(secret, operator.credentialHash))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }

    const claims: OperatorClaims = {
      kind: 'operator',
      operatorId: operator.id,
      uploadCentreId: operator.uploadCentreId,
    };
    await auditLogin(db, 'operator.login', 'operators', operator.id, {
      operatorId: operator.id,
      uploadCentreId: operator.uploadCentreId,
    });
    return { token: signToken(tokenSecret, claims), upload_centre_id: operator.uploadCentreId };
  });

  /**
   * Reference data for the offline cache. Scoped to the token's own centre —
   * the query parameter is checked against it, not trusted.
   */
  app.get('/reference/sync', { preHandler: requireActor }, async (req, reply) => {
    const centreId = (req.query as Record<string, string>)['centre_id'];
    if (centreId && !sameCentre(req, centreId)) {
      return reply.code(403).send({ error: 'not your centre' });
    }
    const [collectors, devices, tasks, scenarios] = await Promise.all([
      db.select().from(schema.collectors),
      db.select().from(schema.devices),
      db.select().from(schema.tasks),
      db.select().from(schema.scenarios),
    ]);
    return {
      fetched_at: new Date().toISOString(),
      upload_centre_id: req.actor!.operator.uploadCentreId,
      collectors,
      devices,
      tasks,
      scenarios,
    };
  });

  registerCounter(app, db, requireActor);

  /** Proves both-tokens and centre scope on its own, with no counter state needed. */
  app.get('/whoami', { preHandler: requireActor }, async (req) => ({
    operator_id: req.actor!.operator.operatorId,
    upload_device_id: req.actor!.machine.uploadDeviceId,
    upload_centre_id: req.actor!.operator.uploadCentreId,
  }));

  return app;
}

