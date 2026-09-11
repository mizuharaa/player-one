# Restore the native phone frame

The owner rejected the Spline phone screenshot and requested an immediate revert. Restore the prior CSS phone frame and naturally sized demo content. Keep the white text-shuffle intro. Replace block-character status placeholders with cellular bars, a 4G label, Wi-Fi and battery SVG icons.

Removed the Spline component, CSS and package dependencies. Restored the response policy from the accepted pre-Spline snapshot, removing external Spline hosts and WASM evaluation permission. No changes to authentication, backend records or payment behavior.

Focused browser checks passed at 320, 375 and 1440px: no Spline requests/canvas, no horizontal or inner scrolling overflow, intact 6/8px frame, and working task/preparation flow. Status-icon clearance from the island measured 10.45/9.95/35.45px. Mobile screenshot visually inspected. Typecheck, production build and response-policy test passed.

Snapshot `scratchpad/railway-release-qHVlgr`: 314 files, 19,274,529 bytes. Deployment `8210d2de-b3ab-4a77-9b73-a64d748304c6` is SUCCESS and publicly verified at320/375/1440px. No Spline requests/canvas or page errors; borders, status icons, no internal overflow and demo interactions passed. Health ready:true and all hashes verified after SUCCESS. No Git commit or push.
