# Collector v3 implementation decisions

The owner work order and its named Wise/Klarna PNG exports set the direction.
CLAUDE.md retains the product and data constraints. This file records decisions,
not completion claims.

- Paper content, night shell; gradients only on splash, Income and About.
  The Home reference supplies layout, not an additional gradient surface.
- Existing `ui.tsx` exports remain the shared kit. `theme.collector` carries the
  v3 palette, typography and layout tokens without changing console tokens.
  `Button` adds `affirmative`, `destructive` and `busy`; `NavRow` adds `subtitle`
  and `icon`; `Note` adds `tone`, `onRetry` and `busy`. Labels remain translated
  by callers; Note's Retry reuses `common.retry`. Rows still stack at small
  widths or enlarged font scale. Blocking errors never auto-dismiss.
- Green and amber retain their specified fills. Small text uses darker shades
  checked against paper, white and the respective semantic tint. Accept uses
  night text on green; primary uses night text on sun; destructive uses white
  text on red.
- Be Vietnam Pro full TTFs are bundled at weights 400–800 through expo-font.
- Motion follows a proven static vertical slice and Fable's native smoke.
- Local visual proof lives inside this worktree under `artifacts/mobile-v3/`,
  honoring the owner's write boundary over the work order's external path.
