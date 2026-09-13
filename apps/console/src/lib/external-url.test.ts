import { describe, expect, it } from 'vitest';
import { httpsLink } from './external-url.ts';

/**
 * The one URL in this console that an outside system supplies.
 *
 * `BackOffice.tsx` rendered ZaloPay's `onboarding_url` / `reform_url` into an
 * `href` unfiltered. An `href` is not inert: `javascript:` runs in the
 * operator's session on click, and `data:text/html` opens a page somebody else
 * wrote with the console's name in the address bar.
 */
describe('a URL from the payment gateway', () => {
  it('is a link when it is https', () => {
    for (const url of [
      'https://zalopay.vn/onboarding?token=abc',
      'https://sandbox.zalopay.vn/reform#step2',
      'https://zalopay.vn',
    ]) {
      expect(httpsLink(url)).toBe(url);
    }
  });

  it('is not a link for any other scheme', () => {
    for (const url of [
      // eslint-disable-next-line no-script-url -- the point of the test
      'javascript:fetch("/api/payout/run",{method:"POST"})',
      'JavaScript:alert(1)',
      'data:text/html,<h1>ZaloPay</h1>',
      'vbscript:msgbox',
      'file:///C:/Windows/System32',
      // Not http either: this is a payment onboarding page.
      'http://zalopay.vn/onboarding',
      // Nor a relative path, which would point at this console.
      '/counter',
      '//zalopay.vn/onboarding',
    ]) {
      expect(httpsLink(url), url).toBeNull();
    }
  });

  it('is nothing at all when the gateway sent nothing', () => {
    expect(httpsLink(null)).toBeNull();
    expect(httpsLink(undefined)).toBeNull();
    expect(httpsLink('')).toBeNull();
    expect(httpsLink('not a url')).toBeNull();
  });
});
