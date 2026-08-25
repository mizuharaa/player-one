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
  'app.language': 'Language',

  'login.title': 'Sign in to review',
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

  'theme.toggle': 'Theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
} as const;

export type MessageKey = keyof typeof en;

const zh: Record<MessageKey, string> = {
  'app.name': 'PlayerOne',
  'app.review': '审核',
  'app.signOut': '退出登录',
  'app.language': '语言',

  'login.title': '登录以进行审核',
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

  'theme.toggle': '主题',
  'theme.light': '浅色',
  'theme.dark': '深色',
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
