# Operator demonstration assets

Source: `docs/sample_data/New_Sample_Data_Ego/ego_AZER76400FE_19700101_003357/ego_AZER76400FE_19700101_003357_camera_right_part0001.mp4` in the main repository.

`review.mp4` is an 18-second silent web excerpt, starting at source time 00:12, showing drink preparation. Export: ffmpeg, scale 960:-2, libx264 CRF 27, fast preset, faststart. `review-poster.webp` is its first frame. The original is unchanged.

`vng.png`, `paxini.png`, and `zalopay.png` are the exact user-supplied assets. CSS contains their whitespace without redrawing their marks.

`demo-qr.svg` encodes only `PLAYERONE DEMO ONLY - No payment - Example settlement DEMO-0024`. It is not a payment request or a production wallet flow. The review and receipt use explicitly illustrative data, perform no network mutation, and transfer no money.

Design references inspected through Mobbin MCP:
- Mews: https://mobbin.com/sites/sections/da3e6ee5-cf51-4ccd-b8e2-6d93b7090520
- TIDAL phone composition: https://mobbin.com/sites/sections/2379a9f9-dcd9-48c8-98da-e362b4926459

Motion is implemented in React/CSS; no synthetic footage was generated.
