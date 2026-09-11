
## Latest owner correction: fast intro and stable scrolling

The 3.8-second orbit choreography is rejected. Replace it with an approximately
1.6-second controlled modular scramble: compact mark, direct entry to letter
slots, two small local bar/curve reconfigurations, exact lock, color and dock.
No orbit, oscillation, wide scatter or extended intermediate composition.
The same 32 SVG paths and normal-reload behavior remain.

The reported disappearing heading and gallery jitter are release blockers.
Content must remain visible throughout re-entry, refresh and idle wake; repeated
scroll callbacks must not reset visible headings to opacity zero. Gallery
figures must stay geometrically stable during scroll, with hover treatment
confined to their images. Remove global animation ownership conflicts and
repeated ScrollTrigger disable/enable resets. Keep native scrolling and bounded
GSAP motion; validate wheel down/up, direction reversal, idle wake, anchors,
resize, locales and reduced motion before deploying. This direction supersedes
both earlier slow kinetic choreography and stepped-scramble prescriptions.

Reproduction: after the introduction heading had settled at opacity 1, an idle
wait followed by a 4px scroll reset it to opacity 0 / y24 for three sampled frames.
The same action reset a gallery figure to scale 0.975 / y30. ScrollTrigger's global
idle disable/wake enable cycle replayed entrance callbacks, which killed the
current tween and started again from hidden or shifted states. The replacement
uses bounded GSAP animations with one-shot IntersectionObserver entry detection;
no global plugin sleep/wake cycle and no whole-photo scroll transforms.


An early hover-rule concern was ruled out after inspecting the full cascade:
the later inherit/light overrides already protect the dark-section headings.
No hover CSS change is required. Independent QA checks the rendered result.
