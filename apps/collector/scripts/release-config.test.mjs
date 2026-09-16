/*
 * eas.json, checked against what Expo actually loads.
 *
 * Known and harmless, so nobody chases it: every `eas submit` run logs
 * "Skipping TestFlight group setup: ENOENT ... UsersKhang.playeroneAuthKey_*.p8".
 * The CLI strips the drive and slashes out of `submit.*.ios.ascApiKeyPath` when it
 * resolves that path relative to the project, and only the optional group step
 * uses it — the submission itself authenticates fine, and the internal group is
 * set to all builds, which is why 43 through 47 all appeared without it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

/**
 * The profiles EAS will actually build, read out of `eas.json` and put through
 * the same config loader.
 *
 * This is here because the two halves drifted: `testflight` inherited
 * `demo`'s `https://demo.playerone.invalid`, which `app.config.cjs` accepts
 * for a demo build and which no phone can resolve — so the one build the
 * owner installs on his iPhone would have shipped pointed at nothing. The
 * runtime override (`src/api/origin.ts`) is how a build reaches a laptop or
 * the cloud, but its default has to be a real host, because a build whose
 * default is unresolvable is unusable until somebody finds the Server row.
 *
 * `extends` merges env in EAS, child keys winning; `profileEnv` reproduces
 * that so the assertions are about what the build gets, not about one JSON
 * object.
 */
const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
function profileEnv(name) {
  const profile = eas.build[name];
  assert.ok(profile, `eas.json has no ${name} profile`);
  return { ...(profile.extends ? profileEnv(profile.extends) : {}), ...profile.env };
}
/*
 * Two origins, because the production hostname does not resolve yet: the
 * demo builds must reach the GreenNode VM that is actually up, and `store`
 * keeps the name VNG will point at it. Both are checked, neither is DNS.
 */
const DEMO_CLOUD = 'https://api.49-213-71-116.sslip.io';
const PROD_CLOUD = 'https://api.playerone.vng.com.vn';

test('every eas.json build profile mirrors PLAYERONE_BUILD_PROFILE into EXPO_PUBLIC_BUILD_PROFILE', () => {
  // The app cannot read PLAYERONE_BUILD_PROFILE — Expo only inlines the
  // EXPO_PUBLIC_ prefix — so Profile.tsx and origin.ts need their own copy of
  // the same value to gate the Server row and http:// on a Play build.
  for (const name of Object.keys(eas.build)) {
    const env = profileEnv(name);
    assert.equal(env.EXPO_PUBLIC_BUILD_PROFILE, env.PLAYERONE_BUILD_PROFILE,
      `${name} must mirror PLAYERONE_BUILD_PROFILE into EXPO_PUBLIC_BUILD_PROFILE`);
  }
});

// Named for what this checks, not for DNS: it only refuses a reserved or
// example hostname (RFC 2606), never looks the domain up, and cannot tell a
// live host from one that has not gone up yet.
test('every installable profile in eas.json names a non-placeholder origin', () => {
  for (const name of ['demo', 'store', 'testflight']) {
    const origin = profileEnv(name).EXPO_PUBLIC_API_URL;
    const expected = name === 'store' ? PROD_CLOUD : DEMO_CLOUD;
    assert.equal(origin, expected, `${name} must default to its Vietnam cloud domain`);
    assert.doesNotMatch(new URL(origin).hostname, /\.(invalid|test|local|localhost|example)$/i,
      `${name} must not default to a reserved placeholder host`);
  }
});

test('the TestFlight profile is a store-distributed demo at version 49', () => {
  // The three installable profiles ship the same build and must carry the
  // same Play/App Store version code, or one of them ships stale.
  for (const name of ['demo', 'store', 'testflight']) {
    assert.equal(profileEnv(name).PLAYERONE_VERSION_CODE, '49', `${name} must be at version 49`);
  }

  assert.equal(eas.build.testflight.distribution, 'store');
  assert.equal(eas.build.testflight.pnpm, eas.build.demo.pnpm);
  const env = profileEnv('testflight');
  assert.equal(env.PLAYERONE_BUILD_PROFILE, 'demo');
  assert.equal(env.PLAYERONE_VERSION_CODE, '49');
  // What Expo hands the native build: iOS reads the build number, Android the
  // version code, and both come from the one variable.
  const value = config(env);
  assert.equal(value.ios.buildNumber, '49');
  assert.equal(value.android.versionCode, 49);
  assert.equal(value.ios.bundleIdentifier, 'vn.vng.playerone.collector.demo');
  // A demo build talks to a laptop over plain HTTP once the origin is
  // overridden at runtime, so it keeps arbitrary loads and cleartext.
  assert.equal(value.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads, true);
});

test('native builds include Photos and camera purpose strings without adding microphone access', () => {
  const plugin = config(demo).plugins.find(p => Array.isArray(p) && p[0] === 'expo-image-picker');
  assert.ok(plugin);
  assert.match(plugin[1].photosPermission, /unmeasured/);
  assert.match(plugin[1].cameraPermission, /Take Photo/);
  assert.equal(plugin[1].microphonePermission, false);
});
