import type { MachineClaims, OperatorClaims } from './credentials.ts';

/**
 * Who made a change, and from where. Both halves always present: the machine
 * token proves the counter, the operator token proves the person, and PRD
 * §11.3.1 rule 2 records both on the handover.
 *
 * Its own module so `audit.ts` and `index.ts` can both name it without either
 * importing the other.
 */
export type Actor = { machine: MachineClaims; operator: OperatorClaims };
