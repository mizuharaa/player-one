/**
 * Pinned signing vectors for the ZaloPay Disbursement client.
 *
 * PROVENANCE — read before trusting these. The *Disbursement Technical
 * Specifications* PDF with ZaloPay's own worked examples is NOT on this
 * machine (searched ~/Downloads and the repo, 2026-08-26). These vectors were
 * therefore computed from the mac-input orderings documented in Part 0.3 of
 * the payout brief, using `signing.ts` itself, and then pinned. What they
 * prove is that the builders keep producing the same string and the same mac
 * as the day they were written — a reordering or a separator change fails
 * here. What they do NOT prove is that Part 0.3 transcribed the PDF correctly.
 * When the PDF arrives, replace each `macInput`/`mac` pair below with the
 * PDF's worked example for the same endpoint and re-run; nothing else needs
 * to change.
 *
 * `KEY1` and `TEST_RSA` are throwaway test material generated for this file.
 * They have never been near a ZaloPay account.
 */

export const KEY1 = 'PcY4iZIKFCIdgZvA6ueMcMHHUbRLYjPL';
export const APP_ID = 2553;
export const PAYMENT_ID = 'PM-001';

/** Stands in for an encrypted `receiver_info`: the mac treats it as an opaque string. */
export const RECEIVER_INFO_FIXTURE = 'ZW5jcnlwdGVkLXJlY2VpdmVyLWluZm8tZml4dHVyZQ==';

const DESCRIPTION = 'Player One 2026-08 payout';

export const VECTORS = {
  transferFundWallet: {
    fields: {
      app_id: APP_ID,
      payment_id: PAYMENT_ID,
      partner_order_id: 'PO-6f1c2d3e-0001',
      disbursement_type: 'WALLET',
      receiver_info: RECEIVER_INFO_FIXTURE,
      amount: 1_500_000,
      description: DESCRIPTION,
      partner_embed_data: '{}',
      extra_info: '{}',
      time: 1756200000000,
    },
    macInput:
      '2553|PM-001|PO-6f1c2d3e-0001|WALLET|ZW5jcnlwdGVkLXJlY2VpdmVyLWluZm8tZml4dHVyZQ==|1500000|Player One 2026-08 payout|{}|{}|1756200000000',
    mac: '6f0e3ab9ffb00eb0c68792cf9e0e9f351279995aeea4615c475280eb82a075b7',
  },
  transferFundBankAccount: {
    fields: {
      app_id: APP_ID,
      payment_id: PAYMENT_ID,
      partner_order_id: 'PO-6f1c2d3e-0002',
      disbursement_type: 'BANK',
      receiver_info: RECEIVER_INFO_FIXTURE,
      amount: 2_000,
      description: DESCRIPTION,
      partner_embed_data: '{}',
      extra_info: '{}',
      time: 1756200000001,
    },
    macInput:
      '2553|PM-001|PO-6f1c2d3e-0002|BANK|ZW5jcnlwdGVkLXJlY2VpdmVyLWluZm8tZml4dHVyZQ==|2000|Player One 2026-08 payout|{}|{}|1756200000001',
    mac: '19fd6a25d3015223c3b2897e020bb2083688440a3ae06d59befe44877edf173e',
  },
  transferFundBankCard: {
    fields: {
      app_id: APP_ID,
      payment_id: PAYMENT_ID,
      partner_order_id: 'PO-6f1c2d3e-0003',
      disbursement_type: 'CARD',
      receiver_info: RECEIVER_INFO_FIXTURE,
      amount: 10_000_000,
      description: DESCRIPTION,
      partner_embed_data: '{"bill":"6f1c2d3e"}',
      extra_info: '{}',
      time: 1756200000002,
    },
    macInput:
      '2553|PM-001|PO-6f1c2d3e-0003|CARD|ZW5jcnlwdGVkLXJlY2VpdmVyLWluZm8tZml4dHVyZQ==|10000000|Player One 2026-08 payout|{"bill":"6f1c2d3e"}|{}|1756200000002',
    mac: '5d12b0465d9527816db90934f4ee1a95fc99eaab3ca2175ac287cc45023a6979',
  },
  verifyAccountWallet: {
    fields: {
      app_id: APP_ID,
      disbursement_type: 'WALLET',
      receiver_info: RECEIVER_INFO_FIXTURE,
      amount: 1,
      time: 1756200000003,
    },
    macInput: '2553|WALLET|ZW5jcnlwdGVkLXJlY2VpdmVyLWluZm8tZml4dHVyZQ==|1|1756200000003',
    mac: '88b9accecb2d13ef4b698420f4121075cb49ac9e1dbe399573c3023a8337d51d',
  },
  queryTxn: {
    fields: { app_id: APP_ID, partner_order_id: 'PO-6f1c2d3e-0001', time: 1756200000004 },
    macInput: '2553|PO-6f1c2d3e-0001|1756200000004',
    mac: '6eba6511e23e318cbf55051e02645d9eb95cb05cc221022771aa55a377ec1bdc',
  },
  balance: {
    fields: { app_id: APP_ID, payment_id: PAYMENT_ID, time: 1756200000005 },
    macInput: '2553|PM-001|1756200000005',
    mac: 'd4a57def9bb7054db41e6f6c1555ba21d7849939ce6c42d42ea9739de50051dd',
  },
  bankCodes: {
    fields: { app_id: APP_ID, time: 1756200000006 },
    macInput: '2553|1756200000006',
    mac: '2d6e3e91be838ef0baafd51738ac0678b53af3f80818aad39ee246fbc0a4b147',
  },
  /** Legacy topup flow only (§0.3). Not a disbursement endpoint. */
  queryUser: {
    fields: { app_id: APP_ID, phone: '0901234567', time: 1756200000007 },
    macInput: '2553|0901234567|1756200000007',
    mac: 'b1fd2087f2e34e85b0e638893a928faca2762edbd2801ae44842e74ddd27eb97',
  },
} as const;

