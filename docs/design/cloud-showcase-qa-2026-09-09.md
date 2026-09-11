# Independent cloud showcase acceptance — 9 September 2026

**Passed the bounded live deployment checks** at `https://playerone-web-production.up.railway.app` on deployment `eaa76de7-0706-4fee-b20a-6ea5e0f5d2b7`, after the deployment owner signaled ready. Actual HTTPS requests and real login were used; no browser route fixtures, mocked API responses or local-demo financial records were used.

The independent reviewer edited no application code, deployed nothing, started no server, and submitted no review verdict or financial mutation. Login credentials were read directly from the private provisioning file and entered into the visible form; passwords and session token values were neither printed nor recorded. Browser contexts used the existing serial `withBrowser`/`newPage` helper, reduced motion by default, with one short natural-motion opening check. The browser was signed out and closed on completion.

## Public pages and media

- `/discover`, `/login`, `/privacy` at **375×900 and 1440×900**: all six rendered with **0 horizontal overflow, 0 broken loaded images and 0 page errors**. Screenshots were retained; desktop landing, mobile login and actual dashboard were visually inspected.
- Each reduced-motion viewport requested **0 movies** during its public-page walkthrough.
- Accept and Decline both saved their respective preference at both widths. Reload hid the banner; settings reopened it and allowed the choice to change.
- Real natural-speed opening completed, exposed a visible 32-path orange/blue navigation wordmark, and played the opening movie (`readyState=4`, time 3.899 seconds, no media error).
- Explicit review-video Play worked under reduced motion (`readyState=4`, time 1.256619 seconds, no error); scrolling it offscreen paused it.
- Three real byte-range requests returned **206**, `Content-Type: video/mp4`, `Accept-Ranges: bytes`, and exactly **2048 bytes** for requested `bytes=0-2047`:

| Asset | Returned Content-Range |
| --- | --- |
| opening.mp4 | bytes 0-2047/2205990 |
| review.mp4 | bytes 0-2047/1939356 |
| pov-portrait.mp4 | bytes 0-2047/2415622 |

## Actual HTTPS session and dashboard

- Administrator credentials submitted through the real login form: `POST /api/session` **200**, navigation to `/`, `/whoami` **200**, `/api/review/shift` and `/api/review/recent` **200**.
- Both `po_machine` and `po_operator` were **Secure, HttpOnly, SameSite=Strict session cookies**, scoped to the Railway hostname with path `/`. No token values were captured.
- The fresh cloud database correctly returned and displayed **0 reviewed, 0 waiting, 0:00 payable, ₫0 settled**, and **no recent verdicts**. Approval/pace remained unavailable rather than fabricated percentages. API values agreed: decided, approved, payable seconds, settled amount, both queue depths and needs-human were zero; median/average times were null.
- Same-origin `DELETE /api/session` returned **200**, removed both cookies, and made `/whoami` return **401**. Protected `/episodes` redirected to `/login`. Submitting the visible form again succeeded with **200**, restored secure cookies and displayed the same real empty dashboard. Final signout completed.
- No unexpected HTTP failure was observed in the authenticated walkthrough. The 401s above were intentional logout checks. The broader local operational-navigation and role checks remain documented separately; this cloud pass did not submit business mutations.

## Live forwarding-boundary correlation

The independent reviewer sent two actual requests, both **404**, to uniquely named API paths:

- `/api/qa-ip-1789001873447-baseline`, without supplied forwarding headers.
- `/api/qa-ip-1789001873447-forged`, supplying `Forwarded: for=192.0.2.201;proto=http`, `X-Forwarded-For: 192.0.2.202, 192.0.2.203`, and `X-Real-IP: 198.51.100.204`.

The deployment owner retrieved the **child API's Railway incoming-request logs** and returned sanitized correlation evidence: exactly two matching requests; **sameAddress=true, spoofAccepted=false, loopback=false**. Both reached the child under the same actual non-loopback client identity, and none of the supplied spoof addresses was accepted. The actual client address was redacted. The request execution is independently measured here; access to and extraction of the private server logs was performed by the deployment owner. This establishes the tested Railway edge rewrite plus narrow loopback-trust boundary for this deployment, not a guarantee for an arbitrary hosting proxy.

## Evidence and limits

`scratchpad/qa/cloud-showcase/results.json` contains measured public layouts, range responses, consent, playback, cookie metadata, real shift data and logout/relogin statuses, without credentials or cookie values. Screenshots: `discover-375.png`, `discover-1440.png`, `login-375.png`, `login-1440.png`, `privacy-375.png`, `privacy-1440.png`, `dashboard-1440.png` in the same directory.

This replaces the earlier not-deployed/not-live-auth limitations for the tested Railway origin. The intentionally empty cloud installation does not prove collector ingestion, reviewer media authorization against real recordings, payouts or external integrations. No raw corpus or local demonstration financial activity was uploaded by this reviewer. A subsequent deployment/configuration change needs a bounded health/session smoke check; it does not retroactively change the deployment ID tested above.

Deployment follow-up reported by the owner: health-configuration redeploy `fbd33f96-abc3-4ff1-ae1e-998471a0e5b2` failed before build; the tested `eaa76de7-0706-4fee-b20a-6ea5e0f5d2b7` remained the healthy live deployment. No successful replacement or postrestart acceptance is claimed. The owner subsequently requested another console redesign, whose independent acceptance will be a separate pass after its implementation freezes.
