# How a collector signs in — the three channels, verified

Read 2026-09-15/16 against the live docs. Decisions and exact endpoints only.
`[live]` = probed. The unverified list at the end is not fact.

## 1. Zalo Login (OAuth v4) — identity only

| Step | Exact call |
| --- | --- |
| Authorize | `GET https://oauth.zaloapp.com/v4/permission?app_id=&redirect_uri=&code_challenge=&state=` |
| Token | `POST https://oauth.zaloapp.com/v4/access_token`, `application/x-www-form-urlencoded`, header `secret_key: <app secret>`, body `code`, `app_id`, `grant_type=authorization_code`, `code_verifier` |
| Refresh | same URL, body `refresh_token`, `app_id`, `grant_type=refresh_token` |
| Profile | `GET https://graph.zalo.me/v2.0/me?fields=id,name,picture`, header `access_token: <token>` |

- **No `code_challenge_method` parameter exists** — four are documented and
  Zalo's own PHP SDK sends those four, so S256 is implicit. The method is
  accepted and echoed, but nothing documents it being read, so we omit it.
  `code_challenge = base64url(sha256(ASCII(verifier)))`, padding stripped;
  the SDK builds the verifier from 32 random bytes.
- The auth header is literally `access_token`, **not** `Authorization: Bearer` —
  a bearer is answered as anonymous. Token response: `access_token`,
  `refresh_token`, `expires_in`, `refresh_token_expires_in`, all strings.
- **Errors arrive as HTTP 200 with a body** `[live]`: `{"error":-14002,
  "error_name":"Invalid appId","error_description":…,"error_reason":"","ref_doc":…}`.
  Branch on `error`, never the status. Seen: `-14002` app id, `-14004` secret
  key, `-14005` invalid/expired/reused code, `-14018` grant type. Graph has a
  separate integer table (`452` session key invalid `[live]`).
- Code **10 min, single use**. Access token **1 hour**. Refresh token **30 days,
  and refreshing does not extend it** — a new one inherits the remainder, and it
  rotates. **We keep none of it:** used once, for one `/me` call, then dropped.
- **The phone number is not available.** `/me` documents `id`, `name`,
  `picture`. The only documented Zalo phone read is the Mini App
  `getPhoneNumber()` flow — a different product, needing review approval. So a
  Zalo sign-in carries no `phone`, which is why 0035 adds `collectors.zalo_id`.
- **Callback registration:** developers.zalo.me → the app → **Đăng nhập** →
  **Thêm nền tảng** → **Web** → the **callback url** field (the doc says it *is*
  `redirect_uri`) → **Lưu**. That section also holds the app secret and the
  **check App Secret Key** toggle: leave it ON, because we implement server side
  and send `secret_key`. The app must be **Đang hoạt động**. No domain
  verification is documented.

## 2. ZNS — now ZBS Template Message, and the OA is the blocker

Since **2026-01-01** ZNS is merged into **ZBS Template Message**. The API is
unchanged — `POST https://business.openapi.zalo.me/message/template`, header
`access_token`, body `phone`/`template_id`/`template_data`/`tracking_id` — but
the consoles moved to `zalo.solutions/business-message/*`. The app's three
approved permissions are the old labels for today's **Quyền gửi tin qua SĐT**
group and **are enough to send**; they exclude template management.

What still blocks, in order:

1. **A verified Official Account.** Only an `OA xác thực` can be linked to a ZBS
   account, and the send API refuses an unverified or free-plan OA by name:
   `-135` "not verified, in free subscription plan". Hence the 2026-09-16 decision.
2. **A ZBS account** (`account.zalo.solutions`) holding the money, linked to the
   app and the OA, with the OA authorized to the app id.
3. **An approved `Mẫu Xác thực` template**, 1–3 business days. The OA logo, the
   line "Mã xác thực của bạn là" and `<otp>` are fixed; only the surrounding
   text is ours (9–400 chars, ≤2 params, no links, no phone numbers, no CTA).
4. **300 VND per authentication message**, with a **15-second delivery
   timeout** — a late one is not charged, and also useless, which is why a
   second channel is required rather than nice to have. New OAs get 20,000/day.

