# PlayerOne continuous logo choreography

This supersedes the stepped scramble. Scope: only the public brand intro and its development controls; the approved dashboard, identity geometry, colors and landing composition remain the reference.

The visual world is a small mechanical type workshop: the twin-lens mark releases the actual stems, bowls and bars already stacked within it. Two opposing groups exchange places around a shared centre. Their spread narrows, releases into an offset arrangement, then sweeps toward a line where stems begin to stand upright and curves meet them. The final letters are a discovery after the intermediate choreography.

| Moment | Composition / motion | Continuity evidence |
| --- | --- | --- |
| 0–0.35 s | Compact black twin-lens silhouette, slight internal anticipation | Same 32 SVG pieces; no text or raster substitute |
| 0.25–0.75 s | Uneven unfolding, paired stems and curved fragments detach with overlapping starts | Each measured pivot stays fixed in its own SVG coordinates |
| 0.60–1.35 s | Counter-rotating families cross into a wide, airy formation | Major lens circles cross opposite ways; arcs have smooth tangents |
| 1.20–1.80 s | The arrangement compresses inward, then releases off-centre | Radius changes through translation, not uniform shrinking of every fragment |
| 1.65–2.25 s | Asymmetric arrangement begins a shared directional sweep | Families overlap in time and keep their own lanes and phase offsets |
| 2.10–3.15 s | Stems recognize destinations first, then bowls and connectors | Partial letters visible near 70% of runtime, most of wordmark near 85% |
| 3.10–3.85 s | Small mechanical corrections, exact black lock, color and navigation handoff | Natural geometry reaches x/y/rotation0, scale1; same pieces become colored |

One master GSAP timeline owns every transform. Use one continuous trajectory evaluator per piece, with explicit deterministic family/phase/waypoint metadata. Curvature and continuous tangents matter more than waypoint count. Never overlap two competing tweens on the same piece's x/y merely to appear smooth. Remove steps easing and position resets. Family start offsets and within-family offsets create the overlapping waves.

Five suggested families: clockwise bowls, counterclockwise bowls, horizontal paired bars, vertical compression stems, trailing connectors/lens pieces. Their paths are coordinated; do not turn every fragment into an independent orbiting dot. Keep 2–3 transient formations legible without freezing. Make at least two major opposing exchanges visible at quarter speed.

Preserve getBBox-driven compact positions and the existing measured svgOrigin solution. The current view-box/zero CSS origin prevents a double-pivot bug; a generic fill-box rule must not reintroduce it. Resize must use existing safe cleanup/fail-open behavior. The normal sequence should end in3.2–4.0seconds including color/handoff; the safety timeout must allow startup plus the longer authored timeline.

Retain ordinary reload replay, Skip, reduced-motion immediate reveal, page content beneath the overlay, focus/scroll restoration and route cleanup. No looping intro, particles, blur, glow, 3D, path replacement or unrelated wordmark fade. Console routes remain animation-free.

Development-only controls: play/pause, scrubber, current time, normal/quarter speed, stablepiece IDs, family-colored outlines and family isolation. Production must ignore debug query flags and render no debug controls. Color/outlinesare diagnostics, not brand decoration.

Separate QA must inspect actual source identity and normal/quarter-speed samples at375,430,768,1024,1440,1920. Check partial recognition, crossings and compression/release, bounded trajectories, no waypoint discontinuity, final geometry, exact handoff, two normal reloads, reducedmotion/Skip/resize cleanup and absence of debug UI in production. Do not describe intentional stepping as performance chop or claim physical-device 60 fps from headless captures. Root directs composition; builder implements; independent reviewer accepts.

## Implementation and measured checkpoints

Astra implemented one GSAP clock with time-aware cubic Hermite trajectories in
logoChoreography.ts. Each family has explicit geometric membership; the two
lens discs have authored opposing crossing anchors. Geometry remains 32 unchanged
paths. All fragments reach identity at 3.2 s; color and docking finish at 3.8 s.
The fail-open budget is 6.5 s including chunk loading. Debug labels are separate
siblings, keeping getBBox pivots unaffected.

The independent first pass checked 320 interior waypoint joins and found
continuous positions/velocities, exact final transforms and no invalid samples.
Rendered sampling at 77 times across each of 375/430/768/1024/1440/1920 found
zero off-viewport pieces. Docking delta was below 0.041 px. Ordinary reloads,
quarter-speed timing, pause, family isolation, Skip, Escape, resize and changing
reduced-motion preference passed. Production build passed; final debug exclusion,
route cleanup and cloud release evidence are tracked in the independent QA report.
These browser/numerical checks do not certify physical-device 60 fps.
