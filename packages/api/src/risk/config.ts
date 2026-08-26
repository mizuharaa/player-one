/**
 * The two environment flags the brief gives the engine (§2.4), read once.
 *
 *   PLAYERONE_RISK_ENGINE=1|0   default 1. Advisory evaluation is always on.
 *   PLAYERONE_RISK_HOLD=1|0     default 0. Holds stay off until the
 *                               false-positive report says the thresholds
 *                               are right; whether they are on at pilot is
 *                               escalated, not decided here.
 *
 * Read in `bin/` by whoever wires the worker; this is the one place the
 * strings are spelled.
 */

export type RiskConfig = { engineEnabled: boolean; holdsEnabled: boolean; mediaRoot: string | undefined };

export function riskConfigFromEnv(env: Record<string, string | undefined> = process.env): RiskConfig {
  const flag = (name: string, fallback: boolean): boolean => {
    const v = env[name];
    if (v === undefined || v === '') return fallback;
    if (v === '1') return true;
    if (v === '0') return false;
    throw new Error(`${name} must be 1 or 0, not '${v}'`);
  };
  return {
    engineEnabled: flag('PLAYERONE_RISK_ENGINE', true),
    holdsEnabled: flag('PLAYERONE_RISK_HOLD', false),
    mediaRoot: env['PLAYERONE_MEDIA_ROOT'],
  };
}
