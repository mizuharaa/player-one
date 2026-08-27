import { describe, expect, it } from 'vitest';
import {
  buildExport,
  canonicalRow,
  EXPORT_COLUMNS,
  PIT_COMMENT,
  rowHash,
  sha256Hex,
  verifyExport,
  type ExportRow,
} from '../../../src/payout/domain/export.ts';

const row = (over: Partial<ExportRow> = {}): ExportRow => ({
  bill_id: '0f3b2f0e-1111-4000-8000-000000000001',
  period_start: '2026-08-17T00:00:00.000Z',
  period_end: '2026-08-24T00:00:00.000Z',
  collector_id: '0f3b2f0e-2222-4000-8000-000000000001',
  collector_name: 'Nguyễn Văn A',
  verified_name: 'NGUYEN VAN A',
  phone_masked: '******5678',
  method: 'WALLET',
  valid_minutes: '2.000000',
  rate_vnd: '1200.0000',
  gross_vnd: '2400.0000',
  tax_withheld_vnd: '0',
  net_vnd: '2400.0000',
  episode_count: '2',
  risk_band: 'clear',
  risk_flags: '',
  ...over,
});

describe('the payout export', () => {
  it('is byte-identical for the same rows, twice', () => {
    const a = buildExport([row(), row({ bill_id: '0f3b2f0e-1111-4000-8000-000000000002' })]);
    const b = buildExport([row(), row({ bill_id: '0f3b2f0e-1111-4000-8000-000000000002' })]);
    expect(a.body).toBe(b.body);
    expect(a.fileHash).toBe(b.fileHash);
  });

  it('starts with a BOM and the PIT comment, then the header, then the rows, then the file hash', () => {
    const built = buildExport([row()]);
    const lines = built.body.split('\r\n');
    expect(lines[0]).toBe('﻿' + PIT_COMMENT);
    expect(lines[0]).toContain('tax_withheld_vnd is 0');
    expect(lines[1]!.startsWith('# amounts are copied from bill_lines')).toBe(true);
    expect(lines[2]).toBe([...EXPORT_COLUMNS, 'row_hash'].map((c) => `"${c}"`).join(','));
    expect(lines[3]!.startsWith(`"${row().bill_id}"`)).toBe(true);
    expect(lines[4]).toBe(`# file_hash,${built.fileHash}`);
    expect(lines[5]).toBe('');
  });

  it('hashes each row over its canonical form and the file over everything above the trailer', () => {
    const r = row();
    const built = buildExport([r]);
    expect(built.rowHashes).toEqual([{ billId: r.bill_id, rowHash: sha256Hex(canonicalRow(r)) }]);
    expect(built.body).toContain(`"${rowHash(r)}"`);
    const above = built.body.slice(0, built.body.indexOf('# file_hash'));
    expect(built.fileHash).toBe(sha256Hex(above));
    expect(verifyExport(built.body)).toEqual({ ok: true, claimed: built.fileHash, actual: built.fileHash });
  });

  it('detects one edited cell', () => {
    const built = buildExport([row()]);
    const edited = built.body.replace('"2400.0000","0","2400.0000"', '"2400.0000","0","2500.0000"');
    expect(edited).not.toBe(built.body);
    const check = verifyExport(edited);
    expect(check.ok).toBe(false);
    expect(check.claimed).toBe(built.fileHash);
    expect(check.actual).not.toBe(built.fileHash);
  });

  it('quotes every field, so a comma or a quote in a name cannot shift a column', () => {
    const r = row({ collector_name: 'Nguyen, "Van" A' });
    expect(canonicalRow(r)).toContain('"Nguyen, ""Van"" A"');
    expect(canonicalRow(r).split('","')).toHaveLength(EXPORT_COLUMNS.length);
  });

  it('has exactly the columns the brief names, in its order', () => {
    expect([...EXPORT_COLUMNS]).toEqual([
      'bill_id',
      'period_start',
      'period_end',
      'collector_id',
      'collector_name',
      'verified_name',
      'phone_masked',
      'method',
      'valid_minutes',
      'rate_vnd',
      'gross_vnd',
      'tax_withheld_vnd',
      'net_vnd',
      'episode_count',
      'risk_band',
      'risk_flags',
    ]);
  });
});