/** A 2048-bit RSA keypair generated for these tests and nothing else. */
export const TEST_RSA = {
  privateKeyPkcs8Pem: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDWTWtFuinsF/cR
Hu2UZ9LpubpIDPGn/UekiqOV0z35zGnSPVTAG+WGI+aP6z4wcuwjY95P8x8ma4wu
6H19An7iYF7QkPAZzGvocTOgiqOaq8pmZZYeYzoqtr3ZGsbXao44bhkCSVo8aTmd
012AyBU2wk9jayLJOsABUu469Iu1KH2zw3zDuYfx1ss8ZT+XjFRABgZH64tKqd0a
9oFXSQ8kb7Ryfyg3G2UyZ+Iu38bQQf06ibaNPvbCu0xsdqwLZkTiohcxkCHVfpg5
34zQ2qr6u9CQmQVP08X2jJDSch9f0vwNxj4u1HXc2/hwSkgfX0tcDrJbUf+5xYtm
g/aFAqiDAgMBAAECggEAGW8Cxjm78/s8JVoIVE6mJ3sVcqummotiz1Js68EwX880
1/DTeCFXcj4chQQkU1ewUtrtbYurLMIi1wZcrlN3f6J0Xkh1Vnp+bA3TVMBffmHZ
GaIA2QZpxtv9WCDnbHWG/4eBjFXsUbMjVWnadQhKDD+vcFssu7kvRHj1MSYI1q0J
5J1cUxXzUmIPWwzbSsxuXU9n7gWHcNCl001sAMIZVGdnofdtvo9z4KdN/fGNu8eM
oRkUc1Yc4M6shbia73Dz1e5BGgbYCiLBXG4NIhRq1hNbBzUm07odRzYTIQGf9406
llCqxtc6EXCyjP7ZqQZf7wyNkiukTdzVsWdcVi9ewQKBgQD12SZ81Ppchwx7U2jg
IAVIy0SJmr30TXNwZZzxr8ugH5q+vnrTy4cHQ/k1i1Xqb8JjGRz9LZnyDXBSX01N
Tc5I47K1WUBkfBMt+Wqg6TZYgQGKla33XBsvFIrwc+sAFZ5drtaI6++KErseWsHI
C8PkZ6VUlWAeGYOzPrnNKhgAMQKBgQDfJsygmdI+9Oo/J1EUoiBh9fstHGCOrwHw
j5cQ7pRWpX2bRyujR+2MNDxLs2ru1JMSxQN7asAyn/rSaSZzvN+P0ELRBFnwyyRW
umMYy1noaZgB1LuXoe7t3LIYuw4qo5/pXMnjOXsbjssUe4S6AhiSrsA8tFRG0WRr
AcXkL62a8wKBgE743kAjOfkW+I91D69PGeN0SCPbrUEY0Ag+29dXHRXmkRLMpS/7
pPhUgW0NwR95nvuuSX2adGUoo/gR3QcEA0uuuO1AKksdABw4jmP6BhcP+arGwgc/
cwwAkVEEK2zvhNubGhcJkvzLX4g0pyLXhKmOEbHF+gYxM/kUISMibmtBAoGAAMh8
E1w21q25XLtgl3fyMSXR2ditphKLKTL3zsFnl95A0JixWINaHBHa3FEm4OuyEHDM
kFRRlFvnX3GrBuD0z+ZlNaKURjoQSJWi32VnTV+BfxAmEGQrGH6byWZuqEumtgTz
WG7NNc2MfOfqEVUMjQc7+XqQiScW+SEqdqCMNW0CgYBmreD5MaKpO2mdPkIqWwya
S+grkColOC6IPo2R+EGGFbM80EbnGSbgKX+Opmm48ogBT3OtHzYFnOC17aduEhH3
jteibiW0w4HdbzMRhjkQh2jw1q1T+2s44UTaLrDy1buzEgbQ6CNf8Qv8FztPfqDU
PVrn67foipbc7IGaJfhwrg==
-----END PRIVATE KEY-----
`,
  publicKeySpkiPem: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1k1rRbop7Bf3ER7tlGfS
6bm6SAzxp/1HpIqjldM9+cxp0j1UwBvlhiPmj+s+MHLsI2PeT/MfJmuMLuh9fQJ+
4mBe0JDwGcxr6HEzoIqjmqvKZmWWHmM6Kra92RrG12qOOG4ZAklaPGk5ndNdgMgV
NsJPY2siyTrAAVLuOvSLtSh9s8N8w7mH8dbLPGU/l4xUQAYGR+uLSqndGvaBV0kP
JG+0cn8oNxtlMmfiLt/G0EH9Oom2jT72wrtMbHasC2ZE4qIXMZAh1X6YOd+M0Nqq
+rvQkJkFT9PF9oyQ0nIfX9L8DcY+LtR13Nv4cEpIH19LXA6yW1H/ucWLZoP2hQKo
gwIDAQAB
-----END PUBLIC KEY-----
`,
};

/**
 * Legacy topup: `sig = RSA_sign(privateKey, HMAC_SHA256(key1, input))`, the
 * hex signed as UTF-8 text, PKCS#1 v1.5 / SHA-256, base64. Deterministic, so
 * pinned. Over the `queryUser` vector above with `TEST_RSA`.
 */
export const LEGACY_SIGNATURE = {
  macHex: VECTORS.queryUser.mac,
  signatureBase64:
    'G/Tz1VkXi2YwJNaDFTDACYKoZdteZoSUsr/6az98I9K1T0pWDjPcGW84uOy6MeiaSabGsVer8BKISG0ET9i1xaYxdUq9rjN4SWfi1aHjnLzuNPJm99ZqbD77lgcvjayPFOlp234k7aoaBaVccOHoR9dwtEPXAXWC4k9vKE4PHuimsQ7DMwxa5VoLG/jqRRGxZd3lAYMqkmIzLgWlv8amZQDtKHo/4+9lokTc8tXVoPeymm5oZgOXBVMtNeViZZfH5LrZRr/mJOZ/9NBUOGSCDl8ZNEmMjikMsnFkDf57B7G2mx1XQDpBRIEvRVcXpGoQEk7rT2a924ekFHoqboWqdA==',
};