**There is no sandbox.** Testing is `"mode": "development"` on the same request,
delivering only to **admins of the app or the OA** (`-127` otherwise) — the admin
list *is* the whitelist. `-126` "out of quota (development mode)" exists, so dev
sends are metered against something unpublished; do not plan on free.

**The OA access token expires and our handling was wrong.** Documented three
times: access token **25 hours** (`expires_in: "90000"`), refresh token **3
months**, **single-use and rotating** ("Refresh Token chỉ được sử dụng một lần"
— the old is invalidated, a new one returned), and the **old access token dies
the instant a new one is minted**. So a static `PLAYERONE_ZNS_ACCESS_TOKEN` fails
inside a day with `{"error":-124,"message":"Access token invalid"}` `[live]`, and
the rotated refresh token must be persisted or nothing recovers without a human
OA admin re-authorizing. `POST https://oauth.zaloapp.com/v4/oa/access_token`,
header `secret_key`, body `refresh_token`/`app_id`/`grant_type=refresh_token`.

The published code list is transcribed into `ZNS_ERROR_CODES` in `zns.ts`, which
is the one place it is read; several numbers in the old map meant something else.

## 3. SMS to +84

**eSMS.vn (ViHAT)** — `POST https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/`,
JSON body carrying `ApiKey` and `SecretKey` as **fields, not headers**, plus
`Phone` (`84…`), `Content`, `Brandname`, `SmsType: "2"` (CSKH/OTP), `IsUnicode`,
`Sandbox`, `RequestId`. `CodeResult`: `100` accepted, `101` authorize failed
`[live]`, `104` brandname not found/inactive, `124` duplicate `RequestId`, `146`
template not registered, `99` connection. **520 VND** per brandname CSKH message
(450 on a shared fixed number). Sign-up needs a **business registration licence**
(original or notarised, within 6 months), a **công văn** on ViHAT's template
signed by the legal representative, the **company seal** and the **tax code**; an
individual cannot hold a brandname. Approval **5–10 business days** (eSMS's own
pages disagree) and the template is registered separately. `Sandbox: "1"` is
free, exercises the whole request path, and reaches no handset.

**Twilio** — **not a Vietnam channel.** $0.2852/segment (~7,400 VND, 14–25×);
alphanumeric sender ID mandatory *and* pre-registered, **5 weeks** provisioning;
unregistered sender IDs fully blocked in VN since **2025-08-25**; templates
pre-registered, brand name in the body, no URLs or phone numbers in it; no VN
long or short codes, no two-way, no numbers to buy; DLRs SMSC-ack only.

## Recommendation

- **This week, for the demo:** Zalo Login for sign-in — only a callback URL in
  the app's settings, live today — plus ZNS `"mode": "development"` for code
  delivery to admin handsets, **if the OA is already verified**. If it is not,
  nothing delivers a real code this week, and Twilio against active sender-ID
  blocking must not be on the critical path.
- **Pilot:** ZNS `Mẫu Xác thực` at 300 VND, with eSMS brandname SMS (`SmsType 2`,
  520 VND) for the numbers ZNS cannot reach — no Zalo account (`-118`) or the
  channel refused (`-139`/`-141`). Start the eSMS paperwork now: 5–10 days.

## What could not be verified

**Zalo Login:** whether `localhost` or a custom scheme is an acceptable callback
URL, and exact vs prefix matching; whether domain verification exists; the Mini
App phone-exchange URL; the Social API error table beyond `452`.
**ZNS:** whether development sends are charged, and any cap; the ZBS top-up
minimum; whether the 22:00–06:00 blackout still applies (`-133` is gone from the
table); whether a personal OA is banned outright or only refused by `-135`; the
template SLA (Zalo's pages say 1–2 *and* 2–3 days); whether an OA refresh
rotation resets the 3 months or inherits the remainder.
**SMS:** the eSMS brandname monthly fee and trial allowance; the MIC sender-ID
registration at `tendinhdanh.ais.gov.vn`, probably a separate mandatory step
beside the provider's own; Twilio's VN throughput and alphanumeric price.

**Nothing here was tested against a live Zalo app, a verified OA or a real
handset.** The fixture tests prove the request shapes above; they cannot prove
Zalo agrees.
