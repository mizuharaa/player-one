import { describe, expect, it } from 'vitest';
import { HEADSET_COPY, HEADSET_GUIDANCE } from '../src/headset-guidance.ts';
import { DEFAULT_LOCALE } from '../src/i18n.ts';

describe('PXCap source coverage', () => {
  it('keeps Vietnamese primary and cites every instruction', () => {
    expect(DEFAULT_LOCALE).toBe('vi');
    for (const section of HEADSET_GUIDANCE) {
      for (const item of section.items) expect(item.source).toMatch(/§[1-5]\./);
    }
  });

  for (const locale of ['vi', 'en', 'zh'] as const) {
    it(`supplies every heading, instruction and action in ${locale}`, () => {
      const texts = [
        ...Object.values(HEADSET_COPY),
        ...HEADSET_GUIDANCE.flatMap((section) => [section.title, ...section.items.map((item) => item.text)]),
      ];
      for (const text of texts) {
        expect(text[locale].trim().length).toBeGreaterThan(0);
        if (locale !== 'en') expect(text[locale]).not.toBe(text.en);
      }
    });

    it(`keeps the recommended 3-second holds, 30-minute interval and external-check boundary in ${locale}`, () => {
      const items = HEADSET_GUIDANCE.flatMap((section) => [...section.items]);
      const text = (id: string) => items.find((item) => item.id === id)!.text[locale];
      expect(text('sequence').match(/3/g)).toHaveLength(2);
      expect(text('sequence')).toMatch({ vi: /Trình tự khuyến nghị: giữ yên 3 giây/, en: /Recommended pattern: hold still for 3 seconds/, zh: /建议流程：静止 3 秒/ }[locale]);
      expect(text('periodic')).toContain('30');
      expect(HEADSET_COPY.external[locale]).toMatch({ vi: /bên ngoài ứng dụng/, en: /external host software/, zh: /本应用以外/ }[locale]);
      expect(text('storage')).toMatch({ vi: /không xóa tệp hay dọn thẻ/, en: /do not delete files or clear the card/, zh: /不删除文件、不清空卡/ }[locale]);
    });
  }

  it('covers all source topics, including faults and post-capture preservation', () => {
    const expected = ['mount', 'lens', 'power', 'preview', 'light', 'privacy', 'discomfort',
      'sequence', 'posture', 'natural', 'periodic', 'heat', 'crash', 'storage', 'sync',
      'handover', 'confidential', 'putAway'];
    expect(HEADSET_GUIDANCE.flatMap((section) => section.items.map((item) => item.id))).toEqual(expected);
    const english = HEADSET_GUIDANCE.flatMap((section) => section.items.map((item) => item.text.en)).join('\n');
    for (const required of [/short test recording/, /exposure and white balance/, /field of view/,
      /without speeding up or acting/, /restart the task/, /ambient temperature/, /check firmware/,
      /re-pair/, /unusable/, /verify file sizes/, /Do not rename/, /personal cloud storage/]) {
      expect(english).toMatch(required);
    }
  });
});
