**PlayerOne — immersive media Mobbin research · 2026-09-10**  
Target: `docs/design/immersive-media-mobbin-2026-09-10.md`

Restore edge-to-edge film, use a restrained text overlay, introduce a deliberate lime/black geometric section, and organize the gallery through consistent grouping and spacing. Preserve the supplied film content and short logo.

**Method and exact queries**

Actual session discovery exposed `mcp__mobbin__search_sections`, `mcp__mobbin__search_screens`, and `mcp__mobbin__search_flows`. Authentication succeeded.

Executed **six queries**, all through `mcp__mobbin__search_sections`, with `image_format: "jpg"`, `limit: 3`, and default page 1. Inspected all **18 returned inline previews** visually. No substitute search or browser automation was used. The read-only research subprocess did not edit files; the coordinating agent saved this report afterward. No product changes were made by the research lane.

Shared `task_intent`: “Find visual references for PlayerOne's immersive film hero, geometric product section, and organized editorial gallery.”

1. `Full-width cinematic video hero with a translucent glass text overlay`
2. `Editorial full-bleed image gallery with grouped photographs and consistent spacing`
3. `Product section with vibrant lime green and black geometric shapes`
4. `Flim film still gallery with image browsing`
5. `Fauna Robotics hero presenting a robot in a cinematic film`
6. `Hero with a translucent frosted glass text panel over a full-bleed photograph`

**Eight selected references — visually observed**

| Canonical Mobbin reference | Preview | Observed layout and relevance |
|---|---|---|
| [Dropbox Paper](https://mobbin.com/sites/sections/10e69996-df8c-4a86-bfb9-03693d9323f3) | [Image](https://mobbin.com/api/mcp/short/yGwnNBu5) | Street imagery spans the full content width beneath a shallow white navigation bar. A thin circular play control sits centrally. Strong reference for giving film uninterrupted horizontal space. |
| [Robot.com](https://mobbin.com/sites/sections/17dab1a2-5558-42bb-a1fb-010259caa5ae) | [Image](https://mobbin.com/api/mcp/short/HlXZaNCS) | Nearly edge-to-edge robot imagery with minimal outer margin. Small white text crosses the middle; a dark watch pill sits right. A translucent-looking navigation strip occupies the top center. Useful overlay restraint and subject placement. |
| [Aurora](https://mobbin.com/sites/sections/43de95a4-138b-4228-bcd0-4b4a871f4a89) | [Image](https://mobbin.com/api/mcp/short/hG8oaU0G) | Truck imagery fills the section. Large pale text sits upper-left over open sky; the vehicle occupies the lower/right area. Demonstrates reserving negative space within the crop for copy. |
| [Fauna Robotics — origin story](https://mobbin.com/sites/sections/7782fa8e-97a6-4099-a4e4-5e8180d3842f) | [Image](https://mobbin.com/api/mcp/short/TgCMNpF7) | Centered heading above a wide rounded workshop image. Film-title graphics occupy the left; the robot remains visible right; a small story play button sits between. Useful subject/title separation. Its beige surround and inset container are not the proposed PlayerOne treatment. |
| [Flim](https://mobbin.com/sites/sections/a187b58e-5921-4486-908d-b87c0d55469a) | [Image](https://mobbin.com/api/mcp/short/eGhIQXLI) | A centered introduction sits above an embedded browsing-interface image. Search/filter controls precede a tightly packed mosaic of differently sized film stills. Useful hierarchy between browsing controls and imagery; this capture is a marketing section showing the interface. |
| [Aino Agency](https://mobbin.com/sites/sections/6e82f83c-f6fb-410d-ad9c-cdd19a453bb8) | [Image](https://mobbin.com/api/mcp/short/ihAD9i4M) | Three aligned portrait project images share equal dimensions, narrow consistent gutters, and small captions below. Considerable space remains right. Borrow the repeated geometry and caption alignment. |
| [Graza](https://mobbin.com/sites/sections/674d9fc9-7e05-45fe-ac3c-c8f6d793c78f) | [Image](https://mobbin.com/api/mcp/short/5I6p3Pd8) | A saturated yellow-lime section pairs centered dark copy on the left with a large product photograph on the right. Strong color-field contrast and clear two-part composition; not an exact lime/black geometric match. |
| [MANA Yerba Maté](https://mobbin.com/sites/sections/e1506c53-1a25-422e-917b-6e745715027a) | [Image](https://mobbin.com/api/mcp/short/Wus1cjDY) | Six product tiles form a flush three-column, two-row grid with thin dark dividers. Each tile uses a solid contrasting field, top-aligned title, and prominent product. Useful structural geometry, not a palette to copy wholesale. |

**Frontend direction — proposals, not observed behavior**

- **Film:** Remove the narrow beige card wrapper. Use a viewport-width media section with square edges. Start around 75–90svh on desktop; review the actual film before fixing height. Set crop focal points per shot so the subject and embedded graphics survive.
- **Glass overlay:** Use one compact panel, approximately 320–420px wide, inset 32–48px from a safe edge, with 20–24px padding. Keep copy short. Start with a dark translucent fill, subtle border, and optional modest blur; assess readability across bright and dark frames.
- **Lime/black section:** Use a full-width lime field and black typography, a disciplined 5/7 text-to-visual split, and one dominant circle or rectangle. Allow 64–96px vertical padding. Preserve PlayerOne’s short logo and existing content; reference composition without copying another brand.
- **Gallery:** Group supplied media by actual project or chapter. Use aligned captions, 16–24px desktop gutters, and 48–64px between groups. Alternate one full-width lead image with a coherent two- or three-column supporting row.
- **Mobile:** Compose independently: edge-to-edge media, 16–20px text insets, one gallery column or deliberate paired thumbnails. Move overlay copy below the film when it obscures the subject. Use a portrait crop only when the supplied footage supports it; otherwise retain the film’s aspect ratio.
- **Idle motion:** Proposal only: at most a slow 2–4px translation on one decorative shape, with no rotation or arbitrary swinging. Keep gallery items stable and disable decorative motion for reduced-motion preferences.

**Evidence limits**

Both requested brands, Flim and Fauna Robotics, appeared. No inspected result clearly establishes the requested frosted-glass **text panel** or an exact lime/black geometric product composition. Still previews cannot verify playback, autoplay, looping, timing, parallax, hover, working controls, or live backdrop blur. Mobile behavior was not inspected. Preview URLs expire after 30 days according to the tool documentation.
