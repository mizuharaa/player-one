import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getConfig } = require('@expo/config');
const root = fileURLToPath(new URL('../', import.meta.url));
const keys = ['PLAYERONE_BUILD_PROFILE', 'EXPO_PUBLIC_API_URL', 'PLAYERONE_VERSION_CODE', 'EXPO_PUBLIC_MOCK_API', 'PLAYERONE_MOCK_API',
  'PLAYERONE_UPLOAD_KEYSTORE', 'PLAYERONE_UPLOAD_STORE_PASSWORD', 'PLAYERONE_UPLOAD_KEY_ALIAS', 'PLAYERONE_UPLOAD_KEY_PASSWORD'];
function config(env) {
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    return getConfig(root).exp;
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
}
const demo = { PLAYERONE_BUILD_PROFILE: 'demo', EXPO_PUBLIC_API_URL: 'http://192.168.1.10:8080', PLAYERONE_VERSION_CODE: '2' };
test('Expo really loads the profile and separates demo package/version from production', () => {
  const value = config(demo);
  assert.equal(value.android.package, 'vn.vng.playerone.collector.demo');
  assert.equal(value.android.versionCode, 2);
  assert.equal(value.name, 'Player One Demo');
  assert.equal(value.plugins.find((p) => p[0] === 'expo-build-properties')[1].android.targetSdkVersion, 36);
});
test('installable builds cannot silently target the emulator or mock API', () => {
  assert.throws(() => config({ ...demo, EXPO_PUBLIC_API_URL: '' }), /EXPO_PUBLIC_API_URL is required/);
  assert.throws(() => config({ ...demo, EXPO_PUBLIC_MOCK_API: '1' }), /real API/);
});
test('origins cannot contain credentials, paths or a trailing slash that breaks route joining', () => {
  for (const url of ['https://user:password@api.example.org', 'https://api.example.org/', 'https://api.example.org/api']) {
    assert.throws(() => config({ ...demo, EXPO_PUBLIC_API_URL: url }), /origin/);
  }
});
test('Play refuses LAN/plain HTTP and requires explicit upload signing', () => {
  for (const url of ['http://api.example.org', 'https://192.168.1.10', 'https://localhost', 'https://127.0.0.1']) {
    assert.throws(() => config({ ...demo, PLAYERONE_BUILD_PROFILE: 'play', EXPO_PUBLIC_API_URL: url }), /public HTTPS/);
  }
  assert.throws(() => config({ ...demo, PLAYERONE_BUILD_PROFILE: 'play', EXPO_PUBLIC_API_URL: 'https://api.example.org' }), /PLAYERONE_UPLOAD_KEYSTORE is required/);
});
test('version codes must be explicit valid Play integers', () => {
  for (const version of ['', '0', '-1', '1.5', '2100000001']) {
    assert.throws(() => config({ ...demo, PLAYERONE_VERSION_CODE: version }), /PLAYERONE_VERSION_CODE/);
  }
});
