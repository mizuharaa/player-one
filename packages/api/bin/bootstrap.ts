import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { and, eq, ne } from 'drizzle-orm';
import { open, schema, type Db } from '@playerone/store';
import { hashCredential, verifyCredential } from '../src/credentials.ts';

type Operator = { ref: string; role: string; secret: string };
type Options =
  | { mode: 'create'; region: string; name: string; machine: string; secret: string; operators: Operator[] }
  | { mode: 'rotate-machine'; ref: string; secret: string }
  | { mode: 'rotate-operator'; ref: string; secret: string };

class Refusal extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const flags = {
  'centre-region': { type: 'string' },
  'centre-name': { type: 'string' },
  machine: { type: 'string' },
  'machine-secret': { type: 'string' },
  operator: { type: 'string', multiple: true },
  'rotate-machine': { type: 'string' },
  'rotate-operator': { type: 'string' },
  'operator-secret': { type: 'string' },
} as const;

export function parseBootstrapArgs(args: string[]): Options {
  let values;
  try {
    ({ values } = parseArgs({ args, options: flags, allowPositionals: false }));
  } catch (err) {
    // parseArgs errors can contain a whole credential-bearing argument.
    const flag = /Option '(--[a-z-]+)(?: <value>)?'/.exec((err as Error).message)?.[1];
    throw new Refusal(flag && flag.slice(2) in flags ? `invalid or missing value for ${flag}` : 'invalid arguments', 2);
  }
  const required = (flag: Exclude<keyof typeof flags, 'operator'>): string => {
    const value = values[flag];
    if (!value) throw new Refusal(`--${flag} is required`, 2);
    return value;
  };
  const machineRotation = values['rotate-machine'] !== undefined;
  const operatorRotation = values['rotate-operator'] !== undefined;
  if (machineRotation && operatorRotation) {
    throw new Refusal('--rotate-machine and --rotate-operator cannot be combined', 2);
  }
  if (machineRotation || operatorRotation) {
    const forbidden = ['centre-region', 'centre-name', 'machine', 'operator',
      machineRotation ? 'operator-secret' : 'machine-secret'] as const;
    for (const flag of forbidden) {
      if (values[flag] !== undefined) throw new Refusal(`--${flag} cannot be combined with rotation`, 2);
    }
    return machineRotation
      ? { mode: 'rotate-machine', ref: required('rotate-machine'), secret: required('machine-secret') }
      : { mode: 'rotate-operator', ref: required('rotate-operator'), secret: required('operator-secret') };
  }
  if (values['operator-secret'] !== undefined) {
    throw new Refusal('--operator-secret requires --rotate-operator', 2);
  }
  const region = required('centre-region');
  const name = required('centre-name');
  const machine = required('machine');
  const secret = required('machine-secret');
  if (!values.operator?.length) throw new Refusal('--operator is required', 2);
  const operators = values.operator.map((value): Operator => {
    const first = value.indexOf(':');
    const second = value.indexOf(':', first + 1);
    if (first < 1 || second <= first + 1 || second === value.length - 1) {
      throw new Refusal('--operator requires ref:role:secret', 2);
    }
    const ref = value.slice(0, first);
    const role = value.slice(first + 1, second);
    if (!['administrator', 'finance', 'centre_operator'].includes(role)) {
      throw new Refusal(`unsupported operator role '${role}'`, 2);
    }
    return { ref, role, secret: value.slice(second + 1) };
  });
  return { mode: 'create', region, name, machine, secret, operators };
}

