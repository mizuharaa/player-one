/**
 * Path A's pure half: the delivery state machine, the chunked sha256 it needs,
 * and the refusal both throw.
 *
 * Pure means no runtime dependency and no platform import. That is what lets
 * the same code drive the phone (`apps/collector/src/upload/delivery-native.ts`,
 * which supplies an `expo-file-system` transport) and an operator's browser
 * (`apps/console/src/debug-delivery/transport.ts`, which supplies a `fetch`
 * and `File` one) without either one re-implementing the resume, re-signing and
 * verdict rules that decide what a collector is paid for.
 *
 * This package has no `dependencies` block and must not acquire one: React
 * Native has no `node:crypto`, which is the reason `sha256.ts` exists at all.
 */
export * from './delivery.ts';
export * from './sha256.ts';
export * from './errors.ts';
