# PlayerOne native collector refinement — build after web handoff

Owner: design direction. Native correctness is assigned separately to `functional_fixes`; this document covers UI/UX only. Claude independently measures the implementation. Do not overwrite correctness changes or run concurrent edits of the same native files.

## World and task

The native app is the working companion to the landing's human story: a clear task ledger used on ordinary Android phones, often with interrupted connectivity. Keep the established lavender/ink identity, native text and familiar controls. Ambient cinematic backgrounds, cursor lenses and GSAP belong to the public website, not to task preparation or money.

The screenshots benchmark coverage and discoverability; their orange palette, yuan wallet and verification design are not reference identity. Preserve existing navigation routes and community access. Make the task hall and My Tasks easy to reach from Home instead of adding more cramped bottom destinations.

## Composition

| Surface | What it says and how it is arranged | Evidence | Never imply |
| --- | --- | --- | --- |
| Home | Available work first, one obvious path to My Tasks, device/preparation status nearby. Secondary app destinations in a plain list below. | Existing tasks, claims, bindings. | A guessed available task or successful device connection. |
| Task hall | Task title and scenario, prominent server rate with full per-reviewed-minute basis, available/claimed state, then progress/capacity. One task per readable row. Search by title/scenario and available-only filter if grounded in current fields. | Server task fields preserved by correctness agent. | Task target is permitted session duration; capacity equals approved minutes. |
| Task detail/preparation | One clear hierarchy: task and conditions; scenario/device; two explicit declarations; one preparation action; subsequent physical-camera instruction. Let labels wrap without collisions. | Existing task contract and session fields. | App starts recording; missing instructions are approved guidance. |
| My Tasks | Claimed tasks identified by name, clear Prepare session action, existing recording history destination. | Claims and episode state kept distinct. | A multi-episode task has an invented aggregate paid/completed status. |
| Devices | Real bound device ID and status, real manual binding path, recoverable errors; no simulated control in production. | Correctness agent transport/API fixes. | Request/shipping or Bluetooth success without implementation. |
| Income | Approved/effective minutes and server amount with estimate/finality label grouped together. History remains legible at text enlargement. | Server financial strings and settlement status. | Withdrawable balance, instant withdrawal, UI-calculated payment. |

## Responsive craft

Use existing shared native tokens. Screen/list containers reserve real content space above the floating tab bar and system bottom inset; final actions remain reachable at short height and with keyboard open. Avoid fixed vertical centering that pushes buttons below the visible area. Let form labels and explanatory text wrap. Do not truncate task names, device IDs needed for identification, financial amounts or important refusal reasons.

Keep controls at least 48dp touch regions on native Android. At 320/360/390/412dp, avoid adding a sixth tab; compact visible labels may have complete accessibility labels. Support 100/130/200% text scaling, Vietnamese stacked accents and Chinese. Do not claim React Native Web proves Android safe-area or font behavior.

Use small native press-state feedback. Existing mascot motion may remain outside review/payment context if it obeys reduced animation and background/offscreen pauses. No persistent animation on money or factual completion state.

## Scope and delivery

After the functional agent finishes, Astra may refine native `ui.tsx`, `shell/TabBar.tsx`, Home/TaskHall/TaskDetail/SessionCreate/MyTasks/Devices/Income layout and native locale copy required for presentation. No backend, financial arithmetic, document verification, hardware transport invention, route removal or unrelated community redesign. Preserve the corrected mutation locks/errors and API truth. Hand exact changed-file list and screenshots-needed to Claude; no self-awarded acceptance.

Separate dependency: a shipping collector webapp is not currently established. `apps/collector/web` is a labelled review harness. Mobile responsive `/discover` is production frontend work; native app readiness and its preview are separate deliverables.