export async function bootstrap(db: Db, options: Options): Promise<string[]> {
  const { uploadCentres: centres, uploadDevices: machines, operators } = schema;
  return db.transaction(async (tx) => {
    if (options.mode === 'rotate-machine') {
      const [row] = await tx.select().from(machines).where(eq(machines.machineIdentifier, options.ref));
      if (!row) throw new Refusal(`machine '${options.ref}' does not exist`);
      await tx.update(machines).set({ credentialHash: await hashCredential(options.secret) }).where(eq(machines.id, row.id));
      return [`machine '${options.ref}' rotated ${row.id}`];
    }
    if (options.mode === 'rotate-operator') {
      const [row] = await tx.select().from(operators)
        .where(and(eq(operators.externalRef, options.ref), ne(operators.role, 'reviewer')));
      if (!row) throw new Refusal(`operator '${options.ref}' does not exist`);
      await tx.update(operators).set({ credentialHash: await hashCredential(options.secret) }).where(eq(operators.id, row.id));
      return [`operator '${options.ref}' rotated ${row.id}`];
    }

    const output: string[] = [];
    const [machine] = await tx.select().from(machines).where(eq(machines.machineIdentifier, options.machine));
    let centre: typeof centres.$inferSelect;
    if (machine) {
      const [row] = await tx.select().from(centres).where(eq(centres.id, machine.uploadCentreId));
      if (!row) throw new Refusal(`machine '${options.machine}' centre ${machine.uploadCentreId} does not exist`);
      centre = row;
      if (centre.region !== options.region || centre.name !== options.name) {
        throw new Refusal(`machine '${options.machine}' centre ${centre.id}: --centre-region or --centre-name differs (expected '${centre.region}' / '${centre.name}')`);
      }
      output.push(`centre exists ${centre.id}`);
    } else {
      const matches = await tx.select().from(centres).where(and(eq(centres.region, options.region), eq(centres.name, options.name)));
      if (matches.length > 1) throw new Refusal(`multiple centres match region '${options.region}' and name '${options.name}'`);
      if (matches[0]) {
        centre = matches[0];
        output.push(`centre exists ${centre.id}`);
      } else {
        const [created] = await tx.insert(centres).values({ id: randomUUID(), region: options.region, name: options.name, status: 'active' }).returning();
        centre = created!;
        output.push(`centre created ${centre.id}`);
      }
    }
    if (machine) {
      if (!await verifyCredential(options.secret, machine.credentialHash)) {
        throw new Refusal(`machine '${options.machine}' (${machine.id}) credential differs; use --rotate-machine ${options.machine}`);
      }
      output.push(`machine '${options.machine}' exists ${machine.id}`);
    } else {
      const id = randomUUID();
      await tx.insert(machines).values({ id, uploadCentreId: centre.id, machineIdentifier: options.machine,
        status: 'active', credentialHash: await hashCredential(options.secret) });
      output.push(`machine '${options.machine}' created ${id}`);
    }
    for (const operator of options.operators) {
      const [row] = await tx.select().from(operators)
        .where(and(eq(operators.externalRef, operator.ref), ne(operators.role, 'reviewer')));
      if (row) {
        if (row.uploadCentreId !== centre.id) {
          throw new Refusal(`operator '${operator.ref}' (${row.id}) centre differs: ${row.uploadCentreId}, expected ${centre.id}`);
        }
        if (row.role !== operator.role) {
          throw new Refusal(`operator '${operator.ref}' (${row.id}) role differs: '${row.role}', expected '${operator.role}'`);
        }
        if (!await verifyCredential(operator.secret, row.credentialHash)) {
          throw new Refusal(`operator '${operator.ref}' (${row.id}) credential differs; use --rotate-operator ${operator.ref}`);
        }
        output.push(`operator '${operator.ref}' exists ${row.id}`);
      } else {
        const id = randomUUID();
        await tx.insert(operators).values({ id, uploadCentreId: centre.id, externalRef: operator.ref,
          role: operator.role, credentialHash: await hashCredential(operator.secret) });
        output.push(`operator '${operator.ref}' created ${id}`);
      }
    }
    return output;
  });
}

export async function main(args = process.argv.slice(2), env = process.env): Promise<number> {
  let db: Db | undefined;
  try {
    const options = parseBootstrapArgs(args);
    if (!env['DATABASE_URL']) throw new Refusal('DATABASE_URL is required', 2);
    db = await open(env['DATABASE_URL']);
    const output = await bootstrap(db, options);
    output.forEach((line) => console.log(line));
    return 0;
  } catch (err) {
    // Driver errors may include SQL parameters (including hashes).
    console.error(`bootstrap: ${err instanceof Refusal ? err.message : 'database operation failed; check database availability and constraints'}`);
    return err instanceof Refusal ? err.exitCode : 1;
  } finally {
    await db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
