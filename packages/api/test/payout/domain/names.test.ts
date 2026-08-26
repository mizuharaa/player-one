import { describe, expect, it } from 'vitest';
import { maskPhone, namesMatch, normaliseName } from '../../../src/payout/domain/names.ts';

describe('name matching for verification', () => {
  it('drops diacritics, folds case and collapses whitespace', () => {
    expect(namesMatch('Nguyễn Văn A', 'NGUYEN VAN A')).toBe(true);
    expect(namesMatch('  Trần   Thị  Bích   Ngọc ', 'tran thi bich ngoc')).toBe(true);
    expect(normaliseName('Nguyễn Văn A')).toEqual(['a', 'nguyen', 'van']);
  });

  it('handles đ, which NFD does not decompose', () => {
    expect(namesMatch('Đặng Hoàng Đức', 'DANG HOANG DUC')).toBe(true);
    expect(normaliseName('Đặng')).toEqual(['dang']);
  });

  it('compares token sets, because Vietnamese name order varies by form', () => {
    expect(namesMatch('A Van Nguyen', 'Nguyen Van A')).toBe(true);
  });

  it('is exact on the tokens: one letter off is a different person', () => {
    expect(namesMatch('Nguyen Van A', 'Nguyen Van B')).toBe(false);
    expect(namesMatch('Nguyen Van A', 'Nguyen Van')).toBe(false);
    expect(namesMatch('Nguyen Van A', 'Nguyen Van A A')).toBe(false);
    expect(namesMatch('', 'Nguyen Van A')).toBe(false);
    expect(namesMatch('Nguyen Van A', '')).toBe(false);
  });

  it('masks a phone to its last four digits', () => {
    expect(maskPhone('0912345678')).toBe('******5678');
    // Eleven digits once the country code is counted: seven hidden, four shown.
    expect(maskPhone('+84 912 345 678')).toBe('*******5678');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('')).toBe('');
  });
});
