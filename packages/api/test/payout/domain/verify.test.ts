import { describe, expect, it } from 'vitest';
import { outcomeOf, verifyDeclaration } from '../../../src/payout/domain/verify.ts';
import { StubZaloPay } from './stub-client.ts';

const rejected = (subCode: number, extra: Record<string, string> = {}) =>
  ({ kind: 'rejected', subCode, retryable: false, ...extra }) as const;

describe('verification on declare', () => {
  it('maps every answer in the brief to a verify_status and, where it is a signal, an event', () => {
    expect(outcomeOf('Nguyễn Văn A', { kind: 'verified', verifiedName: 'NGUYEN VAN A', mUId: 'mu-1' })).toMatchObject({
      status: 'verified',
      verifiedName: 'NGUYEN VAN A',
      mUId: 'mu-1',
      event: null,
    });
    expect(outcomeOf('Nguyễn Văn A', { kind: 'verified', verifiedName: 'NGUYEN VAN B', mUId: 'mu-1' })).toMatchObject({
      status: 'name_mismatch',
      verifiedName: 'NGUYEN VAN B',
      event: 'IDENT.NAME_MISMATCH',
    });
    expect(outcomeOf('A', rejected(-101, { onboardingUrl: 'https://zalopay.vn/onboard' }))).toMatchObject({
      status: 'no_wallet',
      redirectUrl: 'https://zalopay.vn/onboard',
      subCode: -101,
      event: 'IDENT.NO_WALLET',
    });
    expect(outcomeOf('A', rejected(-406, { reformUrl: 'https://zalopay.vn/reform' }))).toMatchObject({
      status: 'kyc_limit',
      redirectUrl: 'https://zalopay.vn/reform',
      event: 'IDENT.KYC_LIMIT',
    });
    expect(outcomeOf('A', rejected(-1011))).toMatchObject({ status: 'locked', event: 'IDENT.WALLET_LOCKED' });
    expect(outcomeOf('A', rejected(-1103))).toMatchObject({ status: 'unverified', event: 'IDENT.UNVERIFIED_KYC' });
    expect(outcomeOf('A', rejected(-1104))).toMatchObject({ status: 'name_mismatch', event: 'IDENT.NAME_MISMATCH' });
    expect(outcomeOf('A', rejected(-105))).toMatchObject({ status: 'error', subCode: -105, event: 'IDENT.VERIFY_ERROR' });
    expect(outcomeOf('A', { kind: 'system', subCode: -503, retryable: true })).toMatchObject({ status: 'error', event: null });
  });

  it('never rewrites the declared name, and keeps both when they differ', () => {
    const o = outcomeOf('Nguyễn Văn A', { kind: 'verified', verifiedName: 'NGUYEN VAN B', mUId: null });
    expect(o.verifiedName).toBe('NGUYEN VAN B');
    // The outcome carries ZaloPay's name only; the caller stores the declared
    // name it was given, untouched. There is no field here to overwrite it with.
    expect(Object.keys(o)).not.toContain('declaredName');
  });

  it('records a wallet ZaloPay confirms but does not name as verified-unnamed, and flags it', () => {
    expect(outcomeOf('Nguyễn Văn A', { kind: 'verified', verifiedName: null, mUId: 'mu-9' })).toMatchObject({
      status: 'verified',
      verifiedName: null,
      mUId: 'mu-9',
      event: 'IDENT.NAME_UNCONFIRMED',
    });
  });

  it('stores unverified with no client, and error when the client cannot reach ZaloPay', async () => {
    expect(await verifyDeclaration(undefined, 'A', { method: 'WALLET', phone: '0912345678' })).toMatchObject({
      status: 'unverified',
      event: null,
    });
    const stub = new StubZaloPay();
    stub.verify = () => {
      throw new Error('timeout');
    };
    expect(await verifyDeclaration(stub, 'A', { method: 'WALLET', phone: '0912345678' })).toMatchObject({
      status: 'error',
      event: null,
    });
    expect(stub.calls.verifyAccount).toBe(1);
  });

  it('probes with one dong: verify moves no money', async () => {
    const stub = new StubZaloPay();
    await verifyDeclaration(stub, 'NGUYEN VAN A', { method: 'WALLET', phone: '0912345678' });
    expect(stub.calls.transferFund).toBe(0);
  });
});
