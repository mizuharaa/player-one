import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Real sample sessions are not committed. Point PLAYERONE_SESSIONS at the extracted directory. */
export const SESSIONS_ROOT =
  process.env['PLAYERONE_SESSIONS'] ??
  'C:/Users/user/playerone-sample/EgoCamera Sample Data';

export const session = (id: string): string =>
  join(SESSIONS_ROOT, `ego_AZER76400FE_20260813_${id}`);

export const hasSession = (id: string): boolean => existsSync(session(id));

/** A checkout of huggingface.co/datasets/paxini/Omnisharing_DB_SampleData. LFS payloads not needed. */
export const PAXINI_ROOT = process.env['PAXINI_SAMPLE'] ?? '';
export const hasPaxini = (): boolean => PAXINI_ROOT !== '' && existsSync(PAXINI_ROOT);
