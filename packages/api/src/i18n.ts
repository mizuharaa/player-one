/**
 * Every user-facing string in the back office, in both languages it has to be
 * read in.
 *
 * LOC-02: PaXini's reviewers work in Chinese through phase 1, and they are the
 * people this screen is for. English is the default because VNG builds and
 * operates it. Vietnamese is deliberately absent here — LOC-04 puts Vietnamese
 * on what reaches the *collector*, which is the reject reason codes, and those
 * are localised as catalogue rows in `review_reason_codes` rather than as
 * strings in the console. A reviewer-facing Vietnamese console is not something
 * anybody has asked for and inventing one would be three columns to keep in
 * step instead of two.
 *
 * The catalogue is a flat map of dotted keys rather than nested objects, and
 * both languages hold the same keys, which is what `assertComplete` below is
 * for: a missing Chinese string should fail a test, not surface as an English
 * word in the middle of a Chinese sentence at an upload centre.
 *
 * The same object is rendered into the page and handed to the client module, so
 * there is one catalogue and not a server one and a browser one that drift.
 */

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

const en = {
  'app.name': 'PlayerOne',
  'app.review': 'Review',
  'app.signOut': 'Sign out',
  /**
   * Said on the control itself, because the session is still open. The cookies
   * are `HttpOnly` and only the server can clear them, so a failed sign-out
   * must not look like a finished one.
   */
  'app.signOutFailed': 'Still signed in — the service did not answer. Try again.',
  'app.language': 'Language',

  'login.title': 'Sign in to review',
  'login.intro':
    'Two credentials, as everywhere else in this service: the machine proves where, the operator proves who.',
  'login.machine': 'Machine identifier',
  'login.machineSecret': 'Machine secret',
  'login.operator': 'Operator reference',
  'login.operatorSecret': 'Operator secret',
  'login.submit': 'Sign in',
  'login.failed': 'Those credentials were not accepted.',
  'login.mismatch': 'The machine and the operator belong to different upload centres.',

  /**
   * The two sentences on the sign-in panel. They were English literals in the
   * component, which meant a Shenzhen reviewer met the product in a language
   * they may not read before they had signed in far enough to find the toggle.
   */
  'login.promise': 'Every recorded hour gets an owner, a measurement and a decision.',
  'login.partners': 'VNG PT Lab and PaXini. Footage stays in Vietnam.',
  'login.network':
    'The service did not answer. Check the machine is on the centre network and try again.',

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
  /** Why the commit button is disabled on an episode that has arrived. */
  'player.notReady': 'The footage has not loaded yet. A verdict waits for it.',

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
  /**
   * The field keeps its name above it now, so the placeholder is free to be a
   * prompt rather than a repeat of the label.
   */
  'verdict.notePlaceholder': 'Anything the reason codes do not cover',
  'verdict.reasons': 'Reasons',
  'verdict.reasonsRequired': 'A rejection must name at least one reason.',

  /**
   * QR-04 needs the reason list to reject at all. When the list itself fails to
   * load, the reject choice is a dead end — a disabled commit beside an empty
   * box — so it says so rather than looking like a rejection with nothing wrong.
   */
  'verdict.reasonsFailed':
    'The reason list did not load, so a rejection cannot be recorded yet. Reload the page.',
  'verdict.committing': 'Recording verdict',

  /**
   * The hold on the claimed episode, printed while it is being worked on.
   *
   * The lease is ten minutes and the heartbeat renews it every minute, so this
   * figure sits still in the normal case. It only falls when the renewal is
   * failing, which is precisely when the reviewer needs the warning: the marks
   * they are making are about to belong to somebody else's episode.
   */
  'lease.held': 'Held for',
  'lease.ending':
    'This hold is running out. If it ends, the episode returns to the queue and the marks on it are lost. Commit now, or reload to take it again.',

  'state.leaseExpired.title': 'This episode was reassigned',
  'state.leaseExpired.body':
    'The claim on it expired and another reviewer may now hold it. The verdict you were preparing has been discarded.',
  'state.leaseExpired.action': 'Claim the next episode',
  'state.mediaFailed.title': 'The footage will not play',
  'state.mediaFailed.body':
    'The media is recorded in the store but this machine cannot read it. That is a fault on this machine, not with the recording.',
  'state.mediaFailed.action': 'Skip this episode',
  /**
   * The skip that could not give the episode back. Naming it is the point: a
   * skip that silently failed to release locks this episode out of the queue
   * for ten minutes, and a reviewer working through a run of unplayable files
   * on a bad connection can drain a queue in under a minute that way.
   */
  'state.mediaFailed.releaseFailed':
    'This episode could not be given back to the queue, so it has not been skipped. Skipping now would lock it out of review for ten minutes. Try again when the connection returns.',
  'mark.multipart':
    'This episode arrives in more than one file, and a mark cannot yet be placed on the whole episode. Good and reject still work; a partial pass does not.',
  'state.writeFailed.title': 'The verdict was not recorded',
  'state.writeFailed.body':
    'The commit did not reach the server. Nothing has been paid and nothing has advanced. Try again, or release the episode and it will return to the queue.',
  'state.writeFailed.retry': 'Try again',
  'state.writeFailed.release': 'Release it',
  'state.offline.title': 'No connection',
  'state.offline.body': 'Verdicts cannot be recorded while this machine is offline.',
  /** Said once per loading region, for anybody who cannot see a skeleton. */
  'state.loading': 'Loading',
  'state.loadFailed.title': 'Could not reach the queue',
  'state.loadFailed.body':
    'The queue did not answer. Nothing has been claimed, and no verdict already committed is affected.',
  /**
   * Separated from the lease states because the answer is different. A 401 or
   * a 403 does not recover by waiting, and it used to present as a countdown
   * that quietly stopped moving — so a reviewer kept marking spans they could
   * no longer commit.
   */
  'state.sessionEnded.title': 'This session has ended',
  'state.sessionEnded.body':
    'The sign-in on this machine is no longer valid, so the hold on this episode cannot be renewed. It returns to the queue by itself. Sign in again to carry on.',
  'state.sessionEnded.action': 'Sign in again',

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
  'shortcuts.close': 'Close',

  'recent.title': 'Recent verdicts',
  'recent.empty': 'No verdicts yet this session',
  /** An empty list and a failed read are different facts and must not look alike. */
  'recent.failed': 'These verdicts did not load. Nothing on the server has changed.',

  // ---------------------------------------------------------------------
  // Added with the React console. Home, Pipeline and the shell's navigation
  // did not exist while the console was one screen.

  /** The landmark label for the pill row. A page may hold more than one `<nav>`. */
  'nav.sections': 'Sections',
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

  /**
   * The notes under the four figures. `home.settled.note` is load-bearing copy:
   * DESIGN.md requires that sentence to survive any rewrite, because a reviewer
   * must never read their own settled value as the programme's budget.
   */
  'home.payable.note': 'Effective duration from decided reviews only.',
  'home.approval.note': 'Passes and partial passes, against every decision today.',
  'home.settled.note': 'Your decisions only. Not the programme’s spend.',
  'home.average.note': 'Load to verdict. Instrumentation, never money.',
  'home.figuresFailed.title': 'The shift figures did not load',
  'home.figuresFailed.body':
    'Everything else on this screen still works. The counters come from the review database; if this keeps happening, the API cannot reach Postgres.',

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

  /**
   * The seven stages, the capability table and its footnote.
   *
   * These were English literals in `Pipeline.tsx`, which left a Chinese reviewer
   * with translated chrome around an entirely English table — the exact failure
   * this catalogue exists to prevent. Requirement IDs are printed as the brief
   * prints them and are not strings here.
   */
  'pipeline.stage.record': 'Record',
  'pipeline.stage.handover': 'Hand in card',
  'pipeline.stage.measure': 'Measure',
  'pipeline.stage.attribute': 'Attribute',
  'pipeline.stage.review': 'Review',
  'pipeline.stage.settle': 'Settle',
  'pipeline.stage.upload': 'Cloud upload',

  'pipeline.cap.duration': 'Duration measurement',
  'pipeline.cap.identity': 'Episode identity and quarantine',
  'pipeline.cap.attribution': 'Session attribution',
  'pipeline.cap.auth': 'Both-token operator auth',
  'pipeline.cap.audit': 'Audit trail',
  'pipeline.cap.verdicts': 'Review verdicts',
  'pipeline.cap.reasons': 'Reject reasons, localised',
  'pipeline.cap.settlementRow': 'Settlement row',
  'pipeline.cap.bill': 'Bill export and mark paid',
  'pipeline.cap.centres': 'Upload-centre management',
  'pipeline.cap.reviewerRole': 'Scoped remote reviewer role',
  'pipeline.cap.training': 'Training and exam',
  'pipeline.cap.taskHall': 'Task hall and claiming',
  'pipeline.cap.cloudVerify': 'Cloud verification',
  'pipeline.cap.deviceBinding': 'Device binding',
  'pipeline.cap.preChecks': 'Pre-collection checks',
  'pipeline.cap.pathA': 'Path A upload',
  'pipeline.cap.playback': 'Raw or proxy playback for review',

  'pipeline.surface.engine': 'Engine — no screen',
  'pipeline.surface.counter': 'Counter',
  'pipeline.surface.all': 'All',
  'pipeline.surface.review': 'Review',
  'pipeline.surface.settle': 'Settle',
  'pipeline.surface.app': 'Android app',
  'pipeline.surface.services': 'Services',

  'pipeline.provenance':
    'Hand-kept, not measured: this page is a dated record of the build, last revised 25 August 2026. It does not count anything in the database, and it describes only what is merged — work in flight on a feature branch is not counted here until it lands.',
  'pipeline.footnote':
    'D1 (Wi-Fi protocol) and D5 (device SDK and manual) are owed by PaXini and were promised on 13 August 2026. D11 — whether background review needs online playback of raw video — is unresolved on PaXini’s side and decides whether video effectively leaves Vietnam.',

  'theme.toggle': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  /** The third state of the cycle. It was printing the English word `system`. */
  'theme.system': 'Follow the machine',
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  'app.name': 'PlayerOne',
  'app.review': '审核',
  'app.signOut': '退出登录',
  'app.signOutFailed': '仍处于登录状态：服务未响应，请重试。',
  'app.language': '语言',

  'login.title': '登录以进行审核',
  'login.intro': '与本服务其他部分一致，需要两组凭据：机器凭据证明地点，操作员凭据证明身份。',
  'login.machine': '机器标识',
  'login.machineSecret': '机器密钥',
  'login.operator': '操作员编号',
  'login.operatorSecret': '操作员密钥',
  'login.submit': '登录',
  'login.failed': '凭据未被接受。',
  'login.mismatch': '机器与操作员属于不同的上传中心。',

  'login.promise': '每一小时的录制都有归属、有实测、有结论。',
  'login.partners': 'VNG PT Lab 与 PaXini。素材不出越南。',
  'login.network': '服务未响应。请确认本机已接入中心网络，然后重试。',

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
  'player.notReady': '素材尚未加载完成，提交需要等待素材可播放。',

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
  'verdict.notePlaceholder': '原因代码未能覆盖的情况',
  'verdict.reasons': '原因',
  'verdict.reasonsRequired': '拒绝时必须至少选择一个原因。',
  'verdict.reasonsFailed': '拒绝原因列表未能加载，暂时无法提交拒绝。请重新加载页面。',
  'verdict.committing': '正在记录结果',

  'lease.held': '锁定剩余',
  'lease.ending': '锁定即将到期。到期后该片段会退回队列，已标记的区间将丢失。请立即提交，或重新加载以再次领取。',

  'state.leaseExpired.title': '该片段已被重新分配',
  'state.leaseExpired.body': '认领已过期，可能已由其他审核员接手。您正在填写的结果已被丢弃。',
  'state.leaseExpired.action': '领取下一条',
  'state.mediaFailed.title': '素材无法播放',
  'state.mediaFailed.body': '记录已存在于数据库中，但本机无法读取该文件。这是本机的问题，与录制内容无关。',
  'state.mediaFailed.action': '跳过该片段',
  'state.mediaFailed.releaseFailed':
    '该片段未能退回队列，因此没有跳过。此时跳过会使其在十分钟内无法被审核。请在网络恢复后重试。',
  'mark.multipart': '该片段由多个文件组成，暂时无法在整段时间轴上标记区间。可以提交通过或拒绝，暂不支持部分通过。',
  'state.writeFailed.title': '结果未被记录',
  'state.writeFailed.body':
    '提交未送达服务器。没有产生任何结算，也没有跳转到下一条。请重试，或释放该片段使其回到队列。',
  'state.writeFailed.retry': '重试',
  'state.writeFailed.release': '释放',
  'state.offline.title': '网络已断开',
  'state.offline.body': '离线状态下无法记录审核结果。',
  'state.loading': '加载中',
  'state.loadFailed.title': '无法连接队列',
  'state.loadFailed.body': '队列没有响应。没有领取任何片段，已提交的审核结果也不受影响。',
  'state.sessionEnded.title': '登录状态已失效',
  'state.sessionEnded.body':
    '本机的登录已失效，无法继续续约该片段的锁定。该片段会自动退回队列。请重新登录后继续。',
  'state.sessionEnded.action': '重新登录',

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
  'shortcuts.close': '关闭',

  'recent.title': '最近的审核',
  'recent.empty': '本次登录尚无记录',
  'recent.failed': '最近的审核记录未能加载。服务端数据没有变化。',

  'nav.sections': '功能区',
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

  'home.payable.note': '仅统计已出结果的审核的有效时长。',
  'home.approval.note': '通过与部分通过，占今日全部结果的比例。',
  'home.settled.note': '仅为您的审核结果，并非整个项目的支出。',
  'home.average.note': '从加载到出结果的用时。仅用于观测，与结算无关。',
  'home.figuresFailed.title': '班次数据未能加载',
  'home.figuresFailed.body':
    '本页其他内容仍可使用。这些计数来自审核数据库；若持续出现，说明接口无法连接 Postgres。',

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

  'pipeline.stage.record': '录制',
  'pipeline.stage.handover': '交卡',
  'pipeline.stage.measure': '实测',
  'pipeline.stage.attribute': '归属',
  'pipeline.stage.review': '审核',
  'pipeline.stage.settle': '结算',
  'pipeline.stage.upload': '云端上传',

  'pipeline.cap.duration': '时长实测',
  'pipeline.cap.identity': '片段标识与隔离',
  'pipeline.cap.attribution': '采集场次归属',
  'pipeline.cap.auth': '双凭据操作员认证',
  'pipeline.cap.audit': '审计轨迹',
  'pipeline.cap.verdicts': '审核结果',
  'pipeline.cap.reasons': '拒绝原因（多语言）',
  'pipeline.cap.settlementRow': '结算记录',
  'pipeline.cap.bill': '账单导出与标记已付',
  'pipeline.cap.centres': '上传中心管理',
  'pipeline.cap.reviewerRole': '受限的远程审核员角色',
  'pipeline.cap.training': '培训与考核',
  'pipeline.cap.taskHall': '任务大厅与接单',
  'pipeline.cap.cloudVerify': '云端校验',
  'pipeline.cap.deviceBinding': '设备绑定',
  'pipeline.cap.preChecks': '采集前检查',
  'pipeline.cap.pathA': 'A 路径上传',
  'pipeline.cap.playback': '审核用原片或代理片播放',

  'pipeline.surface.engine': '引擎 — 无界面',
  'pipeline.surface.counter': '柜台',
  'pipeline.surface.all': '全部',
  'pipeline.surface.review': '审核',
  'pipeline.surface.settle': '结算',
  'pipeline.surface.app': '安卓应用',
  'pipeline.surface.services': '服务端',

  'pipeline.provenance':
    '人工维护，非实时统计：本页是构建状态的记录，最后修订于 2026 年 8 月 25 日，不读取数据库，且只反映已合并的部分——尚在特性分支上的工作在合并前不计入。',
  'pipeline.footnote':
    'D1（Wi-Fi 协议）与 D5（设备 SDK 与手册）由 PaXini 提供，承诺日期为 2026 年 8 月 13 日。D11——后台审核是否需要在线播放原始视频——PaXini 尚未确认，它决定视频是否实际离开越南。',

  'theme.toggle': '主题',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'theme.system': '跟随系统',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, zh };

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
      if (tag.startsWith('en')) return 'en';
    }
  }
  return DEFAULT_LOCALE;
}

/** The `lang` attribute for the document. Not the same string as the locale key. */
export const HTML_LANG: Record<Locale, string> = { en: 'en', zh: 'zh-Hans' };

export const t = (locale: Locale, key: MessageKey): string => MESSAGES[locale][key];
