import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';
import { smoke } from './zalopay-sandbox-smoke.mjs';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  PLAYERONE_ZALOPAY_ENV: 'sandbox', PLAYERONE_ZALOPAY_APP_ID: '1',
  PLAYERONE_ZALOPAY_PAYMENT_ID: 'test-payment', PLAYERONE_ZALOPAY_KEY1: 'secret-sentinel',
  PLAYERONE_ZALOPAY_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID: 'test-wallet', PLAYERONE_ZALOPAY_SANDBOX_PHONE: '0901234567',
};
const answer = body => new Response(JSON.stringify(body));

test('production is refused without a request', async () => {
  let calls = 0;
  assert.equal(await smoke({ ...env, PLAYERONE_ZALOPAY_ENV: 'production' }, { fetch: async () => { calls++; }, write() {} }), 2);
  assert.equal(calls, 0);
});
test('every supplied base URL override is refused, even the sandbox URL', async () => {
  for (const value of ['', 'https://sb-openapi.zalopay.vn', 'https://openapi.zalopay.vn']) {
    let calls = 0;
    assert.equal(await smoke({ ...env, PLAYERONE_ZALOPAY_BASE_URL: value }, { fetch: async () => { calls++; }, write() {} }), 2);
    assert.equal(calls, 0);
  }
});
test('missing Merchant Wallet ID is refused before requests', async () => {
  let calls = 0;
  assert.equal(await smoke({ ...env, PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID: '' }, { fetch: async () => { calls++; }, write() {} }), 2);
  assert.equal(calls, 0);
});
test('only pinned read endpoints can be sent, redirects refused, no identifiers printed', async () => {
  const output = [], paths = [];
  await smoke(env, { write: line => output.push(line), fetch: async (url, init) => {
    assert.equal(new URL(url).origin, 'https://sb-openapi.zalopay.vn');
    assert.equal(init.redirect, 'error');
    paths.push(new URL(url).pathname);
    return answer(url.endsWith('/balance') ? { return_code: 1, data: { balance: 123456 } } : { return_code: 1, data: { m_u_id: 'private-wallet-sentinel' } });
  }});
  assert(paths.includes('/v2/disbursement/verify-account'));
  assert(paths.every(path => ['/v2/disbursement/balance', '/v2/disbursement/verify-account'].includes(path)));
  const text = output.join('\n');
  for (const secret of ['secret-sentinel', '0901234567', 'private-wallet-sentinel', '123456']) assert(!text.includes(secret));
  assert(output.every(line => line.startsWith('Simulation | ')));
  assert(text.includes('name_unconfirmed'));
});
test('unknown provider messages and transport errors never leak', async () => {
  for (const fail of [false, true]) {
    const output = [], warnings = [];
    const oldWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
      assert.equal(await smoke(env, { write: line => output.push(line), fetch: async () => {
        if (fail) throw new Error('private-message-sentinel');
        return answer({ return_code: 2, sub_return_code: -9999, sub_return_message: 'private-message-sentinel' });
      }}), 1);
      assert(!output.concat(warnings).join('\n').includes('private-message-sentinel'));
    } finally { console.warn = oldWarn; }
  }
});

test('configured balance and wallet reads both succeed without a transfer', async () => {
  const paths = [], output = [];
  const code = await smoke(env, { write: line => output.push(line), fetch: async (url, init) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/balance')) {
      assert.deepEqual(JSON.parse(JSON.parse(init.body).partner_embed_data), { merchant_wallet_id: 'test-wallet' });
      return answer({ return_code: 1, data: { balance: 123 } });
    }
    return answer({ return_code: 1, data: { m_u_id: 'private-id' } });
  }});
  assert.equal(code, 0);
  assert.deepEqual(paths, ['/v2/disbursement/balance', '/v2/disbursement/verify-account']);
  assert(output.every(line => line.includes('| success |')));
});
