import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parseCode, deletionSql, DEFAULT_PHONE } from './smoke-phone.mjs';

// ---------------------------------------------------------------- parseArgs

test('parses --origin, --ssh and --phone', () => {
  const args = parseArgs(['--origin', 'https://api.example.test', '--ssh', 'ssh -p 234 host', '--phone', '+84900000002']);
  assert.equal(args.origin, 'https://api.example.test');
  assert.equal(args.ssh, 'ssh -p 234 host');
  assert.equal(args.phone, '+84900000002');
  assert.equal(args.dryRun, false);
});

test('--phone defaults to the seeded demo phone', () => {
  const args = parseArgs(['--origin', 'https://x', '--ssh', 'ssh host']);
  assert.equal(args.phone, DEFAULT_PHONE);
});

test('--dry-run needs no --origin or --ssh', () => {
  const args = parseArgs(['--dry-run']);
  assert.equal(args.dryRun, true);
  assert.equal(args.origin, undefined);
});

test('refuses when --origin is missing and this is not a dry run', () => {
  assert.throws(() => parseArgs(['--ssh', 'ssh host']), /--origin is required/);
});

test('refuses when --ssh is missing and this is not a dry run', () => {
  assert.throws(() => parseArgs(['--origin', 'https://x']), /--ssh is required/);
});

test('refuses an unknown flag', () => {
  assert.throws(() => parseArgs(['--origin', 'https://x', '--ssh', 'h', '--bogus']), /unknown argument: --bogus/);
});

// ------------------------------------------------------------------ parseCode

const LINE = (phone, code) =>
  `api-1  | [zns:dev] NOT SENT — sign-in code for ${phone} is ${code}. No ZNS credentials are configured.`;

test('reads the code for the named phone off a single log line', () => {
  const log = LINE('+84900000001', '123456');
  assert.equal(parseCode(log, '+84900000001'), '123456');
});

test('picks the LAST matching line, for a phone asked for a code twice', () => {
  const log = [LINE('+84900000001', '111111'), 'api-1  | some other line', LINE('+84900000001', '222222')].join('\n');
  assert.equal(parseCode(log, '+84900000001'), '222222');
});

test('ignores lines for a different phone', () => {
  const log = [LINE('+84900000009', '999999'), LINE('+84900000001', '123456')].join('\n');
  assert.equal(parseCode(log, '+84900000001'), '123456');
});

test('returns null when the phone never appears', () => {
  const log = LINE('+84900000009', '999999');
  assert.equal(parseCode(log, '+84900000001'), null);
});

test('ignores an unrelated docker compose log line', () => {
  const log = [
    'api-1  | {"level":30,"msg":"request completed"}',
    LINE('+84900000001', '654321'),
  ].join('\n');
  assert.equal(parseCode(log, '+84900000001'), '654321');
});

// ---------------------------------------------------------------- deletionSql

test('deletionSql names every id an operator needs to find and remove this run', () => {
  const sql = deletionSql({
    sessionId: 'S-1', uploadId: 'U-1', episodeId: 'E-1', basename: 'smoke_SMOKETEST_20260916_120000',
  });
  for (const needle of ['S-1', 'U-1', 'E-1', 'smoke_SMOKETEST_20260916_120000']) {
    assert.ok(sql.includes(needle), `expected deletionSql output to mention ${needle}`);
  }
});
