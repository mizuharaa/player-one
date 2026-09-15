import { loadEnvFile } from 'node:process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { zaloPayClientFromEnv } from '../src/payout/zalopay/client.ts';
import { SUB_RETURN_CODES, ZaloPayError, ZaloPayTransportError } from '../src/payout/zalopay/types.ts';

const origin = 'https://sb-openapi.zalopay.vn';
const endpoints = ['/v2/disbursement/balance', '/v2/disbursement/verify-account'];

// No database or transfer capability. The transport guard also refuses redirects.
export async function smoke(env, { fetch: request = globalThis.fetch, write = console.log } = {}) {
  const report = (endpoint, status, code, meaning) => write(`Simulation | ${endpoint} | ${status} | code=${code ?? 'none'} | ${meaning}`);
  if ((env.PLAYERONE_ZALOPAY_ENV ?? 'sandbox') !== 'sandbox' ||
      Object.keys(env).some(key => /ZALOPAY.*URL/i.test(key))) {
    report('configuration', 'refused', null, 'sandbox_only_no_url_override');
    return 2;
  }
  if (!env.PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID?.trim() || !/^0\d{9}$/.test(env.PLAYERONE_ZALOPAY_SANDBOX_PHONE ?? '')) {
    report('configuration', 'refused', null, 'merchant_wallet_id_and_sandbox_phone_required');
    return 2;
  }
  let client;
  let missingWalletPayload = false;
  try {
    client = zaloPayClientFromEnv(env, {
      warn: () => {}, // Results below report codes; raw provider messages never leave the adapter.
      fetch: async (url, init) => {
        if (!endpoints.some(path => String(url) === origin + path)) throw new Error('read_endpoint_refused');
        if (String(url).endsWith('/balance')) {
          const body = JSON.parse(init.body);
          // Task 2 must supply this through the existing client, never reconstructed here.
          if (JSON.parse(body.partner_embed_data ?? '{}').merchant_wallet_id !== env.PLAYERONE_ZALOPAY_MERCHANT_WALLET_ID) {
            missingWalletPayload = true;
            throw new Error('merchant_wallet_payload_missing');
          }
        }
        return request(url, { ...init, redirect: 'error' });
      },
    });
    if (!client) throw new Error('configuration_missing');
  } catch {
    report('configuration', 'refused', null, 'client_configuration_invalid');
    return 2;
  }
  let ok = true;
  for (const endpoint of ['balance', 'verifyAccount']) {
    try {
      if (endpoint === 'balance') {
        await client.balance();
        report(endpoint, 'success', 1, 'balance_read_no_payment');
      } else {
        const result = await client.verifyAccount({ receiver: { method: 'WALLET', phone: env.PLAYERONE_ZALOPAY_SANDBOX_PHONE }, amountVnd: 1 });
        if (result.kind === 'verified') {
          report(endpoint, 'success', 1, 'wallet_lookup_only_one_dong_probe_name_unconfirmed_no_payment');
        } else {
          ok = false;
          report(endpoint, 'unresolved', result.subCode, SUB_RETURN_CODES.get(result.subCode)?.constant ?? 'unknown_provider_code');
        }
      }
    } catch (error) {
      ok = false;
      if (endpoint === 'balance' && missingWalletPayload) {
        report(endpoint, 'refused', null, 'merchant_wallet_payload_missing_task_2_required');
        continue;
      }
      report(endpoint, 'unresolved', error instanceof ZaloPayError ? error.subCode : null,
        error instanceof ZaloPayError ? SUB_RETURN_CODES.get(error.subCode)?.constant ?? 'unknown_provider_code'
          : error instanceof ZaloPayTransportError ? error.cause : 'request_failed');
    }
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.log('Simulation | configuration | refused | code=none | no_cli_overrides');
    process.exitCode = 2;
  } else {
    try {
      loadEnvFile(join(homedir(), '.playerone', 'zalopay-sandbox.env'));
      process.exitCode = await smoke(process.env);
    } catch {
      console.log('Simulation | configuration | refused | code=none | env_load_failed');
      process.exitCode = 2;
    }
  }
}
