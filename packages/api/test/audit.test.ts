import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@playerone/store';
import { hashCredential, mutate, type Actor } from '../src/index.ts';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../store/test/db.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('audit');

/**
 * The audit wrapper. The property under test is atomicity, because that is what
 * separates a trail you can rely on from one you cannot: if a change can commit
 * without its audit row, then an unaudited change is indistinguishable from a
 * change that never happened, and every later question about who did what has
 * no answer.
 */

const uid = () => randomUUID();

async function seed(): Promise<{ actor: Actor; centreId: string; taskId: string }> {
  const d = await db();
  const centreId = uid();
  const deviceId = uid();
  const operatorId = uid();
  const taskId = uid();
  const hash = await hashCredential('x');

  await d.execute(sql`
    insert into upload_centres (id, region, name, status)
      values (${centreId}, 'HCM', 'centre', 'active')`);
  await d.execute(sql`
    insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${deviceId}, ${centreId}, 'HCM-01', 'active', ${hash})`);
  await d.execute(sql`
    insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${operatorId}, ${centreId}, 'op-1', 'centre_operator', ${hash})`);

  return {
    centreId,
    taskId,
    actor: {
      machine: { kind: 'machine', uploadDeviceId: deviceId, uploadCentreId: centreId },
      operator: { kind: 'operator', operatorId, uploadCentreId: centreId },
    },
  };
}

const countTasks = async (): Promise<number> => {
  const rows = (await (await db()).execute(
    sql`select count(*)::int as n from tasks`,
  )) as unknown as { n: number }[];
  return rows[0]!.n;
};

const audits = async (): Promise<Record<string, string | null>[]> =>
  (await (await db()).execute(
    sql`select action, target_table, target_id, operator_id, upload_device_id, reason
        from audit_events order by id`,
  )) as unknown as Record<string, string | null>[];

describe.skipIf(!hasDb())('the audit wrapper', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const insertTask = (id: string) => (tx: Parameters<Parameters<typeof mutate>[3]>[0]) =>
    tx.insert(schema.tasks).values({
      id,
      name: 'housework',
      unitPrice: '1200.0000',
      maxConcurrentClaimants: 5,
      status: 'published',
    });

  it('records the change, naming both the operator and the machine', async () => {
    const { actor, taskId } = await seed();
    await mutate(
      await db(),
      actor,
      { action: 'task.create', targetTable: 'tasks', targetId: taskId, after: { name: 'housework' } },
      insertTask(taskId),
    );

    expect(await countTasks()).toBe(1);
    const [row] = await audits();
    expect(row!['action']).toBe('task.create');
    expect(row!['target_id']).toBe(taskId);
    expect(row!['operator_id']).toBe(actor.operator.operatorId);
    expect(row!['upload_device_id']).toBe(actor.machine.uploadDeviceId);
  });

  it('writes no audit row when the change fails', async () => {
    const { actor, taskId } = await seed();
    await expect(
      mutate(
        await db(),
        actor,
        { action: 'task.create', targetTable: 'tasks', targetId: taskId },
        async () => {
          throw new Error('disk on fire');
        },
      ),
    ).rejects.toThrow('disk on fire');

    expect(await countTasks()).toBe(0);
    expect(await audits()).toHaveLength(0);
  });

  /**
   * The direction that matters. If the audit insert is rejected the change must
   * roll back too — otherwise the row is missing and the change is not, which is
   * precisely the state that makes a trail worthless.
   *
   * Driven through a real constraint rather than a mock: a manual resolution
   * with no reason is refused by audit_events_manual_reason_check.
   */
  it('rolls the change back when the audit row is refused', async () => {
    const { actor, taskId } = await seed();
    await violates(
      'audit_events_manual_reason_check',
      mutate(
        await db(),
        actor,
        { action: 'episode.resolve_manual', targetTable: 'episodes', targetId: taskId },
        insertTask(taskId),
      ),
    );

    // The task must not exist. The audit row could not be written, so the change
    // it would have described must not have happened either.
    expect(await countTasks()).toBe(0);
    expect(await audits()).toHaveLength(0);
  });

  it('accepts a manual resolution that says why', async () => {
    const { actor, taskId } = await seed();
    await mutate(
      await db(),
      actor,
      {
        action: 'episode.resolve_manual',
        targetTable: 'episodes',
        targetId: taskId,
        reason: 'collector confirmed the afternoon task at the counter',
        before: { proposed_session_id: null },
        after: { collection_session_id: taskId },
      },
      insertTask(taskId),
    );

    expect(await countTasks()).toBe(1);
    const [row] = await audits();
    expect(row!['reason']).toContain('collector confirmed');
  });

  it('records what was proposed as well as what was chosen', async () => {
    // A dispute asks both: what did the machine suggest, and what did the human
    // pick. before/after carry it, so no extra column is needed on episodes.
    const { actor, taskId } = await seed();
    const proposed = uid();
    const chosen = uid();
    await mutate(
      await db(),
      actor,
      {
        action: 'episode.resolve_manual',
        targetTable: 'episodes',
        targetId: taskId,
        reason: 'operator corrected the ordering',
        before: { proposed_session_id: proposed },
        after: { collection_session_id: chosen },
      },
      insertTask(taskId),
    );

    const rows = (await (await db()).execute(
      sql`select before, after from audit_events`,
    )) as unknown as { before: Record<string, string>; after: Record<string, string> }[];
    expect(rows[0]!.before['proposed_session_id']).toBe(proposed);
    expect(rows[0]!.after['collection_session_id']).toBe(chosen);
  });

  it('attributes to the token, so an endpoint cannot blame somebody else', async () => {
    // `mutate` takes the actor, not the event, and the actor comes from verified
    // tokens. There is no parameter an endpoint could use to name another operator.
    const { actor, taskId } = await seed();
    await mutate(
      await db(),
      actor,
      { action: 'task.create', targetTable: 'tasks', targetId: taskId },
      insertTask(taskId),
    );
    const [row] = await audits();
    expect(row!['operator_id']).toBe(actor.operator.operatorId);
    expect(row!['upload_device_id']).toBe(actor.machine.uploadDeviceId);
  });
});
