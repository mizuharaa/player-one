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
  'bo.refused.unknown': 'The server refused that change.',

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
  'bo.refused.unknown': '服务端拒绝了该操作。',

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
