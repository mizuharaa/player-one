/**
 * Every user-facing string in the back office, in every language it has to be
 * read in.
 *
 * LOC-02: PaXini's reviewers work in Chinese through phase 1, and they are the
 * people the review screen is for. English is the default because VNG builds
 * and operates it. Vietnamese was absent until the payout console: LOC-04 put
 * Vietnamese on what reaches the *collector* — the reject reason codes, which
 * are catalogue rows in `review_reason_codes` — and nobody had asked for a
 * Vietnamese reviewer screen. The payout brief changed that: every risk flag
 * must render as one plain sentence "in Vietnamese and English", and the
 * finance operators who pay collectors are VNG staff in Ho Chi Minh City. A
 * third column for some keys and not others would be a catalogue with holes,
 * so `vi` holds every key, and the completeness test covers it like `zh`.
 *
 * The catalogue is a flat map of dotted keys rather than nested objects, and
 * every language holds the same keys, which is what `missingKeys` below is
 * for: a missing string should fail a test, not surface as an English word in
 * the middle of a Chinese or Vietnamese sentence at an upload centre.
 *
 * The `risk.signal.*` entries are templates rather than sentences: `{name}`
 * is filled from a flag's evidence by `render` in the risk engine
 * (`risk/sentences.ts`) and by its twin in the console (`risk/sentences.ts`
 * there). Single braces on purpose — i18next interpolates `{{ }}` and leaves
 * these alone.
 *
 * The same object is rendered into the page and handed to the client module, so
 * there is one catalogue and not a server one and a browser one that drift.
 */

