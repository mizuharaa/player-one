import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const fixture = fileURLToPath(new URL('../../../fixtures/sessions/delivery-a/ego_SYNTH0000001_20260813_090800', import.meta.url));
export const credentials = {
  PLAYERONE_MACHINE_IDENTIFIER: 'HCM-01',
  PLAYERONE_MACHINE_SECRET: 'pw',
  PLAYERONE_OPERATOR_REF: 'op-1',
  PLAYERONE_OPERATOR_SECRET: 'pw',
};
export const flags = {
  'session-dir': fixture,
  collector: '11111111-1111-4111-8111-111111111111',
  device: '22222222-2222-4222-8222-222222222222',
  card: 'CARD-0001',
  task: '33333333-3333-4333-8333-333333333333',
  scenario: '44444444-4444-4444-8444-444444444444',
  'others-in-frame': 'yes',
  sensitive: 'no',
};

export const argsFor = (values: Record<string, string> = flags) =>
  ['import', ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])];

export function runCounter(args = argsFor(), overrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...credentials, PLAYERONE_MEDIA_ROOT: '', ...overrides };
  delete env.DATABASE_URL;
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [
      fileURLToPath(new URL('../bin/counter.ts', import.meta.url)), ...args,
    ], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
