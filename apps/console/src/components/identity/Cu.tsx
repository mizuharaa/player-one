/**
 * Cú, kept as a name and nothing else.
 *
 * The owl is gone — Trúc the panda replaces her, and `Panda.tsx` holds the
 * artwork. This file survives only so that an import that has not been switched
 * over yet still resolves: the collector app and any console route the revamp
 * has not reached both say `import { Cu } from '.../identity/Cu.tsx'`, and a
 * mascot swap is not a reason for a screen that was working to stop compiling.
 *
 * Everything here is an alias. There is no second drawing, no second set of
 * clock states and no second palette; deleting this file once the last import
 * has moved is the whole of the cleanup.
 *
 * @deprecated import `Panda` from `./Panda.tsx`.
 */
export {
  Panda as Cu,
  MASCOT_LABEL as CU_LABEL,
  mascotStateAt as cuStateAt,
  type MascotState as CuState,
} from './Panda.tsx';