export const LOCALES = ['en', 'zh', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The refusals the review screen offers a park for, rather than "take the next
 * one" (0017).
 *
 * It lives HERE, in the catalogue module, for two reasons. It is the one
 * module the console imports from this package — `src/index.ts` pulls in
 * fastify, drizzle and the S3 client, none of which belong in a browser
 * bundle — and every name in it is a name that needs a `bo.refused.*`
 * sentence, which is what this file holds. A test in backoffice.test.ts walks
 * it and fails on a name with no sentence in any of the three locales.
 *
 * What they have in common: after one of these the review row is still
 * `pending` and still eligible, so the lease runs out, the queue hands the
 * episode to the next reviewer and they meet the same refusal. Nothing in the
 * lane ends that loop except parking the episode.
 *
 * `session_claim_missing` is the counter's own name (counter.ts) and reaches
 * the review screen from `POST /api/review/verdict`; the rest are that route's
 * own (`REVIEW_API_REFUSALS` in review.ts).
 *
 * `review_duration_implausible` is `feat/upload-restriction`'s billable-duration
 * guard. It strands an episode exactly the same way, so it is in this set. It
 * renders as its own sentence either way — the classification is by the name in
 * the body, not by this list — but without the entry the reviewer is shown no
 * way out of it. Added when the two branches were merged, on the note the
 * console branch left here.
 */
export const REVIEW_HOLDABLE_REFUSALS: ReadonlySet<string> = new Set([
  'session_claim_missing',
  'review_no_task',
  'review_no_longer_reviewable',
  'review_billed_while_disputed',
  'review_duration_implausible',
]);

const en = {
  'app.name': 'PlayerOne',
  'app.review': 'Review',
  'app.signOut': 'Sign out',
  'app.language': 'Language',

  'login.title': 'Sign in to review',
  /* The operator imports cards; only the reviewer reviews. */
  'login.titleOperator': 'Sign in to the upload centre',
  /* Group headings, not field names — the legends are drawn now, and a
     legend that repeats its first field's label makes a screen reader say
     "Machine identifier group, Machine identifier". */
  'login.groupMachine': 'Machine',
  /*
   * Field labels inside a group, and they are short because the group already
   * said the noun. "Machine" above "Machine identifier" is the word twice, four
   * pixels apart, in two sizes — which is what made this form read as broken.
   */
  'login.fieldIdentifier': 'Identifier',
  'login.fieldReference': 'Reference',
  'login.fieldSecret': 'Secret',
  /* Trúc's launcher and the placeholder behind it. No model is wired up. */
  'login.trucOpen': 'Ask Trúc',
  'login.trucTitle': 'Trúc',
  'login.trucBody':
    'Trúc cannot answer yet. When he can, this is where you will ask him what a verdict means, why a card was refused, or where a payment went.',
  'login.trucSoon': 'Not connected yet',
  'login.trucClose': 'Close',
  'login.groupOperator': 'Operator',
  'login.groupReviewer': 'Reviewer',
  'login.intro':
    'Two credentials, as everywhere else in this service: the machine proves where, the operator proves who.',
  'login.machine': 'Machine identifier',
  'login.machineSecret': 'Machine secret',
  'login.operator': 'Operator reference',
  'login.operatorSecret': 'Operator secret',
  'login.role': 'Sign in as',
  'login.roleCounter': 'Upload centre',
  'login.roleReviewer': 'Reviewer',
  'login.reviewer': 'Reviewer reference',
  'login.reviewerSecret': 'Reviewer secret',
  'login.reviewerIntro':
    'One credential. A reviewer works remotely and not at a counter, so there is no machine to prove — and the session reaches the review lane and nothing else.',
  'login.submit': 'Sign in',
  'login.failed': 'Those credentials were not accepted.',
  'login.mismatch': 'The machine and the operator belong to different upload centres.',

  'queue.depth': 'In queue',
  'queue.average': 'Average per verdict',
  'queue.empty.title': 'Nothing to review',
  'queue.empty.body':
    'Every episode that has an owner and passed its integrity check has been decided. New footage appears here as it is imported.',
  'queue.refresh': 'Check again',

  'meta.episode': 'Episode',
  'meta.folder': 'Card folder',
  'meta.task': 'Task',
  'meta.rate': 'Per minute',
  'meta.collector': 'Collector',
  'meta.scenario': 'Scenario',
  'meta.device': 'Device',
  'meta.firmware': 'Firmware',
  'meta.measured': 'Measured',
  'meta.claimed': 'Device claim',
  'meta.discrepancy': 'Difference',
  'meta.recorded': 'Recorded',
  'meta.timing': 'Timing',
  'meta.attribution': 'Attribution',
  'meta.flags': 'Flags',
  'meta.declared': 'Declared by collector',
  'meta.othersInFrame': 'Others in frame',
  'meta.sensitive': 'Sensitive information',
  'meta.yes': 'Yes',
  'meta.no': 'No',
  'meta.none': 'None',
  /**
   * One sentence per ingest discrepancy, for every code the contract can emit.
   *
   * The reviewer used to be shown the code itself — `PART-MISSING-INTERIOR` —
   * with the engine's English `detail` under it, in every locale. The code is
   * the stable identifier and stays on screen, but it is not a description,
   * and a reviewer in Shenzhen reading an English machine name is being asked
   * to do a job in a language nobody promised them. LOC-02.
   *
   * Keyed by the literal code, so `DISCREPANCY_CODES` and this block are held
   * in step by a test in console.test.ts rather than by anyone remembering.
   *
   * ponytail: the per-episode `detail` the engine writes underneath — stream
   * names, measured numbers — is still English. It is evidence rather than
   * prose. Templating it the way `risk.signal.*` templates its sentences is
   * the upgrade path, worth taking when a reviewer asks for it.
   */
  'bo.flag.DUR-MANIFEST-INFLATED': 'The device manifest claims a longer recording than the media actually holds.',
  'bo.flag.FRAMECOUNT-MISMATCH': 'The frame count the manifest declares does not match the frames measured in the media.',
  'bo.flag.AUDIO-STATS-ZERO': 'The manifest reports no audio frames although an audio stream is present.',
  'bo.flag.MANIFEST-FILES-UNRESOLVED': 'The manifest lists files that are not on the card.',
  'bo.flag.SESSION-UNCLOSED': 'The device never wrote an end time; the recording itself is still fine.',
  'bo.flag.STATS-ZEROED': 'The manifest’s statistics block is all zero although media is present.',
  'bo.flag.PTS-EMPTY': 'The timestamp sidecar is on the card but holds no timestamps.',
  'bo.flag.PTS-ABSENT': 'No timestamp sidecar travelled with this stream.',
  'bo.flag.PTS-TRUNCATED': 'The timestamp sidecar stops mid-line; the final partial row was dropped.',
  'bo.flag.STATS-STALE': 'The statistics block looks copied from an earlier session: it disagrees with what was measured.',
  'bo.flag.STREAM-CLOCK-FAULT': 'The stream’s own span cannot be explained by the number of samples it carries.',
  'bo.flag.DEVICE-CLOCK-UNSET': 'The device clock was never set, so this recording carries no usable date. The footage is fine and still pays; it cannot be matched to a collection session by time, so confirm which session it belongs to.',
  'bo.flag.PART-MISSING-TAIL': 'Fewer parts are on the card than the manifest declares; the recording stops early.',
  'bo.flag.TIMING-ESTIMATED': 'The timing was estimated rather than read exactly, so the payable time is less certain.',
  'bo.flag.STREAM-SKEW-HIGH': 'The streams start too far apart from one another.',
  'bo.flag.PART-GAP': 'There is a gap in time between two consecutive parts of one stream.',
  'bo.flag.PART-ORDER-CONFLICT': 'The part numbers contradict the order the timestamps put the parts in.',
  'bo.flag.FIRMWARE-UNKNOWN': 'The device firmware is outside the set this platform has been tested against.',
  'bo.flag.CAMERA-NAMING-CONFLICT': 'The camera names on the card disagree with what the manifest describes.',
  'bo.flag.IMU-RATE-ANOMALY': 'The measured IMU sample rate differs from the rate the manifest declares.',
  'bo.flag.CALIB-MISSING': 'Calibration did not travel with the episode.',
  'bo.flag.MEDIA-MISSING': 'A stream the session declares has no media on disk.',
  'bo.flag.MEDIA-UNREADABLE': 'A container exists but cannot be decoded.',
  'bo.flag.MEDIA-TRUNCATED': 'A container is structurally short: the transfer did not finish.',
  'bo.flag.ROWS-MALFORMED': 'A timestamp file held rows that were not timestamps.',
  'bo.flag.CALIB-UNREADABLE': 'The calibration is on disk but will not parse.',
  'bo.flag.MANIFEST-UNREADABLE': 'The manifest is on disk but will not parse, so nothing was compared against it.',
  'bo.flag.PART-MISSING-INTERIOR': 'A part is missing from the middle of a multi-part stream.',
  'bo.flag.CHECKSUM-MISMATCH': 'The bytes changed between two deliveries of one session.',
  'bo.flag.DUR-EXCEEDS-WINDOW': 'The duration claimed is longer than the window the record’s own timestamps describe.',
  'bo.flag.EPISODE-ID-FALLBACK': 'The directory name does not parse; the id falls back to the raw name.',
  'bo.flag.SERIAL-CONFLICT': 'Basename, manifest and calibration disagree on the device serial.',
  'bo.flag.SESSION-CONFLICT': 'The declared session id disagrees with the handover record.',
  'meta.unknown': 'Unknown',
  'meta.claimHint': 'Advisory. The device manifest overstates media length.',
  'meta.measuredHint': 'What a verdict is scored against.',

  'player.play': 'Play',
  'player.pause': 'Pause',
  'player.rate': 'Speed',
  'player.part': 'Part',
  'player.position': 'Playback position',
  'player.of': 'of',
  'player.loading': 'Loading footage',

  'mark.in': 'Mark in',
  'mark.out': 'Mark out',
  'mark.clear': 'Clear span',
  'mark.pending': 'In point set. Press O to close the span.',
  'mark.orphanOut': 'Press I first to open a span.',
  'mark.spans': 'Marked spans',
  'mark.none': 'Nothing marked yet',
  'mark.estimate': 'Estimated useful',
  'mark.estimateHint': 'An estimate. The server figure decides the payment.',
  'mark.needsSpan': 'A partial verdict needs at least one marked span.',

  'verdict.good': 'Good',
  'verdict.partial': 'Partial',
  'verdict.bad': 'Reject',
  'verdict.commit': 'Commit and advance',
  'verdict.note': 'Note (optional)',
  'verdict.reasons': 'Reasons',
  'verdict.reasonsRequired': 'A rejection must name at least one reason.',
  'verdict.committing': 'Recording verdict',

  'state.leaseExpired.title': 'This episode was reassigned',
  'state.leaseExpired.body':
    'The claim on it expired and another reviewer may now hold it. The verdict you were preparing has been discarded.',
  'state.leaseExpired.action': 'Claim the next episode',
  'state.playbackWithheld.title': 'Review is not open on this session yet',
  'state.playbackWithheld.body':
    'Remote playback of raw footage is not authorised yet, so there is nothing to review here. No episode has been taken off the queue, and no verdict can be given without watching the footage. This screen will work as soon as the playback arrangement is approved.',
  'state.mediaFailed.title': 'The footage will not play',
  'state.mediaFailed.body':
    'The media is recorded in the store but this machine cannot read it. That is a fault on this machine, not with the recording.',
  'state.mediaFailed.action': 'Skip this episode',
  'state.writeFailed.title': 'The verdict was not recorded',
  'state.writeFailed.body':
    'The commit did not reach the server. Nothing has been paid and nothing has advanced. Try again, or release the episode and it will return to the queue.',
  'state.writeFailed.retry': 'Try again',
  'state.writeFailed.release': 'Release it',

  /**
   * The refused-verdict state (0017). A refusal the reviewer cannot fix is not
   * a lost lease and not a failed write: the episode is judgeable footage that
   * the server will not take a verdict on, and the only honest action is to
   * park it and say why. The body of the box is the refusal's own
   * `bo.refused.*` sentence; these keys are the frame around it.
   */
  'state.refused.title': 'The server refused this verdict',
  'state.refused.hold': 'Send it back to the counter',
  'state.refused.holdReason': 'What the counter has to fix',
  'state.refused.holding': 'Sending it back',
  'state.refused.holdFailed':
    'The episode was not parked. It is still in the queue. Try again, or tell the counter directly.',
  'state.refused.held.title': 'Sent back to the counter',
  'state.refused.held.body':
    'This episode has left the review queue and will not be handed to anyone else until the counter fixes what the refusal named. Nothing was paid.',
  'state.offline.title': 'No connection',
  'state.offline.body': 'Verdicts cannot be recorded while this machine is offline.',
  'state.loadFailed.title': 'Could not reach the queue',

  'shortcuts.title': 'Keyboard',
  'shortcuts.show': 'Shortcuts',
  /**
   * The one key legend that is a word rather than a symbol, and so the one that
   * has to be translated. Arrows, digits and letters are printed on the key
   * itself in every locale; "Space" is not.
   */
  'shortcuts.spaceKey': 'Space',
  'shortcuts.playPause': 'Play or pause',
  'shortcuts.seek': 'Back or forward 5 seconds',
  'shortcuts.frame': 'One frame back or forward',
  'shortcuts.rate': 'Slower or faster',
  'shortcuts.markIn': 'Mark in',
  'shortcuts.markOut': 'Mark out',
  'shortcuts.clear': 'Clear the span under the playhead',
  'shortcuts.verdict': 'Good, partial, reject',
  'shortcuts.commit': 'Commit and advance',
  'shortcuts.help': 'Show or hide this',

  'recent.title': 'Recent verdicts',
  'recent.empty': 'No verdicts yet this session',

  // ---------------------------------------------------------------------
  // Added with the React console. Home, Pipeline and the shell's navigation
  // did not exist while the console was one screen.

  'nav.home': 'Home',
  'nav.counter': 'Counter',
  'nav.review': 'Review',
  'nav.episodes': 'Episodes',
  'nav.settle': 'Settle',
  'nav.pipeline': 'Pipeline',
  'nav.notBuilt': 'Not built yet',
  'nav.notBuilt.body':
    'This surface is planned and has no screen. The work it names is done at the command line today.',

  'home.greeting': 'Your shift',
  'home.reviewed': 'episodes reviewed',
  'home.target': 'target',
  'home.start': 'Start reviewing',
  'home.payable': 'Payable today',
  'home.approval': 'Approval rate',
  'home.settled': 'Settled value',
  'home.needsHuman': 'episodes need a human',
  'home.needsHuman.body': 'The resolver refused to guess who recorded them.',
  'home.needsHuman.open': 'Open',
  'home.queueEmpty': 'The queue is empty. Cú has nothing to watch.',
  'home.shiftEarly': 'Early bird',
  'home.shiftDay': 'Day shift',
  'home.shiftGolden': 'Golden hour',
  'home.shiftNight': 'Night owl',

  'pipeline.title': 'What is actually built',
  'pipeline.intro':
    'Every capability the brief asks for, and the honest state of each one. Blocked items name the deliverable that blocks them.',
  'pipeline.built': 'built',
  'pipeline.next': 'next',
  'pipeline.blocked': 'blocked',
  'pipeline.capability': 'Capability',
  'pipeline.requirement': 'Requirement',
  'pipeline.state': 'State',
  'pipeline.surface': 'Surface',
  'pipeline.state.built': 'Built',
  'pipeline.state.partial': 'Partial',
  'pipeline.state.buildable': 'Buildable',
  'pipeline.state.blocked': 'Blocked',
  'pipeline.state.verified': 'Verified',

  // ---------------------------------------------------------------------
  // The back office (BO-01 to BO-04). One screen, three tabs: the three things
  // an operations person creates and manages. Episodes and settlement have
  // their own surfaces and are deliberately not here.

  'nav.backoffice': 'Back office',

  'bo.title': 'Back office',
  'bo.intro':
    'The tasks collectors are paid to record, the people recording them, and the hardware they carry.',
  'bo.tab.tasks': 'Tasks',
  'bo.tab.collectors': 'Collectors',
  'bo.tab.devices': 'Devices',
  'bo.empty': 'Nothing here yet.',
  'bo.loadFailed': 'This list did not load.',
  'bo.loadFailed.body': 'The back office reads through the API. Nothing has been changed.',
  'bo.working': 'Working',
  'bo.edit': 'Edit',
  'bo.save': 'Save',
  'bo.cancel': 'Cancel',

  'bo.task.name': 'Task',
  'bo.task.type': 'Type',
  'bo.task.rate': 'Per minute',
  'bo.task.target': 'Target effective',
  'bo.task.claimants': 'Claimed',
  'bo.task.maxClaimants': 'Maximum concurrent claimants',
  'bo.task.state': 'State',
  'bo.task.state.draft': 'Draft',
  'bo.task.state.published': 'Published',
  'bo.task.state.taken_down': 'Taken down',
  'bo.task.publish': 'Publish',
  'bo.task.takeDown': 'Take down',
  'bo.task.new': 'New task',
  'bo.task.create': 'Create draft',
  'bo.task.priceFrozen':
    'The price of a published task cannot be changed here. Take the task down and publish a new one.',
  'bo.task.priceNote':
    'The price is stored exactly as written and multiplied into every payment. Nothing rounds it here.',

  'bo.collector.ref': 'Collector',
  'bo.collector.status': 'Qualification',
  'bo.collector.status.pending': 'Pending',
  'bo.collector.status.qualified': 'Qualified',
  'bo.collector.status.suspended': 'Suspended',
  'bo.collector.exam': 'Exam',
  'bo.collector.exam.pass': 'Passed',
  'bo.collector.exam.fail': 'Failed',
  'bo.collector.exam.none': 'Not taken',
  'bo.collector.agreements': 'Agreements',
  'bo.collector.gate': 'No exam pass, no task claiming. The server refuses it, not the screen.',
  'bo.collector.markPass': 'Record a pass',
  'bo.collector.markFail': 'Record a fail',
  'bo.collector.clearExam': 'Clear the exam',
  'bo.collector.new': 'New collector',
  'bo.collector.create': 'Add collector',
  'bo.collector.missing': 'Missing',
  'bo.collector.recordAgreement': 'Record an acceptance',
  'bo.collector.agreement': 'Agreement',
  'bo.collector.version': 'Version accepted',
  'bo.collector.acceptedAt': 'Accepted at',
  'bo.collector.agreement.user': 'User agreement',
  'bo.collector.agreement.privacy': 'Privacy policy',
  'bo.collector.agreement.data_collection': 'Data collection',
  'bo.collector.agreement.commercial_use': 'Commercial use',
  'bo.collector.agreement.manual_review': 'Manual review',
  'bo.collector.agreement.offline_settlement': 'Offline settlement',
  /**
   * The payout account, on the collectors tab. A collector with none is
   * approved and then waits for ever, so "not declared" is a state the screen
   * has to name rather than leave blank.
   */
  'bo.collector.payout': 'Payout account',
  'bo.collector.payout.none': 'Not declared',
  'bo.collector.payout.declare': 'Declare account',
  'bo.collector.payout.redeclare': 'Replace account',
  'bo.collector.payout.method': 'Method',
  'bo.collector.payout.method.WALLET': 'ZaloPay wallet',
  'bo.collector.payout.method.BANK_ACCOUNT': 'Bank account',
  'bo.collector.payout.method.BANK_CARD': 'Bank card',
  'bo.collector.payout.holder': 'Name on the account',
  'bo.collector.payout.phone': 'Mobile number',
  'bo.collector.payout.bankCode': 'Bank code',
  'bo.collector.payout.accountNo': 'Account or card number',
  'bo.collector.payout.note':
    'Type what the collector shows you. The number is sent to ZaloPay to confirm the name and is not stored: only the last four digits are kept.',
  'bo.collector.payout.declared': 'Declared. ZaloPay answered:',
  'bo.collector.payout.open': 'Open the ZaloPay page the collector needs',

  'bo.device.serial': 'Serial',
  'bo.device.type': 'Type',
  'bo.device.firmware': 'Firmware',
  'bo.device.state': 'State',
  'bo.device.state.active': 'In service',
  'bo.device.state.faulty': 'Faulty',
  'bo.device.state.retired': 'Retired',
  'bo.device.holder': 'Bound to',
  'bo.device.unbound': 'Nobody',
  'bo.device.bind': 'Bind',
  'bo.device.unbind': 'Unbind',
  'bo.device.new': 'New device',
  'bo.device.create': 'Add device',
  'bo.device.faultNote': 'Fault note',
  'bo.device.retireNote': 'A retired device cannot be in anybody’s hands. Unbind it first.',
  'bo.device.rollFailed':
    'The list of collectors did not load, so there is nobody to bind to. Nothing has been changed.',

  'bo.refused': 'Refused',
  /**
   * SEC-03. Read on the sign-in form, in the SPA and by a machine client, so it
   * says what to do rather than what happened: the window expires on its own
   * and there is nobody to ring.
   */
  'bo.refused.sign_in_rate_limited':
    'Too many sign-in attempts were refused. Wait a few minutes and try again — the block clears by itself and nobody has to unlock anything.',
  'bo.refused.task_claims_capacity': 'That task already has as many claimants as it allows.',
  'bo.refused.task_claims_exam_gate':
    'That collector has not passed the exam, so they cannot claim a task.',
  'bo.refused.task_claims_published_gate': 'Only a published task can be claimed.',
  'bo.refused.task_claims_live_key': 'That collector already holds this task.',
  'bo.refused.tasks_status_transition':
    'A task goes draft, published, taken down, and never back.',
  'bo.refused.tasks_price_frozen':
    'The price of a published task is what its claimants agreed to. Take it down and publish a new one.',
  'bo.refused.task_claims_qualified_gate':
    'That collector is not qualified, so they cannot claim a task.',
  'bo.refused.task_claims_consent_gate':
    'That collector has not accepted all six agreements, so they cannot claim a task.',
  'bo.refused.task_claims_id_reused':
    'That claim reference already belongs to a different task or collector.',
  'bo.refused.collector_agreements_append_only':
    'An acceptance is a record of a moment and cannot be changed or removed.',
  'bo.refused.devices_retired_unbound_check': 'Unbind the device before retiring it.',
  /**
   * BO-11 (0020). The one refusal that has to name the role it wants: "403" on
   * a screen with a Save button tells an operator nothing they can act on.
   * Sent by `adminGuard` on the route and raised by 0020's triggers in the
   * database, with the same name and this one sentence either way.
   */
  'bo.refused.backoffice_admin_required':
    'That change needs the administrator role. Your sign-in is an upload-centre one, which covers handovers, imports and the queues. Ask an administrator to make the change, or to give you the role.',
  'bo.refused.collectors_external_ref_key': 'Another collector already uses that reference.',
  'bo.refused.devices_hardware_serial_key': 'Another device already carries that serial.',
  'bo.refused.device_already_bound': 'That device is bound to somebody else. Unbind it first.',
  'bo.refused.task_claims_released':
    'That claim was released. Claiming the task again is a new claim, under a new reference.',
  'bo.refused.task_claims_history_immutable':
    'When a claim began and when it ended is settlement evidence and cannot be edited or removed.',
  'bo.refused.task_claims_identity_immutable':
    'A claim cannot be moved to another task or collector. Release it and make a new one.',
  'bo.refused.tasks_capacity_below_live':
    'More collectors hold this task than the new limit allows. Release some claims first.',
  'bo.refused.tasks_id_reused': 'That reference already names a task with different terms.',
  'bo.refused.collectors_id_reused': 'That reference already names a different collector.',
  'bo.refused.devices_id_reused': 'That reference already names a different device.',
  'bo.refused.task_claims_task_id_tasks_id_fk': 'That task no longer exists. Reload the list.',
  'bo.refused.task_claims_collector_id_collectors_id_fk':
    'That collector no longer exists. Reload the list.',
  'bo.refused.devices_bound_collector_id_collectors_id_fk':
    'That collector no longer exists. Reload the list.',
  'bo.refused.devices_device_type_id_device_types_id_fk':
    'That device type no longer exists. Reload the list.',
  'bo.refused.device_assignments_no_overlap':
    'That device is already assigned to somebody for part of that period.',
  'bo.refused.device_assignments_id_reused':
    'That assignment reference already belongs to another device or collector.',
  'bo.refused.device_assignments_device_id_devices_id_fk': 'That device no longer exists. Reload the list.',
  'bo.refused.device_assignments_collector_id_collectors_id_fk':
    'That collector no longer exists. Reload the list.',
  'bo.refused.episode_clearing_nothing_to_clear':
    'That delivery is already the current one and carries no unanswered checksum mismatch, so there is nothing to clear.',
  'bo.refused.episode_clearing_id_reused':
    'That clearing reference already names a different decision. Send a new reference.',
  'bo.refused.episode_clearing_foreign_delivery':
    'That delivery does not belong to this episode. Name one of its own deliveries.',
  'bo.refused.episode_clearing_paid_on_other_delivery':
    'Another delivery of this episode has already been reviewed and paid. Choosing a different one is a dispute, not a clear.',
  'bo.refused.episode_parks_already_parked':
    'This episode is already parked out of the review queue. Release it before parking it again.',
  'bo.refused.episode_parks_not_parked':
    'This episode is not parked, so there is nothing to release.',
  'bo.refused.episode_parks_settled':
    'This episode has already been reviewed and carries a settlement, so it cannot be parked. Park the settlement instead.',
  'bo.refused.episode_park_id_reused':
    'That park reference already names a different decision. Send a new reference.',
  'bo.refused.session_claim_missing':
    'This collector holds no claim on that task, so nothing recorded for it can be paid. Claim the task first.',
  'bo.refused.session_claim_released':
    'This collector released their claim on that task. A new claim is needed before a session can be recorded.',
  'bo.refused.session_task_not_published':
    'That task has been taken down, so no new session can be recorded against it.',
  'bo.refused.review_duration_implausible':
    'This episode claims to run longer than one card can record, so it cannot be paid. Send it back to the counter to have the delivery checked.',

  /**
   * The verdict route's own refusals (`REVIEW_API_REFUSALS` in review.ts).
   * These are the sentences the review screen shows instead of the lost-lease
   * banner it used to show for every 409.
   */
  'bo.refused.review_already_decided':
    'This episode already has a verdict. Nothing you marked was recorded. Take the next one.',
  'bo.refused.review_no_task':
    'This episode names no task, so there is no price to pay it at and no verdict can be recorded. Send it back to the counter with a note; it needs a session attached before anyone can review it.',
  'bo.refused.review_no_longer_reviewable':
    'This episode stopped being reviewable while you had it open — a new delivery landed, or its copy failed verification. Nothing was recorded. Send it back to the counter with a note.',
  'bo.refused.review_billed_while_disputed':
    'The settlement under challenge was billed while the challenge was open, so a second verdict cannot replace it. Nothing was recorded. Send it back to the counter with a note.',
  'bo.refused.review_verdict_id_taken':
    'That verdict reference already belongs to a different review. Nothing was recorded. Reload the screen and judge the episode again.',

  /**
   * Path A's refusals (UPL-01/APP-26). These reach a collector on a phone, not
   * an operator at a counter, and Vietnamese is the language most of them read.
   * They are in the same `bo.refused.*` namespace as everything else because
   * the console shows the same sentence when a support operator looks at an
   * upload that failed.
   */
  'bo.refused.upload_unknown_session':
    'That session does not exist. Bind a session in the app before uploading it.',
  'bo.refused.upload_foreign_session':
    'That session belongs to another collector, so nothing can be uploaded against it.',
  'bo.refused.upload_already_complete':
    'This upload is finished and checked. Sending it again would change nothing.',
  'bo.refused.upload_checksum_mismatch':
    'A file in the cloud does not match the checksum your phone computed for it. The recording is held out of review until it is sent again.',
  'bo.refused.upload_payload_too_large':
    'That delivery is larger than one upload may declare. Send it as more than one upload, or hand the card in at an upload centre.',
  'bo.refused.upload_superseded':
    'A newer delivery of this recording arrived while these files were being sent, so this result was not recorded. Start the upload again.',

  /**
   * The collector app's own refusals (`COLLECTOR_API_REFUSALS` in
   * collector-app.ts). Same namespace as everything else, for the reason Path
   * A's are: a support operator looking at why a collector could not claim a
   * task reads the same sentence the collector did.
   *
   * NONE of these is a constraint name, and that is the point of the set. The
   * gates behind them are triggers — `task_claims_capacity`,
   * `task_claims_consent_gate` — whose names are for the console. A collector
   * is never shown one.
   */
  'bo.refused.task_not_found': 'That task is not there any more.',
  'bo.refused.task_not_claimable':
    'That task is not open at the moment, so it cannot be taken on or recorded against.',
  'bo.refused.task_at_capacity':
    'That task already has as many collectors as it takes. Try another one.',
  'bo.refused.already_claimed': 'You have already taken this task on.',
  'bo.refused.exam_not_passed':
    'The exam has to be passed before a task can be taken on. Take it from the training screen.',
  'bo.refused.not_qualified':
    'This account has not been approved for collection yet. The upload centre can say where it stands.',
  'bo.refused.agreements_incomplete':
    'All six agreements have to be accepted before a task can be taken on.',
  'bo.refused.claim_id_reused':
    'That reference already belongs to a different task. Try taking the task on again.',
  'bo.refused.claim_released':
    'You gave this task up earlier, so that reference cannot be used again. Take it on again to get a new one.',
  'bo.refused.agreement_version_unknown':
    'The agreements on this screen are out of date. Reload them and read them again before accepting.',
  'bo.refused.device_not_found': 'No camera carries that serial number. Check what is on the case.',
  'bo.refused.device_not_available':
    'That camera has been taken out of service, so it cannot be paired.',
  'bo.refused.already_bound': 'That camera is paired to somebody else.',
  'bo.refused.device_not_bound':
    'That camera is not paired to you. Pair it before starting a session.',
  'bo.refused.task_not_claimed':
    'You do not hold that task, so nothing can be recorded against it. Take it on first.',
  'bo.refused.scenario_not_found': 'That setting is not one this platform records.',
  'bo.refused.session_id_reused':
    'That reference already names a different session. Start the session again.',

  'bo.refused.review_disputes_open_key': 'That verdict is already under dispute.',
  'bo.refused.review_disputes_decided_check':
    'That review has not been decided yet, so there is no outcome to challenge.',
  'bo.refused.review_disputes_final_check':
    'That verdict is itself a second review, and a second review is final.',
  'bo.refused.review_disputes_unbilled_check':
    'That verdict is already on a bill or paid, and a bill is never revised.',
  'bo.refused.tasks_commitment_shape_check': 'Commitment hours must be a non-empty list of positive hours with no missing values.',
  'bo.refused.task_commitments_abandon_reason_check': 'Give a non-blank reason for abandoning the commitment.',
  'bo.refused.task_commitments_terms_immutable': 'The claim, weekly hours and dates agreed on a commitment cannot be changed.',
  'bo.refused.task_commitments_insert_active': 'A commitment must start active; close it afterwards to record the outcome.',
  'bo.refused.task_commitments_no_delete': 'Commitment records cannot be deleted. Close the commitment instead.',
  'bo.refused.unknown': 'The server refused that change.',
  'bo.refused.settlements_not_in_exception': 'That settlement is not in exception, so there is nothing to release.',
  'bo.refused.settle_export_bill_in_exception':
    'A bill in this period has a line in exception. Its total would not match the lines in the file, so the export is held until the line is released.',
  'bo.refused.settle_generate_by_finance':
    'A finance operator may not generate the cycle. Whoever issues a bill is refused when they pay it, so another operator has to run this.',
  'bo.refused.payout_settlement_exception':
    'A line on this bill is in exception. Release it before the bill can be paid.',

  'theme.toggle': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  /* ---------------------------------------------------------------------
     The guided tour (`components/guide/`).

     Optional, dismissible, and never started by the console itself except
     once on Home. The sentences are the point: each one stands beside the
     element it names and says what that element is FOR, including the two
     things this console is most often misread on - the shift gauge is
     progress and not a verdict, and the settled figure is one person's own
     decisions and not the programme's spend. */

  'guide.title': 'Guided tour',
  'guide.start': 'Show me around',
  'guide.step': 'Step {{current}} of {{total}}',
  'guide.back': 'Back',
  'guide.next': 'Next',
  'guide.done': 'Done',
  'guide.close': 'Close tour',
  'guide.panda': 'Truc, pointing at the item this step describes',
  'guide.offscreen': 'This item is not on the screen right now. Continue to the next step.',
  'guide.offer': 'First time here? A short tour shows what each part of this screen is for.',
  'guide.offer.accept': 'Show me around',
  'guide.offer.decline': 'Not now',

  'guide.home.gauge':
    'Your shift so far: episodes you have reviewed, against the target for the shift. The ring is progress. It is not a verdict.',
  'guide.home.start':
    'This claims the next episode in the queue and opens it. You hold it until you decide or release it.',
  'guide.home.settled':
    'The value of your own decisions in this period. It is not the programme spend and it is not a payment.',
  'guide.shell.counters':
    'How many episodes are waiting, and the average time one verdict takes. Both stay in the bar on every screen.',
  'guide.shell.nav':
    'The whole back office. A dot means the screen is not built yet; a half-filled square means it is built for part of its job.',
  'guide.review.player':
    'The footage and the playhead. Space plays and pauses. The arrow keys move five seconds; hold Shift for one frame.',
  'guide.review.marks':
    'Mark the start and the end of usable footage with I and O. The server measures the span; this screen never sends a duration.',
  'guide.review.verdict':
    'The three outcomes: pass, partial, reject. Keys 1, 2 and 3. Enter commits the one you chose.',
  'guide.review.reasons':
    'A reject needs at least one reason code. The collector reads these in Vietnamese, so pick the one that says what to change.',
  'guide.pipeline.stage':
    'Each stage of the ingest run, and what is waiting in it. Work stopping at a stage tells you where the import is waiting or has failed. It says nothing about the recording, which is already on the card.',
  'guide.backoffice.tabs':
    'Tasks, collectors and devices. Each tab is a list you can filter, and every change here is logged against your operator id.',
  'guide.settle.period':
    'One settlement cycle starts on this day. Every bill whose period starts inside it appears below.',
  'guide.settle.bills':
    'Every bill in the period. A total comes from its lines and the server rounds it; this screen adds nothing.',
  'guide.risk.holds':
    'Payments the engine has held, each with the plain sentence saying why. Release one only when you can say what changed.',
  'guide.episodes.scope':
    'Which episodes this screen is showing right now. It is a scope, not the whole catalogue.',
  'guide.counter.plan':
    'One question per step, and nothing is written until the last one. The rail says where you are, and every answer stays editable from the summary.',

  // ---------------------------------------------------------------------
  // Settle and the payout console (SET-03 → SET-07; payout brief, Agent D).
  // Four screens on one period: the bills, the preflight that has to be read
  // before any payment, the flag review, and the attempts that need a person.

  'settle.title': 'Settle',
  'settle.intro':
    'The bills of a period, what the wallet holds against them, what the engine has flagged, and the record of every payment. Every figure here is the server’s; nothing on this screen adds or rounds.',
  'settle.period': 'Period starts',
  'settle.period.hint': 'One settlement cycle from this day. Bills whose period starts inside it.',
  'settle.period.apply': 'Open',
  'settle.tab.bills': 'Bills',
  'settle.tab.preflight': 'Preflight',
  'settle.tab.flags': 'Flags',
  'settle.tab.exceptions': 'Exceptions',
  'settle.mode.manual': 'Manual payout: the operator transfers the money and records the reference here.',
  'settle.mode.api': 'API payout: transfers are sent through ZaloPay from the preflight screen.',
  'settle.readonly': 'Read only',
  'settle.readonly.operator':
    'This session does not hold the finance role. Every figure is visible; every payment action is disabled here and refused by the server.',
  'settle.readonly.unknown':
    'The finance role could not be confirmed for this session, so payment actions are disabled. Reload to ask again.',
  'settle.readonly.refused': 'The server refused: this session does not hold the finance role. Nothing has been changed.',
  'settle.failed': 'The request did not reach the server. Nothing has been changed.',
  'settle.invalid': 'The server would not read that request. Nothing has been changed.',
  'settle.gone': 'That bill or attempt no longer exists on the server. Reload the list.',
  'settle.loadFailed': 'This period did not load.',
  'settle.loadFailed.body': 'The settle screens read through the API. Nothing has been changed.',
  'settle.empty': 'No bills in this period.',
  'settle.empty.body': 'Bills are made from reviewed settlements. Generate the period, or pick another start day.',
  'settle.generate': 'Generate bills',
  'settle.generate.hint': 'Bills every settlement of the period that is waiting. Running it twice changes nothing.',
  'settle.generate.result': '{{created}} bill(s) created; {{notPayable}} settlement(s) worth nothing were left off.',
  'settle.generate.deferred': '{{n}} settlement(s) already had a bill for this period ({{who}}), so they roll into the next cycle. The money is not lost.',
  'settle.generate.skipped': '{{n}} settlement(s) ({{who}}) were billed by another run under a different period while this one was reading. They are on that run’s bill.',
  'settle.generate.exception': '{{n}} settlement(s) in this period are parked as exceptions.',
  'settle.export.payout': 'Export payout CSV',
  'settle.export.payout.hint': 'Hashed row by row and as a file, and recorded. Finance only.',
  'settle.export.lines': 'Export lines CSV',
  'settle.col.collector': 'Collector',
  'settle.col.minutes': 'Valid minutes',
  'settle.col.gross': 'Gross',
  'settle.col.withheld': 'Withheld',
  'settle.col.net': 'Net',
  'settle.col.band': 'Risk',
  'settle.col.attempt': 'Payout',
  'settle.col.open': 'Open',
  'settle.sort': 'Sort by {{column}}',
  'settle.withheld.note': 'The PIT withholding rate is not decided. The server reports 0 withheld and net equal to gross.',
  'settle.asStored': 'As stored, in {{currency}}. Not rounded here.',
  'settle.wholeVnd': 'Whole dong. The total is rounded down; the collector loses under one dong per bill.',
  'settle.lines': '{{n}} line(s)',
  'settle.attempt.none': 'No attempt',
  'settle.attempt.created': 'Created',
  'settle.attempt.submitted': 'Submitted',
  'settle.attempt.processing': 'Processing',
  'settle.attempt.pending_zlp': 'Pending at ZaloPay',
  'settle.attempt.succeeded': 'Paid',
  'settle.attempt.failed': 'Failed',
  'settle.attempt.unknown': 'Unknown, polling',
  'settle.method.WALLET': 'ZaloPay wallet',
  'settle.method.BANK_ACCOUNT': 'Bank account',
  'settle.method.BANK_CARD': 'Bank card',
  'settle.verify.unverified': 'Not verified',
  'settle.verify.verified': 'Verified',
  'settle.verify.name_mismatch': 'Name mismatch',
  'settle.verify.no_wallet': 'No wallet',
  'settle.verify.locked': 'Wallet locked',
  'settle.verify.kyc_limit': 'Receiving limit',
  'settle.verify.error': 'Verification error',
  'settle.issue.title': 'What stands between this bill and a transfer',
  'settle.issue.none': 'Nothing. This bill can be paid.',
  'settle.issue.no_account': 'The collector has declared no payout account.',
  'settle.issue.account_unverified': 'The payout account is not verified by ZaloPay.',
  'settle.issue.over_bank_ceiling': 'Above ZaloPay’s ceiling of 10,000,000 VND for one bank transfer.',
  'settle.issue.under_bank_minimum': 'Below ZaloPay’s minimum of 2,000 VND for a bank transfer.',
  'settle.issue.under_one_dong': 'The whole bill is worth less than one dong, so rounded down there is nothing to transfer.',
  'settle.issue.over_cap': 'Above the per-collector cap for this period.',
  'settle.issue.risk_hold': 'The risk engine holds this bill.',
  'settle.issue.attempt_open': 'An attempt is still open on this bill.',
  'settle.issue.already_paid': 'This bill is already paid.',
  'settle.issue.line_in_exception': 'A line on this bill is parked as an exception.',
  'settle.state.pending_review': 'Waiting for review',
  'settle.state.pending_settlement': 'Waiting to be billed',
  'settle.state.bill_generated': 'On an issued bill',
  'settle.state.manually_paid': 'Paid on the manual rail',
  'settle.state.exception': 'Parked as an exception',

  'settle.preflight.intro':
    'Read before any payment. What the batch would send, what the wallet holds, which accounts are unverified, and who the engine has flagged.',
  'settle.preflight.balance': 'Wallet balance',
  'settle.preflight.balance.none':
    'Cannot be read: no ZaloPay client is configured on this server. The manual pilot pays from a bank, so this is expected.',
  'settle.preflight.total': 'Batch total',
  'settle.preflight.required': 'Required with margin',
  'settle.preflight.required.hint': 'The total plus 5%, the margin the batch worker insists on.',
  'settle.preflight.shortfall': 'Shortfall',
  'settle.preflight.ok': 'The batch can be sent: {{payable}} of {{bills}} bill(s) are payable.',
  'settle.preflight.refused': 'The batch is refused as a whole. Nothing will be sent.',
  'settle.preflight.serverSaid': 'The server said',
  'settle.preflight.ranAt': 'Preflight run at {{at}}',
  'settle.preflight.rerun': 'Run again',
  'settle.preflight.bands': 'Bills by risk band',
  'settle.preflight.accounts': 'Payout accounts',
  'settle.preflight.accounts.verified': 'Verified',
  'settle.preflight.accounts.unverified': 'Not verified',
  'settle.preflight.accounts.mismatch': 'Name mismatch',
  'settle.preflight.accounts.missing': 'No account',
  'settle.preflight.limits': 'Limits',
  'settle.preflight.ceiling': 'Over the bank ceiling of {{ceiling}}',
  'settle.preflight.cap': 'Over the cap of {{cap}}',
  'settle.preflight.cap.none': 'No per-collector cap is configured. The value is an escalation.',
  'settle.preflight.others': 'Also not payable',
  'settle.preflight.anomalies': 'Highest risk first',
  'settle.preflight.anomalies.hint':
    'The {{n}} bill(s) with the highest risk score, with every flag in plain words. Open the flag review to act on one.',
  'settle.preflight.anomalies.none': 'The engine has raised no flag on any bill in this period.',
  'settle.preflight.continue.manual':
    'Preflight seen. Open a bill from the list to record a manual payment; the payment controls stay locked until this screen has been read for the period.',
  'settle.preflight.stale': 'The preflight for this period has not been run in this session. Run it before paying.',
  'settle.preflight.expired': 'The preflight is older than five minutes. The balance, the holds and the anomaly list may have moved; run it again before paying.',
  'settle.preflight.changed': 'The batch changed since the preflight ran — a payment, a declaration or a hold. Run it again before paying.',
  'settle.preflight.open': 'Run the preflight',

  'settle.batch.title': 'Send the batch',
  'settle.batch.sentence': 'Send {{n}} transfer(s) totalling {{total}}.',
  'settle.batch.serverLoop':
    'One request. The server runs its own preflight again at that moment, sends one transfer at a time with a pause between, stops at the first refusal, and reports back. Nothing is sent from this browser.',
  'settle.batch.notOnServer': 'This server has no batch-run route yet. The batch is a server-side loop by design; until the route exists nothing is sent from here.',
  'settle.batch.refusedAtSend': 'The server’s own preflight refused the batch at send time: {{reason}} Zero transfers were sent and a ticket was raised.',
  'settle.batch.retype': 'Retype the total, digits only, to confirm',
  'settle.batch.retype.hint': 'Typed, not clicked. The figure is the preflight’s.',
  'settle.batch.mismatch': 'That is not the batch total.',
  'settle.batch.send': 'Send {{n}} transfer(s)',
  'settle.batch.sending': 'Sending {{done}} of {{n}}',
  'settle.batch.stopped':
    'The batch stopped at {{collector}}: {{reason}} What was already sent stays sent; the poller finishes it.',
  'settle.batch.done': 'All {{n}} transfer(s) were sent. The poller resolves their final status.',
  'settle.batch.noneOk': 'The preflight refused the batch, or nothing in it is payable, so nothing can be sent.',
  'settle.batch.refused.title': 'Not sent',
  'settle.batch.refused.body': 'These bills were not sent, with the reason beside each. Some are already paid or already in flight; most need a person before any run will send them.',
  'settle.batch.tickets.title': 'Tickets',
  'settle.batch.tickets.body': 'Raised while this run was going. A person has to act on them.',
  'settle.batch.aborted': 'The run stopped on an error, not on a refusal.',
  'settle.batch.aborted.at': 'It stopped at {{collector}}.',
  'settle.batch.aborted.body': 'What was sent is sent and committed. Why it threw is in the server’s log, not in this report. The poller resolves the transfers that are already out.',
  'settle.ticket.TICKET.POLL_EXHAUSTED': 'Polling gave up on a transfer',
  'settle.ticket.TICKET.ORDER_NOT_FOUND': 'ZaloPay does not know this order',
  'settle.ticket.TICKET.CAP_EXCEEDED': 'A bill is above the per-collector cap',
  'settle.ticket.TICKET.BATCH_REFUSED': 'The batch was refused at send time',
  'settle.ticket.TICKET.RECON_DISCREPANCY': 'Reconciliation found a discrepancy',

  'settle.bill.back': 'All bills',
  'settle.bill.notInPeriod': 'That bill is not in this period.',
  'settle.bill.notInPeriod.body': 'Pick the period it belongs to, or open it from the list.',
  'settle.bill.period': 'Period',
  'settle.bill.total': 'Total',
  'settle.bill.amount': 'Amount to pay',
  'settle.bill.account': 'Payout account',
  'settle.bill.account.none': 'This collector has declared no payout account. Nothing can be paid to nobody.',
  'settle.bill.declared': 'Name declared',
  'settle.bill.verified': 'Name on ZaloPay',
  'settle.bill.verified.none': 'Not returned',
  'settle.bill.phone': 'Phone',
  'settle.bill.risk': 'Risk',
  'settle.bill.risk.open': 'Open the flag review',
  'settle.bill.attempt': 'Latest attempt',
  'settle.bill.attempt.reference': 'Reference',
  'settle.bill.attempt.order': 'Partner order',
  'settle.bill.attempt.zlp': 'ZaloPay order',
  'settle.bill.attempt.trans': 'ZaloPay transaction',
  'settle.bill.attempt.sub': 'Sub code',
  'settle.bill.attempt.polls': 'Polls',
  'settle.bill.attempt.created': 'Created',
  'settle.bill.attempt.settled': 'Settled',
  'settle.bill.lines.title': 'Lines',
  'settle.bill.lines.empty': 'This bill has no lines.',
  'settle.bill.lines.exceptions': '{{n}} line(s) are parked as exceptions. They stay on the bill and stay in its total.',
  'settle.bill.lines.reproduce': 'Each amount is the unit price multiplied by the effective minutes and then rounded to four decimal places, so the two columns beside it reproduce it. The total is the exact sum of the lines. The rounding down to whole dong happens once, on the payment, and never on a line.',
  'settle.bill.line.task': 'Task',
  'settle.bill.line.episode': 'Episode',
  'settle.bill.line.unitPrice': 'Unit price',
  'settle.bill.line.minutes': 'Effective minutes',
  'settle.bill.line.amount': 'Amount',
  'settle.bill.line.state': 'State',
  'settle.bill.line.reviewed': 'Reviewed',

  'settle.pay.title': 'Record the payment',
  'settle.pay.manual.intro':
    'Transfer the amount yourself, in ZaloPay or at the bank, to the account above. Then come back and record the reference of that transfer. The database checks the amount against the bill.',
  'settle.pay.api.intro':
    'One transfer through ZaloPay for this bill, or a manual payment with its reference. The preflight has been read; the amount is retyped to confirm.',
  'settle.pay.reference': 'Transaction reference',
  'settle.pay.reference.hint': 'Required for a manual payment. The reference the bank or ZaloPay gave the transfer.',
  'settle.pay.retype': 'Retype the amount, digits only',
  'settle.pay.retype.hint': 'It must match the amount to pay. Typed, not clicked.',
  'settle.pay.mismatch': 'That is not the amount on this bill.',
  'settle.pay.markPaid': 'Record as paid',
  'settle.pay.api.send': 'Send the transfer',
  'settle.pay.done': 'Recorded. Attempt {{order}}, status: {{status}}.',
  'settle.pay.sent': 'Sent. Attempt {{order}} is {{status}}; the poller resolves it.',
  'settle.pay.rejected': 'ZaloPay rejected the transfer (sub code {{sub}}). A new attempt is needed.',
  'settle.pay.alreadyPaid': 'This bill is paid. Nothing more can be recorded against it.',
  'settle.pay.locked': 'Locked until the preflight has been read',

  'settle.exceptions.intro': 'Every attempt that needs a person, and every bill that cannot be sent as it is.',
  'settle.exceptions.empty': 'No exceptions in this period.',
  'settle.exceptions.empty.body': 'Every attempt is terminal and every bill is inside the limits.',
  'settle.exceptions.pending': 'Pending inside ZaloPay',
  'settle.exceptions.pending.body':
    'ZaloPay holds these transfers in its status 4. Retrying does not resolve it and nothing here retries: ZaloPay’s own team must fix the order. Resolve here only with the outcome ZaloPay confirms, and write down where it was confirmed.',
  'settle.exceptions.polling': 'Still polling',
  'settle.exceptions.polling.body':
    'The answer to these transfers was lost or is still coming. The poller asks ZaloPay on a backoff and moves the attempt when it knows. An operator resolves one only when the polling is exhausted.',
  'settle.exceptions.neverSent': 'Created, never sent',
  'settle.exceptions.neverSent.body':
    'The attempt row exists and the request never left. Nothing resends on a guess; resolve it as failed and pay again.',
  'settle.exceptions.ceiling': 'Over the bank ceiling',
  'settle.exceptions.ceiling.body':
    'ZaloPay sends at most {{ceiling}} per bank transfer. A bill above it cannot go as one transfer, and splitting it is a money decision nobody has taken. Escalate; do not split.',
  'settle.exceptions.cap': 'Over the cap',
  'settle.exceptions.cap.body':
    'Above the per-collector cap of {{cap}}. The batch refuses it by name and raises a ticket; it never pays the cap instead.',
  'settle.exceptions.blocked': 'Not payable yet',
  'settle.exceptions.blocked.body':
    'Bills with something to fix before a transfer: no account, an unverified account, a risk hold.',
  'settle.exceptions.opened': 'Opened {{elapsed}} ago',
  'settle.exceptions.polls': '{{n}} poll(s), last at {{at}}',
  'settle.exceptions.polls.none': 'Not polled yet',
  'settle.exceptions.events': 'Events',
  'settle.resolve.title': 'Resolve',
  'settle.resolve.outcome': 'Outcome',
  'settle.resolve.succeeded': 'Money moved',
  'settle.resolve.failed': 'Money did not move',
  'settle.resolve.reason': 'Reason',
  'settle.resolve.reason.hint': 'Required. Where the outcome was confirmed and by whom. This is the permission.',
  'settle.resolve.trans': 'ZaloPay transaction id, if it succeeded',
  'settle.resolve.submit': 'Resolve the attempt',
  'settle.resolve.done': 'Resolved: the attempt is now {{status}}.',
  'settle.resolve.pollerWorking':
    'The poller is still working on this attempt. Only a pending, exhausted or never-sent attempt is resolved by hand.',

  // ---------------------------------------------------------------------
  // The flag review (payout brief, Agent C §8 and Agent D BUILD 3). The
  // `risk.signal.*` entries are templates filled from evidence — see the
  // header of this file.

  'risk.intro':
    'Evidence first, verdict second. Every flag is one sentence with the number that caused it; a hold is cleared with a typed reason, and who cleared what stays on the record.',
  'risk.score': 'Score',
  'risk.points': '{{n}} pt',
  'risk.flags': '{{n}} flag(s)',
  'risk.open': 'Open',
  'risk.empty': 'No flags in this period.',
  'risk.empty.body': 'The engine has nothing to say about these bills, or is not running on this server.',
  'risk.evidence': 'Evidence',
  'risk.references': 'Recordings named',
  'risk.proxy.none': 'No proxy clip is served by this server, and the raw footage is never shown here.',
  'risk.threshold': 'threshold {{v}}, computed {{at}}',
  'risk.holds.title': 'Hold trail',
  'risk.holds.none': 'No hold is open on this bill.',
  'risk.holds.notOnServer':
    'The risk engine’s routes are not on this server. The flags shown come from the batch summary; the hold trail and the clear action need the engine.',
  'risk.holds.open': 'Held since {{at}}',
  'risk.holds.raised': 'Raised {{at}} on {{signals}}',
  'risk.holds.cleared': 'Cleared {{at}} by {{who}}: {{verdict}} — {{reason}}',
  'risk.clear.title': 'Clear the hold',
  'risk.clear.verdict': 'Verdict',
  'risk.clear.reason': 'Reason',
  'risk.clear.reason.hint': 'At least ten characters. What you checked and why the bill may be paid.',
  'risk.clear.submit': 'Clear with this reason',
  'risk.clear.done': 'Cleared. The bill pays normally from here.',
  'risk.actions.escalate': 'Escalate',
  'risk.actions.hold': 'Hold',
  'risk.actions.unavailable':
    'Escalation and manual holds have no route on this server yet. The engine raises holds itself; clearing one is the action an operator has.',
  'risk.band.clear': 'Clear',
  'risk.band.notice': 'Notice',
  'risk.band.review': 'Review',
  'risk.band.hold': 'On hold',
  'risk.severity.info': 'info',
  'risk.severity.notice': 'notice',
  'risk.severity.review': 'review',
  'risk.severity.hold': 'hold',
  'risk.verdict.false_positive': 'Checked, nothing wrong',
  'risk.verdict.accepted': 'Risk accepted, pay anyway',
  'risk.verdict.resolved': 'Cause fixed',

  'risk.signal.META.EVALUATED': 'Evaluated with {findings} finding(s).',
  'risk.signal.IDENT.NAME_MISMATCH': 'Name on ZaloPay is {verified_name}; the agreement says {declared_name}.',
  'risk.signal.IDENT.PHONE_SHARED':
    'Wallet phone {phone_masked} is also on the payout account of {count} other collector(s): {other_collector_refs}.',
  'risk.signal.IDENT.ACCOUNT_SHARED':
    'Bank account {bank_code} ···{account_no_last4} is also on the payout account of {count} other collector(s): {other_collector_refs}.',
  'risk.signal.IDENT.MUID_SHARED':
    'ZaloPay wallet {m_u_id_masked} is also on the payout account of {count} other collector(s): {other_collector_refs}.',
  'risk.signal.IDENT.ACCOUNT_CHANGED_LATE':
    'The payout account was changed on {changed_at}, {days_before_end} day(s) before the period ended on {period_end}.',
  'risk.signal.IDENT.UNVERIFIED_KYC':
    'ZaloPay reported on {verified_at} that this wallet has not completed identity verification (code {sub_return_code}).',
  'risk.signal.IDENT.KYC_LIMIT_REPEATED':
    'ZaloPay reported the receiving limit reached {occurrences} times (code {sub_return_code}); more than {max_occurrences} is unusual for one person.',
  'risk.signal.IDENT.WALLET_LOCKED': 'ZaloPay reported on {verified_at} that this wallet is locked (code {sub_return_code}).',
  'risk.signal.IDENT.NAME_UNCONFIRMED': 'ZaloPay returned no name to compare with {declared_name}; the declaration is unconfirmed.',
  'risk.signal.IDENT.KYC_LIMIT': 'ZaloPay reported the wallet’s receiving limit reached (code {sub_return_code}).',
  'risk.signal.IDENT.NO_WALLET': 'ZaloPay has no wallet for phone {phone_masked} (code {sub_return_code}).',
  'risk.signal.IDENT.VERIFY_ERROR': 'ZaloPay could not verify the account (code {sub_return_code}).',
  'risk.signal.VOL.HOURS_PER_DAY':
    '{hours} hours of recording on {day} across {episodes} episode(s). The daily maximum is {max_hours} hours.',
  'risk.signal.VOL.ABOVE_COHORT_P95':
    '{episodes} episodes on {day}. 95 in 100 collector-days have {p95} or fewer ({cohort_days} collector-days compared).',
  'risk.signal.VOL.STEP_CHANGE':
    '{minutes} minutes on {day}. This collector’s usual day is {median_minutes} minutes, so this is {ratio}×.',
  'risk.signal.VOL.NO_GAP': 'Episodes {episode_a} and {episode_b} overlap by {overlap_s} seconds. One person cannot record both at once.',
  'risk.signal.VOL.NOCTURNAL':
    '{night_minutes} of {total_minutes} minutes ({share_pct}) were recorded between {night_hours} on task type {task_type}. Night work is a real job; this is context.',
  'risk.signal.CONT.MOOV_DAMAGED': 'The MP4 {file} fails the container check: {verdict}.',
  'risk.signal.CONT.TIMING_TRUNCATED':
    'The {stream} timestamp index stopped early: {pts_rows} rows against {media_packets} media packets. Typical of an interrupted recording.',
  'risk.signal.CONT.TIMING_PACKET_DELTA':
    'The {stream} timestamp index has {pts_rows} rows but the media has only {media_packets} packets: the video was cut or rewritten after its index.',
  'risk.signal.CONT.IMU_CLOCK_DRIFT': 'The IMU clock is off: {clock_outlier_rows} rows carry a time nowhere near the session ({detail}).',
  'risk.signal.CONT.PTS_MANIFEST_DELTA':
    'The manifest claims {declared_s} s and the media measures {measured_s} s, a ratio of {ratio}. This device usually reads {baseline_ratio} ({baseline_episodes} episodes).',
  'risk.signal.CONT.NEAR_DUPLICATE':
    'The footage matches episode {other_episode_id} by collector {other_collector_ref} ({method}, {match_share_pct} of frames).',
  'risk.signal.CONT.STATIC_SCENE':
    'The picture changed very little across {frames} sampled frames: motion {motion_energy}, where normal footage is above {max_motion_energy}.',
  'risk.signal.CONT.LOW_LUMA_VARIANCE':
    '{dark_share_pct} of sampled frames are dark and {flat_share_pct} are flat (mean brightness {mean_luma} of 255). The lens may have been covered.',
  'risk.signal.CONT.AUDIO_ABSENT': 'No usable audio ({reason}) on a task that expects sound ({task_type}).',
  'risk.signal.CONT.FINGERPRINT': 'A frame fingerprint of {frames} frames was recorded for duplicate checks.',
  'risk.signal.PROV.PRNU_MISMATCH':
    'The sensor noise pattern of the footage correlates {correlation} with the fingerprint enrolled for device {device_serial}; a match is above {min_correlation}.',
  'risk.signal.PROV.IMU_VIDEO_DECORR':
    'Over {seconds} seconds the motion in the picture and the motion the IMU recorded correlate {correlation}; a real recording is above {min_correlation}.',
  'risk.signal.PROV.ENCODER_MISMATCH': 'The file was not written the way firmware {firmware} writes files: {mismatches}.',
  'risk.signal.PROV.SCREEN_RECAPTURE': 'The footage looks like a filmed screen: {cues} ({frames} frames checked).',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC':
    'The footage has almost no sensor noise ({noise_floor}, cameras read above {max_noise_floor}). A weak cue on its own.',
  'risk.signal.OPS.REVIEW_TOO_FAST':
    'Reviewer {reviewer_ref} recorded a {verdict} verdict in {time_to_verdict_s} s on an episode that runs {measured_duration_s} s.',
  'risk.signal.OPS.APPROVAL_OUTLIER':
    'Reviewer {reviewer_ref} approved {approval_rate_pct} of {decided} episodes; the other {reviewers} reviewers approve {cohort_median_pct}.',
  'risk.signal.OPS.SELF_DEALING': 'Operator {operator_ref} created this collector on {created_at} and also {paid_action} the bill on {paid_at}.',
  'risk.signal.OPS.CONCENTRATION':
    'Operator {operator_ref} handled {share_pct} of the {events} actions on this collector’s bills while {operators} operators were active.',

  // ---------------------------------------------------------------------
  // Payout refusals: `PAYOUT_REFUSALS` (constraints) and `PAYOUT_API_REFUSALS`
  // (the routes' own) in `payout/routes/payout.ts`. A test asserts every name
  // in both sets has a sentence in every locale.

  'bo.refused.payout_attempts_previous_not_failed':
    'This bill already has an attempt that has not failed. A new attempt is only possible after the previous one has failed.',
  'bo.refused.payout_attempts_amount_check': 'The amount typed does not equal the bill total rounded down to whole dong. Nothing was recorded.',
  'bo.refused.payout_attempts_account_owner': 'That payout account belongs to a different collector.',
  'bo.refused.payout_attempts_account_current': 'That payout account is no longer the collector’s current one. Reload the bill.',
  'bo.refused.payout_attempts_bank_ceiling':
    'Above ZaloPay’s ceiling of 10,000,000 VND for one bank transfer. It cannot go as one transfer, and splitting it is an escalation, not a button.',
  'bo.refused.payout_attempts_bank_minimum': 'Below ZaloPay’s minimum of 2,000 VND for a bank transfer.',
  'bo.refused.payout_attempts_amount_positive_check':
    'This bill totals less than one dong, so rounded down it is 0 VND, and a payment of nothing is not recorded. Nothing was sent.',
  'bo.refused.payout_attempts_transition_check': 'The attempt cannot move from its current state that way. Reload the list.',
  'bo.refused.payout_attempts_succeeded_immutable': 'A succeeded attempt is final and cannot be changed.',
  'bo.refused.payout_attempts_failed_terminal': 'A failed attempt is final. Paying again is a new attempt.',
  'bo.refused.payout_attempts_pending_operator_only':
    'An attempt pending inside ZaloPay is moved only by an operator with a typed reason. Nothing else moves it.',
  'bo.refused.payout_attempts_manual_reference_check': 'A manual payment needs the transaction reference. None was recorded.',
  'bo.refused.payout_finance_required': 'Only an operator with the finance role may pay or resolve. The server refused.',
  'bo.refused.payout_separation_of_duty':
    'The operator who created this collector, approved this bill, or declared the payout account may not be the one who pays it.',
  'bo.refused.payout_accounts_current_key': 'The collector already has a current payout account. Reload and try again.',
  'bo.refused.payout_accounts_append_only': 'A payout account is a record of a declaration and cannot be changed or removed.',
  'bo.refused.settlements_transition_check':
    'A settlement on this bill was already paid or moved to exception in between. Reload the bill.',
  'bo.refused.payout_mode_manual':
    'The server is in manual payout mode. Transfer the money yourself and record the reference here.',
  'bo.refused.payout_batch_running': 'A run of this period is already in progress on the server. Wait for its report; nothing was sent twice.',
  'bo.refused.payout_transfer_rejected': 'ZaloPay rejected the transfer. The run stopped at this bill; the attempt is recorded as failed and nothing after it was sent.',
  'bo.refused.payout_bill_not_payable': 'Preflight found this bill is not payable. Open the bill for the reason; nothing was sent.',
  'bo.refused.payout_no_client': 'No ZaloPay client is configured on this server, so no transfer can be sent.',
  'bo.refused.payout_account_missing': 'This collector has no current payout account.',
  'bo.refused.payout_account_unverified': 'The collector’s payout account is not verified. ZaloPay must confirm the name first.',
  'bo.refused.payout_attempts_account_unverified':
    'The database refused the attempt: the payout account is not verified. ZaloPay must confirm the name first.',
  'bo.refused.payout_bank_details_unavailable':
    'A bank transfer through the API needs the full account number, which this server does not keep. Pay it manually.',
  'bo.refused.payout_cap_exceeded': 'Above the per-collector cap for this period. A ticket was raised; the cap is never paid instead.',
  'bo.refused.payout_risk_hold': 'The risk engine holds this bill. Clear the hold with a reason in the flag review first.',
  'bo.refused.payout_already_paid': 'This bill is already paid.',
  'bo.refused.payout_accounts_id_reused': 'That account reference already names a different declaration.',
  'bo.refused.payout_account_declaration_invalid':
    'That declaration cannot be stored. A wallet needs a Vietnamese mobile number of ten digits starting with 0; a bank route needs a bank code and an account number.',
  'bo.refused.payout_account_locked_while_paying':
    'A payment to this collector is still open, so the account cannot be changed. Finish or resolve that payment first.',
  'bo.refused.payout_account_not_this_centre':
    'This collector has handed nothing in at this centre, so this counter cannot declare their account.',
  'bo.refused.payout_attempt_not_resolvable':
    'This attempt cannot be resolved by hand in its current state. Only a pending, exhausted or never-sent attempt is.',
  'bo.refused.payout_bill_period_mismatch': 'That bill belongs to a different period.',

  // ---------------------------------------------------------------------
  // Sign-in code delivery: `ZNS_REFUSALS` in `zns.ts`. These are never an HTTP
  // body — the route answers 204 whatever happens, on purpose — so they are
  // read out of `audit_events` by an operator asking why somebody cannot sign
  // in. Each sentence says what to DO, because somebody has to do something:
  // the collector cannot ask again and get a different answer.

  'bo.refused.zns_no_zalo_account':
    'That phone number has no Zalo account, so no sign-in code can reach it and this collector cannot sign in. Ask them to install Zalo on that number, or record a different number for them.',
  'bo.refused.zns_phone_not_vietnamese':
    'The number on this collector’s record is not a Vietnamese mobile number, so no code was sent. Correct the number in the back office.',
  'bo.refused.zns_template_rejected':
    'Zalo refused the sign-in message template. Nobody can sign in until the template is approved and active again. This is a Zalo Official Account matter, not the collector’s.',
  'bo.refused.zns_quota_exhausted':
    'The Zalo Official Account has no notification quota left, so no sign-in code was sent. Nobody can sign in until more is bought.',
  'bo.refused.zns_rate_limited':
    'Zalo is refusing messages for the moment because too many were sent too quickly. It clears by itself; ask the collector to try again in a few minutes.',
  'bo.refused.zns_credentials_rejected':
    'Zalo refused this server’s credentials, so no sign-in code was sent. The access token is wrong or has expired and has to be renewed.',
  'bo.refused.zns_unreachable':
    'Zalo could not be reached, so no sign-in code was sent. Ask the collector to try again; if it keeps happening, the link to Zalo is down.',
  'bo.refused.zns_refused':
    'Zalo refused to send the code and gave a reason this server does not recognise. The reason is in the server log; ask the collector to try again while somebody reads it.',
  /**
   * Shown under a failed write that the server could not explain, next to the
   * id it logged the failure against. The operator reads it out; whoever has
   * the log finds the same id. Before this the body was `{"error":"internal"}`
   * and there was nothing to quote.
   */
  'bo.error.reference': 'Reference:',
  /**
   * The console restyle's own strings (`ui.b.*`): the sentences that stand
   * beside the two ink figures. A figure earns the console's one dark block
   * only when it carries its own sentence, so these are load-bearing rather
   * than captions.
   */
  'ui.b.settle.total.sentence':
    'What this batch would send. The server decides each transfer, and a bill can still be refused at the moment it is paid.',
  'ui.b.risk.holds.count': 'Bills on hold',
  'ui.b.risk.holds.sentence':
    'No transfer leaves while a hold is open. Clearing one needs a verdict and a written reason; the engine appends a row and never edits one.',

  // ---------------------------------------------------------------------
  // The sign-in screen, `/discover`, Home, the not-built page, Pipeline and
  // /episodes.
  //
  // `ui.a.*` are strings that were English literals inside the `.tsx` files.
  // A literal in a component is a string a Chinese reviewer never sees in
  // their own language, and the completeness test cannot find it to complain
  // about, so it survives every review. Moving one here is not a rewrite of
  // the sentence: the English value below is the sentence that was on screen.

  'login.video.region': 'Demo video',

  /*
   * The landing's own strings, and there were fourteen more of them on
   * 2026-09-07: three slogan lines, three burst variants that renamed the
   * third line under a pointer, a marquee sentence, a circular-type sentence,
   * two calls to action, a skip link and two labels for a control that paused
   * a drifting field of photographs.
   *
   * Every one of those elements was deleted when the landing was rebuilt, so
   * every one of those strings is gone with it rather than left as a catalogue
   * row three locales have to keep carrying. `login.hero` went the same way
   * and had already had no caller for some time.
   */

  /*
   * The legal line under the submit. A lead sentence and two named links,
   * each translated as a whole unit — see the note in `Login.tsx` for why the
   * links are not embedded in the sentence.
   */
  'login.legal': 'By signing in you accept how PlayerOne handles your data.',
  'login.legalPrivacy': 'Privacy policy',
  'login.legalData': 'Data collection notice',
  'login.network':
    'The service did not answer. Check the machine is on the centre network and try again.',

  /* ---------------------------------------------------------------------
     `/discover` — the product story, on its own public route.

     **Every value below is a process fact.** There is not a user count, a
     payout total or a percentage anywhere in this block, and none may be
     added. This is a payout-bearing product: a figure on its landing that
     nobody can reproduce from the system is the single worst thing it could
     publish, and an illustrative one has to say that it is illustrative.

     The claims that ARE here are all reproducible from the code or the brief:
     payment is per reviewed effective minute (§5.3.3, UPL-14); payable time
     is the intersection of stream coverage and not the union; a recording is
     started and stopped by the camera's own buttons and by nothing else; the
     TF card is never cleared; a bill's total is rounded down to the whole dong
     in `wholeVnd`; payout runs through ZaloPay.

     The headline is in two halves because the second half carries the page's
     one highlight marker, and the condition — that the minutes have to pass
     review — belongs inside the headline rather than in a footnote under it.
     --------------------------------------------------------------------- */
  'discover.headline.a': 'Meet Ego.',
  'discover.headline.mark': 'Everyday tasks',
  'discover.headline.b': ', from your point of view.',
  'discover.lead':
    'A head-worn camera for recording everyday activities. Collectors earn for reviewed, approved effective minutes.',
  'discover.signIn': 'Sign in to the console',
  /* The public product home introduces the whole thing, not one side of it:
     what Ego is, what the platform does with a recording, and who the two
     audiences are. The two calls to action below are peers because these two
     audiences are peers. */
  'discover.audiences':
    'Two ways in. Collectors record with an Ego camera and are paid for the effective minutes a reviewer approves. Upload-centre operators and reviewers work in the console.',


  /* The demonstration: one player, one caption, nothing over it. */
  'discover.video.caption':
    'A placeholder film, and it is not a recording the camera made: someone wearing Ego is filmed at arm’s length in Paris. Ego records from the wearer’s forehead and cannot see the wearer. A real shoot replaces this.',

  'discover.how.title': 'Four steps, in order',
  'discover.step.record.title': 'Record',
  'discover.step.record.body':
    "You wear the camera and do ordinary work — cooking, gardening, cleaning, ironing. The camera's own buttons start and stop the recording.",
  'discover.step.upload.title': 'Upload',
  'discover.step.upload.body':
    'The card goes across the counter at an upload centre. An operator records the handover and imports it on the centre machine.',
  'discover.step.review.title': 'Human review',
  'discover.step.review.body':
    'A reviewer watches the episode and marks the part that is usable, with a reason code for the rest.',
  'discover.step.payment.title': 'Payment',
  'discover.step.payment.body':
    'A bill is raised for the approved effective minutes at the rate the task carries, and paid through ZaloPay.',

  /* The mosaic. Every cell adds detail the four steps do not carry. */
  'discover.cell.camera.title': 'The camera',
  'discover.cell.camera.body':
    'Ego is a head-worn camera supplied by the platform and bound to one person. Its own buttons start and stop a recording — no application on a phone can do it, and none is going to be given the ability.',
  'discover.cell.pov.caption':
    'The camera worn on the forehead. A frame taken from the placeholder film above, cropped — a third-person view of the device, not a view through it.',
  'discover.cell.activities.title': 'Which activities count',
  'discover.cell.activities.body':
    'Ordinary activity at home, in offices, in shops and in warehouses. Every recording is claimed against a declared task before it starts, so what is suitable is written down in advance rather than judged afterwards.',
  'discover.cell.review.title': 'How review works',
  'discover.cell.review.body':
    'Every episode is watched by a person, who marks the usable part and records failure reason codes for the rest. That judgement is the only source of the number a collector is paid on; nothing on the platform computes it another way.',
  'discover.cell.minutes.title': 'How payable minutes are determined',
  'discover.cell.minutes.body':
    'Payable time is the span that every recorded stream covers together, not the longest one. The device’s own duration figure is advisory and reads high, so the platform measures the media instead.',

  /* Before you participate. Established facts only, and each one is checkable
     against the code or the brief. */
  'discover.before.title': 'Before you participate',
  'discover.before.q.record': 'What am I expected to record?',
  'discover.before.a.record':
    'Ordinary activity, against a task claimed in advance. There is training and an exam before a first task.',
  'discover.before.q.paid': 'Is every recorded minute paid?',
  'discover.before.a.paid':
    'No. Only the part of an episode a reviewer judges usable is payable, and a recording can be rejected in full.',
  'discover.before.q.when': 'When is a payment decided?',
  'discover.before.a.when':
    'After the card is imported and the episode is reviewed. Bills are raised per settlement period, and a total is rounded down to the whole dong.',
  'discover.before.q.data': 'What is collected about me?',
  'discover.before.a.data':
    'The consent declarations the recording agreement asks for, and nothing beyond them. Footage stays resident in Vietnam.',

  'discover.handoff.title': 'Already an operator or a reviewer?',
  'discover.handoff.body':
    'Sign in to the console. Upload-centre operators register a handover and import a card; reviewers watch episodes and decide what is payable.',
  'discover.credits': 'Film and stills: credits and licences',
  'discover.partners':
    'PlayerOne is a joint venture of VNG PT Lab and PaXini. VNG runs the platform and the upload centres; PaXini makes the Ego camera and, in this phase, reviews the footage.',
  /* The thin line under the footer's wordmark. It restates two facts the page
     has already made — a person decides every payment, and footage stays in
     Vietnam — because the bottom of a page is where somebody who skipped the
     middle of it arrives. No figure, and no claim that is not on the page
     above it. */
  'discover.foot.legal':
    'PlayerOne is a joint venture of VNG PT Lab and PaXini. Every recording is judged by a person before any minute of it is payable, and footage stays resident in Vietnam.',
  /* -----------------------------------------------------------------------
     The two audiences, and the one that had nowhere to go.

     Every section above this explains the product to a prospective collector,
     and until 2026-09-08 the only action on the whole page was an *operator*
     sign-in. A collector read seven sections and arrived at a back-office form
     asking for machine credentials. So the page now carries a collector path
     of its own, in the hero and again at the bottom where intent is highest.

     `discover.take.pending` is load-bearing and is not a placeholder for a
     placeholder: the destination — a store listing, an APK, a Zalo flow — has
     not been decided, and inventing one on a payout-bearing page is worse than
     saying it is not published. The control names the action and the sentence
     under it names the state. When the real destination lands, the control
     becomes a link and this key comes out.
     -------------------------------------------------------------------- */
  'discover.ways.title': 'Where to go from here',
  'discover.take.cta': 'Download the APK',
  'discover.take.title': 'Collectors',
  'discover.take.body':
    'Collecting starts with training and an exam. Each recording is claimed against a task before the camera is switched on, and the camera itself is supplied by the platform and stays with it. What is paid is the effective minutes a reviewer approves.',
  'discover.take.pending':
    'The APK is not published yet, so there is nothing to download from this page today. The build will be linked here when it is released.',

  /* -----------------------------------------------------------------------
     Build seven, 2026-09-08. The four-step strip is deleted and its content
     is now the headline: four phrases, one per line, in the order the work
     happens. A step of a process is a sentence, not a card, and four cards
     in a row was the arrangement the product owner rejected by name.

     The chips are fragments of the real console — a claimed task, a card
     received at a counter, a verdict pill out of `primitives.tsx`, the rule
     a collector is paid under. Nothing here is a figure: this page is
     payout-bearing and every number on it would be one nobody has cleared.
     -------------------------------------------------------------------- */
  'discover.nav.label': 'On this page',
  'discover.nav.camera': 'The camera',
  'discover.nav.work': 'The work',
  'discover.nav.review': 'Review',
  'discover.nav.payment': 'Payment',
  'discover.nav.questions': 'Questions',

  'discover.eyebrow': 'Ego — a head-worn camera',
  'discover.line.1': 'Record.',
  'discover.line.2': 'Hand in the card.',
  'discover.line.3': 'A person reviews it.',
  'discover.line.4': 'The minutes are paid.',

  'discover.chip.task': 'Task claimed',
  'discover.chip.handover': 'Card in at the counter',
  'discover.chip.rate': 'Paid per reviewed minute',

  'discover.label.camera': 'The device',
  'discover.label.work': 'The work',
  'discover.label.film': 'Placeholder film',
  'discover.label.review': 'Review',
  'discover.label.payment': 'Payment',
  'discover.label.questions': 'Questions',
  'discover.label.next': 'Next',

  'discover.work.note':
    'Placeholder stills of ordinary work. None of them is a recording the Ego camera made, and none is captioned as one. A real shoot replaces them.',

  'discover.verdict.note':
    'A reviewer records one of three outcomes and names a reason code for anything not usable.',

  'discover.streams.video': 'Video',
  'discover.streams.audio': 'Audio',
  'discover.streams.imu': 'Motion',
  'discover.streams.payable': 'Payable: the span every stream covers together',
  'discover.streams.device':
    'The device reports its longest stream. That figure is advisory and it reads high.',

  /* -----------------------------------------------------------------------
     The not-found route. It is a real route rather than a redirect, because
     a person who mistyped a console URL needs to be told the address is
     wrong — a silent bounce to the product page reads as the console having
     lost their screen.
     -------------------------------------------------------------------- */
  'nf.eyebrow': 'No such page',
  'nf.title.a': 'Nothing was',
  'nf.title.b': 'recorded at',
  'nf.title.c': 'this address.',
  'nf.body':
    'The link is wrong, or the page has moved. Everything the platform explains about itself is on the product page.',
  'nf.back': 'Back to the product page',

  /* The full-bleed pair. Captions sit at the foot of each panel; the stills are
     420x420 and are held at a size they are sharp at rather than stretched. */

  'ui.a.home.gauge': 'Reviewed {{value}} of {{target}} episodes this shift',
  /* The caption under the band's figure, where the count is already drawn. */
  'ui.a.home.gaugeCaption': 'episodes reviewed this shift',
  'ui.a.home.payable.note': 'Effective duration from decided reviews only.',
  'ui.a.home.approval.note': 'Passes and partial passes, against every decision today.',
  'ui.a.home.pace.note': 'Load to verdict. Instrumentation, never money.',
  'ui.a.home.clock': 'This machine\'s clock.',
  'ui.a.home.approval.target': 'Programme target 85–90%.',
  'ui.a.home.recent.time': 'Time',
  'ui.a.home.recent.episode': 'Episode',
  'ui.a.home.recent.verdict': 'Verdict',
  'ui.a.home.recent.duration': 'Measured → effective',
  'ui.a.home.recent.amount': 'Amount',
  'ui.a.home.recent.pace': 'Pace',
  /**
   * DESIGN.md, "Copy". This sentence is not decoration and must survive any
   * rewrite: the figure above it is one reviewer's own decisions and somebody
   * reading it as the programme's budget would be wrong by orders of
   * magnitude. The English is byte-identical to the sentence DESIGN.md pins.
   */
  'ui.a.home.settled.note': 'Your decisions only. Not the programme\'s spend.',
  'ui.a.home.settled.open': 'Open settlement',
  'ui.a.home.error.title': 'The shift figures did not load.',
  'ui.a.home.error.body':
    'Everything else on this screen still works. The counters come from the review database; if this keeps happening, the API cannot reach Postgres.',
  'ui.a.home.recent.error': 'Your recent verdicts did not load.',
  /* Shown where a figure would be. Not a zero: nothing was measured. */
  'ui.a.home.unavailable': 'No figure',

  /*
   * Home, rebuilt around one order: attention needed, next action, shift
   * results, recent work, optional insights.
   *
   * `asOf` is the freshness stamp every operational sentence on that screen
   * carries — the mascot's included. A claim about the queue with no time on
   * it is a claim about an unknown moment, and the moment is what makes it
   * checkable.
   */
  'ui.a.home.asOf': 'As of {{time}}',
  'ui.a.home.next.title': 'One recording at a time.',
  'ui.a.home.next.body':
    "A verdict here is the only place a collector's payment comes from. Take the next episode when you are ready.",
  'ui.a.home.queueWaiting': 'waiting in your queue',
  'ui.a.home.results': 'What this shift has done',
  'ui.a.home.median': 'Median time to verdict',
  'ui.a.home.median.note':
    'The middle value across the reviews this shift timed. Instrumentation, never money.',
  'ui.a.home.attention.none': 'Nothing is waiting for a human.',
  'ui.a.home.attention.unknown':
    'Not connected. This screen cannot say what needs attention.',

  /*
   * Trúc's own strings, and the rule they exist under: a greeting is authored,
   * an operational statement is evidence. `truc.greet` is the authored half.
   * `truc.offline` is what he says instead of a figure when the request
   * failed, and `truc.source` is where the one figure he does report came
   * from. He never gets a sentence that has no counterpart on the page.
   */
  'ui.a.home.insights': 'Optional insights',
  'ui.a.home.truc.lede':
    'Trúc is an extra channel. Everything he says is written on this page as well, so nothing depends on him.',
  'ui.a.home.truc.greet': 'Hello. {{shift}}.',
  'ui.a.home.truc.offline': 'Not connected. I have nothing measured to tell you.',
  'ui.a.home.truc.source': 'Source: your shift figures.',
  'ui.a.home.truc.pause': 'Pause Trúc',
  'ui.a.home.truc.resume': 'Resume Trúc',

  /*
   * The preview: numerical demonstrations, entered by hand and labelled at
   * every value rather than once at the top of the group. A heading two
   * hundred pixels away is not what somebody photographs.
   */
  'ui.a.home.preview.show': 'Show example insights',
  'ui.a.home.preview.hide': 'Hide example insights',
  'ui.a.home.preview.why':
    'Nothing here is measured. The examples show the shape of a panel that is not built yet.',
  'ui.a.home.preview.note':
    'The shift endpoint returns current figures and no history, so there is no trend behind any of these. They are drawn to agree a layout, and they are never shown in place of a figure that failed to load.',
  'ui.a.home.preview.badge': 'Example — not live data',
  'ui.a.home.preview.trend': 'Most recorded scenario',
  'ui.a.home.preview.trendValue': 'Gardening',
  'ui.a.home.preview.week': 'Footage you judged this week',
  'ui.a.home.preview.streak': 'Shifts in a row',

  'ui.a.notBuilt.today': 'How this is done today',

  'ui.a.pipeline.track': 'What a recording passes through',
  'ui.a.pipeline.owed': 'Waiting on PaXini',

  'episodes.title': 'Episodes needing attention',
  'episodes.intro':
    'Browsing every episode by task, collector, device, status and recording time (BO-05) needs a list endpoint that does not exist yet.',
  'episodes.batch': 'Batches imported on this machine, last 100',
  'episodes.batch.pick': 'Batch',
  'episodes.batch.none': 'No batches have been imported on this machine.',
  'episodes.batch.failed': 'The batch list did not load.',
  'episodes.blocking': 'Blocking, this batch',
  'episodes.blocking.scope':
    'Episodes that hold the chosen batch open. Scoped to this machine, by import time.',
  'episodes.stuck': 'Stuck, this centre',
  'episodes.stuck.scope':
    'Parked or held work anywhere in this upload centre, whichever batch it arrived on.',
  'episodes.empty': 'No attention items in this scope.',
  'episodes.filter': 'Filter these rows',
  'episodes.col.episode': 'Episode',
  'episodes.col.session': 'Session start',
  'episodes.col.state': 'Attribution',
  'episodes.col.needs': 'Needs',
  'episodes.col.device': 'Card',
  'episodes.col.hold': 'Hold',
  'episodes.needs.assignment': 'A session to attribute it to',
  'episodes.needs.confirmation': 'A person to confirm the match',
  'episodes.hold.parked': 'Parked',
  'episodes.hold.held': 'Held in review',
  'episodes.summary.episodes': 'Episodes',
  'episodes.summary.sessions': 'Sessions',
  'episodes.summary.quarantined': 'Quarantined',
  'episodes.summary.awaiting': 'Awaiting confirmation',
  'episodes.summary.parked': 'Parked out of review',
  'episodes.summary.perSession': 'Episodes per session',
  'episodes.resolve': 'Attribute',
  'episodes.resolve.title': 'Attribute this episode',
  'episodes.resolve.session': 'Session',
  'episodes.resolve.reason': 'Why this session',
  'episodes.resolve.reasonHint': 'The database refuses a resolution that carries no reason.',
  'episodes.resolve.done': 'Attributed. The batch has been read again.',
  'episodes.outcome': 'Review outcome',
  'episodes.outcome.state': 'Verdict',
  'episodes.outcome.pending': 'No verdict yet on the delivery that counts.',
  'episodes.outcome.collector': 'Collector',
  'episodes.outcome.decided': 'Decided',
  'episodes.outcome.note': 'Reviewer note',
  'episodes.outcome.reasons': 'Reason codes',
  'episodes.outcome.failed': 'The outcome did not load.',
  'episodes.close': 'Close',
  'episodes.gone': 'That episode is no longer on the server. Read the batch again.',
  'episodes.reload': 'Read again',
  'episodes.noMatch': 'No row in this scope matches the filter.',
  /* ---------------------------------------------------------------------
     The wizard grammar, shared by the counter's card intake and the back
     office's task assignment. One decision per step, a rail that says where
     you are, and a summary of every answer before anything is written.
     --------------------------------------------------------------------- */

  'wiz.step': 'Step',
  'wiz.review': 'Check and commit',
  'wiz.review.question': 'Check every answer before this is written.',
  'wiz.unanswered': 'Not answered',
  'wiz.edit': 'Change',
  'wiz.back': 'Back',
  'wiz.next': 'Next',
  'wiz.needAnswer': 'Answer this question to go on.',
  'wiz.failed.gone':
    'The server no longer holds the row this step names. Reload the screen and start again.',
  'wiz.failed.body':
    'The server would not accept one of the answers. That is a fault in this console rather than in what you typed; quote the reference below when you report it.',
  'wiz.failed.session':
    'This session is not allowed to make that change. Sign in again, or ask an operator who holds the administrator role.',

  /* ---------------------------------------------------------------------
     The counter: card intake (BO-10, APP-17b).
     --------------------------------------------------------------------- */

  'counter.title': 'Card intake',
  'counter.intro':
    'A collector hands in a TF card. Record who handed it over, which camera it came out of, and what was recorded on it. Nothing is written until the last step.',
  'counter.review.intro':
    'Two rows go in: the handover of the card, and the recording declared against it. Change any answer from here.',
  'counter.group.card': 'The card',
  'counter.group.recording': 'The recording',

  'counter.step.collector': 'Collector',
  'counter.step.device': 'Camera',
  'counter.step.card': 'Card',
  'counter.step.task': 'Task',
  'counter.step.scenario': 'Scenario',
  'counter.step.declare': 'Declarations',

  'counter.q.collector': 'Who handed this card over?',
  'counter.q.device': 'Which camera did the card come out of?',
  'counter.q.card': 'Which card is it, and when did it arrive?',
  'counter.q.task': 'Which task was this recorded against?',
  'counter.q.scenario': 'Where was it recorded, and when was the recording prepared?',
  'counter.q.declare': 'What did the collector declare?',

  'counter.note.collector':
    'One card belongs to one collector, and that is the person at the counter. The centre, this machine and your own name come from the credentials you signed in with, so none of them is asked for here.',
  'counter.note.device':
    'Cameras move between collectors and cards move between cameras. Neither is inferred from whoever last held it, so the camera is named rather than guessed.',
  'counter.note.card':
    'The label on the card, as it is written on the card. The time is when it changed hands at this counter, not when anything was recorded.',
  'counter.note.task':
    'The task decides the rate. The collector has to hold a live claim on it already; if they do not, the server refuses the recording and says which of the three reasons it is.',
  'counter.note.scenario':
    'The prepare time is what the collector remembers. It is never matched against the footage automatically, because only a session the app created is, so an operator confirms the attribution after the card is imported.',
  'counter.note.declare':
    'Both answers are required. "No" is an answer and "nobody asked" is not, and the record has no way to say the second.',

  'counter.field.card': 'TF card',
  'counter.hint.card': 'As written on the card.',
  'counter.field.handoverAt': 'Handed over at',
  'counter.hint.handoverAt': 'Your own local time.',
  'counter.field.preparedAt': 'Recording prepared at',
  'counter.hint.preparedAt':
    'Your own local time. There is no end time, and there is no field for one.',

  'counter.declare.others': 'Other people appear in the footage',
  'counter.declare.sensitive': 'Sensitive information appears in the footage',
  'counter.declare.yes': 'Yes',
  'counter.declare.no': 'No',

  'counter.privacy.low': 'Low privacy risk',
  'counter.privacy.medium': 'Medium privacy risk',
  'counter.privacy.high': 'High privacy risk',

  'counter.empty.collectors':
    'No collectors have reached this machine. The roll is kept in the back office, and an empty one here usually means the reference sync has not arrived.',
  'counter.empty.devices':
    'No cameras have reached this machine. The fleet is kept in the back office, and an empty one here usually means the reference sync has not arrived.',
  'counter.empty.tasks':
    'No tasks have reached this machine. A recording is always recorded against a task, so nothing can be declared until one exists.',
  'counter.empty.scenarios':
    'No scenarios have reached this machine. Scenarios are reference data seeded with the service, so an empty list means the reference sync did not arrive.',

  'counter.commit': 'Record the handover',
  'counter.commit.session': 'Record the recording',
  'counter.recorded':
    'Already written, under the id this intake started with. Sending it again would change nothing. Start a new card if it is wrong.',
  'counter.landed':
    'The handover is on the record. Only the recording is still to be written, and the first three answers cannot change underneath it. Start a new card if one of them is wrong.',
  'counter.refused.reference':
    'This machine holds a reference list the server does not recognise. Reload the screen and choose again. Not found:',

  'counter.done.title': 'Card recorded',
  'counter.done.card':
    'The card is not cleared. Nothing on this path deletes what is on it, and nothing will.',
  'counter.done.match':
    'This was recorded at the counter, so the footage is not matched to it by time. An operator confirms the attribution on Episodes once the card has been imported.',
  'counter.done.nextCard': 'Next card',
  'counter.done.nextSession': 'Another recording on this card',

  /* ---------------------------------------------------------------------
     The back office: creating a task and putting people on it (BO-01,
     BO-02, APP-10, and the device custody period a settlement reads).
     --------------------------------------------------------------------- */

  'assign.title': 'New task',
  'assign.review.intro':
    'The task is created first, published if you asked for that, then claimed for each collector in turn. Change any answer from here.',
  'assign.commit': 'Create the task',
  'assign.group.task': 'The task',
  'assign.group.people': 'The people',

  'assign.step.name': 'Name',
  'assign.step.rate': 'Rate',
  'assign.step.capacity': 'Places',
  'assign.step.publish': 'Publish',
  'assign.step.claimants': 'Claimants',
  'assign.step.cameras': 'Cameras',

  'assign.q.name': 'What is this task called?',
  'assign.q.rate': 'What does it pay?',
  'assign.q.capacity': 'How many collectors may hold it at once?',
  'assign.q.publish': 'Publish it now?',
  'assign.q.claimants': 'Who is taking it on?',
  'assign.q.cameras': 'Does a camera go out with anybody?',

  'assign.note.name':
    'The name is what a collector reads in the task hall. The type follows PaXini own taxonomy and has no fixed list.',
  'assign.note.rate':
    'A decimal, up to eight digits and four decimals, exactly as the column stores it. It multiplies into every payment, so nothing rounds it on the way in, and once the task is published the figure cannot move.',
  'assign.note.capacity':
    'The cap counts live claims. Releasing a claim gives the place back to the task.',
  'assign.note.publish':
    'A draft cannot be claimed: the database refuses a claim on a task that is not published. Leave it a draft to finish the details later and publish it from the table.',
  'assign.note.claimants':
    'A claim is this collector holding this task, and what they record against it is paid at its rate. Nobody is a real answer, because a published task can be left for the task hall to fill.',
  'assign.note.cameras':
    'A custody period, not a bind: this is what a settlement reads to say who held a camera on a given day. Any period still open on that camera is closed at the same instant.',

  'assign.hint.type': 'PaXini taxonomy. No fixed list.',
  'assign.hint.target': 'Optional. Effective seconds.',

  'assign.publish.label': 'Publish this task now',
  'assign.publish.now': 'Published',
  'assign.publish.draft': 'Left as a draft',

  'assign.claimants.none': 'Nobody',
  'assign.claimants.empty':
    'There are no collectors yet. Create one on the collectors tab, then come back.',
  'assign.cameras.none': 'No camera goes out',
  'assign.cameras.no': 'No camera',
  'assign.cameras.noClaimants':
    'Nobody is taking this task on, so there is no camera to hand out.',

  'assign.done.title': 'Task created',
  'assign.done.published': 'Published. Collectors can claim it.',
  'assign.done.draft': 'Left as a draft. Publish it from the table when it is ready.',
  'assign.done.nobody':
    'Nobody was put on it. Collectors can claim it themselves from the task hall, or you can claim it for them from this tab.',
  'assign.done.claimed': 'Holds the task.',
  'assign.done.assigned': 'Camera handed out.',
  'assign.done.someRefused':
    'Part of what you asked for was refused. The task itself was created; the lines above say who was not put on it and why.',
  'assign.done.close': 'Back to the tasks',
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  'bo.error.reference': '编号：',
  'app.name': 'PlayerOne',
  'app.review': '审核',
  'app.signOut': '退出登录',
  'app.language': '语言',

  'login.title': '登录以进行审核',
  'login.titleOperator': '登录上传中心',
  'login.groupMachine': '机器',
  'login.fieldIdentifier': '标识',
  'login.fieldReference': '编号',
  'login.fieldSecret': '密钥',
  'login.trucOpen': '询问小竹',
  'login.trucTitle': '小竹',
  'login.trucBody': '小竹暂时还不能回答。接通后，你可以在这里询问某个判定的含义、存储卡为何被拒，或某笔付款去了哪里。',
  'login.trucSoon': '尚未接通',
  'login.trucClose': '关闭',
  'login.groupOperator': '操作员',
  'login.groupReviewer': '审核员',
  'login.intro': '与本服务其他部分一致，需要两组凭据：机器凭据证明地点，操作员凭据证明身份。',
  'login.machine': '机器标识',
  'login.machineSecret': '机器密钥',
  'login.operator': '操作员编号',
  'login.operatorSecret': '操作员密钥',
  'login.role': '登录身份',
  'login.roleCounter': '上传中心',
  'login.roleReviewer': '审核员',
  'login.reviewer': '审核员编号',
  'login.reviewerSecret': '审核员密钥',
  'login.reviewerIntro': '仅需一组凭据。审核员远程办公，不在上传柜台，因此无需机器凭据；该会话仅可访问审核功能。',
  'login.submit': '登录',
  'login.failed': '凭据未被接受。',
  'login.mismatch': '机器与操作员属于不同的上传中心。',

  'queue.depth': '队列中',
  'queue.average': '每条平均用时',
  'queue.empty.title': '暂无待审核内容',
  'queue.empty.body': '所有已归属且通过完整性校验的片段均已处理。新导入的素材会出现在这里。',
  'queue.refresh': '重新检查',

  'meta.episode': '片段',
  'meta.folder': '卡内目录',
  'meta.task': '任务',
  'meta.rate': '每分钟单价',
  'meta.collector': '采集者',
  'meta.scenario': '场景',
  'meta.device': '设备',
  'meta.firmware': '固件',
  'meta.measured': '实测时长',
  'meta.claimed': '设备申报',
  'meta.discrepancy': '差值',
  'meta.recorded': '录制时间',
  'meta.timing': '时间来源',
  'meta.attribution': '归属方式',
  'meta.flags': '标记',
  'meta.declared': '采集者申报',
  'meta.othersInFrame': '画面中有他人',
  'meta.sensitive': '涉及敏感信息',
  'meta.yes': '是',
  'meta.no': '否',
  'meta.none': '无',
  'bo.flag.DUR-MANIFEST-INFLATED': '设备清单声称的录制时长超过实际媒体文件的时长。',
  'bo.flag.FRAMECOUNT-MISMATCH': '清单声明的帧数与从媒体文件中实测的帧数不一致。',
  'bo.flag.AUDIO-STATS-ZERO': '清单报告音频帧数为零，但实际存在音频流。',
  'bo.flag.MANIFEST-FILES-UNRESOLVED': '清单列出的部分文件在存储卡上并不存在。',
  'bo.flag.SESSION-UNCLOSED': '设备没有写入结束时间，但录制内容本身没有问题。',
  'bo.flag.STATS-ZEROED': '清单中的统计数据全为零，但媒体文件确实存在。',
  'bo.flag.PTS-EMPTY': '时间戳附属文件存在于存储卡上，但其中没有任何时间戳。',
  'bo.flag.PTS-ABSENT': '该数据流没有随附时间戳文件。',
  'bo.flag.PTS-TRUNCATED': '时间戳文件在一行中间中断，最后一条不完整的记录已被丢弃。',
  'bo.flag.STATS-STALE': '统计数据似乎是从上一段录制中复制而来，与实测结果不符。',
  'bo.flag.STREAM-CLOCK-FAULT': '该数据流的时间跨度无法用其自身的采样数量来解释。',
  'bo.flag.DEVICE-CLOCK-UNSET': '设备时钟未设置，因此该录制没有可用日期。素材本身正常，仍可计酬；但无法按时间匹配采集会话，请确认它属于哪一次采集。',
  'bo.flag.PART-MISSING-TAIL': '存储卡上的分段数少于清单声明的数量，录制提前结束。',
  'bo.flag.TIMING-ESTIMATED': '时间信息是推算得出而非精确读取，因此可结算时长的确定性较低。',
  'bo.flag.STREAM-SKEW-HIGH': '各数据流的起始时间相差过大。',
  'bo.flag.PART-GAP': '同一数据流的两个相邻分段之间存在时间空隙。',
  'bo.flag.PART-ORDER-CONFLICT': '分段编号与时间戳所显示的先后顺序相互矛盾。',
  'bo.flag.FIRMWARE-UNKNOWN': '设备固件版本不在本平台已测试的范围之内。',
  'bo.flag.CAMERA-NAMING-CONFLICT': '存储卡上的摄像头命名与清单中的描述不一致。',
  'bo.flag.IMU-RATE-ANOMALY': '实测的 IMU 采样率与清单声明的采样率不符。',
  'bo.flag.CALIB-MISSING': '该片段没有随附标定文件。',
  'bo.flag.MEDIA-MISSING': '本次录制声明的某个数据流在磁盘上没有对应的媒体文件。',
  'bo.flag.MEDIA-UNREADABLE': '媒体文件存在，但无法解码。',
  'bo.flag.MEDIA-TRUNCATED': '媒体文件结构上不完整：传输没有完成。',
  'bo.flag.ROWS-MALFORMED': '时间戳文件中包含并非时间戳的行。',
  'bo.flag.CALIB-UNREADABLE': '标定文件在磁盘上，但无法解析。',
  'bo.flag.MANIFEST-UNREADABLE': '清单文件在磁盘上但无法解析，因此没有任何内容与之比对。',
  'bo.flag.PART-MISSING-INTERIOR': '多分段数据流的中间缺少了一个分段。',
  'bo.flag.CHECKSUM-MISMATCH': '同一次录制的两次交付之间，文件字节发生了变化。',
  'bo.flag.DUR-EXCEEDS-WINDOW': '声明的时长超过了该记录自身时间戳所描述的时间窗口。',
  'bo.flag.EPISODE-ID-FALLBACK': '目录名无法解析，片段编号退回使用原始目录名。',
  'bo.flag.SERIAL-CONFLICT': '目录名、清单和标定文件对设备序列号的记载互不一致。',
  'bo.flag.SESSION-CONFLICT': '声明的录制编号与交接记录不一致。',
  'meta.unknown': '未知',
  'meta.claimHint': '仅供参考。设备清单会高估素材长度。',
  'meta.measuredHint': '结算以此为准。',

  'player.play': '播放',
  'player.pause': '暂停',
  'player.rate': '速度',
  'player.part': '分段',
  'player.position': '播放位置',
  'player.of': '/',
  'player.loading': '正在加载素材',

  'mark.in': '标记入点',
  'mark.out': '标记出点',
  'mark.clear': '清除该区间',
  'mark.pending': '入点已设置。按 O 结束该区间。',
  'mark.orphanOut': '请先按 I 设置入点。',
  'mark.spans': '已标记区间',
  'mark.none': '尚未标记',
  'mark.estimate': '有效时长（估算）',
  'mark.estimateHint': '仅为估算。结算以服务端计算结果为准。',
  'mark.needsSpan': '部分通过至少需要标记一个区间。',

  'verdict.good': '通过',
  'verdict.partial': '部分通过',
  'verdict.bad': '拒绝',
  'verdict.commit': '提交并继续',
  'verdict.note': '备注（可选）',
  'verdict.reasons': '原因',
  'verdict.reasonsRequired': '拒绝时必须至少选择一个原因。',
  'verdict.committing': '正在记录结果',

  'state.leaseExpired.title': '该片段已被重新分配',
  'state.leaseExpired.body': '认领已过期，可能已由其他审核员接手。您正在填写的结果已被丢弃。',
  'state.leaseExpired.action': '领取下一条',
  'state.playbackWithheld.title': '本会话暂未开放审核',
  'state.playbackWithheld.body':
    '原始素材的远程播放尚未获得授权，因此此处暂无可审核的内容。系统未从队列中取走任何片段；未观看素材即不可提交审核结论。播放方案获批后本页即可使用。',
  'state.mediaFailed.title': '素材无法播放',
  'state.mediaFailed.body': '记录已存在于数据库中，但本机无法读取该文件。这是本机的问题，与录制内容无关。',
  'state.mediaFailed.action': '跳过该片段',
  'state.writeFailed.title': '结果未被记录',
  'state.writeFailed.body':
    '提交未送达服务器。没有产生任何结算，也没有跳转到下一条。请重试，或释放该片段使其回到队列。',
  'state.writeFailed.retry': '重试',
  'state.writeFailed.release': '释放',

  'state.refused.title': '服务端拒绝了本次审核结果',
  'state.refused.hold': '退回上传柜台',
  'state.refused.holdReason': '需要柜台处理的问题',
  'state.refused.holding': '正在退回',
  'state.refused.holdFailed': '该片段未被移出队列，仍在队列中。请重试，或直接联系上传柜台。',
  'state.refused.held.title': '已退回上传柜台',
  'state.refused.held.body':
    '该片段已移出审核队列，在柜台处理拒绝原因之前不会再分配给任何人。未产生任何结算。',
  'state.offline.title': '网络已断开',
  'state.offline.body': '离线状态下无法记录审核结果。',
  'state.loadFailed.title': '无法连接队列',

  'shortcuts.title': '键盘操作',
  'shortcuts.show': '快捷键',
  'shortcuts.spaceKey': '空格',
  'shortcuts.playPause': '播放或暂停',
  'shortcuts.seek': '后退或前进 5 秒',
  'shortcuts.frame': '逐帧后退或前进',
  'shortcuts.rate': '减速或加速',
  'shortcuts.markIn': '标记入点',
  'shortcuts.markOut': '标记出点',
  'shortcuts.clear': '清除播放头所在区间',
  'shortcuts.verdict': '通过、部分通过、拒绝',
  'shortcuts.commit': '提交并继续',
  'shortcuts.help': '显示或隐藏本说明',

  'recent.title': '最近的审核',
  'recent.empty': '本次登录尚无记录',

  'nav.home': '概览',
  'nav.counter': '柜台',
  'nav.review': '审核',
  'nav.episodes': '片段',
  'nav.settle': '结算',
  'nav.pipeline': '流程',
  'nav.notBuilt': '尚未开发',
  'nav.notBuilt.body': '该界面已在计划中，目前尚无页面。相关工作现在通过命令行完成。',

  'home.greeting': '本班次',
  'home.reviewed': '已审核片段',
  'home.target': '目标',
  'home.start': '开始审核',
  'home.payable': '今日可结算时长',
  'home.approval': '通过率',
  'home.settled': '结算金额',
  'home.needsHuman': '个片段需要人工处理',
  'home.needsHuman.body': '归属程序拒绝猜测录制人。',
  'home.needsHuman.open': '打开',
  'home.queueEmpty': '队列已清空，Cú 没有可看的内容。',
  'home.shiftEarly': '早班',
  'home.shiftDay': '白班',
  'home.shiftGolden': '黄昏',
  'home.shiftNight': '夜猫子',

  'pipeline.title': '已建成的部分',
  'pipeline.intro': '需求文档列出的每项能力，以及各自的真实状态。受阻项会写明所缺的交付物。',
  'pipeline.built': '已建成',
  'pipeline.next': '下一步',
  'pipeline.blocked': '受阻',
  'pipeline.capability': '能力',
  'pipeline.requirement': '需求编号',
  'pipeline.state': '状态',
  'pipeline.surface': '所属界面',
  'pipeline.state.built': '已建成',
  'pipeline.state.partial': '部分完成',
  'pipeline.state.buildable': '可开发',
  'pipeline.state.blocked': '受阻',
  'pipeline.state.verified': '已验证',

  'nav.backoffice': '后台',

  'bo.title': '后台管理',
  'bo.intro': '采集者按任务采集并获得报酬。这里管理任务、采集者，以及他们携带的设备。',
  'bo.tab.tasks': '任务',
  'bo.tab.collectors': '采集者',
  'bo.tab.devices': '设备',
  'bo.empty': '暂无数据。',
  'bo.loadFailed': '该列表未能加载。',
  'bo.loadFailed.body': '后台通过 API 读取数据。没有任何内容被修改。',
  'bo.working': '处理中',
  'bo.edit': '编辑',
  'bo.save': '保存',
  'bo.cancel': '取消',

  'bo.task.name': '任务',
  'bo.task.type': '类型',
  'bo.task.rate': '每分钟单价',
  'bo.task.target': '目标有效时长',
  'bo.task.claimants': '已领取',
  'bo.task.maxClaimants': '最大同时领取人数',
  'bo.task.state': '状态',
  'bo.task.state.draft': '草稿',
  'bo.task.state.published': '已发布',
  'bo.task.state.taken_down': '已下架',
  'bo.task.publish': '发布',
  'bo.task.takeDown': '下架',
  'bo.task.new': '新建任务',
  'bo.task.create': '创建草稿',
  'bo.task.priceNote': '单价按填写内容原样存储，并直接用于计算报酬。此处不做任何取整。',
  'bo.task.priceFrozen': '已发布任务的单价不能在此修改。请先下架，再发布新任务。',

  'bo.collector.ref': '采集者',
  'bo.collector.status': '资格状态',
  'bo.collector.status.pending': '待审核',
  'bo.collector.status.qualified': '已合格',
  'bo.collector.status.suspended': '已停用',
  'bo.collector.exam': '考试',
  'bo.collector.exam.pass': '通过',
  'bo.collector.exam.fail': '未通过',
  'bo.collector.exam.none': '未参加',
  'bo.collector.agreements': '协议',
  'bo.collector.gate': '未通过考试则不能领取任务。该限制由服务端强制执行，不只是界面控制。',
  'bo.collector.markPass': '记录通过',
  'bo.collector.markFail': '记录未通过',
  'bo.collector.clearExam': '清除考试记录',
  'bo.collector.new': '新增采集者',
  'bo.collector.create': '添加采集者',
  'bo.collector.missing': '缺少',
  'bo.collector.recordAgreement': '登记协议接受',
  'bo.collector.agreement': '协议',
  'bo.collector.version': '接受的版本',
  'bo.collector.acceptedAt': '接受时间',
  'bo.collector.agreement.user': '用户协议',
  'bo.collector.agreement.privacy': '隐私政策',
  'bo.collector.agreement.data_collection': '数据采集协议',
  'bo.collector.agreement.commercial_use': '商业使用协议',
  'bo.collector.agreement.manual_review': '人工审核协议',
  'bo.collector.agreement.offline_settlement': '线下结算协议',
  'bo.collector.payout': '收款账户',
  'bo.collector.payout.none': '未申报',
  'bo.collector.payout.declare': '申报账户',
  'bo.collector.payout.redeclare': '更换账户',
  'bo.collector.payout.method': '收款方式',
  'bo.collector.payout.method.WALLET': 'ZaloPay 钱包',
  'bo.collector.payout.method.BANK_ACCOUNT': '银行账户',
  'bo.collector.payout.method.BANK_CARD': '银行卡',
  'bo.collector.payout.holder': '账户姓名',
  'bo.collector.payout.phone': '手机号',
  'bo.collector.payout.bankCode': '银行代码',
  'bo.collector.payout.accountNo': '账号或卡号',
  'bo.collector.payout.note': '按采集者出示的内容填写。号码会发送给 ZaloPay 以确认姓名，本系统不保存：只保留后四位。',
  'bo.collector.payout.declared': '已申报。ZaloPay 的答复：',
  'bo.collector.payout.open': '打开采集者需要的 ZaloPay 页面',

  'bo.device.serial': '序列号',
  'bo.device.type': '型号',
  'bo.device.firmware': '固件',
  'bo.device.state': '状态',
  'bo.device.state.active': '在用',
  'bo.device.state.faulty': '故障',
  'bo.device.state.retired': '已退役',
  'bo.device.holder': '绑定至',
  'bo.device.unbound': '未绑定',
  'bo.device.bind': '绑定',
  'bo.device.unbind': '解绑',
  'bo.device.new': '新增设备',
  'bo.device.create': '添加设备',
  'bo.device.faultNote': '故障说明',
  'bo.device.retireNote': '已退役的设备不能仍在他人手中，请先解绑。',
  'bo.device.rollFailed': '采集者列表未能加载，暂时无法绑定。没有任何内容被修改。',

  'bo.refused': '已拒绝',
  'bo.refused.sign_in_rate_limited':
    '登录尝试失败次数过多。请等待几分钟后重试——该限制会自动解除，无需任何人解锁。',
  'bo.refused.task_claims_capacity': '该任务的领取人数已达上限。',
  'bo.refused.task_claims_exam_gate': '该采集者尚未通过考试，不能领取任务。',
  'bo.refused.task_claims_published_gate': '只有已发布的任务才能被领取。',
  'bo.refused.task_claims_live_key': '该采集者已经领取了这个任务。',
  'bo.refused.tasks_status_transition': '任务状态只能从草稿到已发布再到已下架，不能回退。',
  'bo.refused.tasks_price_frozen': '已发布任务的单价是领取者已接受的条款。请先下架，再发布新任务。',
  'bo.refused.task_claims_qualified_gate': '该采集者不具备合格资格，不能领取任务。',
  'bo.refused.task_claims_consent_gate': '该采集者尚未接受全部六项协议，不能领取任务。',
  'bo.refused.task_claims_id_reused': '该领取编号已属于其他任务或采集者。',
  'bo.refused.collector_agreements_append_only': '协议接受记录是当时的事实记录，不可修改或删除。',
  'bo.refused.devices_retired_unbound_check': '请先解绑设备，再将其退役。',
  'bo.refused.backoffice_admin_required':
    '该操作需要管理员角色。您当前是上传中心操作员，权限覆盖交接、导入和各类队列。请让管理员执行该操作，或为您授予该角色。',
  'bo.refused.collectors_external_ref_key': '该采集者编号已被占用。',
  'bo.refused.devices_hardware_serial_key': '该序列号已被其他设备占用。',
  'bo.refused.device_already_bound': '该设备已绑定给其他人，请先解绑。',
  'bo.refused.task_claims_released': '该领取已释放。重新领取属于新的领取，需要新的领取编号。',
  'bo.refused.task_claims_history_immutable': '领取的开始与结束时间是结算依据，不能修改或删除。',
  'bo.refused.task_claims_identity_immutable': '领取不能改挂到其他任务或采集者。请先释放，再新建领取。',
  'bo.refused.tasks_capacity_below_live': '当前领取人数已超过新的上限，请先释放部分领取。',
  'bo.refused.tasks_id_reused': '该编号已属于另一个条款不同的任务。',
  'bo.refused.collectors_id_reused': '该编号已属于另一位采集者。',
  'bo.refused.devices_id_reused': '该编号已属于另一台设备。',
  'bo.refused.task_claims_task_id_tasks_id_fk': '该任务已不存在，请刷新列表。',
  'bo.refused.task_claims_collector_id_collectors_id_fk': '该采集者已不存在，请刷新列表。',
  'bo.refused.devices_bound_collector_id_collectors_id_fk': '该采集者已不存在，请刷新列表。',
  'bo.refused.devices_device_type_id_device_types_id_fk': '该设备型号已不存在，请刷新列表。',
  'bo.refused.device_assignments_no_overlap': '该设备在这段时间内已分配给其他采集者。',
  'bo.refused.device_assignments_id_reused': '该分配编号已属于其他设备或采集者。',
  'bo.refused.device_assignments_device_id_devices_id_fk': '该设备已不存在，请刷新列表。',
  'bo.refused.device_assignments_collector_id_collectors_id_fk': '该采集者已不存在，请刷新列表。',
  'bo.refused.episode_clearing_nothing_to_clear': '该交付已是当前交付，且没有未处理的校验和不一致，无需清除。',
  'bo.refused.episode_clearing_id_reused': '该清除编号已对应另一项决定。请使用新的编号。',
  'bo.refused.episode_clearing_foreign_delivery': '该交付不属于这个片段。请选择该片段自己的交付。',
  'bo.refused.episode_clearing_paid_on_other_delivery':
    '该片段的另一次交付已审核并结算。改选其他交付属于争议流程，不是清除。',
  'bo.refused.episode_parks_already_parked': '该片段已被暂存出审核队列。请先释放，再重新暂存。',
  'bo.refused.episode_parks_not_parked': '该片段未被暂存，没有可释放的内容。',
  'bo.refused.episode_parks_settled': '该片段已审核并已有结算记录，不能暂存。请改为暂存该笔结算。',
  'bo.refused.episode_park_id_reused': '该暂存编号已对应另一项决定。请使用新的编号。',
  'bo.refused.session_claim_missing': '该采集者未领取此任务，为其录制的内容无法结算。请先领取任务。',
  'bo.refused.session_claim_released': '该采集者已释放对此任务的领取。需要重新领取后才能登记采集会话。',
  'bo.refused.session_task_not_published': '该任务已下架，不能再登记新的采集会话。',
  'bo.refused.review_duration_implausible':
    '该片段声称的时长超过一张存储卡所能录制的上限，无法结算。请退回柜台核查该次交付。',

  'bo.refused.review_already_decided': '该片段已有审核结果。您所做的标记未被记录。请领取下一条。',
  'bo.refused.review_no_task':
    '该片段没有对应的任务，因此没有单价，也无法记录审核结果。请附上说明退回上传柜台；须先关联采集会话才能审核。',
  'bo.refused.review_no_longer_reviewable':
    '在您打开期间，该片段已不可审核：可能有新的交付，或云端副本校验失败。未记录任何内容。请附上说明退回上传柜台。',
  'bo.refused.review_billed_while_disputed':
    '被申诉的结算在申诉期间已生成账单，因此复审结果无法取代它。未记录任何内容。请附上说明退回上传柜台。',
  'bo.refused.review_verdict_id_taken':
    '该审核结果编号已属于另一条审核记录。未记录任何内容。请刷新页面后重新审核。',
  'bo.refused.upload_unknown_session': '该采集会话不存在。请先在应用中绑定会话，再上传。',
  'bo.refused.upload_foreign_session': '该采集会话属于其他采集员，无法向其上传数据。',
  'bo.refused.upload_already_complete': '本次上传已完成并通过校验，重复发送不会有任何改变。',
  'bo.refused.upload_checksum_mismatch':
    '云端某个文件与手机计算出的校验和不一致。在重新上传之前，该段素材不会进入审核。',
  'bo.refused.upload_payload_too_large':
    '本次交付超过单次上传允许的大小。请分多次上传，或将存储卡交至上传中心。',
  'bo.refused.upload_superseded':
    '文件传输期间，该段素材出现了更新的交付，因此本次结果未被记录。请重新发起上传。',

  /** 采集端应用自身的拒绝原因（collector-app.ts 的 COLLECTOR_API_REFUSALS）。 */
  'bo.refused.task_not_found': '该任务已不存在。',
  'bo.refused.task_not_claimable': '该任务目前未开放，无法领取，也无法向其记录采集。',
  'bo.refused.task_at_capacity': '该任务的采集员名额已满，请选择其他任务。',
  'bo.refused.already_claimed': '您已经领取了该任务。',
  'bo.refused.exam_not_passed': '领取任务前必须通过考核。请在培训页面参加考核。',
  'bo.refused.not_qualified': '该账号尚未通过采集资格审核。可向上传中心询问当前状态。',
  'bo.refused.agreements_incomplete': '领取任务前必须接受全部六份协议。',
  'bo.refused.claim_id_reused': '该编号已属于另一项任务。请重新领取任务。',
  'bo.refused.claim_released': '您此前已放弃该任务，该编号不能再次使用。请重新领取以获取新编号。',
  'bo.refused.agreement_version_unknown': '该页面上的协议版本已过期。请重新加载并阅读后再接受。',
  'bo.refused.device_not_found': '没有设备使用该序列号。请核对设备外壳上的编号。',
  'bo.refused.device_not_available': '该设备已停用，无法绑定。',
  'bo.refused.already_bound': '该设备已绑定给其他采集员。',
  'bo.refused.device_not_bound': '该设备未绑定到您名下。开始采集会话前请先绑定。',
  'bo.refused.task_not_claimed': '您未持有该任务，无法向其记录采集。请先领取任务。',
  'bo.refused.scenario_not_found': '本平台不记录该采集场景。',
  'bo.refused.session_id_reused': '该编号已属于另一个采集会话。请重新创建会话。',

  'bo.refused.review_disputes_open_key': '该审核结果已在申诉中。',
  'bo.refused.review_disputes_decided_check': '该审核尚未给出结果，无可申诉的内容。',
  'bo.refused.review_disputes_final_check': '该结果本身已是复审结果，复审为最终结论。',
  'bo.refused.review_disputes_unbilled_check': '该结果已生成账单或已支付，账单不可修改。',
  'bo.refused.tasks_commitment_shape_check': '承诺时数必须为非空列表，所有时数均须大于零且不得缺失。',
  'bo.refused.task_commitments_abandon_reason_check': '放弃承诺时必须填写非空白原因。',
  'bo.refused.task_commitments_terms_immutable': '承诺约定的任务认领、每周时数和日期不能更改。',
  'bo.refused.task_commitments_insert_active': '承诺必须以进行中状态建立，再通过关闭操作记录结果。',
  'bo.refused.task_commitments_no_delete': '承诺记录不能删除，请关闭该承诺。',
  'bo.refused.unknown': '服务端拒绝了该操作。',
  'bo.refused.settlements_not_in_exception': '该结算记录不在异常状态，无需释放。',
  'bo.refused.settle_export_bill_in_exception':
    '本周期内有账单包含异常状态的明细。导出文件的合计与明细将无法对上，因此在释放该明细之前暂不导出。',
  'bo.refused.settle_generate_by_finance':
    '财务角色的操作员不能生成本周期账单。出账的人在付款时会被拒绝，因此需要由其他操作员来生成。',
  'bo.refused.payout_settlement_exception': '该账单中有一条结算记录处于异常状态。请先释放，账单才能支付。',

  'theme.toggle': '主题',
  'theme.light': '浅色',
  'theme.dark': '深色',

  'guide.title': '导览',
  'guide.start': '带我看一遍',
  'guide.step': '第 {{current}} 步，共 {{total}} 步',
  'guide.back': '上一步',
  'guide.next': '下一步',
  'guide.done': '完成',
  'guide.close': '关闭导览',
  'guide.panda': '竹，正指向本步骤所说的位置',
  'guide.offscreen': '该内容当前不在屏幕上。请继续下一步。',
  'guide.offer': '第一次使用？简短导览会说明本页每个部分的用途。',
  'guide.offer.accept': '带我看一遍',
  'guide.offer.decline': '暂不',

  'guide.home.gauge': '本班次进度：你已审核的片段数与本班次目标的对比。这个圆环表示进度，不是审核结论。',
  'guide.home.start': '领取队列中的下一个片段并打开它。在你作出结论或释放它之前，它一直归你。',
  'guide.home.settled': '本周期内你自己所作结论对应的金额。它不是项目的总支出，也不是一笔付款。',
  'guide.shell.counters': '队列中还有多少片段，以及每条结论的平均用时。这两个数字在每个页面都会显示。',
  'guide.shell.nav': '整个后台。圆点表示该页面尚未开发；半填充方块表示只完成了部分功能。',
  'guide.review.player': '素材与播放头。空格键播放和暂停。方向键前后移动五秒；按住 Shift 时移动一帧。',
  'guide.review.marks': '用 I 和 O 标记可用素材的起点和终点。时长由服务端测算；本页不会发送任何时长。',
  'guide.review.verdict': '三种结论：通过、部分通过、拒绝。对应按键 1、2、3。按回车提交你选择的结论。',
  'guide.review.reasons': '拒绝时至少要选一个原因代码。采集者看到的是越南语版本，请选择能说明需要改什么的那一条。',
  'guide.pipeline.stage': '导入流程的每个阶段，以及其中还在等待的内容。卡在某个阶段，说明导入在这里等待或失败了。这与录制无关：素材已经在卡上。',
  'guide.backoffice.tabs': '任务、采集者和设备。每个标签页都是可筛选的列表；这里的每次修改都会记录你的操作员账号。',
  'guide.settle.period': '一个结算周期从这一天开始。周期起始日落在其中的账单都会显示在下方。',
  'guide.settle.bills': '本周期内的全部账单。合计来自明细，由服务端取整；本页不做任何计算。',
  'guide.risk.holds': '引擎暂扣的付款，以及说明原因的那句话。只有当你能说清变了什么时才释放。',
  'guide.episodes.scope': '本页当前显示的是哪一部分片段。这是一个范围，不是全部目录。',
  'guide.counter.plan':
    '每一步只问一个问题，最后一步之前不写入任何数据。左侧的进度栏说明您走到哪里了，每个答案都可以从汇总页改回来。',

  'settle.title': '结算',
  'settle.intro': '某个周期的账单、钱包余额与之的对比、引擎标记的内容，以及每笔付款的记录。这里的每个数字都来自服务端；本页不做任何加总或取整。',
  'settle.period': '周期起始日',
  'settle.period.hint': '从这一天起一个结算周期。周期起始日落在其中的账单。',
  'settle.period.apply': '打开',
  'settle.tab.bills': '账单',
  'settle.tab.preflight': '付款前检查',
  'settle.tab.flags': '风险标记',
  'settle.tab.exceptions': '异常',
  'settle.mode.manual': '人工付款模式：由操作员自行转账，并在此登记交易参考号。',
  'settle.mode.api': 'API 付款模式：在付款前检查页通过 ZaloPay 发送转账。',
  'settle.readonly': '只读',
  'settle.readonly.operator': '本会话没有财务角色。所有数字均可查看；所有付款操作在此禁用，服务端也会拒绝。',
  'settle.readonly.unknown': '无法确认本会话的财务角色，付款操作已禁用。请刷新后重试。',
  'settle.readonly.refused': '服务端拒绝：本会话没有财务角色。没有任何内容被修改。',
  'settle.failed': '请求未送达服务端。没有任何内容被修改。',
  'settle.invalid': '服务端无法读取该请求。没有任何内容被修改。',
  'settle.gone': '该账单或付款尝试已不存在于服务端。请刷新列表。',
  'settle.loadFailed': '该周期未能加载。',
  'settle.loadFailed.body': '结算页面通过 API 读取数据。没有任何内容被修改。',
  'settle.empty': '该周期没有账单。',
  'settle.empty.body': '账单由已审核的结算记录生成。请生成该周期，或选择另一个起始日。',
  'settle.generate': '生成账单',
  'settle.generate.hint': '为该周期内所有待结算记录开具账单。重复执行不会产生变化。',
  'settle.generate.result': '已创建 {{created}} 张账单；{{notPayable}} 条金额为零的结算记录未列入。',
  'settle.generate.deferred': '{{n}} 条结算记录在本周期已有账单（{{who}}），因此顺延至下一周期。这笔钱不会丢失。',
  'settle.generate.skipped': '{{n}} 条结算记录（{{who}}）在本次读取期间已被另一次运行按其他周期开具账单。它们在那次运行的账单上。',
  'settle.generate.exception': '本周期有 {{n}} 条结算记录被搁置为异常。',
  'settle.export.payout': '导出付款 CSV',
  'settle.export.payout.hint': '逐行及整体加哈希，并记录在案。仅限财务。',
  'settle.export.lines': '导出明细 CSV',
  'settle.col.collector': '采集者',
  'settle.col.minutes': '有效分钟',
  'settle.col.gross': '总额',
  'settle.col.withheld': '代扣',
  'settle.col.net': '实付',
  'settle.col.band': '风险',
  'settle.col.attempt': '付款状态',
  'settle.col.open': '打开',
  'settle.sort': '按{{column}}排序',
  'settle.withheld.note': '个人所得税代扣比例尚未确定。服务端报告代扣为 0，实付等于总额。',
  'settle.asStored': '按存储值显示，单位 {{currency}}。此处不取整。',
  'settle.wholeVnd': '整数越南盾。总额向下取整；每张账单采集者最多损失不到一盾。',
  'settle.lines': '{{n}} 条明细',
  'settle.attempt.none': '尚无付款尝试',
  'settle.attempt.created': '已创建',
  'settle.attempt.submitted': '已提交',
  'settle.attempt.processing': '处理中',
  'settle.attempt.pending_zlp': 'ZaloPay 待处理',
  'settle.attempt.succeeded': '已支付',
  'settle.attempt.failed': '失败',
  'settle.attempt.unknown': '未知，轮询中',
  'settle.method.WALLET': 'ZaloPay 钱包',
  'settle.method.BANK_ACCOUNT': '银行账户',
  'settle.method.BANK_CARD': '银行卡',
  'settle.verify.unverified': '未验证',
  'settle.verify.verified': '已验证',
  'settle.verify.name_mismatch': '姓名不符',
  'settle.verify.no_wallet': '没有钱包',
  'settle.verify.locked': '钱包已锁定',
  'settle.verify.kyc_limit': '收款额度上限',
  'settle.verify.error': '验证出错',
  'settle.issue.title': '这张账单距离转账还差什么',
  'settle.issue.none': '没有。这张账单可以支付。',
  'settle.issue.no_account': '采集者尚未申报收款账户。',
  'settle.issue.account_unverified': '收款账户尚未通过 ZaloPay 验证。',
  'settle.issue.over_bank_ceiling': '超过 ZaloPay 单笔银行转账上限 10,000,000 越南盾。',
  'settle.issue.under_bank_minimum': '低于 ZaloPay 银行转账最低金额 2,000 越南盾。',
  'settle.issue.under_one_dong': '整张账单不足一越南盾，向下取整后没有可转账的金额。',
  'settle.issue.over_cap': '超过本周期每位采集者的上限。',
  'settle.issue.risk_hold': '风险引擎已暂停这张账单的支付。',
  'settle.issue.attempt_open': '这张账单还有一次付款尝试未完成。',
  'settle.issue.already_paid': '这张账单已支付。',
  'settle.issue.line_in_exception': '这张账单上有一条明细被搁置为异常。',
  'settle.state.pending_review': '等待审核',
  'settle.state.pending_settlement': '等待开具账单',
  'settle.state.bill_generated': '已列入已开具的账单',
  'settle.state.manually_paid': '已通过人工渠道支付',
  'settle.state.exception': '已搁置为异常',

  'settle.preflight.intro': '付款前必读。本批次将发送的内容、钱包余额、哪些账户未验证，以及引擎标记了谁。',
  'settle.preflight.balance': '钱包余额',
  'settle.preflight.balance.none': '无法读取：本服务端未配置 ZaloPay 客户端。人工试点通过银行付款，这是预期情况。',
  'settle.preflight.total': '批次总额',
  'settle.preflight.required': '含余量的所需金额',
  'settle.preflight.required.hint': '总额加 5%，这是批次程序坚持保留的余量。',
  'settle.preflight.shortfall': '缺口',
  'settle.preflight.ok': '本批次可以发送：{{bills}} 张账单中有 {{payable}} 张可支付。',
  'settle.preflight.refused': '本批次被整体拒绝。不会发送任何转账。',
  'settle.preflight.serverSaid': '服务端回复',
  'settle.preflight.ranAt': '付款前检查执行于 {{at}}',
  'settle.preflight.rerun': '重新执行',
  'settle.preflight.bands': '按风险等级统计账单',
  'settle.preflight.accounts': '收款账户',
  'settle.preflight.accounts.verified': '已验证',
  'settle.preflight.accounts.unverified': '未验证',
  'settle.preflight.accounts.mismatch': '姓名不符',
  'settle.preflight.accounts.missing': '没有账户',
  'settle.preflight.limits': '限额',
  'settle.preflight.ceiling': '超过银行转账上限 {{ceiling}}',
  'settle.preflight.cap': '超过上限 {{cap}}',
  'settle.preflight.cap.none': '未配置每位采集者的上限。该数值需要上报决定。',
  'settle.preflight.others': '其他不可支付项',
  'settle.preflight.anomalies': '风险最高者优先',
  'settle.preflight.anomalies.hint': '风险评分最高的 {{n}} 张账单，每条标记都用通俗语句说明。打开风险标记页进行处理。',
  'settle.preflight.anomalies.none': '引擎未对本周期任何账单发出标记。',
  'settle.preflight.continue.manual': '付款前检查已阅。从列表中打开一张账单登记人工付款；在本周期的此页面被阅读之前，付款控件保持锁定。',
  'settle.preflight.stale': '本会话尚未对该周期执行付款前检查。请先执行，再付款。',
  'settle.preflight.expired': '付款前检查已超过五分钟。余额、暂停和异常列表可能已变化；请重新执行后再付款。',
  'settle.preflight.changed': '自付款前检查以来批次已发生变化——有付款、申报或暂停。请重新执行后再付款。',
  'settle.preflight.open': '执行付款前检查',

  'settle.batch.title': '发送批次',
  'settle.batch.sentence': '发送 {{n}} 笔转账，合计 {{total}}。',
  'settle.batch.serverLoop': '只发一个请求。服务端在那一刻重新执行自己的付款前检查，逐笔发送并在两笔之间暂停，遇到第一次拒绝即停止，然后返回报告。本浏览器不会发送任何转账。',
  'settle.batch.notOnServer': '本服务端尚无批次执行路由。按设计，批次是服务端的循环；在该路由存在之前，此处不会发送任何内容。',
  'settle.batch.refusedAtSend': '服务端在发送时自行执行的付款前检查拒绝了批次：{{reason}} 未发送任何转账，并已生成工单。',
  'settle.batch.retype': '重新输入总额（仅数字）以确认',
  'settle.batch.retype.hint': '手动输入，而非点击。数字来自付款前检查。',
  'settle.batch.mismatch': '这不是批次总额。',
  'settle.batch.send': '发送 {{n}} 笔转账',
  'settle.batch.sending': '正在发送第 {{done}} 笔，共 {{n}} 笔',
  'settle.batch.stopped': '批次在 {{collector}} 处停止：{{reason}} 已发送的保持已发送；由轮询程序完成。',
  'settle.batch.done': '全部 {{n}} 笔转账已发送。最终状态由轮询程序确定。',
  'settle.batch.noneOk': '付款前检查拒绝了本批次，或其中没有可支付的账单，因此无法发送。',
  'settle.batch.refused.title': '未发送',
  'settle.batch.refused.body': '这些账单没有发送，每条旁边写明原因。其中有些已经支付或正在处理中；多数需要有人处理后，任何一次运行才会发送。',
  'settle.batch.tickets.title': '工单',
  'settle.batch.tickets.body': '在本次运行期间产生。需要有人处理。',
  'settle.batch.aborted': '本次运行因错误而中止，不是因为被拒绝。',
  'settle.batch.aborted.at': '它在 {{collector}} 处停止。',
  'settle.batch.aborted.body': '已发送的转账保持已发送并已提交。抛出错误的原因在服务端日志中，不在本报告里。已发出的转账由轮询程序确定最终状态。',
  'settle.ticket.TICKET.POLL_EXHAUSTED': '轮询已放弃一笔转账',
  'settle.ticket.TICKET.ORDER_NOT_FOUND': 'ZaloPay 找不到该订单',
  'settle.ticket.TICKET.CAP_EXCEEDED': '有账单超过每位采集者的上限',
  'settle.ticket.TICKET.BATCH_REFUSED': '批次在发送时被拒绝',
  'settle.ticket.TICKET.RECON_DISCREPANCY': '对账发现差异',

  'settle.bill.back': '全部账单',
  'settle.bill.notInPeriod': '该账单不属于本周期。',
  'settle.bill.notInPeriod.body': '请选择它所属的周期，或从列表中打开。',
  'settle.bill.period': '周期',
  'settle.bill.total': '总额',
  'settle.bill.amount': '应付金额',
  'settle.bill.account': '收款账户',
  'settle.bill.account.none': '该采集者尚未申报收款账户。没有收款人就无法付款。',
  'settle.bill.declared': '申报姓名',
  'settle.bill.verified': 'ZaloPay 上的姓名',
  'settle.bill.verified.none': '未返回',
  'settle.bill.phone': '手机号',
  'settle.bill.risk': '风险',
  'settle.bill.risk.open': '打开风险标记页',
  'settle.bill.attempt': '最近一次付款尝试',
  'settle.bill.attempt.reference': '交易参考号',
  'settle.bill.attempt.order': '合作方订单号',
  'settle.bill.attempt.zlp': 'ZaloPay 订单号',
  'settle.bill.attempt.trans': 'ZaloPay 交易号',
  'settle.bill.attempt.sub': '子返回码',
  'settle.bill.attempt.polls': '轮询次数',
  'settle.bill.attempt.created': '创建时间',
  'settle.bill.attempt.settled': '完成时间',
  'settle.bill.lines.title': '账单明细',
  'settle.bill.lines.empty': '这张账单没有明细。',
  'settle.bill.lines.exceptions': '有 {{n}} 条明细被搁置为异常。它们仍在账单上，也仍计入总额。',
  'settle.bill.lines.reproduce': '每一笔金额是单价乘以有效分钟数，再四舍五入到小数点后四位，因此旁边两列可以还原它。总额是各条明细的精确合计。向下取整为整数越南盾只在支付时进行一次，绝不在明细上进行。',
  'settle.bill.line.task': '任务',
  'settle.bill.line.episode': '片段',
  'settle.bill.line.unitPrice': '单价',
  'settle.bill.line.minutes': '有效分钟数',
  'settle.bill.line.amount': '金额',
  'settle.bill.line.state': '状态',
  'settle.bill.line.reviewed': '审核时间',

  'settle.pay.title': '登记付款',
  'settle.pay.manual.intro': '请自行通过 ZaloPay 或银行向上述账户转账。然后回到这里登记该笔转账的参考号。数据库会核对金额与账单是否一致。',
  'settle.pay.api.intro': '为这张账单通过 ZaloPay 发送一笔转账，或登记一笔带参考号的人工付款。付款前检查已阅；金额需重新输入以确认。',
  'settle.pay.reference': '交易参考号',
  'settle.pay.reference.hint': '人工付款必填。银行或 ZaloPay 为该笔转账提供的参考号。',
  'settle.pay.retype': '重新输入金额（仅数字）',
  'settle.pay.retype.hint': '必须与应付金额一致。手动输入，而非点击确认。',
  'settle.pay.mismatch': '这不是本账单的金额。',
  'settle.pay.markPaid': '登记为已支付',
  'settle.pay.api.send': '发送转账',
  'settle.pay.done': '已登记。付款尝试 {{order}}，状态：{{status}}。',
  'settle.pay.sent': '已发送。付款尝试 {{order}} 状态为 {{status}}；由轮询程序确定结果。',
  'settle.pay.rejected': 'ZaloPay 拒绝了该转账（子返回码 {{sub}}）。需要新的付款尝试。',
  'settle.pay.alreadyPaid': '这张账单已支付。不能再登记任何内容。',
  'settle.pay.locked': '在阅读付款前检查之前保持锁定',

  'settle.exceptions.intro': '所有需要人工处理的付款尝试，以及所有按现状无法发送的账单。',
  'settle.exceptions.empty': '本周期没有异常。',
  'settle.exceptions.empty.body': '所有付款尝试均已终结，所有账单均在限额之内。',
  'settle.exceptions.pending': 'ZaloPay 内部待处理',
  'settle.exceptions.pending.body': '这些转账处于 ZaloPay 的状态 4。重试无法解决，此处也不会重试：必须由 ZaloPay 自己的团队修复该订单。只有在 ZaloPay 确认结果后才在此处理，并写明是在哪里得到确认的。',
  'settle.exceptions.polling': '轮询中',
  'settle.exceptions.polling.body': '这些转账的回复丢失或仍在等待。轮询程序按退避间隔向 ZaloPay 查询，得知结果后推进状态。只有在轮询耗尽时才由操作员处理。',
  'settle.exceptions.neverSent': '已创建，从未发送',
  'settle.exceptions.neverSent.body': '付款尝试记录存在，但请求从未发出。系统不会凭猜测重发；请将其处理为失败，然后重新付款。',
  'settle.exceptions.ceiling': '超过银行转账上限',
  'settle.exceptions.ceiling.body': 'ZaloPay 每笔银行转账最多 {{ceiling}}。高于此金额的账单无法作为一笔转账发送，而拆分是尚未有人做出的资金决定。请上报，不要拆分。',
  'settle.exceptions.cap': '超过上限',
  'settle.exceptions.cap.body': '超过每位采集者上限 {{cap}}。批次会点名拒绝并生成工单；绝不会改为支付上限金额。',
  'settle.exceptions.blocked': '暂不可支付',
  'settle.exceptions.blocked.body': '转账前还有事项需要处理的账单：没有账户、账户未验证、总额带小数、风险暂停。',
  'settle.exceptions.opened': '已开启 {{elapsed}}',
  'settle.exceptions.polls': '已轮询 {{n}} 次，最近一次 {{at}}',
  'settle.exceptions.polls.none': '尚未轮询',
  'settle.exceptions.events': '事件',
  'settle.resolve.title': '处理',
  'settle.resolve.outcome': '结果',
  'settle.resolve.succeeded': '资金已到账',
  'settle.resolve.failed': '资金未到账',
  'settle.resolve.reason': '原因',
  'settle.resolve.reason.hint': '必填。结果在哪里、由谁确认。这就是授权依据。',
  'settle.resolve.trans': 'ZaloPay 交易号（如已成功）',
  'settle.resolve.submit': '处理该付款尝试',
  'settle.resolve.done': '已处理：付款尝试现在为 {{status}}。',
  'settle.resolve.pollerWorking': '轮询程序仍在处理该付款尝试。只有待处理、轮询耗尽或从未发送的尝试才能人工处理。',

  'risk.intro': '先看证据，再下结论。每条标记是一句话，附带触发它的数字；暂停需填写原因才能解除，谁解除了什么会一直留在记录中。',
  'risk.score': '评分',
  'risk.points': '{{n}} 分',
  'risk.flags': '{{n}} 条标记',
  'risk.open': '打开',
  'risk.empty': '本周期没有标记。',
  'risk.empty.body': '引擎对这些账单没有发现，或者本服务端未运行引擎。',
  'risk.evidence': '证据',
  'risk.references': '涉及的录制',
  'risk.proxy.none': '本服务端不提供代理片段，此处也从不展示原始素材。',
  'risk.threshold': '阈值版本 {{v}}，计算于 {{at}}',
  'risk.holds.title': '暂停记录',
  'risk.holds.none': '这张账单没有未解除的暂停。',
  'risk.holds.notOnServer': '本服务端未挂载风险引擎的路由。所示标记来自批次摘要；暂停记录和解除操作需要引擎。',
  'risk.holds.open': '自 {{at}} 起暂停',
  'risk.holds.raised': '于 {{at}} 因 {{signals}} 发起',
  'risk.holds.cleared': '于 {{at}} 由 {{who}} 解除：{{verdict}} — {{reason}}',
  'risk.clear.title': '解除暂停',
  'risk.clear.verdict': '结论',
  'risk.clear.reason': '原因',
  'risk.clear.reason.hint': '至少十个字符。您核查了什么，以及为什么可以支付这张账单。',
  'risk.clear.submit': '以此原因解除',
  'risk.clear.done': '已解除。此后账单按正常流程支付。',
  'risk.actions.escalate': '上报',
  'risk.actions.hold': '暂停',
  'risk.actions.unavailable': '本服务端尚无上报和人工暂停的路由。暂停由引擎自行发起；操作员能做的是解除。',
  'risk.band.clear': '正常',
  'risk.band.notice': '提示',
  'risk.band.review': '需复核',
  'risk.band.hold': '已暂停支付',
  'risk.severity.info': '信息',
  'risk.severity.notice': '提示',
  'risk.severity.review': '复核',
  'risk.severity.hold': '暂停',
  'risk.verdict.false_positive': '已核查，无问题',
  'risk.verdict.accepted': '接受风险，照常支付',
  'risk.verdict.resolved': '原因已解决',

  'risk.signal.META.EVALUATED': '已评估，发现 {findings} 项。',
  'risk.signal.IDENT.NAME_MISMATCH': 'ZaloPay 上的姓名为 {verified_name}，协议上的姓名为 {declared_name}。',
  'risk.signal.IDENT.PHONE_SHARED': '钱包手机号 {phone_masked} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.ACCOUNT_SHARED': '银行账户 {bank_code} ···{account_no_last4} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.MUID_SHARED': 'ZaloPay 钱包 {m_u_id_masked} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.ACCOUNT_CHANGED_LATE': '收款账户于 {changed_at} 更改，距结算周期 {period_end} 结束仅 {days_before_end} 天。',
  'risk.signal.IDENT.UNVERIFIED_KYC': 'ZaloPay 于 {verified_at} 反馈该钱包尚未完成实名认证（代码 {sub_return_code}）。',
  'risk.signal.IDENT.KYC_LIMIT_REPEATED': 'ZaloPay 反馈收款额度已达上限 {occurrences} 次（代码 {sub_return_code}）；一个人超过 {max_occurrences} 次并不常见。',
  'risk.signal.IDENT.WALLET_LOCKED': 'ZaloPay 于 {verified_at} 反馈该钱包已被锁定（代码 {sub_return_code}）。',
  'risk.signal.IDENT.NAME_UNCONFIRMED': 'ZaloPay 未返回可与 {declared_name} 比对的姓名；申报尚未得到确认。',
  'risk.signal.IDENT.KYC_LIMIT': 'ZaloPay 反馈该钱包的收款额度已达上限（代码 {sub_return_code}）。',
  'risk.signal.IDENT.NO_WALLET': 'ZaloPay 没有与手机号 {phone_masked} 对应的钱包（代码 {sub_return_code}）。',
  'risk.signal.IDENT.VERIFY_ERROR': 'ZaloPay 无法验证该账户（代码 {sub_return_code}）。',
  'risk.signal.VOL.HOURS_PER_DAY': '{day} 当天 {episodes} 个片段合计录制 {hours} 小时，每日上限为 {max_hours} 小时。',
  'risk.signal.VOL.ABOVE_COHORT_P95': '{day} 当天录制了 {episodes} 个片段；100 个采集者日中有 95 个不超过 {p95} 个（共比较 {cohort_days} 个采集者日）。',
  'risk.signal.VOL.STEP_CHANGE': '{day} 当天录制 {minutes} 分钟，该采集者平时每天约 {median_minutes} 分钟，为平时的 {ratio} 倍。',
  'risk.signal.VOL.NO_GAP': '片段 {episode_a} 与 {episode_b} 在时间上重叠 {overlap_s} 秒，一个人无法同时录制两段。',
  'risk.signal.VOL.NOCTURNAL': '任务类型 {task_type} 的 {total_minutes} 分钟中有 {night_minutes} 分钟（{share_pct}）录制于 {night_hours} 之间。夜班是正常工作，此项仅供参考。',
  'risk.signal.CONT.MOOV_DAMAGED': 'MP4 文件 {file} 未通过容器检查：{verdict}。',
  'risk.signal.CONT.TIMING_TRUNCATED': '{stream} 的时间戳索引提前结束：{pts_rows} 行，而媒体有 {media_packets} 个数据包。这是录制被中断的典型表现。',
  'risk.signal.CONT.TIMING_PACKET_DELTA': '{stream} 的时间戳索引有 {pts_rows} 行，但媒体只有 {media_packets} 个数据包：视频在建立索引之后被截断或改写。',
  'risk.signal.CONT.IMU_CLOCK_DRIFT': 'IMU 时钟异常：{clock_outlier_rows} 行的时间与本次会话相差甚远（{detail}）。',
  'risk.signal.CONT.PTS_MANIFEST_DELTA': '清单声称 {declared_s} 秒，媒体实测 {measured_s} 秒，比值 {ratio}；该设备通常为 {baseline_ratio}（基于 {baseline_episodes} 个片段）。',
  'risk.signal.CONT.NEAR_DUPLICATE': '画面与采集者 {other_collector_ref} 的片段 {other_episode_id} 相同（{method}，{match_share_pct} 的帧匹配）。',
  'risk.signal.CONT.STATIC_SCENE': '{frames} 个抽样帧之间画面几乎没有变化：运动量 {motion_energy}，正常拍摄高于 {max_motion_energy}。',
  'risk.signal.CONT.LOW_LUMA_VARIANCE': '{dark_share_pct} 的抽样帧过暗，{flat_share_pct} 的帧没有细节（平均亮度 {mean_luma}/255）。镜头可能被遮挡。',
  'risk.signal.CONT.AUDIO_ABSENT': '没有可用的音频（{reason}），而任务类型 {task_type} 应当有声音。',
  'risk.signal.CONT.FINGERPRINT': '已记录 {frames} 帧的画面指纹，用于重复检查。',
  'risk.signal.PROV.PRNU_MISMATCH': '画面的传感器噪声模式与设备 {device_serial} 登记的指纹相关性为 {correlation}，匹配应高于 {min_correlation}。',
  'risk.signal.PROV.IMU_VIDEO_DECORR': '在 {seconds} 秒内，画面中的运动与 IMU 记录的运动相关性为 {correlation}，真实录制应高于 {min_correlation}。',
  'risk.signal.PROV.ENCODER_MISMATCH': '该文件的写入方式与固件 {firmware} 不同：{mismatches}。',
  'risk.signal.PROV.SCREEN_RECAPTURE': '画面像是翻拍的屏幕：{cues}（检查了 {frames} 帧）。',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC': '画面几乎没有传感器噪声（{noise_floor}，相机通常高于 {max_noise_floor}）。单独看只是弱线索。',
  'risk.signal.OPS.REVIEW_TOO_FAST': '审核员 {reviewer_ref} 用 {time_to_verdict_s} 秒给出了 {verdict} 结论，而该片段时长 {measured_duration_s} 秒。',
  'risk.signal.OPS.APPROVAL_OUTLIER': '审核员 {reviewer_ref} 在 {decided} 个片段中通过了 {approval_rate_pct}，其他 {reviewers} 位审核员的通过率为 {cohort_median_pct}。',
  'risk.signal.OPS.SELF_DEALING': '操作员 {operator_ref} 于 {created_at} 创建了该采集者，又于 {paid_at} 对账单执行了 {paid_action}。',
  'risk.signal.OPS.CONCENTRATION': '在 {operators} 位操作员都在处理的情况下，操作员 {operator_ref} 处理了该采集者账单 {events} 次操作中的 {share_pct}。',

  'bo.refused.payout_attempts_previous_not_failed': '这张账单已有一次未失败的付款尝试。只有在前一次尝试失败之后才能发起新的尝试。',
  'bo.refused.payout_attempts_amount_check': '输入的金额与账单总额不一致。没有登记任何内容。',
  'bo.refused.payout_attempts_account_owner': '该收款账户属于另一位采集者。',
  'bo.refused.payout_attempts_account_current': '该收款账户已不是采集者当前的账户。请刷新账单。',
  'bo.refused.payout_attempts_bank_ceiling': '超过 ZaloPay 单笔银行转账上限 10,000,000 越南盾。无法作为一笔转账发送，拆分需要上报决定，而不是一个按钮。',
  'bo.refused.payout_attempts_bank_minimum': '低于 ZaloPay 银行转账最低金额 2,000 越南盾。',
  'bo.refused.payout_attempts_amount_positive_check': '这张账单总额不足一越南盾，向下取整后为 0 越南盾，金额为零的付款不会被记录。没有发送任何款项。',
  'bo.refused.payout_attempts_transition_check': '付款尝试不能以这种方式从当前状态转换。请刷新列表。',
  'bo.refused.payout_attempts_succeeded_immutable': '已成功的付款尝试是最终状态，不能更改。',
  'bo.refused.payout_attempts_failed_terminal': '已失败的付款尝试是最终状态。再次付款是一次新的尝试。',
  'bo.refused.payout_attempts_pending_operator_only': '在 ZaloPay 内部待处理的付款尝试只能由操作员填写原因后推进。其他任何方式都不能推进它。',
  'bo.refused.payout_attempts_manual_reference_check': '人工付款需要交易参考号。没有登记任何内容。',
  'bo.refused.payout_finance_required': '只有具备财务角色的操作员才能付款或处理。服务端已拒绝。',
  'bo.refused.payout_separation_of_duty': '创建该采集者、批准该账单或申报该收款账户的操作员不能是付款的操作员。',
  'bo.refused.payout_accounts_current_key': '该采集者已有当前收款账户。请刷新后重试。',
  'bo.refused.payout_accounts_append_only': '收款账户是申报记录，不能修改或删除。',
  'bo.refused.settlements_transition_check': '这张账单上的某条结算记录在此期间已被支付或移至异常。请刷新账单。',
  'bo.refused.payout_mode_manual': '服务端处于人工付款模式。请自行转账，并在此登记参考号。',
  'bo.refused.payout_batch_running': '该周期的批次已在服务端执行中。请等待其报告；不会重复发送。',
  'bo.refused.payout_transfer_rejected': 'ZaloPay 拒绝了该转账。批次在这张账单处停止；该尝试已记录为失败，其后的账单均未发送。',
  'bo.refused.payout_bill_not_payable': '预检发现这张账单不可支付。请打开账单查看原因；没有发送任何转账。',
  'bo.refused.payout_no_client': '本服务端未配置 ZaloPay 客户端，无法发送任何转账。',
  'bo.refused.payout_account_missing': '该采集者没有当前收款账户。',
  'bo.refused.payout_account_unverified': '该采集者的收款账户未经验证。必须先由 ZaloPay 确认姓名。',
  'bo.refused.payout_attempts_account_unverified': '数据库拒绝了该付款尝试：收款账户未经验证。必须先由 ZaloPay 确认姓名。',
  'bo.refused.payout_bank_details_unavailable': '通过 API 进行银行转账需要完整账号，而本服务端不保存账号。请人工付款。',
  'bo.refused.payout_cap_exceeded': '超过本周期每位采集者的上限。已生成工单；绝不会改为支付上限金额。',
  'bo.refused.payout_risk_hold': '风险引擎已暂停这张账单。请先在风险标记页填写原因解除暂停。',
  'bo.refused.payout_already_paid': '这张账单已支付。',
  'bo.refused.payout_accounts_id_reused': '该账户编号已属于另一条不同的申报。',
  'bo.refused.payout_account_declaration_invalid':
    '该申报无法保存。钱包需要以 0 开头的十位越南手机号；银行方式需要银行代码和账号。',
  'bo.refused.payout_account_locked_while_paying': '对该采集者的一笔付款仍未结束，因此不能更改账户。请先完成或处理该笔付款。',
  'bo.refused.payout_account_not_this_centre': '该采集者未在本中心交付过任何素材，因此本柜台不能申报其账户。',
  'bo.refused.payout_attempt_not_resolvable': '该付款尝试在当前状态下不能人工处理。只有待处理、轮询耗尽或从未发送的尝试才可以。',
  'bo.refused.payout_bill_period_mismatch': '该账单属于另一个周期。',

  // 登录验证码的发送失败（zns.ts 中的 ZNS_REFUSALS）。
  'bo.refused.zns_no_zalo_account':
    '该手机号没有 Zalo 账号，验证码无法送达，此采集者无法登录。请让他们在该号码上安装 Zalo，或为其登记另一个号码。',
  'bo.refused.zns_phone_not_vietnamese':
    '该采集者档案中的号码不是越南手机号，因此未发送验证码。请在后台更正该号码。',
  'bo.refused.zns_template_rejected':
    'Zalo 拒绝了登录短信模板。在模板重新通过审核并启用之前，没有人能登录。这是 Zalo 公众号一侧的事，与采集者无关。',
  'bo.refused.zns_quota_exhausted': 'Zalo 公众号的通知配额已用尽，因此未发送验证码。在购买新配额之前无人能登录。',
  'bo.refused.zns_rate_limited': 'Zalo 因发送过快暂时拒绝了消息。它会自行恢复；请让采集者几分钟后再试。',
  'bo.refused.zns_credentials_rejected':
    'Zalo 拒绝了本服务器的凭据，因此未发送验证码。访问令牌错误或已过期，需要重新获取。',
  'bo.refused.zns_unreachable':
    '无法连接 Zalo，因此未发送验证码。请让采集者再试一次；如果反复出现，说明与 Zalo 的链路已中断。',
  'bo.refused.zns_refused':
    'Zalo 拒绝发送验证码，给出的原因本服务器无法识别。原因记录在服务器日志中；请一边查阅日志一边让采集者再试。',
  // 控制台改版自己的字符串（ui.b.*）：两个深色区块里数字旁边的句子。
  'ui.b.settle.total.sentence':
    '本批次将要发出的金额。每一笔转账由服务端决定，账单在支付的那一刻仍可能被拒绝。',
  'ui.b.risk.holds.count': '被暂停的账单',
  'ui.b.risk.holds.sentence':
    '只要暂停仍未解除，就不会有任何转账发出。解除暂停需要一个结论和一段书面理由；风险引擎只追加记录，从不修改已有记录。',

  'login.video.region': '演示视频',

  'discover.headline.a': '认识 Ego。',
  'discover.headline.mark': '日常劳动',
  'discover.headline.b': '，从你的视角出发。',
  'discover.lead':
    '一台用于记录日常活动的头戴相机。采集者按经审核通过的有效分钟获得报酬。',
  'discover.signIn': '登录控制台',
  'discover.audiences':
    '两条入口。采集者用 Ego 相机录制，按审核员认定通过的有效分钟获得报酬；上传中心的运营人员和审核员在控制台工作。',
  'discover.video.caption':
    '这是一段占位影片，并非相机拍下的素材：画面是别人举着手臂拍摄的佩戴 Ego 的人，地点在巴黎。Ego 从佩戴者额头向外记录，拍不到佩戴者本人。日后会用实拍素材替换。',
  'discover.how.title': '四个步骤，依次进行',
  'discover.step.record.title': '记录',
  'discover.step.record.body':
    '你戴上相机，做平常的事——做饭、园艺、打扫、熨衣。只有相机自身的按键能开始和停止录制。',
  'discover.step.upload.title': '上传',
  'discover.step.upload.body': '存储卡在上传中心柜台交付。工作人员登记交接，并在中心的机器上导入。',
  'discover.step.review.title': '人工审核',
  'discover.step.review.body': '审核员观看该段素材，标出可用的部分，并为其余部分记录原因代码。',
  'discover.step.payment.title': '付款',
  'discover.step.payment.body':
    '按审核通过的有效分钟与该任务的单价开具账单，并通过 ZaloPay 支付。',
  'discover.cell.camera.title': '这台相机',
  'discover.cell.camera.body':
    'Ego 是由平台提供、与一个人绑定的头戴相机。开始和停止录制只能按相机自身的按键——手机上的任何应用都做不到，也不会被赋予这项权限。',
  'discover.cell.pov.caption':
    '戴在额头上的相机。取自上方占位影片的一帧，经过裁切——这是从旁观视角看这台设备，而不是透过它看到的画面。',
  'discover.cell.activities.title': '哪些活动算数',
  'discover.cell.activities.body':
    '家里、办公室、店铺和仓库中的日常活动。每次录制都要先认领一项已公布的任务，因此什么算合适是事先写明的，而不是事后判定的。',
  'discover.cell.review.title': '审核是怎么进行的',
  'discover.cell.review.body':
    '每一段素材都由人观看，标出可用部分，并为其余部分记录失败原因代码。这一判定是采集者据以获得报酬的唯一来源；平台上没有第二种算法得出这个数字。',
  'discover.cell.minutes.title': '可计酬的分钟如何确定',
  'discover.cell.minutes.body':
    '计费时长取各路数据共同覆盖的区间，而不是最长的那一路。设备自报的时长仅供参考且偏高，因此平台以素材文件本身为准进行测量。',
  'discover.before.title': '参与之前',
  'discover.before.q.record': '我需要记录什么？',
  'discover.before.a.record': '日常活动，且对应一项事先认领的任务。首个任务之前有培训和一次考核。',
  'discover.before.q.paid': '录到的每一分钟都有钱吗？',
  'discover.before.a.paid': '不是。只有审核员认定可用的部分才计酬，一段录制也可能被整段拒绝。',
  'discover.before.q.when': '付款何时确定？',
  'discover.before.a.when':
    '在存储卡导入并完成审核之后。账单按结算周期开具，总额向下取整到整数越南盾。',
  'discover.before.q.data': '关于我会收集哪些信息？',
  'discover.before.a.data': '录制协议所要求的同意声明，除此之外一概不收。素材始终存放在越南境内。',
  'discover.handoff.title': '你已经是运营人员或审核员？',
  'discover.handoff.body':
    '请登录控制台。上传中心的工作人员在此登记交接并导入存储卡；审核员在此观看素材并判定哪些可以计酬。',
  'discover.credits': '影片与图片：来源与授权',
  'discover.partners':
    'PlayerOne 是 VNG PT Lab 与 PaXini 的合资项目。VNG 负责平台与各上传中心；PaXini 制造 Ego 相机，并在本阶段负责素材审核。',
  'discover.foot.legal':
    'PlayerOne 是 VNG PT Lab 与 PaXini 的合资项目。每一段录制都要先由人工判定，才会产生可结算的分钟数；素材始终存放在越南境内。',
  'discover.ways.title': '接下来去哪里',
  'discover.take.cta': '下载 APK',
  'discover.take.title': '采集者',
  'discover.take.body':
    '采集工作从培训和考核开始。每次录制前都要先领取一个任务；相机由平台提供，所有权仍属于平台。支付的是审核员认定通过的有效分钟。',
  'discover.take.pending':
    'APK 尚未发布，今天还无法从本页下载。发布后会在这里给出链接。',

  'discover.nav.label': '本页内容',
  'discover.nav.camera': '相机',
  'discover.nav.work': '工作',
  'discover.nav.review': '审核',
  'discover.nav.payment': '付款',
  'discover.nav.questions': '问题',

  'discover.eyebrow': 'Ego — 头戴式相机',
  'discover.line.1': '记录。',
  'discover.line.2': '交回存储卡。',
  'discover.line.3': '由人来审核。',
  'discover.line.4': '按分钟计酬。',

  'discover.chip.task': '已领取任务',
  'discover.chip.handover': '柜台已收到存储卡',
  'discover.chip.rate': '按通过审核的分钟计酬',

  'discover.label.camera': '设备',
  'discover.label.work': '工作',
  'discover.label.film': '占位影片',
  'discover.label.review': '审核',
  'discover.label.payment': '付款',
  'discover.label.questions': '问题',
  'discover.label.next': '下一步',

  'discover.work.note':
    '这些是日常劳动的占位图片。没有一张是 Ego 相机拍下的素材，也没有一张被这样标注。正式拍摄之后会替换。',

  'discover.verdict.note': '审核员记录三种结果之一，并为不可用的部分给出原因代码。',

  'discover.streams.video': '画面',
  'discover.streams.audio': '声音',
  'discover.streams.imu': '运动',
  'discover.streams.payable': '可计酬：所有数据流共同覆盖的时段',
  'discover.streams.device': '设备报告的是最长的一路数据流。该数字仅供参考，而且偏高。',

  'nf.eyebrow': '没有这个页面',
  'nf.title.a': '这个地址上',
  'nf.title.b': '没有记录',
  'nf.title.c': '任何东西。',
  'nf.body': '链接不对，或者页面已经移动。平台关于自身的全部说明都在产品介绍页。',
  'nf.back': '回到产品介绍页',
  'login.network': '服务没有应答。请确认本机在中心网络内，然后重试。',

  'login.legal': '登录即表示您接受 PlayerOne 处理您数据的方式。',
  'login.legalPrivacy': '隐私政策',
  'login.legalData': '数据收集说明',

  'ui.a.home.gauge': '本班已审核 {{value}} 集，目标 {{target}} 集',
  'ui.a.home.gaugeCaption': '本班已审核集数',
  'ui.a.home.payable.note': '仅统计已判定审核的有效时长。',
  'ui.a.home.approval.note': '通过与部分通过，占今天全部判定的比例。',
  'ui.a.home.pace.note': '从载入到判定。仅作观测，与金额无关。',
  'ui.a.home.clock': '本机时钟。',
  'ui.a.home.approval.target': '项目目标 85–90%。',
  'ui.a.home.recent.time': '时间',
  'ui.a.home.recent.episode': '集',
  'ui.a.home.recent.verdict': '判定',
  'ui.a.home.recent.duration': '实测 → 有效',
  'ui.a.home.recent.amount': '金额',
  'ui.a.home.recent.pace': '用时',
  'ui.a.home.settled.note': '仅限你本人的判定，不是整个项目的支出。',
  'ui.a.home.settled.open': '打开结算',
  'ui.a.home.error.title': '本班数据未能载入。',
  'ui.a.home.error.body':
    '本屏幕其余部分仍可使用。这些计数来自审核数据库；如果反复出现，说明接口无法连接 Postgres。',
  'ui.a.home.recent.error': '最近的审核记录未能载入。',
  'ui.a.home.unavailable': '暂无数据',

  'ui.a.home.asOf': '截至 {{time}}',
  'ui.a.home.next.title': '一次只看一段录制。',
  'ui.a.home.next.body': '收集者的报酬只来自这里的结论。准备好了就领取下一集。',
  'ui.a.home.queueWaiting': '在你的队列中等待',
  'ui.a.home.results': '本班次已完成的工作',
  'ui.a.home.median': '判定用时中位数',
  'ui.a.home.median.note': '本班次已计时审核的中位值。仅作观测，与金额无关。',
  'ui.a.home.attention.none': '目前没有需要人工处理的事项。',
  'ui.a.home.attention.unknown': '未连接。本屏幕无法说明哪些事项需要处理。',

  'ui.a.home.insights': '可选洞察',
  'ui.a.home.truc.lede':
    'Trúc 只是一个额外渠道。他说的每一句，本页面都另有写明，任何事都不依赖他。',
  'ui.a.home.truc.greet': '你好。{{shift}}。',
  'ui.a.home.truc.offline': '未连接。我没有可以告诉你的实测数据。',
  'ui.a.home.truc.source': '来源：你的本班次数据。',
  'ui.a.home.truc.pause': '暂停 Trúc',
  'ui.a.home.truc.resume': '恢复 Trúc',

  'ui.a.home.preview.show': '显示示例洞察',
  'ui.a.home.preview.hide': '隐藏示例洞察',
  'ui.a.home.preview.why': '这里没有任何实测数据。示例只展示尚未建成的面板的样子。',
  'ui.a.home.preview.note':
    '本班次接口只返回当前数值，不返回历史序列，因此这些数字背后没有任何趋势。它们只用于确定版式，绝不会用来顶替载入失败的数值。',
  'ui.a.home.preview.badge': '示例 — 非实时数据',
  'ui.a.home.preview.trend': '记录最多的场景',
  'ui.a.home.preview.trendValue': '园艺',
  'ui.a.home.preview.week': '本周你判定的时长',
  'ui.a.home.preview.streak': '连续班次',

  'ui.a.notBuilt.today': '目前这项工作怎么做',

  'ui.a.pipeline.track': '一段录制会经过哪些环节',
  'ui.a.pipeline.owed': '等待 PaXini 交付',

  'episodes.title': '需要处理的集',
  'episodes.intro':
    '按任务、采集者、设备、状态和录制时间浏览全部集（BO-05），需要一个目前还不存在的列表接口。',
  'episodes.batch': '本机导入的批次，最近 100 个',
  'episodes.batch.pick': '批次',
  'episodes.batch.none': '本机还没有导入过任何批次。',
  'episodes.batch.failed': '批次列表未能载入。',
  'episodes.blocking': '阻塞项，本批次',
  'episodes.blocking.scope': '使所选批次无法关闭的集。范围限于本机，按导入时间。',
  'episodes.stuck': '停滞项，本中心',
  'episodes.stuck.scope': '本上传中心内被搁置或被扣住的工作，不论来自哪个批次。',
  'episodes.empty': '此范围内没有需要处理的项。',
  'episodes.filter': '筛选这些行',
  'episodes.col.episode': '集',
  'episodes.col.session': '会话开始时间',
  'episodes.col.state': '归属',
  'episodes.col.needs': '待办',
  'episodes.col.device': '存储卡',
  'episodes.col.hold': '扣留',
  'episodes.needs.assignment': '需要指定所属会话',
  'episodes.needs.confirmation': '需要有人确认这次匹配',
  'episodes.hold.parked': '已搁置',
  'episodes.hold.held': '审核中被扣留',
  'episodes.summary.episodes': '集数',
  'episodes.summary.sessions': '会话数',
  'episodes.summary.quarantined': '已隔离',
  'episodes.summary.awaiting': '待确认',
  'episodes.summary.parked': '已移出审核队列',
  'episodes.summary.perSession': '每个会话的集数',
  'episodes.resolve': '指定归属',
  'episodes.resolve.title': '为这一集指定所属会话',
  'episodes.resolve.session': '会话',
  'episodes.resolve.reason': '为什么选这个会话',
  'episodes.resolve.reasonHint': '没有写明理由时，数据库会拒绝这次归属。',
  'episodes.resolve.done': '已指定归属。该批次已重新读取。',
  'episodes.outcome': '审核结果',
  'episodes.outcome.state': '判定结果',
  'episodes.outcome.pending': '当前交付还没有结论。',
  'episodes.outcome.collector': '采集者',
  'episodes.outcome.decided': '判定时间',
  'episodes.outcome.note': '审核员备注',
  'episodes.outcome.reasons': '原因代码',
  'episodes.outcome.failed': '结果未能载入。',
  'episodes.close': '关闭',
  'episodes.gone': '服务端上已经没有这一集了。请重新读取该批次。',
  'episodes.reload': '重新读取',
  'episodes.noMatch': '此范围内没有符合筛选条件的行。',
  /* 向导语法：柜台收卡与后台任务派发共用。每一步只问一个问题。 */

  'wiz.step': '步骤',
  'wiz.review': '核对并提交',
  'wiz.review.question': '写入之前，请逐项核对。',
  'wiz.unanswered': '尚未填写',
  'wiz.edit': '修改',
  'wiz.back': '上一步',
  'wiz.next': '下一步',
  'wiz.needAnswer': '回答本题后才能继续。',
  'wiz.failed.gone': '服务端已没有这一步所指的记录。请重新载入页面，从头再来。',
  'wiz.failed.body':
    '服务端不接受其中一项答案。这是控制台自身的缺陷，而不是您填错了；反馈时请附上下面的编号。',
  'wiz.failed.session': '当前会话无权做此更改。请重新登录，或改用具备管理员角色的操作员。',

  /* 柜台：收卡登记（BO-10、APP-17b）。 */

  'counter.title': '收卡登记',
  'counter.intro':
    '采集者交回一张 TF 卡。请登记交卡人、卡取自哪台相机，以及卡上录了什么。最后一步之前不会写入任何数据。',
  'counter.review.intro': '将写入两条记录：卡的交接，以及针对它申报的这次采集。可在此修改任一项。',
  'counter.group.card': '这张卡',
  'counter.group.recording': '这次采集',

  'counter.step.collector': '采集者',
  'counter.step.device': '相机',
  'counter.step.card': '存储卡',
  'counter.step.task': '任务',
  'counter.step.scenario': '场景',
  'counter.step.declare': '申报事项',

  'counter.q.collector': '这张卡是谁交来的？',
  'counter.q.device': '这张卡取自哪台相机？',
  'counter.q.card': '是哪张卡，什么时候交到柜台的？',
  'counter.q.task': '这次采集是针对哪个任务的？',
  'counter.q.scenario': '在哪里采集的？采集是什么时候准备的？',
  'counter.q.declare': '采集者是怎么申报的？',

  'counter.note.collector':
    '一张卡只属于一位采集者，也就是站在柜台前的这个人。中心、这台机器和您本人的身份都取自登录凭证，所以这里不会再问。',
  'counter.note.device':
    '相机会在采集者之间流转，卡也会在相机之间流转。两者都不按上一次谁拿着来推断，所以相机要明确指定。',
  'counter.note.card':
    '按卡上写的标识填写。这里的时间是卡在本柜台交接的时刻，不是录制的时刻。',
  'counter.note.task':
    '任务决定单价。采集者必须已经持有该任务的有效领取；若没有，服务端会拒绝这次采集，并说明是三种原因中的哪一种。',
  'counter.note.scenario':
    '准备时间是采集者回忆出来的。系统绝不会拿它去自动匹配素材，只有由手机应用创建的采集才会自动匹配，所以导入之后由操作员确认归属。',
  'counter.note.declare':
    '两项都必须回答。否是一个答案，没人问过不是，记录里也无法表达后者。',

  'counter.field.card': 'TF 卡',
  'counter.hint.card': '按卡上所写填写。',
  'counter.field.handoverAt': '交卡时间',
  'counter.hint.handoverAt': '您本地的时间。',
  'counter.field.preparedAt': '采集准备时间',
  'counter.hint.preparedAt': '您本地的时间。没有结束时间，也不设这个字段。',

  'counter.declare.others': '画面中出现了其他人',
  'counter.declare.sensitive': '画面中出现了敏感信息',
  'counter.declare.yes': '是',
  'counter.declare.no': '否',

  'counter.privacy.low': '隐私风险低',
  'counter.privacy.medium': '隐私风险中等',
  'counter.privacy.high': '隐私风险高',

  'counter.empty.collectors':
    '本机还没有收到任何采集者名单。名册在后台维护，这里为空通常说明参考数据没有同步过来。',
  'counter.empty.devices':
    '本机还没有收到任何相机记录。设备在后台维护，这里为空通常说明参考数据没有同步过来。',
  'counter.empty.tasks': '本机还没有收到任何任务。采集必须挂在任务下，没有任务就无法申报。',
  'counter.empty.scenarios':
    '本机还没有收到任何场景。场景是随服务预置的参考数据，为空即说明参考数据没有同步过来。',

  'counter.commit': '登记交卡',
  'counter.commit.session': '登记这次采集',
  'counter.recorded':
    '已按本次登记开始时的编号写入，再发一次也不会改变什么。若填错了，请另起一张卡重新登记。',
  'counter.landed':
    '交卡已入库。只剩这次采集还没写入，而前三项答案不能在它下面改动；若其中一项填错，请另起一张卡。',
  'counter.refused.reference': '本机的参考数据与服务端不一致。请重新载入页面后再选。未找到：',

  'counter.done.title': '卡已登记',
  'counter.done.card': '卡不会被清空。这条链路上没有任何环节会删除卡上的内容，以后也不会有。',
  'counter.done.match':
    '这是在柜台登记的，所以素材不会按时间自动归到它名下。卡导入之后，由操作员在采集片段页确认归属。',
  'counter.done.nextCard': '下一张卡',
  'counter.done.nextSession': '这张卡上的另一次采集',

  /* 后台：新建任务并把人派上去（BO-01、BO-02、APP-10，以及结算读取的设备保管期）。 */

  'assign.title': '新建任务',
  'assign.review.intro': '先创建任务，若选择发布则发布，然后逐个为采集者领取。可在此修改任一项。',
  'assign.commit': '创建任务',
  'assign.group.task': '任务本身',
  'assign.group.people': '相关人员',

  'assign.step.name': '名称',
  'assign.step.rate': '单价',
  'assign.step.capacity': '名额',
  'assign.step.publish': '发布',
  'assign.step.claimants': '领取人',
  'assign.step.cameras': '相机',

  'assign.q.name': '这个任务叫什么？',
  'assign.q.rate': '它的报酬是多少？',
  'assign.q.capacity': '同时最多允许几位采集者领取？',
  'assign.q.publish': '现在就发布吗？',
  'assign.q.claimants': '由谁来做？',
  'assign.q.cameras': '有人要领走相机吗？',

  'assign.note.name':
    '名称是采集者在任务大厅里看到的文字。类型沿用 PaXini 自己的分类，没有固定清单。',
  'assign.note.rate':
    '一个小数，最多八位整数、四位小数，与数据库列的存法完全一致。它会乘进每一笔付款，所以录入时不做任何取整；任务一旦发布，这个数字就不能再改。',
  'assign.note.capacity': '名额按当前有效的领取计数。释放一次领取，名额就还给任务。',
  'assign.note.publish':
    '草稿不能被领取：数据库会拒绝对未发布任务的领取。想稍后再补细节就先留作草稿，之后从表格里发布。',
  'assign.note.claimants':
    '领取表示这位采集者持有这个任务，他们据此录制的内容按该单价结算。不选任何人也是有效的答案，已发布的任务可以留给任务大厅去认领。',
  'assign.note.cameras':
    '这是保管期，不是绑定：结算据此判断某一天相机在谁手上。该相机上仍然开着的保管期，会在同一时刻被关闭。',

  'assign.hint.type': 'PaXini 的分类，没有固定清单。',
  'assign.hint.target': '可不填。按有效秒数计。',

  'assign.publish.label': '现在发布这个任务',
  'assign.publish.now': '已发布',
  'assign.publish.draft': '留作草稿',

  'assign.claimants.none': '无人',
  'assign.claimants.empty': '目前还没有采集者。请先到采集者页建一位，再回到这里。',
  'assign.cameras.none': '不发放相机',
  'assign.cameras.no': '不发相机',
  'assign.cameras.noClaimants': '没有人接这个任务，也就没有相机需要发放。',

  'assign.done.title': '任务已创建',
  'assign.done.published': '已发布，采集者可以领取。',
  'assign.done.draft': '留作草稿。准备好后从表格里发布。',
  'assign.done.nobody':
    '没有给任何人派上。采集者可以自己在任务大厅领取，您也可以在本页代为领取。',
  'assign.done.claimed': '已持有该任务。',
  'assign.done.assigned': '相机已发放。',
  'assign.done.someRefused':
    '您所请求的内容有一部分被拒绝了。任务本身已经创建；上面每一行说明了谁没有派上，以及原因。',
  'assign.done.close': '返回任务列表',
};

const vi: Record<MessageKey, string> = {
  'bo.error.reference': 'Mã tham chiếu:',
  'app.name': 'PlayerOne',
  'app.review': 'Duyệt',
  'app.signOut': 'Đăng xuất',
  'app.language': 'Ngôn ngữ',

  'login.title': 'Đăng nhập để duyệt',
  'login.titleOperator': 'Đăng nhập trung tâm tải lên',
  'login.groupMachine': 'Máy',
  'login.fieldIdentifier': 'Mã',
  'login.fieldReference': 'Mã số',
  'login.fieldSecret': 'Khóa',
  'login.trucOpen': 'Hỏi Trúc',
  'login.trucTitle': 'Trúc',
  'login.trucBody':
    'Trúc chưa trả lời được. Khi kết nối xong, đây là nơi bạn hỏi một kết luận nghĩa là gì, vì sao một thẻ bị từ chối, hay một khoản tiền đã đi đâu.',
  'login.trucSoon': 'Chưa kết nối',
  'login.trucClose': 'Đóng',
  'login.groupOperator': 'Nhân viên',
  'login.groupReviewer': 'Người duyệt',
  'login.intro':
    'Hai thông tin xác thực, như mọi nơi khác trong dịch vụ này: máy chứng minh địa điểm, nhân viên chứng minh danh tính.',
  'login.machine': 'Mã máy',
  'login.machineSecret': 'Khóa của máy',
  'login.operator': 'Mã nhân viên',
  'login.operatorSecret': 'Khóa của nhân viên',
  'login.role': 'Đăng nhập với vai trò',
  'login.roleCounter': 'Trung tâm tải lên',
  'login.roleReviewer': 'Người duyệt',
  'login.reviewer': 'Mã người duyệt',
  'login.reviewerSecret': 'Khóa của người duyệt',
  'login.reviewerIntro':
    'Một thông tin xác thực. Người duyệt làm việc từ xa, không ở quầy, nên không cần chứng minh máy — và phiên chỉ vào được phần duyệt.',
  'login.submit': 'Đăng nhập',
  'login.failed': 'Thông tin xác thực không được chấp nhận.',
  'login.mismatch': 'Máy và nhân viên thuộc hai trung tâm tải lên khác nhau.',

  'queue.depth': 'Trong hàng đợi',
  'queue.average': 'Trung bình mỗi kết luận',
  'queue.empty.title': 'Không có gì để duyệt',
  'queue.empty.body':
    'Mọi phiên đã có chủ và qua kiểm tra toàn vẹn đều đã được kết luận. Tư liệu mới sẽ xuất hiện ở đây khi được nhập.',
  'queue.refresh': 'Kiểm tra lại',

  'meta.episode': 'Phiên',
  'meta.folder': 'Thư mục trên thẻ',
  'meta.task': 'Nhiệm vụ',
  'meta.rate': 'Mỗi phút',
  'meta.collector': 'Cộng tác viên',
  'meta.scenario': 'Bối cảnh',
  'meta.device': 'Thiết bị',
  'meta.firmware': 'Firmware thiết bị',
  'meta.measured': 'Đo được',
  'meta.claimed': 'Thiết bị khai',
  'meta.discrepancy': 'Chênh lệch',
  'meta.recorded': 'Ghi lúc',
  'meta.timing': 'Nguồn thời gian',
  'meta.attribution': 'Quy chủ',
  'meta.flags': 'Cờ',
  'meta.declared': 'Cộng tác viên khai',
  'meta.othersInFrame': 'Có người khác trong khung hình',
  'meta.sensitive': 'Thông tin nhạy cảm',
  'meta.yes': 'Có',
  'meta.no': 'Không',
  'meta.none': 'Không có',
  'bo.flag.DUR-MANIFEST-INFLATED': 'Bản kê của thiết bị khai thời lượng ghi dài hơn thời lượng thực có trong tệp phương tiện.',
  'bo.flag.FRAMECOUNT-MISMATCH': 'Số khung hình bản kê khai báo không khớp với số khung hình đo được trong tệp phương tiện.',
  'bo.flag.AUDIO-STATS-ZERO': 'Bản kê báo số khung âm thanh bằng không dù vẫn có luồng âm thanh.',
  'bo.flag.MANIFEST-FILES-UNRESOLVED': 'Bản kê liệt kê những tệp không có trên thẻ nhớ.',
  'bo.flag.SESSION-UNCLOSED': 'Thiết bị không ghi thời điểm kết thúc; bản thân bản ghi vẫn bình thường.',
  'bo.flag.STATS-ZEROED': 'Khối thống kê trong bản kê toàn số không dù vẫn có tệp phương tiện.',
  'bo.flag.PTS-EMPTY': 'Tệp dấu thời gian đi kèm có trên thẻ nhớ nhưng không chứa dấu thời gian nào.',
  'bo.flag.PTS-ABSENT': 'Luồng dữ liệu này không có tệp dấu thời gian đi kèm.',
  'bo.flag.PTS-TRUNCATED': 'Tệp dấu thời gian bị cắt giữa dòng; dòng cuối chưa hoàn chỉnh đã bị bỏ.',
  'bo.flag.STATS-STALE': 'Khối thống kê có vẻ được sao lại từ phiên trước: nó không khớp với kết quả đo được.',
  'bo.flag.STREAM-CLOCK-FAULT': 'Khoảng thời gian của luồng không thể giải thích bằng chính số mẫu mà nó chứa.',
  'bo.flag.DEVICE-CLOCK-UNSET': 'Đồng hồ của thiết bị chưa được đặt nên bản ghi này không có ngày dùng được. Dữ liệu vẫn tốt và vẫn được trả công; không thể ghép theo thời gian, hãy xác nhận nó thuộc buổi thu nào.',
  'bo.flag.PART-MISSING-TAIL': 'Số phần trên thẻ ít hơn số bản kê khai báo; bản ghi kết thúc sớm.',
  'bo.flag.TIMING-ESTIMATED': 'Thời lượng được ước tính chứ không đọc chính xác, nên thời gian tính công kém chắc chắn hơn.',
  'bo.flag.STREAM-SKEW-HIGH': 'Các luồng dữ liệu bắt đầu lệch nhau quá xa.',
  'bo.flag.PART-GAP': 'Có khoảng trống thời gian giữa hai phần liên tiếp của cùng một luồng.',
  'bo.flag.PART-ORDER-CONFLICT': 'Số thứ tự các phần mâu thuẫn với trình tự mà dấu thời gian thể hiện.',
  'bo.flag.FIRMWARE-UNKNOWN': 'Phiên bản firmware của thiết bị nằm ngoài tập đã được nền tảng kiểm thử.',
  'bo.flag.CAMERA-NAMING-CONFLICT': 'Tên các camera trên thẻ không khớp với mô tả trong bản kê.',
  'bo.flag.IMU-RATE-ANOMALY': 'Tần số lấy mẫu IMU đo được khác với tần số bản kê khai báo.',
  'bo.flag.CALIB-MISSING': 'Tệp hiệu chuẩn không đi kèm với phân đoạn này.',
  'bo.flag.MEDIA-MISSING': 'Một luồng mà phiên ghi khai báo lại không có tệp phương tiện trên đĩa.',
  'bo.flag.MEDIA-UNREADABLE': 'Tệp phương tiện có tồn tại nhưng không giải mã được.',
  'bo.flag.MEDIA-TRUNCATED': 'Tệp phương tiện bị thiếu về cấu trúc: quá trình truyền chưa hoàn tất.',
  'bo.flag.ROWS-MALFORMED': 'Tệp dấu thời gian chứa những dòng không phải là dấu thời gian.',
  'bo.flag.CALIB-UNREADABLE': 'Tệp hiệu chuẩn có trên đĩa nhưng không đọc phân tích được.',
  'bo.flag.MANIFEST-UNREADABLE': 'Bản kê có trên đĩa nhưng không phân tích được, nên không có gì được đối chiếu với nó.',
  'bo.flag.PART-MISSING-INTERIOR': 'Thiếu một phần ở giữa của luồng nhiều phần.',
  'bo.flag.CHECKSUM-MISMATCH': 'Nội dung tệp đã thay đổi giữa hai lần bàn giao của cùng một phiên ghi.',
  'bo.flag.DUR-EXCEEDS-WINDOW': 'Thời lượng được khai dài hơn khoảng thời gian mà chính dấu thời gian của bản ghi mô tả.',
  'bo.flag.EPISODE-ID-FALLBACK': 'Tên thư mục không phân tích được; mã phân đoạn lùi về dùng nguyên tên thư mục.',
  'bo.flag.SERIAL-CONFLICT': 'Tên thư mục, bản kê và tệp hiệu chuẩn không thống nhất về số sê-ri thiết bị.',
  'bo.flag.SESSION-CONFLICT': 'Mã phiên được khai không khớp với hồ sơ bàn giao.',
  'meta.unknown': 'Không rõ',
  'meta.claimHint': 'Chỉ để tham khảo. Tệp khai báo của thiết bị thường ghi dài hơn thực tế.',
  'meta.measuredHint': 'Kết luận được chấm dựa trên con số này.',

  'player.play': 'Phát',
  'player.pause': 'Tạm dừng',
  'player.rate': 'Tốc độ',
  'player.part': 'Phần',
  'player.position': 'Vị trí phát',
  'player.of': 'trên',
  'player.loading': 'Đang tải tư liệu',

  'mark.in': 'Đánh dấu đầu',
  'mark.out': 'Đánh dấu cuối',
  'mark.clear': 'Xóa đoạn',
  'mark.pending': 'Đã đặt điểm đầu. Nhấn O để đóng đoạn.',
  'mark.orphanOut': 'Nhấn I trước để mở một đoạn.',
  'mark.spans': 'Các đoạn đã đánh dấu',
  'mark.none': 'Chưa đánh dấu gì',
  'mark.estimate': 'Ước tính phần dùng được',
  'mark.estimateHint': 'Chỉ là ước tính. Con số của máy chủ quyết định khoản thanh toán.',
  'mark.needsSpan': 'Kết luận đạt một phần cần ít nhất một đoạn được đánh dấu.',

  'verdict.good': 'Đạt',
  'verdict.partial': 'Đạt một phần',
  'verdict.bad': 'Từ chối',
  'verdict.commit': 'Ghi nhận và tiếp tục',
  'verdict.note': 'Ghi chú (không bắt buộc)',
  'verdict.reasons': 'Lý do',
  'verdict.reasonsRequired': 'Từ chối phải nêu ít nhất một lý do.',
  'verdict.committing': 'Đang ghi kết luận',

  'state.leaseExpired.title': 'Phiên này đã được giao lại',
  'state.leaseExpired.body':
    'Lượt nhận đã hết hạn và người duyệt khác có thể đang giữ nó. Kết luận bạn đang chuẩn bị đã bị bỏ.',
  'state.leaseExpired.action': 'Nhận phiên tiếp theo',
  'state.playbackWithheld.title': 'Phiên này chưa mở để duyệt',
  'state.playbackWithheld.body':
    'Việc phát tư liệu gốc từ xa chưa được cho phép, nên ở đây chưa có gì để duyệt. Không phiên nào bị lấy khỏi hàng đợi, và không thể đưa kết luận khi chưa xem tư liệu. Màn hình này sẽ hoạt động ngay khi phương án phát được duyệt.',
  'state.mediaFailed.title': 'Tư liệu không phát được',
  'state.mediaFailed.body':
    'Bản ghi có trong kho nhưng máy này không đọc được tệp. Đó là lỗi của máy này, không phải của bản ghi.',
  'state.mediaFailed.action': 'Bỏ qua phiên này',
  'state.writeFailed.title': 'Kết luận chưa được ghi',
  'state.writeFailed.body':
    'Lệnh ghi không đến được máy chủ. Chưa có gì được thanh toán và chưa chuyển sang phiên nào. Thử lại, hoặc trả phiên để nó quay về hàng đợi.',
  'state.writeFailed.retry': 'Thử lại',
  'state.writeFailed.release': 'Trả phiên',

  'state.refused.title': 'Máy chủ đã từ chối kết quả duyệt này',
  'state.refused.hold': 'Gửi lại quầy tiếp nhận',
  'state.refused.holdReason': 'Điều quầy cần xử lý',
  'state.refused.holding': 'Đang gửi lại',
  'state.refused.holdFailed':
    'Phân đoạn chưa được đưa ra khỏi hàng đợi và vẫn còn trong hàng đợi. Hãy thử lại, hoặc báo trực tiếp cho quầy.',
  'state.refused.held.title': 'Đã gửi lại quầy tiếp nhận',
  'state.refused.held.body':
    'Phân đoạn này đã rời hàng đợi duyệt và sẽ không được giao cho ai khác cho đến khi quầy xử lý xong lý do từ chối. Không có khoản nào được trả.',
  'state.offline.title': 'Mất kết nối',
  'state.offline.body': 'Không thể ghi kết luận khi máy này ngoại tuyến.',
  'state.loadFailed.title': 'Không kết nối được hàng đợi',

  'shortcuts.title': 'Bàn phím',
  'shortcuts.show': 'Phím tắt',
  'shortcuts.spaceKey': 'Phím cách',
  'shortcuts.playPause': 'Phát hoặc tạm dừng',
  'shortcuts.seek': 'Lùi hoặc tiến 5 giây',
  'shortcuts.frame': 'Lùi hoặc tiến một khung hình',
  'shortcuts.rate': 'Chậm hơn hoặc nhanh hơn',
  'shortcuts.markIn': 'Đánh dấu đầu',
  'shortcuts.markOut': 'Đánh dấu cuối',
  'shortcuts.clear': 'Xóa đoạn dưới đầu phát',
  'shortcuts.verdict': 'Đạt, đạt một phần, từ chối',
  'shortcuts.commit': 'Ghi nhận và tiếp tục',
  'shortcuts.help': 'Hiện hoặc ẩn bảng này',

  'recent.title': 'Kết luận gần đây',
  'recent.empty': 'Chưa có kết luận nào trong phiên làm việc này',

  'nav.home': 'Trang chính',
  'nav.counter': 'Quầy',
  'nav.review': 'Duyệt',
  'nav.episodes': 'Phiên ghi',
  'nav.settle': 'Thanh toán',
  'nav.pipeline': 'Tiến độ',
  'nav.notBuilt': 'Chưa xây dựng',
  'nav.notBuilt.body': 'Màn hình này đã có trong kế hoạch nhưng chưa được xây. Công việc nó mô tả hiện được làm bằng dòng lệnh.',

  'home.greeting': 'Ca của bạn',
  'home.reviewed': 'phiên đã duyệt',
  'home.target': 'mục tiêu',
  'home.start': 'Bắt đầu duyệt',
  'home.payable': 'Thời lượng được trả hôm nay',
  'home.approval': 'Tỷ lệ đạt',
  'home.settled': 'Giá trị đã chốt',
  'home.needsHuman': 'phiên cần người xử lý',
  'home.needsHuman.body': 'Bộ quy chủ từ chối đoán ai đã ghi chúng.',
  'home.needsHuman.open': 'Mở',
  'home.queueEmpty': 'Hàng đợi trống. Cú không có gì để xem.',
  'home.shiftEarly': 'Chim sớm',
  'home.shiftDay': 'Ca ngày',
  'home.shiftGolden': 'Giờ vàng',
  'home.shiftNight': 'Cú đêm',

  'pipeline.title': 'Những gì đã thực sự xây xong',
  'pipeline.intro':
    'Mọi năng lực mà bản yêu cầu nêu ra, và tình trạng thật của từng mục. Mục bị chặn ghi rõ thứ đang chặn nó.',
  'pipeline.built': 'đã xây',
  'pipeline.next': 'tiếp theo',
  'pipeline.blocked': 'bị chặn',
  'pipeline.capability': 'Năng lực',
  'pipeline.requirement': 'Yêu cầu',
  'pipeline.state': 'Trạng thái',
  'pipeline.surface': 'Màn hình',
  'pipeline.state.built': 'Đã xây',
  'pipeline.state.partial': 'Một phần',
  'pipeline.state.buildable': 'Có thể xây',
  'pipeline.state.blocked': 'Bị chặn',
  'pipeline.state.verified': 'Đã kiểm chứng',

  'nav.backoffice': 'Hậu cần',

  'bo.title': 'Hậu cần',
  'bo.intro': 'Các nhiệm vụ cộng tác viên được trả tiền để ghi, những người ghi chúng, và thiết bị họ mang theo.',
  'bo.tab.tasks': 'Nhiệm vụ',
  'bo.tab.collectors': 'Cộng tác viên',
  'bo.tab.devices': 'Thiết bị',
  'bo.empty': 'Chưa có gì ở đây.',
  'bo.loadFailed': 'Danh sách này không tải được.',
  'bo.loadFailed.body': 'Hậu cần đọc dữ liệu qua API. Chưa có gì bị thay đổi.',
  'bo.working': 'Đang xử lý',
  'bo.edit': 'Sửa',
  'bo.save': 'Lưu',
  'bo.cancel': 'Hủy',

  'bo.task.name': 'Nhiệm vụ',
  'bo.task.type': 'Loại',
  'bo.task.rate': 'Mỗi phút',
  'bo.task.target': 'Thời lượng hiệu quả mục tiêu',
  'bo.task.claimants': 'Đã nhận',
  'bo.task.maxClaimants': 'Số người nhận đồng thời tối đa',
  'bo.task.state': 'Trạng thái',
  'bo.task.state.draft': 'Nháp',
  'bo.task.state.published': 'Đã đăng',
  'bo.task.state.taken_down': 'Đã gỡ',
  'bo.task.publish': 'Đăng',
  'bo.task.takeDown': 'Gỡ xuống',
  'bo.task.new': 'Nhiệm vụ mới',
  'bo.task.create': 'Tạo bản nháp',
  'bo.task.priceFrozen':
    'Đơn giá của nhiệm vụ đã đăng không thể sửa ở đây. Gỡ nhiệm vụ xuống và đăng một nhiệm vụ mới.',
  'bo.task.priceNote':
    'Đơn giá được lưu đúng như đã nhập và nhân vào mọi khoản thanh toán. Ở đây không làm tròn.',

  'bo.collector.ref': 'Cộng tác viên',
  'bo.collector.status': 'Tư cách',
  'bo.collector.status.pending': 'Chờ xét',
  'bo.collector.status.qualified': 'Đủ điều kiện',
  'bo.collector.status.suspended': 'Tạm đình chỉ',
  'bo.collector.exam': 'Bài kiểm tra',
  'bo.collector.exam.pass': 'Đạt',
  'bo.collector.exam.fail': 'Không đạt',
  'bo.collector.exam.none': 'Chưa làm',
  'bo.collector.agreements': 'Thỏa thuận',
  'bo.collector.gate': 'Chưa đạt bài kiểm tra thì không nhận được nhiệm vụ. Máy chủ từ chối, không phải màn hình.',
  'bo.collector.markPass': 'Ghi nhận đạt',
  'bo.collector.markFail': 'Ghi nhận không đạt',
  'bo.collector.clearExam': 'Xóa kết quả kiểm tra',
  'bo.collector.new': 'Cộng tác viên mới',
  'bo.collector.create': 'Thêm cộng tác viên',
  'bo.collector.missing': 'Còn thiếu',
  'bo.collector.recordAgreement': 'Ghi nhận chấp thuận',
  'bo.collector.agreement': 'Thỏa thuận',
  'bo.collector.version': 'Phiên bản đã chấp thuận',
  'bo.collector.acceptedAt': 'Chấp thuận lúc',
  'bo.collector.agreement.user': 'Thỏa thuận người dùng',
  'bo.collector.agreement.privacy': 'Chính sách quyền riêng tư',
  'bo.collector.agreement.data_collection': 'Thu thập dữ liệu',
  'bo.collector.agreement.commercial_use': 'Sử dụng thương mại',
  'bo.collector.agreement.manual_review': 'Duyệt thủ công',
  'bo.collector.agreement.offline_settlement': 'Thanh toán ngoại tuyến',
  'bo.collector.payout': 'Tài khoản nhận tiền',
  'bo.collector.payout.none': 'Chưa khai',
  'bo.collector.payout.declare': 'Khai tài khoản',
  'bo.collector.payout.redeclare': 'Đổi tài khoản',
  'bo.collector.payout.method': 'Hình thức',
  'bo.collector.payout.method.WALLET': 'Ví ZaloPay',
  'bo.collector.payout.method.BANK_ACCOUNT': 'Tài khoản ngân hàng',
  'bo.collector.payout.method.BANK_CARD': 'Thẻ ngân hàng',
  'bo.collector.payout.holder': 'Tên trên tài khoản',
  'bo.collector.payout.phone': 'Số di động',
  'bo.collector.payout.bankCode': 'Mã ngân hàng',
  'bo.collector.payout.accountNo': 'Số tài khoản hoặc số thẻ',
  'bo.collector.payout.note':
    'Gõ đúng những gì cộng tác viên đưa cho bạn. Số này được gửi cho ZaloPay để xác nhận tên và không được lưu: chỉ giữ bốn chữ số cuối.',
  'bo.collector.payout.declared': 'Đã khai. ZaloPay trả lời:',
  'bo.collector.payout.open': 'Mở trang ZaloPay mà cộng tác viên cần',

  'bo.device.serial': 'Số sê-ri',
  'bo.device.type': 'Loại',
  'bo.device.firmware': 'Firmware thiết bị',
  'bo.device.state': 'Trạng thái',
  'bo.device.state.active': 'Đang dùng',
  'bo.device.state.faulty': 'Hỏng',
  'bo.device.state.retired': 'Đã ngừng dùng',
  'bo.device.holder': 'Gán cho',
  'bo.device.unbound': 'Chưa ai',
  'bo.device.bind': 'Gán',
  'bo.device.unbind': 'Bỏ gán',
  'bo.device.new': 'Thiết bị mới',
  'bo.device.create': 'Thêm thiết bị',
  'bo.device.faultNote': 'Ghi chú lỗi',
  'bo.device.retireNote': 'Thiết bị đã ngừng dùng không thể còn trong tay ai. Bỏ gán trước.',
  'bo.device.rollFailed':
    'Danh sách cộng tác viên không tải được, nên không có ai để gán. Chưa có gì bị thay đổi.',

  'bo.refused': 'Bị từ chối',
  'bo.refused.sign_in_rate_limited':
    'Quá nhiều lần đăng nhập bị từ chối. Hãy đợi vài phút rồi thử lại — giới hạn tự hết hạn, không ai cần mở khóa.',
  'bo.refused.task_claims_capacity': 'Nhiệm vụ đó đã đủ số người nhận cho phép.',
  'bo.refused.task_claims_exam_gate': 'Cộng tác viên đó chưa đạt bài kiểm tra nên không thể nhận nhiệm vụ.',
  'bo.refused.task_claims_published_gate': 'Chỉ nhiệm vụ đã đăng mới nhận được.',
  'bo.refused.task_claims_live_key': 'Cộng tác viên đó đã đang giữ nhiệm vụ này.',
  'bo.refused.tasks_status_transition': 'Nhiệm vụ đi từ nháp, đã đăng, đã gỡ, và không bao giờ quay lại.',
  'bo.refused.tasks_price_frozen':
    'Đơn giá của nhiệm vụ đã đăng là điều người nhận đã đồng ý. Gỡ xuống và đăng một nhiệm vụ mới.',
  'bo.refused.task_claims_qualified_gate': 'Cộng tác viên đó chưa đủ điều kiện nên không thể nhận nhiệm vụ.',
  'bo.refused.task_claims_consent_gate': 'Cộng tác viên đó chưa chấp thuận đủ sáu thỏa thuận nên không thể nhận nhiệm vụ.',
  'bo.refused.task_claims_id_reused': 'Mã nhận đó đã thuộc về một nhiệm vụ hoặc cộng tác viên khác.',
  'bo.refused.collector_agreements_append_only': 'Một lần chấp thuận là bản ghi của một thời điểm và không thể sửa hay xóa.',
  'bo.refused.devices_retired_unbound_check': 'Bỏ gán thiết bị trước khi ngừng dùng.',
  'bo.refused.backoffice_admin_required':
    'Thay đổi đó cần vai trò quản trị viên. Tài khoản của bạn là nhân viên trung tâm tải lên, gồm bàn giao, nhập dữ liệu và các hàng đợi. Hãy nhờ quản trị viên thực hiện, hoặc cấp vai trò đó cho bạn.',
  'bo.refused.collectors_external_ref_key': 'Một cộng tác viên khác đã dùng mã đó.',
  'bo.refused.devices_hardware_serial_key': 'Một thiết bị khác đã mang số sê-ri đó.',
  'bo.refused.device_already_bound': 'Thiết bị đó đang gán cho người khác. Bỏ gán trước.',
  'bo.refused.task_claims_released': 'Lượt nhận đó đã được trả. Nhận lại nhiệm vụ là một lượt nhận mới, với mã mới.',
  'bo.refused.task_claims_history_immutable':
    'Thời điểm bắt đầu và kết thúc một lượt nhận là chứng cứ thanh toán và không thể sửa hay xóa.',
  'bo.refused.task_claims_identity_immutable':
    'Một lượt nhận không thể chuyển sang nhiệm vụ hoặc cộng tác viên khác. Trả nó và tạo lượt mới.',
  'bo.refused.tasks_capacity_below_live':
    'Số cộng tác viên đang giữ nhiệm vụ này nhiều hơn giới hạn mới. Trả bớt một số lượt nhận trước.',
  'bo.refused.tasks_id_reused': 'Mã đó đã đặt tên cho một nhiệm vụ với điều khoản khác.',
  'bo.refused.collectors_id_reused': 'Mã đó đã đặt tên cho một cộng tác viên khác.',
  'bo.refused.devices_id_reused': 'Mã đó đã đặt tên cho một thiết bị khác.',
  'bo.refused.task_claims_task_id_tasks_id_fk': 'Nhiệm vụ đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.task_claims_collector_id_collectors_id_fk': 'Cộng tác viên đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.devices_bound_collector_id_collectors_id_fk': 'Cộng tác viên đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.devices_device_type_id_device_types_id_fk': 'Loại thiết bị đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.device_assignments_no_overlap': 'Thiết bị đó đã được giao cho người khác trong một phần của khoảng thời gian đó.',
  'bo.refused.device_assignments_id_reused': 'Mã giao đó đã thuộc về một thiết bị hoặc cộng tác viên khác.',
  'bo.refused.device_assignments_device_id_devices_id_fk': 'Thiết bị đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.device_assignments_collector_id_collectors_id_fk': 'Cộng tác viên đó không còn tồn tại. Tải lại danh sách.',
  'bo.refused.episode_clearing_nothing_to_clear':
    'Lần giao đó đã là lần hiện tại và không còn sai lệch checksum nào chưa xử lý, nên không có gì để gỡ.',
  'bo.refused.episode_clearing_id_reused':
    'Mã gỡ đó đã thuộc về một quyết định khác. Hãy gửi một mã mới.',
  'bo.refused.episode_clearing_foreign_delivery':
    'Lần giao đó không thuộc phân đoạn này. Hãy chọn một lần giao của chính nó.',
  'bo.refused.episode_clearing_paid_on_other_delivery':
    'Một lần giao khác của phân đoạn này đã được duyệt và trả tiền. Chọn lần giao khác là khiếu nại, không phải gỡ.',
  'bo.refused.episode_parks_already_parked':
    'Phân đoạn này đã được đưa ra khỏi hàng chờ duyệt. Hãy thả nó ra trước khi giữ lại lần nữa.',
  'bo.refused.episode_parks_not_parked':
    'Phân đoạn này không bị giữ lại, nên không có gì để thả ra.',
  'bo.refused.episode_parks_settled':
    'Phân đoạn này đã được duyệt và đã có bản thanh toán, nên không thể giữ lại. Hãy giữ lại bản thanh toán đó.',
  'bo.refused.episode_park_id_reused':
    'Mã giữ đó đã thuộc về một quyết định khác. Hãy gửi một mã mới.',
  'bo.refused.session_claim_missing':
    'Cộng tác viên này chưa nhận nhiệm vụ đó, nên không thể trả tiền cho những gì đã ghi. Hãy nhận nhiệm vụ trước.',
  'bo.refused.session_claim_released':
    'Cộng tác viên này đã trả lại nhiệm vụ đó. Cần nhận lại nhiệm vụ trước khi ghi một phiên mới.',
  'bo.refused.session_task_not_published':
    'Nhiệm vụ đó đã được gỡ xuống, nên không thể ghi phiên mới cho nó.',

  'bo.refused.review_already_decided':
    'Phân đoạn này đã có kết quả duyệt. Những gì bạn đánh dấu không được ghi lại. Hãy nhận phân đoạn tiếp theo.',
  'bo.refused.review_no_task':
    'Phân đoạn này không thuộc nhiệm vụ nào, nên không có đơn giá và không thể ghi kết quả duyệt. Hãy gửi lại quầy kèm ghi chú; cần gắn phiên thu thập trước khi duyệt được.',
  'bo.refused.review_no_longer_reviewable':
    'Phân đoạn này đã ngừng đủ điều kiện duyệt trong lúc bạn đang mở: có lần giao mới, hoặc bản sao trên đám mây không qua kiểm tra. Không có gì được ghi lại. Hãy gửi lại quầy kèm ghi chú.',
  'bo.refused.review_billed_while_disputed':
    'Khoản thanh toán đang bị khiếu nại đã lên hoá đơn trong lúc khiếu nại còn mở, nên kết quả duyệt lần hai không thể thay thế nó. Không có gì được ghi lại. Hãy gửi lại quầy kèm ghi chú.',
  'bo.refused.review_verdict_id_taken':
    'Mã kết quả duyệt đó đã thuộc về một bản duyệt khác. Không có gì được ghi lại. Hãy tải lại màn hình và duyệt lại phân đoạn.',
  'bo.refused.upload_unknown_session':
    'Phiên thu thập đó không tồn tại. Hãy gán phiên trong ứng dụng trước khi tải lên.',
  'bo.refused.upload_foreign_session':
    'Phiên thu thập đó thuộc về người thu thập khác, nên không thể tải dữ liệu lên phiên đó.',
  'bo.refused.upload_already_complete':
    'Lần tải lên này đã hoàn tất và đã được kiểm tra. Gửi lại cũng không thay đổi gì.',
  'bo.refused.upload_checksum_mismatch':
    'Một tệp trên đám mây không khớp với giá trị kiểm tra mà điện thoại đã tính. Đoạn ghi hình này bị giữ lại, không vào duyệt, cho đến khi được gửi lại.',
  'bo.refused.upload_payload_too_large':
    'Lần giao đó lớn hơn mức một lần tải lên được phép khai báo. Hãy gửi thành nhiều lần tải lên, hoặc nộp thẻ nhớ tại trung tâm tải lên.',
  'bo.refused.upload_superseded':
    'Một lần giao mới hơn của đoạn ghi hình này đã đến trong khi các tệp đang được gửi, nên kết quả lần này không được ghi nhận. Hãy tải lên lại.',

  /**
   * Lời từ chối của chính ứng dụng người thu thập (`COLLECTOR_API_REFUSALS`).
   * LOC-01 đặt tiếng Việt trên điện thoại, nên đây là ngôn ngữ người đọc chúng.
   */
  'bo.refused.task_not_found': 'Nhiệm vụ đó không còn nữa.',
  'bo.refused.task_not_claimable':
    'Nhiệm vụ đó hiện không mở, nên không thể nhận và không thể ghi hình cho nhiệm vụ đó.',
  'bo.refused.task_at_capacity':
    'Nhiệm vụ đó đã đủ số người thu thập. Hãy chọn nhiệm vụ khác.',
  'bo.refused.already_claimed': 'Bạn đã nhận nhiệm vụ này rồi.',
  'bo.refused.exam_not_passed':
    'Bạn phải đạt bài kiểm tra trước khi nhận nhiệm vụ. Hãy làm bài ở màn hình đào tạo.',
  'bo.refused.not_qualified':
    'Tài khoản này chưa được duyệt để thu thập. Trung tâm tải lên có thể cho biết tình trạng hiện tại.',
  'bo.refused.agreements_incomplete':
    'Bạn phải chấp nhận đủ sáu thỏa thuận trước khi nhận nhiệm vụ.',
  'bo.refused.claim_id_reused':
    'Mã đó đã thuộc về một nhiệm vụ khác. Hãy thử nhận nhiệm vụ lại.',
  'bo.refused.claim_released':
    'Bạn đã trả lại nhiệm vụ này trước đó, nên mã đó không dùng lại được. Hãy nhận lại để có mã mới.',
  'bo.refused.agreement_version_unknown':
    'Các thỏa thuận trên màn hình này đã cũ. Hãy tải lại và đọc trước khi chấp nhận.',
  'bo.refused.device_not_found':
    'Không có thiết bị nào mang số sê-ri đó. Hãy kiểm tra số in trên vỏ máy.',
  'bo.refused.device_not_available':
    'Thiết bị đó đã ngừng sử dụng, nên không thể ghép nối.',
  'bo.refused.already_bound': 'Thiết bị đó đã được ghép nối với người khác.',
  'bo.refused.device_not_bound':
    'Thiết bị đó chưa ghép nối với bạn. Hãy ghép nối trước khi bắt đầu phiên thu thập.',
  'bo.refused.task_not_claimed':
    'Bạn không giữ nhiệm vụ đó, nên không thể ghi hình cho nó. Hãy nhận nhiệm vụ trước.',
  'bo.refused.scenario_not_found': 'Nền tảng không ghi nhận bối cảnh đó.',
  'bo.refused.session_id_reused':
    'Mã đó đã thuộc về một phiên thu thập khác. Hãy tạo lại phiên.',

  'bo.refused.tasks_commitment_shape_check': 'Danh sách số giờ cam kết phải có ít nhất một giá trị, tất cả đều lớn hơn không và không được để trống.',
  'bo.refused.task_commitments_abandon_reason_check': 'Hãy nhập lý do không để trống khi từ bỏ cam kết.',
  'bo.refused.task_commitments_terms_immutable': 'Không thể thay đổi lượt nhận nhiệm vụ, số giờ mỗi tuần và ngày đã thỏa thuận trong cam kết.',
  'bo.refused.task_commitments_insert_active': 'Cam kết phải bắt đầu ở trạng thái đang thực hiện; sau đó đóng cam kết để ghi nhận kết quả.',
  'bo.refused.task_commitments_no_delete': 'Không thể xóa hồ sơ cam kết. Hãy đóng cam kết.',
  'bo.refused.unknown': 'Máy chủ đã từ chối thay đổi đó.',

  'theme.toggle': 'Giao diện',
  'theme.light': 'Sáng',
  'theme.dark': 'Tối',

  'guide.title': 'Hướng dẫn nhanh',
  'guide.start': 'Xem qua một lượt',
  'guide.step': 'Bước {{current}} trên {{total}}',
  'guide.back': 'Quay lại',
  'guide.next': 'Tiếp',
  'guide.done': 'Xong',
  'guide.close': 'Đóng hướng dẫn',
  'guide.panda': 'Trúc đang chỉ vào mục mà bước này nói đến',
  'guide.offscreen': 'Mục này hiện không có trên màn hình. Hãy sang bước tiếp theo.',
  'guide.offer':
    'Lần đầu vào đây? Một lượt xem ngắn sẽ cho biết từng phần của màn hình này dùng để làm gì.',
  'guide.offer.accept': 'Xem qua một lượt',
  'guide.offer.decline': 'Để sau',

  'guide.home.gauge':
    'Ca làm của bạn đến lúc này: số tập đã duyệt so với mục tiêu của ca. Vòng tròn là tiến độ, không phải kết luận duyệt.',
  'guide.home.start':
    'Nhận tập kế tiếp trong hàng đợi và mở nó. Tập đó thuộc về bạn cho đến khi bạn kết luận hoặc trả lại.',
  'guide.home.settled':
    'Giá trị các kết luận của riêng bạn trong kỳ này. Đây không phải chi phí của chương trình và cũng không phải một khoản chi.',
  'guide.shell.counters':
    'Số tập đang chờ trong hàng đợi và thời gian trung bình cho một kết luận. Cả hai luôn hiện trên mọi màn hình.',
  'guide.shell.nav':
    'Toàn bộ back office. Dấu chấm nghĩa là màn hình chưa được xây. Ô vuông tô một nửa nghĩa là mới xây được một phần.',
  'guide.review.player':
    'Đoạn ghi hình và con trỏ thời gian. Phím cách để phát và dừng. Phím mũi tên đi năm giây; giữ Shift để đi từng khung hình.',
  'guide.review.marks':
    'Đánh dấu điểm đầu và điểm cuối của phần dùng được bằng I và O. Máy chủ đo khoảng đó; màn hình này không gửi thời lượng.',
  'guide.review.verdict':
    'Ba kết luận: đạt, đạt một phần, loại. Phím 1, 2 và 3. Enter để ghi nhận kết luận bạn đã chọn.',
  'guide.review.reasons':
    'Kết luận loại phải có ít nhất một mã lý do. Người thu thập đọc các mã này bằng tiếng Việt, nên hãy chọn mã nói rõ cần sửa gì.',
  'guide.pipeline.stage':
    'Từng chặng của lần nạp dữ liệu và những gì còn chờ trong đó. Dừng ở một chặng nghĩa là việc nạp đang chờ hoặc đã lỗi ở đó. Điều này không nói gì về việc ghi hình: dữ liệu đã nằm trên thẻ.',
  'guide.backoffice.tabs':
    'Tác vụ, người thu thập và thiết bị. Mỗi thẻ là một danh sách có thể lọc, và mọi thay đổi ở đây đều ghi lại tài khoản của bạn.',
  'guide.settle.period':
    'Một kỳ quyết toán bắt đầu từ ngày này. Mọi hoá đơn có ngày bắt đầu kỳ nằm trong đó sẽ hiện bên dưới.',
  'guide.settle.bills':
    'Toàn bộ hoá đơn trong kỳ. Tổng tiền lấy từ các dòng và do máy chủ làm tròn; màn hình này không cộng thêm gì.',
  'guide.risk.holds':
    'Những khoản chi bị hệ thống giữ lại, kèm câu nói rõ lý do. Chỉ mở khoá khi bạn nói được điều gì đã thay đổi.',
  'guide.episodes.scope':
    'Phạm vi tập mà màn hình này đang hiển thị. Đây là một phạm vi, không phải toàn bộ danh mục.',
  'guide.counter.plan':
    'Mỗi bước chỉ hỏi một điều, và không ghi gì cho tới bước cuối. Thanh bên trái cho biết bạn đang ở đâu, và mọi câu trả lời đều sửa được từ trang tổng kết.',

  'settle.title': 'Thanh toán',
  'settle.intro':
    'Các hóa đơn của một kỳ, số dư ví so với chúng, những gì bộ máy rủi ro đã gắn cờ, và bản ghi của từng khoản chi. Mọi con số ở đây là của máy chủ; màn hình này không cộng và không làm tròn gì cả.',
  'settle.period': 'Kỳ bắt đầu từ',
  'settle.period.hint': 'Một chu kỳ thanh toán tính từ ngày này. Những hóa đơn có kỳ bắt đầu nằm trong đó.',
  'settle.period.apply': 'Mở',
  'settle.tab.bills': 'Hóa đơn',
  'settle.tab.preflight': 'Kiểm tra trước khi chi',
  'settle.tab.flags': 'Cờ rủi ro',
  'settle.tab.exceptions': 'Ngoại lệ',
  'settle.mode.manual': 'Chi trả thủ công: nhân viên tự chuyển tiền và ghi mã tham chiếu tại đây.',
  'settle.mode.api': 'Chi trả qua API: các lệnh chuyển được gửi qua ZaloPay từ màn hình kiểm tra trước khi chi.',
  'settle.readonly': 'Chỉ xem',
  'settle.readonly.operator':
    'Phiên này không có vai trò tài chính. Mọi con số đều xem được; mọi thao tác chi trả bị vô hiệu ở đây và bị máy chủ từ chối.',
  'settle.readonly.unknown':
    'Không xác nhận được vai trò tài chính của phiên này, nên các thao tác chi trả bị vô hiệu. Tải lại để hỏi lại.',
  'settle.readonly.refused': 'Máy chủ từ chối: phiên này không có vai trò tài chính. Chưa có gì bị thay đổi.',
  'settle.failed': 'Yêu cầu không đến được máy chủ. Chưa có gì bị thay đổi.',
  'settle.invalid': 'Máy chủ không đọc được yêu cầu đó. Chưa có gì bị thay đổi.',
  'settle.gone': 'Hóa đơn hoặc lần chi đó không còn trên máy chủ. Tải lại danh sách.',
  'settle.loadFailed': 'Kỳ này không tải được.',
  'settle.loadFailed.body': 'Các màn hình thanh toán đọc dữ liệu qua API. Chưa có gì bị thay đổi.',
  'settle.empty': 'Kỳ này không có hóa đơn.',
  'settle.empty.body': 'Hóa đơn được lập từ các khoản đã duyệt. Hãy lập hóa đơn cho kỳ này, hoặc chọn ngày bắt đầu khác.',
  'settle.generate': 'Lập hóa đơn',
  'settle.generate.hint': 'Lập hóa đơn cho mọi khoản đang chờ trong kỳ. Chạy hai lần không thay đổi gì.',
  'settle.generate.result': 'Đã lập {{created}} hóa đơn; {{notPayable}} khoản có giá trị bằng không được để ngoài.',
  'settle.generate.deferred': '{{n}} khoản đã có hóa đơn trong kỳ này ({{who}}) nên được chuyển sang kỳ kế tiếp. Số tiền không bị mất.',
  'settle.generate.skipped': '{{n}} khoản ({{who}}) đã được một lần chạy khác lập hóa đơn theo kỳ khác trong lúc lần này đang đọc. Chúng nằm trên hóa đơn của lần chạy đó.',
  'settle.generate.exception': '{{n}} khoản trong kỳ này đang được giữ lại như ngoại lệ.',
  'settle.export.payout': 'Xuất CSV chi trả',
  'settle.export.payout.hint': 'Băm từng dòng và cả tệp, có ghi nhận. Chỉ dành cho tài chính.',
  'settle.export.lines': 'Xuất CSV chi tiết',
  'settle.col.collector': 'Cộng tác viên',
  'settle.col.minutes': 'Phút hợp lệ',
  'settle.col.gross': 'Tổng',
  'settle.col.withheld': 'Khấu trừ',
  'settle.col.net': 'Thực nhận',
  'settle.col.band': 'Rủi ro',
  'settle.col.attempt': 'Chi trả',
  'settle.col.open': 'Mở',
  'settle.sort': 'Sắp xếp theo {{column}}',
  'settle.withheld.note': 'Tỷ lệ khấu trừ thuế TNCN chưa được quyết định. Máy chủ báo khấu trừ 0 và thực nhận bằng tổng.',
  'settle.asStored': 'Đúng như đã lưu, đơn vị {{currency}}. Không làm tròn ở đây.',
  'settle.wholeVnd': 'Số đồng chẵn. Tổng được làm tròn xuống; mỗi hóa đơn cộng tác viên mất chưa tới một đồng.',
  'settle.lines': '{{n}} dòng',
  'settle.attempt.none': 'Chưa có lần chi',
  'settle.attempt.created': 'Đã tạo',
  'settle.attempt.submitted': 'Đã gửi',
  'settle.attempt.processing': 'Đang xử lý',
  'settle.attempt.pending_zlp': 'Treo tại ZaloPay',
  'settle.attempt.succeeded': 'Đã trả',
  'settle.attempt.failed': 'Thất bại',
  'settle.attempt.unknown': 'Chưa rõ, đang hỏi lại',
  'settle.method.WALLET': 'Ví ZaloPay',
  'settle.method.BANK_ACCOUNT': 'Tài khoản ngân hàng',
  'settle.method.BANK_CARD': 'Thẻ ngân hàng',
  'settle.verify.unverified': 'Chưa xác minh',
  'settle.verify.verified': 'Đã xác minh',
  'settle.verify.name_mismatch': 'Tên không khớp',
  'settle.verify.no_wallet': 'Không có ví',
  'settle.verify.locked': 'Ví bị khóa',
  'settle.verify.kyc_limit': 'Chạm hạn mức nhận',
  'settle.verify.error': 'Lỗi xác minh',
  'settle.issue.title': 'Điều gì đang chặn hóa đơn này trước một lệnh chuyển',
  'settle.issue.none': 'Không có gì. Hóa đơn này có thể chi trả.',
  'settle.issue.no_account': 'Cộng tác viên chưa khai tài khoản nhận tiền.',
  'settle.issue.account_unverified': 'Tài khoản nhận tiền chưa được ZaloPay xác minh.',
  'settle.issue.over_bank_ceiling': 'Vượt trần 10.000.000 VND của ZaloPay cho một lệnh chuyển ngân hàng.',
  'settle.issue.under_bank_minimum': 'Dưới mức tối thiểu 2.000 VND của ZaloPay cho một lệnh chuyển ngân hàng.',
  'settle.issue.under_one_dong': 'Cả hóa đơn trị giá chưa tới một đồng, nên làm tròn xuống thì không còn gì để chuyển.',
  'settle.issue.over_cap': 'Vượt hạn mức mỗi cộng tác viên trong kỳ này.',
  'settle.issue.risk_hold': 'Bộ máy rủi ro đang giữ hóa đơn này.',
  'settle.issue.attempt_open': 'Hóa đơn này còn một lần chi chưa kết thúc.',
  'settle.issue.already_paid': 'Hóa đơn này đã được trả.',
  'settle.issue.line_in_exception': 'Một dòng trên hóa đơn này đang được giữ lại như ngoại lệ.',
  'settle.state.pending_review': 'Chờ duyệt',
  'settle.state.pending_settlement': 'Chờ lập hóa đơn',
  'settle.state.bill_generated': 'Đã nằm trên hóa đơn đã lập',
  'settle.state.manually_paid': 'Đã trả qua kênh thủ công',
  'settle.state.exception': 'Đang giữ lại như ngoại lệ',

  'settle.preflight.intro':
    'Đọc trước mọi khoản chi. Lô này sẽ gửi gì, ví đang có bao nhiêu, tài khoản nào chưa xác minh, và bộ máy rủi ro đã gắn cờ ai.',
  'settle.preflight.balance': 'Số dư ví',
  'settle.preflight.balance.none':
    'Không đọc được: máy chủ này chưa cấu hình máy khách ZaloPay. Thí điểm thủ công chi từ ngân hàng, nên điều này là bình thường.',
  'settle.preflight.total': 'Tổng của lô',
  'settle.preflight.required': 'Cần có, gồm biên dự phòng',
  'settle.preflight.required.hint': 'Tổng cộng thêm 5%, biên dự phòng mà bộ xử lý lô yêu cầu.',
  'settle.preflight.shortfall': 'Thiếu hụt',
  'settle.preflight.ok': 'Lô này có thể gửi: {{payable}} trên {{bills}} hóa đơn có thể chi trả.',
  'settle.preflight.refused': 'Cả lô bị từ chối. Sẽ không gửi gì.',
  'settle.preflight.serverSaid': 'Máy chủ trả lời',
  'settle.preflight.ranAt': 'Kiểm tra lúc {{at}}',
  'settle.preflight.rerun': 'Chạy lại',
  'settle.preflight.bands': 'Hóa đơn theo mức rủi ro',
  'settle.preflight.accounts': 'Tài khoản nhận tiền',
  'settle.preflight.accounts.verified': 'Đã xác minh',
  'settle.preflight.accounts.unverified': 'Chưa xác minh',
  'settle.preflight.accounts.mismatch': 'Tên không khớp',
  'settle.preflight.accounts.missing': 'Không có tài khoản',
  'settle.preflight.limits': 'Giới hạn',
  'settle.preflight.ceiling': 'Vượt trần chuyển ngân hàng {{ceiling}}',
  'settle.preflight.cap': 'Vượt hạn mức {{cap}}',
  'settle.preflight.cap.none': 'Chưa cấu hình hạn mức mỗi cộng tác viên. Giá trị này cần được trình lên quyết định.',
  'settle.preflight.others': 'Cũng chưa chi trả được',
  'settle.preflight.anomalies': 'Rủi ro cao nhất trước',
  'settle.preflight.anomalies.hint':
    '{{n}} hóa đơn có điểm rủi ro cao nhất, với từng cờ viết bằng lời thường. Mở màn hình cờ rủi ro để xử lý.',
  'settle.preflight.anomalies.none': 'Bộ máy rủi ro không gắn cờ hóa đơn nào trong kỳ này.',
  'settle.preflight.continue.manual':
    'Đã đọc kiểm tra. Mở một hóa đơn từ danh sách để ghi khoản chi thủ công; các nút chi trả bị khóa cho đến khi màn hình này đã được đọc cho kỳ đó.',
  'settle.preflight.stale': 'Phiên này chưa chạy kiểm tra trước khi chi cho kỳ này. Hãy chạy trước khi chi trả.',
  'settle.preflight.expired': 'Kiểm tra đã quá năm phút. Số dư, các lệnh giữ và danh sách bất thường có thể đã thay đổi; chạy lại trước khi chi trả.',
  'settle.preflight.changed': 'Lô đã thay đổi kể từ khi kiểm tra chạy — một khoản chi, một lời khai hoặc một lệnh giữ. Chạy lại trước khi chi trả.',
  'settle.preflight.open': 'Chạy kiểm tra',

  'settle.batch.title': 'Gửi lô',
  'settle.batch.sentence': 'Gửi {{n}} lệnh chuyển, tổng cộng {{total}}.',
  'settle.batch.serverLoop':
    'Một yêu cầu duy nhất. Máy chủ tự chạy lại kiểm tra ngay lúc đó, gửi từng lệnh một có nghỉ giữa các lệnh, dừng ở lần từ chối đầu tiên, và báo cáo lại. Trình duyệt này không gửi gì cả.',
  'settle.batch.notOnServer': 'Máy chủ này chưa có tuyến chạy lô. Theo thiết kế, lô là một vòng lặp phía máy chủ; cho đến khi tuyến đó tồn tại, không gửi gì từ đây.',
  'settle.batch.refusedAtSend': 'Kiểm tra của chính máy chủ đã từ chối lô lúc gửi: {{reason}} Không lệnh chuyển nào được gửi và một phiếu đã được tạo.',
  'settle.batch.retype': 'Gõ lại tổng, chỉ chữ số, để xác nhận',
  'settle.batch.retype.hint': 'Gõ, không bấm. Con số là của kiểm tra trước khi chi.',
  'settle.batch.mismatch': 'Đó không phải tổng của lô.',
  'settle.batch.send': 'Gửi {{n}} lệnh chuyển',
  'settle.batch.sending': 'Đang gửi {{done}} trên {{n}}',
  'settle.batch.stopped': 'Lô dừng tại {{collector}}: {{reason}} Những gì đã gửi vẫn là đã gửi; bộ hỏi lại sẽ hoàn tất chúng.',
  'settle.batch.done': 'Đã gửi đủ {{n}} lệnh chuyển. Bộ hỏi lại sẽ xác định trạng thái cuối.',
  'settle.batch.noneOk': 'Kiểm tra đã từ chối lô, hoặc trong lô không có gì chi trả được, nên không thể gửi.',
  'settle.batch.refused.title': 'Không gửi',
  'settle.batch.refused.body': 'Các hóa đơn này không được gửi, lý do ghi bên cạnh từng dòng. Một số đã được trả hoặc đang xử lý; phần lớn cần có người xử lý trước khi bất kỳ lần chạy nào gửi chúng.',
  'settle.batch.tickets.title': 'Phiếu xử lý',
  'settle.batch.tickets.body': 'Được tạo trong lúc lần chạy này diễn ra. Cần có người xử lý.',
  'settle.batch.aborted': 'Lần chạy dừng vì lỗi, không phải vì bị từ chối.',
  'settle.batch.aborted.at': 'Nó dừng ở {{collector}}.',
  'settle.batch.aborted.body': 'Những gì đã gửi thì đã gửi và đã ghi nhận. Lý do phát sinh lỗi nằm trong nhật ký máy chủ, không có trong báo cáo này. Chương trình dò sẽ xác định trạng thái của các khoản đã chuyển.',
  'settle.ticket.TICKET.POLL_EXHAUSTED': 'Đã ngừng dò một khoản chuyển',
  'settle.ticket.TICKET.ORDER_NOT_FOUND': 'ZaloPay không tìm thấy đơn này',
  'settle.ticket.TICKET.CAP_EXCEEDED': 'Một hóa đơn vượt hạn mức của người thu thập',
  'settle.ticket.TICKET.BATCH_REFUSED': 'Lô bị từ chối lúc gửi',
  'settle.ticket.TICKET.RECON_DISCREPANCY': 'Đối soát phát hiện chênh lệch',

  'settle.bill.back': 'Tất cả hóa đơn',
  'settle.bill.notInPeriod': 'Hóa đơn đó không thuộc kỳ này.',
  'settle.bill.notInPeriod.body': 'Chọn kỳ mà nó thuộc về, hoặc mở từ danh sách.',
  'settle.bill.period': 'Kỳ',
  'settle.bill.total': 'Tổng',
  'settle.bill.amount': 'Số tiền phải trả',
  'settle.bill.account': 'Tài khoản nhận tiền',
  'settle.bill.account.none': 'Cộng tác viên này chưa khai tài khoản nhận tiền. Không thể trả cho ai cả.',
  'settle.bill.declared': 'Tên đã khai',
  'settle.bill.verified': 'Tên trên ZaloPay',
  'settle.bill.verified.none': 'Không trả về',
  'settle.bill.phone': 'Điện thoại',
  'settle.bill.risk': 'Rủi ro',
  'settle.bill.risk.open': 'Mở màn hình cờ rủi ro',
  'settle.bill.attempt': 'Lần chi gần nhất',
  'settle.bill.attempt.reference': 'Mã tham chiếu',
  'settle.bill.attempt.order': 'Mã đơn của đối tác',
  'settle.bill.attempt.zlp': 'Mã đơn ZaloPay',
  'settle.bill.attempt.trans': 'Mã giao dịch ZaloPay',
  'settle.bill.attempt.sub': 'Mã phụ',
  'settle.bill.attempt.polls': 'Số lần hỏi lại',
  'settle.bill.attempt.created': 'Tạo lúc',
  'settle.bill.attempt.settled': 'Hoàn tất lúc',
  'settle.bill.lines.title': 'Các dòng',
  'settle.bill.lines.empty': 'Hóa đơn này không có dòng nào.',
  'settle.bill.lines.exceptions': '{{n}} dòng đang được giữ lại như ngoại lệ. Chúng vẫn nằm trên hóa đơn và vẫn tính vào tổng.',
  'settle.bill.lines.reproduce': 'Mỗi số tiền là đơn giá nhân với số phút hiệu lực rồi làm tròn đến bốn chữ số thập phân, nên hai cột bên cạnh tái lập được nó. Tổng là tổng chính xác của các dòng. Việc làm tròn xuống thành đồng nguyên chỉ diễn ra một lần, lúc chi trả, và không bao giờ trên một dòng.',
  'settle.bill.line.task': 'Nhiệm vụ',
  'settle.bill.line.episode': 'Tập dữ liệu',
  'settle.bill.line.unitPrice': 'Đơn giá',
  'settle.bill.line.minutes': 'Số phút hiệu lực',
  'settle.bill.line.amount': 'Số tiền',
  'settle.bill.line.state': 'Trạng thái',
  'settle.bill.line.reviewed': 'Đã duyệt lúc',

  'settle.pay.title': 'Ghi nhận khoản chi',
  'settle.pay.manual.intro':
    'Tự chuyển số tiền, qua ZaloPay hoặc tại ngân hàng, vào tài khoản ở trên. Rồi quay lại và ghi mã tham chiếu của lệnh chuyển đó. Cơ sở dữ liệu đối chiếu số tiền với hóa đơn.',
  'settle.pay.api.intro':
    'Một lệnh chuyển qua ZaloPay cho hóa đơn này, hoặc một khoản chi thủ công kèm mã tham chiếu. Kiểm tra đã được đọc; số tiền được gõ lại để xác nhận.',
  'settle.pay.reference': 'Mã tham chiếu giao dịch',
  'settle.pay.reference.hint': 'Bắt buộc với khoản chi thủ công. Mã mà ngân hàng hoặc ZaloPay cấp cho lệnh chuyển.',
  'settle.pay.retype': 'Gõ lại số tiền, chỉ chữ số',
  'settle.pay.retype.hint': 'Phải khớp với số tiền phải trả. Gõ, không bấm.',
  'settle.pay.mismatch': 'Đó không phải số tiền trên hóa đơn này.',
  'settle.pay.markPaid': 'Ghi nhận đã trả',
  'settle.pay.api.send': 'Gửi lệnh chuyển',
  'settle.pay.done': 'Đã ghi nhận. Lần chi {{order}}, trạng thái: {{status}}.',
  'settle.pay.sent': 'Đã gửi. Lần chi {{order}} đang {{status}}; bộ hỏi lại sẽ xác định kết quả.',
  'settle.pay.rejected': 'ZaloPay từ chối lệnh chuyển (mã phụ {{sub}}). Cần một lần chi mới.',
  'settle.pay.alreadyPaid': 'Hóa đơn này đã được trả. Không thể ghi thêm gì.',
  'settle.pay.locked': 'Khóa cho đến khi kiểm tra trước khi chi đã được đọc',

  'settle.exceptions.intro': 'Mọi lần chi cần đến con người, và mọi hóa đơn không thể gửi như hiện trạng.',
  'settle.exceptions.empty': 'Kỳ này không có ngoại lệ.',
  'settle.exceptions.empty.body': 'Mọi lần chi đã kết thúc và mọi hóa đơn nằm trong giới hạn.',
  'settle.exceptions.pending': 'Treo bên trong ZaloPay',
  'settle.exceptions.pending.body':
    'ZaloPay giữ các lệnh chuyển này ở trạng thái 4. Thử lại không giải quyết được và ở đây không thử lại: đội của chính ZaloPay phải sửa đơn. Chỉ xử lý ở đây với kết quả mà ZaloPay xác nhận, và ghi rõ xác nhận ở đâu.',
  'settle.exceptions.polling': 'Vẫn đang hỏi lại',
  'settle.exceptions.polling.body':
    'Câu trả lời cho các lệnh chuyển này đã mất hoặc còn đang đến. Bộ hỏi lại hỏi ZaloPay theo lịch giãn dần và chuyển trạng thái khi biết kết quả. Nhân viên chỉ xử lý khi việc hỏi lại đã cạn.',
  'settle.exceptions.neverSent': 'Đã tạo, chưa từng gửi',
  'settle.exceptions.neverSent.body':
    'Dòng lần chi tồn tại nhưng yêu cầu chưa bao giờ đi. Không gửi lại theo phỏng đoán; xử lý là thất bại rồi chi lại.',
  'settle.exceptions.ceiling': 'Vượt trần chuyển ngân hàng',
  'settle.exceptions.ceiling.body':
    'ZaloPay gửi tối đa {{ceiling}} cho mỗi lệnh chuyển ngân hàng. Hóa đơn cao hơn không thể đi trong một lệnh, và việc chia nhỏ là quyết định về tiền mà chưa ai đưa ra. Trình lên; không chia.',
  'settle.exceptions.cap': 'Vượt hạn mức',
  'settle.exceptions.cap.body':
    'Vượt hạn mức mỗi cộng tác viên {{cap}}. Lô từ chối đích danh và tạo phiếu; không bao giờ trả theo hạn mức thay thế.',
  'settle.exceptions.blocked': 'Chưa chi trả được',
  'settle.exceptions.blocked.body':
    'Hóa đơn còn việc phải sửa trước một lệnh chuyển: không có tài khoản, tài khoản chưa xác minh, tổng có phần lẻ, đang bị giữ vì rủi ro.',
  'settle.exceptions.opened': 'Mở từ {{elapsed}} trước',
  'settle.exceptions.polls': '{{n}} lần hỏi, lần cuối lúc {{at}}',
  'settle.exceptions.polls.none': 'Chưa hỏi lại lần nào',
  'settle.exceptions.events': 'Sự kiện',
  'settle.resolve.title': 'Xử lý',
  'settle.resolve.outcome': 'Kết quả',
  'settle.resolve.succeeded': 'Tiền đã đi',
  'settle.resolve.failed': 'Tiền không đi',
  'settle.resolve.reason': 'Lý do',
  'settle.resolve.reason.hint': 'Bắt buộc. Kết quả được xác nhận ở đâu và bởi ai. Đây chính là sự cho phép.',
  'settle.resolve.trans': 'Mã giao dịch ZaloPay, nếu thành công',
  'settle.resolve.submit': 'Xử lý lần chi',
  'settle.resolve.done': 'Đã xử lý: lần chi giờ là {{status}}.',
  'settle.resolve.pollerWorking':
    'Bộ hỏi lại vẫn đang làm việc với lần chi này. Chỉ lần chi đang treo, đã cạn hỏi lại hoặc chưa từng gửi mới được xử lý bằng tay.',

  'risk.intro':
    'Chứng cứ trước, kết luận sau. Mỗi cờ là một câu kèm con số gây ra nó; lệnh giữ được gỡ bằng một lý do gõ tay, và ai đã gỡ gì luôn nằm trong hồ sơ.',
  'risk.score': 'Điểm',
  'risk.points': '{{n}} điểm',
  'risk.flags': '{{n}} cờ',
  'risk.open': 'Mở',
  'risk.empty': 'Kỳ này không có cờ.',
  'risk.empty.body': 'Bộ máy rủi ro không có gì để nói về các hóa đơn này, hoặc không chạy trên máy chủ này.',
  'risk.evidence': 'Chứng cứ',
  'risk.references': 'Các phiên được nêu tên',
  'risk.proxy.none': 'Máy chủ này không cung cấp đoạn xem thử, và tư liệu gốc không bao giờ hiện ở đây.',
  'risk.threshold': 'ngưỡng {{v}}, tính lúc {{at}}',
  'risk.holds.title': 'Lịch sử giữ',
  'risk.holds.none': 'Hóa đơn này không có lệnh giữ đang mở.',
  'risk.holds.notOnServer':
    'Các tuyến của bộ máy rủi ro không có trên máy chủ này. Các cờ hiển thị lấy từ tóm tắt lô; lịch sử giữ và thao tác gỡ cần đến bộ máy.',
  'risk.holds.open': 'Giữ từ {{at}}',
  'risk.holds.raised': 'Đặt lúc {{at}} vì {{signals}}',
  'risk.holds.cleared': 'Gỡ lúc {{at}} bởi {{who}}: {{verdict}} — {{reason}}',
  'risk.clear.title': 'Gỡ lệnh giữ',
  'risk.clear.verdict': 'Kết luận',
  'risk.clear.reason': 'Lý do',
  'risk.clear.reason.hint': 'Ít nhất mười ký tự. Bạn đã kiểm tra gì và vì sao hóa đơn có thể được trả.',
  'risk.clear.submit': 'Gỡ với lý do này',
  'risk.clear.done': 'Đã gỡ. Từ đây hóa đơn được trả bình thường.',
  'risk.actions.escalate': 'Trình lên',
  'risk.actions.hold': 'Giữ',
  'risk.actions.unavailable':
    'Trình lên và giữ bằng tay chưa có tuyến trên máy chủ này. Bộ máy tự đặt lệnh giữ; gỡ nó là thao tác mà nhân viên có.',
  'risk.band.clear': 'Bình thường',
  'risk.band.notice': 'Lưu ý',
  'risk.band.review': 'Cần xem xét',
  'risk.band.hold': 'Tạm giữ thanh toán',
  'risk.severity.info': 'thông tin',
  'risk.severity.notice': 'lưu ý',
  'risk.severity.review': 'xem xét',
  'risk.severity.hold': 'giữ',
  'risk.verdict.false_positive': 'Đã kiểm tra, không có vấn đề',
  'risk.verdict.accepted': 'Chấp nhận rủi ro, vẫn thanh toán',
  'risk.verdict.resolved': 'Đã khắc phục nguyên nhân',

  'risk.signal.META.EVALUATED': 'Đã đánh giá, phát hiện {findings} điểm.',
  'risk.signal.IDENT.NAME_MISMATCH': 'Tên trên ZaloPay là {verified_name}; tên trong thỏa thuận là {declared_name}.',
  'risk.signal.IDENT.PHONE_SHARED':
    'Số điện thoại ví {phone_masked} cũng nằm trên tài khoản nhận tiền của {count} cộng tác viên khác: {other_collector_refs}.',
  'risk.signal.IDENT.ACCOUNT_SHARED':
    'Tài khoản ngân hàng {bank_code} ···{account_no_last4} cũng nằm trên tài khoản nhận tiền của {count} cộng tác viên khác: {other_collector_refs}.',
  'risk.signal.IDENT.MUID_SHARED':
    'Ví ZaloPay {m_u_id_masked} cũng nằm trên tài khoản nhận tiền của {count} cộng tác viên khác: {other_collector_refs}.',
  'risk.signal.IDENT.ACCOUNT_CHANGED_LATE':
    'Tài khoản nhận tiền được thay đổi vào {changed_at}, chỉ {days_before_end} ngày trước khi kỳ thanh toán kết thúc vào {period_end}.',
  'risk.signal.IDENT.UNVERIFIED_KYC':
    'ZaloPay báo vào {verified_at} rằng ví này chưa hoàn tất xác minh danh tính (mã {sub_return_code}).',
  'risk.signal.IDENT.KYC_LIMIT_REPEATED':
    'ZaloPay báo ví đã chạm hạn mức nhận tiền {occurrences} lần (mã {sub_return_code}); quá {max_occurrences} lần là bất thường với một người.',
  'risk.signal.IDENT.WALLET_LOCKED': 'ZaloPay báo vào {verified_at} rằng ví này đã bị khóa (mã {sub_return_code}).',
  'risk.signal.IDENT.NAME_UNCONFIRMED': 'ZaloPay không trả về tên nào để so với {declared_name}; lời khai chưa được xác nhận.',
  'risk.signal.IDENT.KYC_LIMIT': 'ZaloPay báo ví đã chạm hạn mức nhận tiền (mã {sub_return_code}).',
  'risk.signal.IDENT.NO_WALLET': 'ZaloPay không có ví cho số điện thoại {phone_masked} (mã {sub_return_code}).',
  'risk.signal.IDENT.VERIFY_ERROR': 'ZaloPay không xác minh được tài khoản (mã {sub_return_code}).',
  'risk.signal.VOL.HOURS_PER_DAY':
    '{hours} giờ ghi hình trong ngày {day} qua {episodes} phiên. Mức tối đa mỗi ngày là {max_hours} giờ.',
  'risk.signal.VOL.ABOVE_COHORT_P95':
    '{episodes} phiên trong ngày {day}. 95 trên 100 ngày làm việc của các cộng tác viên có {p95} phiên trở xuống (so sánh {cohort_days} ngày).',
  'risk.signal.VOL.STEP_CHANGE':
    '{minutes} phút trong ngày {day}. Một ngày bình thường của cộng tác viên này là {median_minutes} phút, tức gấp {ratio} lần.',
  'risk.signal.VOL.NO_GAP':
    'Phiên {episode_a} và phiên {episode_b} trùng nhau {overlap_s} giây. Một người không thể ghi hai phiên cùng lúc.',
  'risk.signal.VOL.NOCTURNAL':
    '{night_minutes} trên {total_minutes} phút ({share_pct}) được ghi trong khoảng {night_hours} cho loại nhiệm vụ {task_type}. Làm đêm là công việc bình thường; đây chỉ là thông tin thêm.',
  'risk.signal.CONT.MOOV_DAMAGED': 'Tệp MP4 {file} không đạt kiểm tra cấu trúc: {verdict}.',
  'risk.signal.CONT.TIMING_TRUNCATED':
    'Chỉ mục thời gian của {stream} dừng sớm: {pts_rows} dòng so với {media_packets} gói dữ liệu. Thường gặp khi ghi hình bị ngắt.',
  'risk.signal.CONT.TIMING_PACKET_DELTA':
    'Chỉ mục thời gian của {stream} có {pts_rows} dòng nhưng video chỉ có {media_packets} gói: video đã bị cắt hoặc ghi lại sau khi tạo chỉ mục.',
  'risk.signal.CONT.IMU_CLOCK_DRIFT':
    'Đồng hồ IMU bị lệch: {clock_outlier_rows} dòng mang thời gian cách xa phiên ghi ({detail}).',
  'risk.signal.CONT.PTS_MANIFEST_DELTA':
    'Tệp khai báo ghi {declared_s} giây, đo thực tế được {measured_s} giây, tỷ lệ {ratio}. Thiết bị này thường cho {baseline_ratio} ({baseline_episodes} phiên).',
  'risk.signal.CONT.NEAR_DUPLICATE':
    'Nội dung trùng với phiên {other_episode_id} của cộng tác viên {other_collector_ref} ({method}, {match_share_pct} số khung hình khớp).',
  'risk.signal.CONT.STATIC_SCENE':
    'Hình ảnh gần như không thay đổi qua {frames} khung hình mẫu: mức chuyển động {motion_energy}, ghi hình bình thường cao hơn {max_motion_energy}.',
  'risk.signal.CONT.LOW_LUMA_VARIANCE':
    '{dark_share_pct} khung hình mẫu bị tối và {flat_share_pct} không có chi tiết (độ sáng trung bình {mean_luma}/255). Ống kính có thể đã bị che.',
  'risk.signal.CONT.AUDIO_ABSENT': 'Không có âm thanh dùng được ({reason}) trong khi loại nhiệm vụ {task_type} cần có tiếng.',
  'risk.signal.CONT.FINGERPRINT': 'Đã lưu dấu vân khung hình của {frames} khung để đối chiếu trùng lặp.',
  'risk.signal.PROV.PRNU_MISMATCH':
    'Mẫu nhiễu cảm biến của video tương quan {correlation} với dấu vân đã đăng ký cho thiết bị {device_serial}; khớp phải trên {min_correlation}.',
  'risk.signal.PROV.IMU_VIDEO_DECORR':
    'Trong {seconds} giây, chuyển động trong hình và chuyển động IMU ghi được tương quan {correlation}; ghi hình thật phải trên {min_correlation}.',
  'risk.signal.PROV.ENCODER_MISMATCH': 'Tệp không được ghi theo cách firmware {firmware} ghi tệp: {mismatches}.',
  'risk.signal.PROV.SCREEN_RECAPTURE': 'Video giống như quay lại từ màn hình: {cues} (đã kiểm tra {frames} khung hình).',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC':
    'Video gần như không có nhiễu cảm biến ({noise_floor}, máy quay thường trên {max_noise_floor}). Chỉ là dấu hiệu yếu nếu đứng một mình.',
  'risk.signal.OPS.REVIEW_TOO_FAST':
    'Người duyệt {reviewer_ref} đưa ra kết luận {verdict} trong {time_to_verdict_s} giây cho phiên dài {measured_duration_s} giây.',
  'risk.signal.OPS.APPROVAL_OUTLIER':
    'Người duyệt {reviewer_ref} chấp thuận {approval_rate_pct} trong {decided} phiên; {reviewers} người duyệt khác chấp thuận {cohort_median_pct}.',
  'risk.signal.OPS.SELF_DEALING':
    'Nhân viên {operator_ref} đã tạo cộng tác viên này vào {created_at} và cũng thực hiện {paid_action} cho hóa đơn vào {paid_at}.',
  'risk.signal.OPS.CONCENTRATION':
    'Nhân viên {operator_ref} xử lý {share_pct} trong {events} thao tác trên hóa đơn của cộng tác viên này trong khi có {operators} nhân viên cùng làm.',

  'bo.refused.payout_attempts_previous_not_failed':
    'Hóa đơn này đã có một lần chi chưa thất bại. Chỉ có thể tạo lần chi mới sau khi lần trước đã thất bại.',
  'bo.refused.payout_attempts_amount_check': 'Số tiền đã gõ không bằng tổng hóa đơn. Chưa ghi nhận gì.',
  'bo.refused.payout_attempts_account_owner': 'Tài khoản nhận tiền đó thuộc về một cộng tác viên khác.',
  'bo.refused.payout_attempts_account_current': 'Tài khoản nhận tiền đó không còn là tài khoản hiện tại của cộng tác viên. Tải lại hóa đơn.',
  'bo.refused.payout_attempts_bank_ceiling':
    'Vượt trần 10.000.000 VND của ZaloPay cho một lệnh chuyển ngân hàng. Không thể đi trong một lệnh, và việc chia nhỏ phải được trình lên, không phải một cái nút.',
  'bo.refused.payout_attempts_bank_minimum': 'Dưới mức tối thiểu 2.000 VND của ZaloPay cho một lệnh chuyển ngân hàng.',
  'bo.refused.payout_attempts_amount_positive_check':
    'Hóa đơn này có tổng chưa tới một đồng, nên làm tròn xuống là 0 VND, và một khoản thanh toán bằng không thì không được ghi nhận. Không có gì được gửi đi.',
  'bo.refused.payout_attempts_transition_check': 'Lần chi không thể chuyển từ trạng thái hiện tại theo cách đó. Tải lại danh sách.',
  'bo.refused.payout_attempts_succeeded_immutable': 'Lần chi đã thành công là cuối cùng và không thể thay đổi.',
  'bo.refused.payout_attempts_failed_terminal': 'Lần chi đã thất bại là cuối cùng. Trả lại là một lần chi mới.',
  'bo.refused.payout_attempts_pending_operator_only':
    'Lần chi đang treo bên trong ZaloPay chỉ được chuyển bởi nhân viên với lý do gõ tay. Không gì khác chuyển được nó.',
  'bo.refused.payout_attempts_manual_reference_check': 'Khoản chi thủ công cần mã tham chiếu giao dịch. Chưa ghi nhận gì.',
  'bo.refused.payout_finance_required': 'Chỉ nhân viên có vai trò tài chính mới được chi trả hoặc xử lý. Máy chủ đã từ chối.',
  'bo.refused.payout_separation_of_duty':
    'Nhân viên đã tạo cộng tác viên này, đã duyệt hóa đơn này, hoặc đã khai tài khoản nhận tiền không được là người chi trả nó.',
  'bo.refused.payout_accounts_current_key': 'Cộng tác viên đã có tài khoản nhận tiền hiện tại. Tải lại và thử lại.',
  'bo.refused.payout_accounts_append_only': 'Tài khoản nhận tiền là bản ghi của một lời khai và không thể sửa hay xóa.',
  'bo.refused.settlements_transition_check':
    'Một khoản trên hóa đơn này đã được trả hoặc đã chuyển sang ngoại lệ trong lúc đó. Tải lại hóa đơn.',
  'bo.refused.settlements_not_in_exception': 'Khoản này không ở trạng thái ngoại lệ, nên không có gì để giải phóng.',
  'bo.refused.review_duration_implausible':
    'Phân đoạn này khai thời lượng dài hơn mức một thẻ nhớ có thể ghi, nên không thể trả tiền. Hãy chuyển lại quầy để kiểm tra lần giao đó.',
  'bo.refused.review_disputes_open_key': 'Kết quả duyệt này đã đang được khiếu nại.',
  'bo.refused.review_disputes_decided_check':
    'Lần duyệt này chưa có kết quả, nên chưa có gì để khiếu nại.',
  'bo.refused.review_disputes_final_check':
    'Kết quả này chính là kết quả duyệt lần hai, và duyệt lần hai là kết luận cuối cùng.',
  'bo.refused.review_disputes_unbilled_check':
    'Kết quả này đã lên hóa đơn hoặc đã được chi trả, và hóa đơn không bao giờ được sửa.',
  'bo.refused.settle_export_bill_in_exception':
    'Một hóa đơn trong kỳ này có khoản đang ở ngoại lệ. Tổng của nó sẽ không khớp với các dòng trong tệp, nên bản xuất được giữ lại cho đến khi khoản đó được giải phóng.',
  'bo.refused.settle_generate_by_finance':
    'Nhân viên tài chính không được tạo hóa đơn cho kỳ này. Người phát hành hóa đơn sẽ bị từ chối khi chi trả, nên phải để nhân viên khác chạy kỳ này.',
  'bo.refused.payout_settlement_exception':
    'Một khoản trên hóa đơn này đang ở ngoại lệ. Giải phóng nó trước khi hóa đơn có thể được chi trả.',
  'bo.refused.payout_mode_manual': 'Máy chủ đang ở chế độ chi trả thủ công. Tự chuyển tiền và ghi mã tham chiếu tại đây.',
  'bo.refused.payout_batch_running': 'Một lần chạy của kỳ này đang diễn ra trên máy chủ. Hãy chờ báo cáo; không có gì được gửi hai lần.',
  'bo.refused.payout_transfer_rejected': 'ZaloPay đã từ chối lệnh chuyển. Lần chạy dừng ở hóa đơn này; lần chi được ghi là thất bại và không hóa đơn nào sau đó được gửi.',
  'bo.refused.payout_bill_not_payable': 'Kiểm tra trước cho thấy hóa đơn này không thể chi trả. Mở hóa đơn để xem lý do; chưa gửi gì.',
  'bo.refused.payout_no_client': 'Máy chủ này chưa cấu hình máy khách ZaloPay, nên không gửi được lệnh chuyển nào.',
  'bo.refused.payout_account_missing': 'Cộng tác viên này không có tài khoản nhận tiền hiện tại.',
  'bo.refused.payout_account_unverified': 'Tài khoản nhận tiền của cộng tác viên chưa được xác minh. ZaloPay phải xác nhận tên trước.',
  'bo.refused.payout_attempts_account_unverified': 'Cơ sở dữ liệu đã từ chối lần chi trả: tài khoản nhận tiền chưa được xác minh. ZaloPay phải xác nhận tên trước.',
  'bo.refused.payout_bank_details_unavailable':
    'Chuyển ngân hàng qua API cần số tài khoản đầy đủ, mà máy chủ này không lưu. Hãy chi trả thủ công.',
  'bo.refused.payout_cap_exceeded': 'Vượt hạn mức mỗi cộng tác viên trong kỳ này. Đã tạo phiếu; không bao giờ trả theo hạn mức thay thế.',
  'bo.refused.payout_risk_hold': 'Bộ máy rủi ro đang giữ hóa đơn này. Gỡ lệnh giữ với lý do ở màn hình cờ rủi ro trước.',
  'bo.refused.payout_already_paid': 'Hóa đơn này đã được trả.',
  'bo.refused.payout_accounts_id_reused': 'Mã tài khoản đó đã đặt tên cho một lời khai khác.',
  'bo.refused.payout_account_declaration_invalid':
    'Lời khai đó không lưu được. Ví cần số di động Việt Nam mười chữ số bắt đầu bằng 0; đường ngân hàng cần mã ngân hàng và số tài khoản.',
  'bo.refused.payout_account_locked_while_paying':
    'Một khoản chi cho cộng tác viên này vẫn đang mở, nên không đổi được tài khoản. Hãy hoàn tất hoặc xử lý khoản chi đó trước.',
  'bo.refused.payout_account_not_this_centre':
    'Cộng tác viên này chưa nộp gì tại trung tâm này, nên quầy này không khai được tài khoản của họ.',
  'bo.refused.payout_attempt_not_resolvable':
    'Lần chi này không thể xử lý bằng tay ở trạng thái hiện tại. Chỉ lần chi đang treo, đã cạn hỏi lại hoặc chưa từng gửi mới được.',
  'bo.refused.payout_bill_period_mismatch': 'Hóa đơn đó thuộc một kỳ khác.',

  // Gửi mã đăng nhập thất bại (ZNS_REFUSALS trong zns.ts).
  'bo.refused.zns_no_zalo_account':
    'Số điện thoại đó không có tài khoản Zalo nên mã đăng nhập không thể đến được, và cộng tác viên này không đăng nhập được. Hãy nhờ họ cài Zalo trên số đó, hoặc ghi nhận một số khác cho họ.',
  'bo.refused.zns_phone_not_vietnamese':
    'Số trong hồ sơ của cộng tác viên này không phải số di động Việt Nam nên không gửi được mã. Hãy sửa lại số trong phần quản trị.',
  'bo.refused.zns_template_rejected':
    'Zalo từ chối mẫu tin nhắn đăng nhập. Không ai đăng nhập được cho tới khi mẫu được duyệt và bật lại. Đây là việc của tài khoản Zalo Official Account, không phải của cộng tác viên.',
  'bo.refused.zns_quota_exhausted':
    'Tài khoản Zalo Official Account đã hết hạn mức tin nhắn nên không gửi được mã. Không ai đăng nhập được cho tới khi mua thêm.',
  'bo.refused.zns_rate_limited':
    'Zalo tạm thời từ chối vì gửi quá nhiều tin trong thời gian ngắn. Việc này tự hết; hãy nhờ cộng tác viên thử lại sau vài phút.',
  'bo.refused.zns_credentials_rejected':
    'Zalo từ chối thông tin xác thực của máy chủ này nên không gửi được mã. Access token sai hoặc đã hết hạn và phải được cấp lại.',
  'bo.refused.zns_unreachable':
    'Không kết nối được tới Zalo nên không gửi được mã. Hãy nhờ cộng tác viên thử lại; nếu vẫn vậy thì đường tới Zalo đang hỏng.',
  'bo.refused.zns_refused':
    'Zalo từ chối gửi mã với một lý do máy chủ này không hiểu. Lý do nằm trong nhật ký máy chủ; hãy nhờ cộng tác viên thử lại trong khi có người đọc nhật ký.',
  // Chuỗi riêng của bản dựng lại giao diện (ui.b.*): câu đứng cạnh hai con số trên nền mực.
  'ui.b.settle.total.sentence':
    'Số tiền lô này sẽ gửi. Máy chủ quyết định từng lần chuyển, và một hóa đơn vẫn có thể bị từ chối ngay lúc chi trả.',
  'ui.b.risk.holds.count': 'Hóa đơn đang bị giữ',
  'ui.b.risk.holds.sentence':
    'Không khoản chuyển nào đi khi lệnh giữ còn mở. Gỡ một lệnh giữ cần một kết luận và một lý do viết ra; bộ máy chỉ thêm dòng mới, không bao giờ sửa dòng cũ.',

  'login.video.region': 'Video giới thiệu',

  'discover.headline.a': 'Gặp Ego.',
  'discover.headline.mark': 'Việc thường ngày',
  'discover.headline.b': ', từ góc nhìn của bạn.',
  'discover.lead':
    'Một máy quay đội đầu để ghi lại các hoạt động thường ngày. Người thu thập được trả tiền cho những phút hữu hiệu đã qua duyệt.',
  'discover.signIn': 'Đăng nhập bảng điều khiển',
  'discover.audiences':
    'Hai lối vào. Người thu thập ghi hình bằng máy quay Ego và được trả cho số phút hữu hiệu mà người duyệt chấp nhận. Nhân viên trung tâm tải lên và người duyệt làm việc trên bảng điều khiển.',
  'discover.video.caption':
    'Đây là phim tạm, không phải bản ghi do camera tạo ra: một người đeo Ego được quay từ khoảng cách một cánh tay tại Paris. Ego ghi hình từ trán người đeo nên không thể quay chính người đeo. Một buổi quay thật sẽ thay thế nó.',
  'discover.how.title': 'Bốn bước, theo thứ tự',
  'discover.step.record.title': 'Ghi hình',
  'discover.step.record.body':
    'Bạn đeo máy quay và làm việc thường ngày — nấu ăn, làm vườn, dọn dẹp, ủi đồ. Nút bấm trên chính máy quay mới bắt đầu và dừng ghi hình.',
  'discover.step.upload.title': 'Tải lên',
  'discover.step.upload.body':
    'Thẻ nhớ được giao tại quầy của trung tâm tải lên. Nhân viên ghi nhận việc bàn giao và nhập dữ liệu trên máy của trung tâm.',
  'discover.step.review.title': 'Người duyệt',
  'discover.step.review.body':
    'Người duyệt xem tập tư liệu, đánh dấu phần dùng được và ghi mã lý do cho phần còn lại.',
  'discover.step.payment.title': 'Thanh toán',
  'discover.step.payment.body':
    'Hóa đơn được lập cho số phút hữu hiệu đã duyệt theo đơn giá của nhiệm vụ, và được chi trả qua ZaloPay.',
  'discover.cell.camera.title': 'Máy quay',
  'discover.cell.camera.body':
    'Ego là máy quay đội đầu do nền tảng cấp và gắn với một người. Chỉ nút bấm trên chính máy mới bắt đầu và dừng ghi hình — không ứng dụng điện thoại nào làm được, và cũng sẽ không được trao quyền đó.',
  'discover.cell.pov.caption':
    'Camera đeo trên trán. Một khung hình cắt ra từ phim tạm ở trên — góc nhìn từ người thứ ba về thiết bị, không phải hình ảnh nhìn qua nó.',
  'discover.cell.activities.title': 'Những hoạt động nào được tính',
  'discover.cell.activities.body':
    'Hoạt động thường ngày ở nhà, ở văn phòng, ở cửa hàng và trong kho. Mỗi lần ghi hình đều được nhận theo một nhiệm vụ đã công bố từ trước, nên điều gì là phù hợp đã được viết ra trước, chứ không phán xét về sau.',
  'discover.cell.review.title': 'Việc duyệt diễn ra thế nào',
  'discover.cell.review.body':
    'Mỗi tập tư liệu đều do một người xem, đánh dấu phần dùng được và ghi mã lý do cho phần còn lại. Chính phán quyết đó là nguồn duy nhất của con số dùng để trả tiền; không có cơ chế nào khác trên nền tảng tính ra con số ấy.',
  'discover.cell.minutes.title': 'Phút được trả tiền được xác định ra sao',
  'discover.cell.minutes.body':
    'Thời gian được trả là khoảng mà mọi luồng dữ liệu ghi được cùng bao phủ, không phải luồng dài nhất. Con số thời lượng do thiết bị tự khai chỉ mang tính tham khảo và thường cao hơn thực tế, nên nền tảng đo trên chính tệp tư liệu.',
  'discover.before.title': 'Trước khi tham gia',
  'discover.before.q.record': 'Tôi cần ghi hình những gì?',
  'discover.before.a.record':
    'Hoạt động thường ngày, theo một nhiệm vụ đã nhận trước. Có đào tạo và một bài kiểm tra trước nhiệm vụ đầu tiên.',
  'discover.before.q.paid': 'Mọi phút ghi được đều có tiền chứ?',
  'discover.before.a.paid':
    'Không. Chỉ phần được người duyệt cho là dùng được mới được trả, và một đoạn ghi hình có thể bị từ chối toàn bộ.',
  'discover.before.q.when': 'Khi nào khoản trả được quyết định?',
  'discover.before.a.when':
    'Sau khi thẻ nhớ được nhập và tập tư liệu được duyệt. Hóa đơn lập theo từng kỳ quyết toán, và tổng tiền được làm tròn xuống đến đồng.',
  'discover.before.q.data': 'Những gì về tôi được thu thập?',
  'discover.before.a.data':
    'Các cam kết đồng ý mà thỏa thuận ghi hình yêu cầu, và không gì ngoài chúng. Tư liệu được lưu trữ trong lãnh thổ Việt Nam.',
  'discover.handoff.title': 'Bạn đã là nhân viên vận hành hay người duyệt?',
  'discover.handoff.body':
    'Hãy đăng nhập vào console. Nhân viên trung tâm tải lên ghi nhận việc bàn giao và nhập thẻ nhớ; người kiểm duyệt xem tư liệu và quyết định phần nào được trả.',
  'discover.credits': 'Phim và ảnh: nguồn và giấy phép',
  'discover.partners':
    'PlayerOne là liên doanh giữa VNG PT Lab và PaXini. VNG vận hành nền tảng và các trung tâm tải lên; PaXini sản xuất camera Ego và, trong giai đoạn này, kiểm duyệt tư liệu.',
  'discover.foot.legal':
    'PlayerOne là liên doanh giữa VNG PT Lab và PaXini. Mọi bản ghi đều do một người duyệt trước khi có phút nào được thanh toán, và tư liệu được lưu trữ trong lãnh thổ Việt Nam.',
  'discover.ways.title': 'Đi tiếp từ đây',
  'discover.take.cta': 'Tải APK',
  'discover.take.title': 'Người thu thập',
  'discover.take.body':
    'Công việc thu thập bắt đầu bằng huấn luyện và một bài kiểm tra. Mỗi lần ghi hình đều phải nhận một nhiệm vụ trước khi bật máy; máy quay do nền tảng cấp và vẫn thuộc về nền tảng. Tiền trả cho số phút hữu hiệu mà người duyệt chấp nhận.',
  'discover.take.pending':
    'APK chưa được phát hành, nên hôm nay chưa có gì để tải từ trang này. Bản cài sẽ được dẫn ở đây khi phát hành.',

  'discover.nav.label': 'Trong trang này',
  'discover.nav.camera': 'Máy quay',
  'discover.nav.work': 'Công việc',
  'discover.nav.review': 'Kiểm duyệt',
  'discover.nav.payment': 'Thanh toán',
  'discover.nav.questions': 'Câu hỏi',

  'discover.eyebrow': 'Ego — máy quay đeo trên đầu',
  'discover.line.1': 'Ghi hình.',
  'discover.line.2': 'Nộp thẻ nhớ.',
  'discover.line.3': 'Một người duyệt.',
  'discover.line.4': 'Trả theo phút.',

  'discover.chip.task': 'Đã nhận nhiệm vụ',
  'discover.chip.handover': 'Đã nhận thẻ tại quầy',
  'discover.chip.rate': 'Trả cho mỗi phút được duyệt',

  'discover.label.camera': 'Thiết bị',
  'discover.label.work': 'Công việc',
  'discover.label.film': 'Phim minh hoạ',
  'discover.label.review': 'Kiểm duyệt',
  'discover.label.payment': 'Thanh toán',
  'discover.label.questions': 'Câu hỏi',
  'discover.label.next': 'Tiếp theo',

  'discover.work.note':
    'Ảnh minh hoạ về công việc thường ngày. Không tấm nào là tư liệu do máy quay Ego ghi, và không tấm nào được chú thích như vậy. Một buổi quay thật sẽ thay thế chúng.',

  'discover.verdict.note':
    'Người duyệt ghi một trong ba kết quả và nêu mã lý do cho phần không dùng được.',

  'discover.streams.video': 'Hình',
  'discover.streams.audio': 'Tiếng',
  'discover.streams.imu': 'Chuyển động',
  'discover.streams.payable': 'Được tính: khoảng thời gian mà mọi luồng đều có',
  'discover.streams.device':
    'Máy báo theo luồng dài nhất. Con số đó chỉ để tham khảo và cao hơn thực tế.',

  'nf.eyebrow': 'Không có trang này',
  'nf.title.a': 'Không có gì',
  'nf.title.b': 'được ghi ở',
  'nf.title.c': 'địa chỉ này.',
  'nf.body':
    'Liên kết sai, hoặc trang đã chuyển. Mọi điều nền tảng nói về chính nó đều nằm ở trang giới thiệu.',
  'nf.back': 'Về trang giới thiệu',
  'login.network':
    'Dịch vụ không trả lời. Hãy kiểm tra máy có nằm trong mạng của trung tâm rồi thử lại.',

  'login.legal': 'Khi đăng nhập, bạn chấp nhận cách PlayerOne xử lý dữ liệu của bạn.',
  'login.legalPrivacy': 'Chính sách quyền riêng tư',
  'login.legalData': 'Thông báo thu thập dữ liệu',

  'ui.a.home.gauge': 'Đã duyệt {{value}} trên {{target}} tập trong ca này',
  'ui.a.home.gaugeCaption': 'tập đã duyệt trong ca này',
  'ui.a.home.payable.note': 'Thời lượng hữu ích, chỉ tính từ các lượt duyệt đã có kết luận.',
  'ui.a.home.approval.note': 'Số lượt đạt và đạt một phần, trên tổng số quyết định hôm nay.',
  'ui.a.home.pace.note': 'Từ lúc tải đến lúc có kết luận. Chỉ để theo dõi, không phải tiền.',
  'ui.a.home.clock': 'Đồng hồ của máy này.',
  'ui.a.home.approval.target': 'Mục tiêu chương trình 85–90%.',
  'ui.a.home.recent.time': 'Thời điểm',
  'ui.a.home.recent.episode': 'Tập',
  'ui.a.home.recent.verdict': 'Kết luận',
  'ui.a.home.recent.duration': 'Đo được → hiệu lực',
  'ui.a.home.recent.amount': 'Số tiền',
  'ui.a.home.recent.pace': 'Thời gian xử lý',
  'ui.a.home.settled.note': 'Chỉ các quyết định của bạn. Không phải chi phí của cả chương trình.',
  'ui.a.home.settled.open': 'Mở phần thanh toán',
  'ui.a.home.error.title': 'Không tải được số liệu ca làm việc.',
  'ui.a.home.error.body':
    'Mọi phần khác của màn hình này vẫn dùng được. Các con số lấy từ cơ sở dữ liệu duyệt; nếu lỗi lặp lại thì API không kết nối được Postgres.',
  'ui.a.home.recent.error': 'Không tải được các kết luận gần đây.',
  'ui.a.home.unavailable': 'Chưa có số liệu',

  'ui.a.home.asOf': 'Tính đến {{time}}',
  'ui.a.home.next.title': 'Mỗi lần một bản ghi.',
  'ui.a.home.next.body':
    'Tiền của người thu thập chỉ đến từ kết luận ở đây. Khi sẵn sàng, hãy nhận tập tiếp theo.',
  'ui.a.home.queueWaiting': 'đang chờ trong hàng đợi của bạn',
  'ui.a.home.results': 'Ca này đã làm được gì',
  'ui.a.home.median': 'Trung vị thời gian ra kết luận',
  'ui.a.home.median.note':
    'Giá trị giữa của các lượt duyệt được bấm giờ trong ca này. Chỉ để theo dõi, không phải tiền.',
  'ui.a.home.attention.none': 'Không có việc nào đang chờ người xử lý.',
  'ui.a.home.attention.unknown':
    'Chưa kết nối. Màn hình này không thể nói việc nào cần xử lý.',

  'ui.a.home.insights': 'Thông tin thêm (tuỳ chọn)',
  'ui.a.home.truc.lede':
    'Trúc chỉ là một kênh phụ. Mọi điều Trúc nói đều đã được ghi trên trang này, nên không có gì phụ thuộc vào Trúc.',
  'ui.a.home.truc.greet': 'Xin chào. {{shift}}.',
  'ui.a.home.truc.offline': 'Chưa kết nối. Tôi không có số liệu đo được nào để báo.',
  'ui.a.home.truc.source': 'Nguồn: số liệu ca làm việc của bạn.',
  'ui.a.home.truc.pause': 'Tạm dừng Trúc',
  'ui.a.home.truc.resume': 'Chạy lại Trúc',

  'ui.a.home.preview.show': 'Hiện ví dụ minh hoạ',
  'ui.a.home.preview.hide': 'Ẩn ví dụ minh hoạ',
  'ui.a.home.preview.why':
    'Không có gì ở đây được đo. Các ví dụ chỉ cho thấy hình dạng của một bảng chưa được xây.',
  'ui.a.home.preview.note':
    'Điểm cuối ca làm việc trả về số liệu hiện tại và không có chuỗi lịch sử, nên không có xu hướng nào đứng sau các con số này. Chúng chỉ dùng để chốt bố cục, và không bao giờ thay thế một số liệu tải lỗi.',
  'ui.a.home.preview.badge': 'Ví dụ — không phải dữ liệu thật',
  'ui.a.home.preview.trend': 'Bối cảnh được ghi nhiều nhất',
  'ui.a.home.preview.trendValue': 'Làm vườn',
  'ui.a.home.preview.week': 'Thời lượng bạn duyệt tuần này',
  'ui.a.home.preview.streak': 'Số ca liên tiếp',

  'ui.a.notBuilt.today': 'Hiện nay việc này được làm thế nào',

  'ui.a.pipeline.track': 'Một bản ghi đi qua những bước nào',
  'ui.a.pipeline.owed': 'Đang chờ PaXini',

  'episodes.title': 'Các tập cần xử lý',
  'episodes.intro':
    'Việc duyệt toàn bộ tập theo nhiệm vụ, cộng tác viên, thiết bị, trạng thái và thời gian ghi (BO-05) cần một API danh sách hiện chưa có.',
  'episodes.batch': 'Các lô đã nhập trên máy này, 100 lô gần nhất',
  'episodes.batch.pick': 'Lô',
  'episodes.batch.none': 'Máy này chưa nhập lô nào.',
  'episodes.batch.failed': 'Không tải được danh sách lô.',
  'episodes.blocking': 'Đang chặn, trong lô này',
  'episodes.blocking.scope':
    'Những tập khiến lô đã chọn chưa đóng được. Phạm vi: máy này, theo thời gian nhập.',
  'episodes.stuck': 'Đang kẹt, tại trung tâm này',
  'episodes.stuck.scope':
    'Việc bị tạm dừng hoặc bị giữ ở bất kỳ đâu trong trung tâm này, thuộc lô nào cũng tính.',
  'episodes.empty': 'Không có mục nào cần xử lý trong phạm vi này.',
  'episodes.filter': 'Lọc các dòng này',
  'episodes.col.episode': 'Tập',
  'episodes.col.session': 'Bắt đầu phiên',
  'episodes.col.state': 'Quy kết',
  'episodes.col.needs': 'Cần',
  'episodes.col.device': 'Thẻ nhớ',
  'episodes.col.hold': 'Đang giữ',
  'episodes.needs.assignment': 'Cần gán vào một phiên',
  'episodes.needs.confirmation': 'Cần người xác nhận kết quả khớp',
  'episodes.hold.parked': 'Đã tạm dừng',
  'episodes.hold.held': 'Bị giữ khi duyệt',
  'episodes.summary.episodes': 'Số tập',
  'episodes.summary.sessions': 'Số phiên',
  'episodes.summary.quarantined': 'Bị cách ly',
  'episodes.summary.awaiting': 'Chờ xác nhận',
  'episodes.summary.parked': 'Đã đưa ra khỏi hàng chờ duyệt',
  'episodes.summary.perSession': 'Số tập mỗi phiên',
  'episodes.resolve': 'Gán phiên',
  'episodes.resolve.title': 'Gán tập này cho một phiên',
  'episodes.resolve.session': 'Phiên',
  'episodes.resolve.reason': 'Vì sao chọn phiên này',
  'episodes.resolve.reasonHint': 'Cơ sở dữ liệu từ chối nếu việc gán không có lý do.',
  'episodes.resolve.done': 'Đã gán. Lô này đã được đọc lại.',
  'episodes.outcome': 'Kết quả duyệt',
  'episodes.outcome.state': 'Kết luận',
  'episodes.outcome.pending': 'Bản giao đang tính chưa có kết luận.',
  'episodes.outcome.collector': 'Cộng tác viên',
  'episodes.outcome.decided': 'Thời điểm quyết định',
  'episodes.outcome.note': 'Ghi chú của người duyệt',
  'episodes.outcome.reasons': 'Mã lý do',
  'episodes.outcome.failed': 'Không tải được kết quả.',
  'episodes.close': 'Đóng',
  'episodes.gone': 'Tập này không còn trên máy chủ. Hãy đọc lại lô.',
  'episodes.reload': 'Đọc lại',
  'episodes.noMatch': 'Không có dòng nào trong phạm vi này khớp với bộ lọc.',
  /* Ngữ pháp của luồng nhiều bước: dùng chung cho quầy nhận thẻ và giao nhiệm vụ. */

  'wiz.step': 'Bước',
  'wiz.review': 'Kiểm lại rồi ghi',
  'wiz.review.question': 'Kiểm lại từng câu trả lời trước khi ghi.',
  'wiz.unanswered': 'Chưa trả lời',
  'wiz.edit': 'Sửa',
  'wiz.back': 'Quay lại',
  'wiz.next': 'Tiếp',
  'wiz.needAnswer': 'Hãy trả lời câu này rồi mới đi tiếp.',
  'wiz.failed.gone': 'Máy chủ không còn dòng mà bước này gọi tên. Hãy tải lại màn hình và làm lại.',
  'wiz.failed.body':
    'Máy chủ không nhận một trong các câu trả lời. Đây là lỗi của bảng điều khiển chứ không phải của người nhập; khi báo lỗi hãy kèm mã tham chiếu bên dưới.',
  'wiz.failed.session':
    'Phiên này không được phép thực hiện thay đổi đó. Hãy đăng nhập lại, hoặc nhờ một người vận hành có vai trò quản trị.',

  /* Quầy: nhận thẻ (BO-10, APP-17b). */

  'counter.title': 'Nhận thẻ',
  'counter.intro':
    'Cộng tác viên nộp lại một thẻ TF. Hãy ghi ai nộp, thẻ lấy ra từ máy quay nào, và trên thẻ đã quay gì. Không có gì được ghi cho tới bước cuối.',
  'counter.review.intro':
    'Sẽ ghi hai dòng: việc bàn giao thẻ, và buổi quay được khai theo thẻ đó. Có thể sửa bất kỳ câu trả lời nào từ đây.',
  'counter.group.card': 'Chiếc thẻ',
  'counter.group.recording': 'Buổi quay',

  'counter.step.collector': 'Cộng tác viên',
  'counter.step.device': 'Máy quay',
  'counter.step.card': 'Thẻ nhớ',
  'counter.step.task': 'Nhiệm vụ',
  'counter.step.scenario': 'Bối cảnh',
  'counter.step.declare': 'Phần khai báo',

  'counter.q.collector': 'Ai nộp chiếc thẻ này?',
  'counter.q.device': 'Thẻ này lấy ra từ máy quay nào?',
  'counter.q.card': 'Đây là thẻ nào, và nhận lúc mấy giờ?',
  'counter.q.task': 'Nội dung này quay theo nhiệm vụ nào?',
  'counter.q.scenario': 'Quay ở đâu, và buổi quay được chuẩn bị lúc nào?',
  'counter.q.declare': 'Cộng tác viên khai những gì?',

  'counter.note.collector':
    'Một thẻ thuộc về một cộng tác viên, và đó là người đang đứng ở quầy. Trung tâm, máy này và tên của chính bạn lấy từ thông tin đăng nhập, nên không hỏi lại ở đây.',
  'counter.note.device':
    'Máy quay luân chuyển giữa các cộng tác viên và thẻ luân chuyển giữa các máy quay. Không suy ra theo kiểu lần trước ai giữ, nên máy quay phải được chỉ rõ.',
  'counter.note.card':
    'Ghi đúng nhãn trên thẻ. Thời gian ở đây là lúc thẻ đổi tay tại quầy này, không phải lúc quay.',
  'counter.note.task':
    'Nhiệm vụ quyết định đơn giá. Cộng tác viên phải đang giữ một lượt nhận nhiệm vụ đó; nếu không, máy chủ từ chối buổi quay và nói rõ là lý do nào trong ba lý do.',
  'counter.note.scenario':
    'Thời điểm chuẩn bị là điều cộng tác viên nhớ lại. Hệ thống không bao giờ tự khớp nó với dữ liệu quay, vì chỉ buổi quay do ứng dụng tạo mới được khớp tự động, nên sau khi nhập thẻ sẽ có người vận hành xác nhận.',
  'counter.note.declare':
    'Bắt buộc trả lời cả hai. Không là một câu trả lời, còn chưa ai hỏi thì không, và bản ghi cũng không có cách nào diễn đạt điều thứ hai.',

  'counter.field.card': 'Thẻ TF',
  'counter.hint.card': 'Ghi đúng như trên thẻ.',
  'counter.field.handoverAt': 'Nhận lúc',
  'counter.hint.handoverAt': 'Giờ địa phương của bạn.',
  'counter.field.preparedAt': 'Buổi quay chuẩn bị lúc',
  'counter.hint.preparedAt':
    'Giờ địa phương của bạn. Không có thời điểm kết thúc, và cũng không có ô để nhập.',

  'counter.declare.others': 'Có người khác xuất hiện trong hình',
  'counter.declare.sensitive': 'Có thông tin nhạy cảm xuất hiện trong hình',
  'counter.declare.yes': 'Có',
  'counter.declare.no': 'Không',

  'counter.privacy.low': 'Rủi ro riêng tư thấp',
  'counter.privacy.medium': 'Rủi ro riêng tư trung bình',
  'counter.privacy.high': 'Rủi ro riêng tư cao',

  'counter.empty.collectors':
    'Máy này chưa nhận được danh sách cộng tác viên nào. Danh sách nằm ở khu vực quản trị, và trống ở đây thường nghĩa là dữ liệu tham chiếu chưa đồng bộ về.',
  'counter.empty.devices':
    'Máy này chưa nhận được máy quay nào. Đội thiết bị nằm ở khu vực quản trị, và trống ở đây thường nghĩa là dữ liệu tham chiếu chưa đồng bộ về.',
  'counter.empty.tasks':
    'Máy này chưa nhận được nhiệm vụ nào. Buổi quay luôn phải gắn với một nhiệm vụ, nên chưa có nhiệm vụ thì chưa khai được gì.',
  'counter.empty.scenarios':
    'Máy này chưa nhận được bối cảnh nào. Bối cảnh là dữ liệu tham chiếu cài sẵn cùng dịch vụ, nên danh sách trống nghĩa là dữ liệu tham chiếu chưa về.',

  'counter.commit': 'Ghi việc bàn giao',
  'counter.commit.session': 'Ghi buổi quay',
  'counter.recorded':
    'Đã ghi rồi, theo mã mà lần nhận thẻ này bắt đầu. Gửi lại cũng không thay đổi gì. Nếu sai, hãy bắt đầu một thẻ mới.',
  'counter.landed':
    'Việc bàn giao đã vào sổ. Chỉ còn buổi quay là chưa ghi, và ba câu trả lời đầu không thể đổi bên dưới nó; nếu một trong ba sai, hãy bắt đầu một thẻ mới.',
  'counter.refused.reference':
    'Máy này đang giữ dữ liệu tham chiếu mà máy chủ không nhận ra. Hãy tải lại màn hình rồi chọn lại. Không tìm thấy:',

  'counter.done.title': 'Đã ghi nhận thẻ',
  'counter.done.card':
    'Thẻ không bị xoá. Không khâu nào trên đường đi này xoá nội dung trên thẻ, và sẽ không bao giờ có.',
  'counter.done.match':
    'Việc này được ghi tại quầy, nên dữ liệu quay không tự khớp theo thời gian. Sau khi nhập thẻ, người vận hành xác nhận quy thuộc ở màn hình Tập ghi.',
  'counter.done.nextCard': 'Thẻ tiếp theo',
  'counter.done.nextSession': 'Một buổi quay khác trên thẻ này',

  /* Quản trị: tạo nhiệm vụ và giao cho người (BO-01, BO-02, APP-10, và kỳ giữ máy mà thanh toán đọc). */

  'assign.title': 'Nhiệm vụ mới',
  'assign.review.intro':
    'Tạo nhiệm vụ trước, đăng lên nếu bạn chọn thế, rồi lần lượt nhận nhiệm vụ cho từng cộng tác viên. Có thể sửa bất kỳ câu trả lời nào từ đây.',
  'assign.commit': 'Tạo nhiệm vụ',
  'assign.group.task': 'Nhiệm vụ',
  'assign.group.people': 'Con người',

  'assign.step.name': 'Tên',
  'assign.step.rate': 'Đơn giá',
  'assign.step.capacity': 'Số chỗ',
  'assign.step.publish': 'Đăng',
  'assign.step.claimants': 'Người nhận',
  'assign.step.cameras': 'Máy quay',

  'assign.q.name': 'Nhiệm vụ này tên là gì?',
  'assign.q.rate': 'Nhiệm vụ này trả bao nhiêu?',
  'assign.q.capacity': 'Cùng lúc cho phép mấy cộng tác viên giữ?',
  'assign.q.publish': 'Đăng ngay bây giờ?',
  'assign.q.claimants': 'Ai sẽ nhận việc này?',
  'assign.q.cameras': 'Có ai mang máy quay về không?',

  'assign.note.name':
    'Tên là chữ mà cộng tác viên đọc thấy ở sảnh nhiệm vụ. Loại theo cách phân loại của PaXini và không có danh sách cố định.',
  'assign.note.rate':
    'Một số thập phân, tối đa tám chữ số phần nguyên và bốn chữ số phần lẻ, đúng như cột lưu. Nó nhân vào mọi khoản chi trả nên không làm tròn khi nhập; và một khi nhiệm vụ đã đăng thì con số này không đổi được nữa.',
  'assign.note.capacity':
    'Giới hạn đếm theo các lượt nhận đang còn hiệu lực. Trả lại một lượt nhận là trả chỗ về cho nhiệm vụ.',
  'assign.note.publish':
    'Bản nháp thì không nhận được: cơ sở dữ liệu từ chối lượt nhận trên nhiệm vụ chưa đăng. Cứ để nháp nếu muốn bổ sung chi tiết sau, rồi đăng từ bảng.',
  'assign.note.claimants':
    'Lượt nhận nghĩa là cộng tác viên này đang giữ nhiệm vụ này, và những gì họ quay theo đó được trả theo đơn giá của nó. Không chọn ai cũng là một câu trả lời thật, vì nhiệm vụ đã đăng có thể để sảnh nhiệm vụ tự lấp đầy.',
  'assign.note.cameras':
    'Đây là kỳ giữ máy chứ không phải việc gán máy: thanh toán đọc nó để biết ngày đó máy nằm trong tay ai. Kỳ nào còn mở trên máy quay đó sẽ được đóng lại ngay tại cùng thời điểm.',

  'assign.hint.type': 'Cách phân loại của PaXini. Không có danh sách cố định.',
  'assign.hint.target': 'Không bắt buộc. Tính bằng giây hữu hiệu.',

  'assign.publish.label': 'Đăng nhiệm vụ này ngay',
  'assign.publish.now': 'Đã đăng',
  'assign.publish.draft': 'Để làm nháp',

  'assign.claimants.none': 'Không ai',
  'assign.claimants.empty':
    'Chưa có cộng tác viên nào. Hãy tạo một người ở thẻ cộng tác viên rồi quay lại.',
  'assign.cameras.none': 'Không phát máy quay',
  'assign.cameras.no': 'Không phát máy',
  'assign.cameras.noClaimants': 'Không ai nhận việc này, nên cũng không có máy quay nào để phát.',

  'assign.done.title': 'Đã tạo nhiệm vụ',
  'assign.done.published': 'Đã đăng. Cộng tác viên có thể nhận.',
  'assign.done.draft': 'Để làm nháp. Khi nào xong thì đăng từ bảng.',
  'assign.done.nobody':
    'Chưa giao cho ai. Cộng tác viên có thể tự nhận ở sảnh nhiệm vụ, hoặc bạn nhận thay họ ngay ở thẻ này.',
  'assign.done.claimed': 'Đang giữ nhiệm vụ.',
  'assign.done.assigned': 'Đã phát máy quay.',
  'assign.done.someRefused':
    'Một phần yêu cầu đã bị từ chối. Bản thân nhiệm vụ đã được tạo; các dòng trên nói ai chưa được giao và vì sao.',
  'assign.done.close': 'Về danh sách nhiệm vụ',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, zh, vi };

/** Every locale holds every key. Asserted by a test, not hoped for. */
export function missingKeys(locale: Locale): MessageKey[] {
  const keys = Object.keys(en) as MessageKey[];
  return keys.filter((k) => {
    const value = MESSAGES[locale][k];
    return typeof value !== 'string' || value.trim() === '';
  });
}

/**
 * Which language to render in: an explicit choice first, then what the browser
 * asks for, then English.
 *
 * The query parameter wins because a PaXini reviewer on a shared VNG machine
 * needs to be able to switch without touching browser settings, and because a
 * link to a specific episode should render the same way for whoever opens it.
 */
export function pickLocale(query: unknown, acceptLanguage: string | undefined): Locale {
  const requested = (query as Record<string, string> | undefined)?.['lang'];
  if (requested !== undefined && (LOCALES as readonly string[]).includes(requested)) {
    return requested as Locale;
  }
  if (acceptLanguage !== undefined) {
    for (const part of acceptLanguage.split(',')) {
      const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
      if (tag.startsWith('zh')) return 'zh';
      if (tag.startsWith('vi')) return 'vi';
      if (tag.startsWith('en')) return 'en';
    }
  }
  return DEFAULT_LOCALE;
}

/** The `lang` attribute for the document. Not the same string as the locale key. */
export const HTML_LANG: Record<Locale, string> = { en: 'en', zh: 'zh-Hans', vi: 'vi' };

export const t = (locale: Locale, key: MessageKey): string => MESSAGES[locale][key];
