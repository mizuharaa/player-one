/**
 * Every user-facing string in the collector app, Vietnamese first.
 *
 * LOC-01: the collector app is in Vietnamese, P0. English is P2 and rides
 * along because the catalogue pattern needs a second locale to prove the
 * completeness check does anything — same mechanism as
 * `packages/api/src/i18n.ts`, which this file deliberately mirrors: a flat
 * map of dotted keys, every locale holding every key, asserted by a test.
 *
 * Vietnamese is the BASE locale: `MessageKey` derives from `vi`, so a key
 * added in English only does not typecheck, and a key missing from English
 * fails the parity test.
 */

export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'vi';

const vi = {
  'app.name': 'Player One',

  'common.back': 'Quay lại',
  'common.cancel': 'Hủy',
  'common.loading': 'Đang tải…',
  'common.language': 'English',
  'common.retry': 'Thử lại',
  'common.loadFailed': 'Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.',
  'common.actionFailed': 'Không thực hiện được. Vui lòng thử lại.',

  'register.title': 'Đăng ký',
  'register.intro': 'Tạo tài khoản người thu thập để nhận nhiệm vụ và được trả công theo phút hiệu quả.',
  'register.name': 'Họ và tên',
  'register.phone': 'Số điện thoại',
  'register.submit': 'Tạo tài khoản',
  'register.missing': 'Điền đầy đủ họ tên và số điện thoại.',

  'agreements.title': 'Sáu thỏa thuận',
  'agreements.intro':
    'Đăng ký chỉ hoàn tất khi bạn đồng ý cả sáu thỏa thuận. Mỗi lần đồng ý được ghi lại kèm phiên bản và thời điểm.',
  'agreements.version': 'Phiên bản',
  'agreements.submit': 'Đồng ý cả sáu',
  'agreements.incomplete': 'Cần đồng ý cả sáu thỏa thuận.',
  'agreement.user': 'Thỏa thuận người dùng',
  'agreement.privacy': 'Thỏa thuận quyền riêng tư',
  'agreement.data_collection': 'Ủy quyền thu thập dữ liệu',
  'agreement.commercial_use': 'Ủy quyền sử dụng dữ liệu thương mại',
  'agreement.manual_review': 'Mô tả quy trình duyệt thủ công',
  'agreement.offline_settlement': 'Mô tả thanh toán thủ công ngoại tuyến',

  'training.title': 'Đào tạo',
  'training.body':
    'Nội dung đào tạo do PaXini cung cấp và được VNG bản địa hóa: cách đeo thiết bị, thu thập ngoại tuyến và thẻ TF, đổi Wi-Fi và điểm phát sóng, hàng đợi tải lên, quyền chạy nền, pin và bộ nhớ, không gián đoạn công việc thật để tải lên, ủy quyền bối cảnh và người xung quanh, báo cáo sự cố.',
  'training.placeholder': 'Phần khung — nội dung thật sẽ thay thế khi PaXini bàn giao.',
  'training.done': 'Hoàn thành đào tạo',

  'exam.title': 'Bài kiểm tra',
  'exam.intro': 'Chưa đạt bài kiểm tra thì chưa thể nhận nhiệm vụ. Máy chủ cũng kiểm tra điều này.',
  'exam.q1': 'Tôi đã hiểu cách đeo thiết bị và ghi hình đúng.',
  'exam.q2': 'Tôi sẽ xin phép trước khi ghi hình người khác hoặc địa điểm riêng.',
  'exam.q3': 'Tôi hiểu rằng dữ liệu chỉ được tải lên khi tôi tự xác nhận.',
  'exam.submit': 'Nộp bài',
  'exam.passed': 'Đạt. Bạn có thể nhận nhiệm vụ.',
  'exam.failed': 'Chưa đạt. Xem lại phần đào tạo rồi thử lại.',

  'home.tasks': 'Sảnh nhiệm vụ',
  'home.myTasks': 'Nhiệm vụ của tôi',
  'home.devices': 'Thiết bị của tôi',
  'home.session': 'Tạo phiên thu thập',
  'home.uploads': 'Tải lên',
  'home.income': 'Thu nhập',
  'home.training': 'Đào tạo & kiểm tra',
  'home.gateExam': 'Chưa đạt bài kiểm tra — chưa thể nhận nhiệm vụ.',
  'home.gateDevice': 'Chưa liên kết thiết bị — chưa thể tạo phiên thu thập.',

  'hall.title': 'Sảnh nhiệm vụ',
  'hall.perMinute': 'đ/phút hiệu quả',
  'hall.progress': 'Tiến độ',
  'hall.slots': 'Người nhận',
  'hall.full': 'Đã đủ người',
  'hall.open': 'Có thể nhận',

  'scenario.home': 'Tại nhà',
  'scenario.office': 'Văn phòng',
  'scenario.shop': 'Cửa hàng',
  'scenario.warehouse': 'Kho hàng',

  'detail.title': 'Chi tiết nhiệm vụ',
  'detail.instructions': 'Hướng dẫn',
  'detail.privacy': 'Lưu ý quyền riêng tư',
  'detail.payment': 'Quy tắc thanh toán',
  'detail.target': 'Mục tiêu',
  'detail.minutes': 'phút',
  'detail.claim': 'Nhận nhiệm vụ',
  'detail.claimed': 'Đã nhận nhiệm vụ này',
  'detail.needExam': 'Cần đạt bài kiểm tra trước khi nhận nhiệm vụ.',
  'detail.full': 'Nhiệm vụ đã đủ người nhận.',
  'detail.claiming': 'Đang nhận…',
  'detail.needAgreements': 'Cần đồng ý cả sáu thỏa thuận trước khi nhận nhiệm vụ.',
  'detail.needTraining': 'Cần hoàn thành đào tạo trước khi nhận nhiệm vụ.',

  'mine.title': 'Nhiệm vụ của tôi',
  'mine.empty': 'Chưa nhận nhiệm vụ nào.',
  'mine.claimedAt': 'Nhận lúc',

  'devices.title': 'Thiết bị của tôi',
  'devices.empty': 'Chưa liên kết thiết bị nào.',
  'devices.serial': 'Số sê-ri',
  'devices.scanQr': 'Quét mã QR',
  'devices.qrMock': 'Máy quét giả lập — trả về số sê-ri mẫu.',
  'devices.typed': 'Hoặc nhập số sê-ri in trên thiết bị',
  'devices.bind': 'Liên kết thiết bị',
  'devices.boundAt': 'Liên kết lúc',
  'devices.provision': 'Cấu hình Wi-Fi qua Bluetooth',

  'prov.title': 'Cấu hình thiết bị',
  'prov.hint':
    'Điện thoại gửi Wi-Fi của bạn cho thiết bị qua Bluetooth; thiết bị trả về địa chỉ IP để tải dữ liệu về máy.',
  'prov.scan': 'Tìm thiết bị',
  'prov.connect': 'Kết nối',
  'prov.connected': 'Đã kết nối',
  'prov.ssid': 'Tên Wi-Fi (SSID)',
  'prov.password': 'Mật khẩu Wi-Fi',
  'prov.send': 'Gửi cấu hình Wi-Fi',
  'prov.sent': 'Đã gửi cấu hình',
  'prov.readIp': 'Đọc địa chỉ IP',
  'prov.ip': 'Địa chỉ IP thiết bị',
  'prov.failed': 'Chưa đọc được IP',
  'prov.rssi': 'RSSI',

  'session.title': 'Tạo phiên thu thập',
  'session.intro': 'Một phiên gắn nhiệm vụ + người thu thập + thiết bị + bối cảnh, trước khi ghi hình.',
  'session.task': 'Nhiệm vụ',
  'session.device': 'Thiết bị',
  'session.scenario': 'Bối cảnh',
  'session.declare': 'Hai khai báo bắt buộc trước khi ghi hình:',
  'session.othersTitle': 'Có thể có người khác trong khung hình?',
  'session.sensitiveTitle': 'Có thể xuất hiện thông tin nhạy cảm?',
  'session.yes': 'Có',
  'session.no': 'Không',
  'session.needClaim': 'Cần nhận một nhiệm vụ trước.',
  'session.needDevice': 'Cần liên kết thiết bị trước.',
  'session.needDeclarations': 'Cần trả lời cả hai khai báo.',
  'session.create': 'Tạo phiên',
  'session.created': 'Đã tạo phiên',
  'session.id': 'Mã phiên',
  'session.noRecord':
    'Ứng dụng không bao giờ bắt đầu hay dừng ghi hình. Nút ghi hình nằm trên thiết bị, trong tay bạn.',

  'uploads.title': 'Tải lên',
  'uploads.size': 'Dung lượng',
  'uploads.upload': 'Tải lên',
  'uploads.confirmTitle': 'Xác nhận tải lên?',
  'uploads.confirmBody':
    'Dữ liệu chỉ rời máy của bạn khi bạn xác nhận. Không bao giờ tự động, không bao giờ âm thầm.',
  'uploads.reason': 'Lý do',
  'uploads.empty': 'Chưa có tập dữ liệu nào.',

  'state.pending_upload': 'Chờ tải lên',
  'state.uploading': 'Đang tải lên',
  'state.uploaded': 'Đã tải lên',
  'state.under_review': 'Đang duyệt',
  'state.review_passed': 'Duyệt đạt',
  'state.review_failed': 'Duyệt không đạt',

  'income.title': 'Thu nhập',
  'income.estimated': 'Ước tính',
  'income.confirmed': 'Đã xác nhận',
  'income.minutes': 'Phút hiệu quả',
  'income.amount': 'Số tiền',
  'income.settlement': 'Thanh toán',
  'income.estimatedHint': 'Ước tính — con số cuối cùng do máy chủ quyết định sau khi duyệt.',
  'income.empty': 'Chưa có thu nhập nào.',
  'settlement.pending_review': 'Chờ duyệt',
  'settlement.pending_settlement': 'Chờ thanh toán',
  'settlement.bill_generated': 'Đã lập bảng kê',
  'settlement.manually_paid': 'Đã trả thủ công',
  'settlement.exception': 'Có vấn đề, đang xử lý',
};

export type MessageKey = keyof typeof vi;

const en: Record<MessageKey, string> = {
  'app.name': 'Player One',

  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.loading': 'Loading…',
  'common.language': 'Tiếng Việt',
  'common.retry': 'Try again',
  'common.loadFailed': 'Could not load this. Check the connection and try again.',
  'common.actionFailed': 'That did not go through. Please try again.',

  'register.title': 'Register',
  'register.intro': 'Create a collector account to claim tasks and be paid per effective minute.',
  'register.name': 'Full name',
  'register.phone': 'Phone number',
  'register.submit': 'Create account',
  'register.missing': 'Enter both your full name and phone number.',

  'agreements.title': 'The six agreements',
  'agreements.intro':
    'Registration completes only when you accept all six agreements. Each acceptance is recorded with its version and a timestamp.',
  'agreements.version': 'Version',
  'agreements.submit': 'Accept all six',
  'agreements.incomplete': 'All six agreements must be accepted.',
  'agreement.user': 'User Agreement',
  'agreement.privacy': 'Privacy Agreement',
  'agreement.data_collection': 'Data Collection Authorisation',
  'agreement.commercial_use': 'Data Commercial Use Authorisation',
  'agreement.manual_review': 'Manual Review Description',
  'agreement.offline_settlement': 'Offline Manual Settlement Description',

  'training.title': 'Training',
  'training.body':
    'Training content is supplied by PaXini and localised by VNG: wearing the device, offline collection and TF cards, Wi-Fi and hotspot switching, the upload queue, background permissions, battery and storage, not interrupting real work to upload, scenario authorisation and bystanders, exception reporting.',
  'training.placeholder': 'Shell only — the real content replaces this when PaXini delivers it.',
  'training.done': 'Complete training',

  'exam.title': 'Exam',
  'exam.intro': 'No exam pass, no task claiming. The server checks this too.',
  'exam.q1': 'I understand how to wear the device and record correctly.',
  'exam.q2': 'I will ask permission before filming other people or private places.',
  'exam.q3': 'I understand that data is uploaded only when I confirm it myself.',
  'exam.submit': 'Submit',
  'exam.passed': 'Passed. You can now claim tasks.',
  'exam.failed': 'Not passed. Review the training and try again.',

  'home.tasks': 'Task hall',
  'home.myTasks': 'My tasks',
  'home.devices': 'My devices',
  'home.session': 'Create collection session',
  'home.uploads': 'Uploads',
  'home.income': 'Income',
  'home.training': 'Training & exam',
  'home.gateExam': 'Exam not passed yet — tasks cannot be claimed.',
  'home.gateDevice': 'No device bound yet — a collection session cannot be created.',

  'hall.title': 'Task hall',
  'hall.perMinute': 'VND/effective minute',
  'hall.progress': 'Progress',
  'hall.slots': 'Claimants',
  'hall.full': 'At capacity',
  'hall.open': 'Claimable',

  'scenario.home': 'At home',
  'scenario.office': 'Office',
  'scenario.shop': 'Shop',
  'scenario.warehouse': 'Warehouse',

  'detail.title': 'Task detail',
  'detail.instructions': 'Instructions',
  'detail.privacy': 'Privacy notice',
  'detail.payment': 'Payment rule',
  'detail.target': 'Target',
  'detail.minutes': 'minutes',
  'detail.claim': 'Claim task',
  'detail.claimed': 'Already claimed',
  'detail.needExam': 'Pass the exam before claiming a task.',
  'detail.full': 'This task is at claimant capacity.',
  'detail.claiming': 'Claiming…',
  'detail.needAgreements': 'Accept all six agreements before claiming a task.',
  'detail.needTraining': 'Finish the training before claiming a task.',

  'mine.title': 'My tasks',
  'mine.empty': 'No tasks claimed yet.',
  'mine.claimedAt': 'Claimed at',

  'devices.title': 'My devices',
  'devices.empty': 'No device bound yet.',
  'devices.serial': 'Serial number',
  'devices.scanQr': 'Scan QR code',
  'devices.qrMock': 'Mock scanner — returns a sample serial.',
  'devices.typed': 'Or type the serial printed on the device',
  'devices.bind': 'Bind device',
  'devices.boundAt': 'Bound at',
  'devices.provision': 'Configure Wi-Fi over Bluetooth',

  'prov.title': 'Device setup',
  'prov.hint':
    'The phone sends your Wi-Fi to the device over Bluetooth; the device answers with the IP address used to pull data.',
  'prov.scan': 'Scan for devices',
  'prov.connect': 'Connect',
  'prov.connected': 'Connected',
  'prov.ssid': 'Wi-Fi name (SSID)',
  'prov.password': 'Wi-Fi password',
  'prov.send': 'Send Wi-Fi configuration',
  'prov.sent': 'Configuration sent',
  'prov.readIp': 'Read IP address',
  'prov.ip': 'Device IP address',
  'prov.failed': 'Could not read an IP',
  'prov.rssi': 'RSSI',

  'session.title': 'Create collection session',
  'session.intro': 'A session binds task + collector + device + scenario, before recording.',
  'session.task': 'Task',
  'session.device': 'Device',
  'session.scenario': 'Scenario',
  'session.declare': 'Two declarations, required before recording:',
  'session.othersTitle': 'Might other people appear in frame?',
  'session.sensitiveTitle': 'Might sensitive information appear?',
  'session.yes': 'Yes',
  'session.no': 'No',
  'session.needClaim': 'Claim a task first.',
  'session.needDevice': 'Bind a device first.',
  'session.needDeclarations': 'Answer both declarations.',
  'session.create': 'Create session',
  'session.created': 'Session created',
  'session.id': 'Session ID',
  'session.noRecord':
    'The app never starts or stops recording. The record control is on the device, in your hands.',

  'uploads.title': 'Uploads',
  'uploads.size': 'Size',
  'uploads.upload': 'Upload',
  'uploads.confirmTitle': 'Confirm upload?',
  'uploads.confirmBody':
    'Data leaves your phone only when you confirm it. Never automatically, never silently.',
  'uploads.reason': 'Reason',
  'uploads.empty': 'No episodes yet.',

  'state.pending_upload': 'Pending upload',
  'state.uploading': 'Uploading',
  'state.uploaded': 'Uploaded',
  'state.under_review': 'Under review',
  'state.review_passed': 'Review passed',
  'state.review_failed': 'Review failed',

  'income.title': 'Income',
  'income.estimated': 'Estimated',
  'income.confirmed': 'Confirmed',
  'income.minutes': 'Effective minutes',
  'income.amount': 'Amount',
  'income.settlement': 'Settlement',
  'income.estimatedHint': 'An estimate — the final figure is the server’s, after review.',
  'income.empty': 'No income yet.',
  'settlement.pending_review': 'Awaiting review',
  'settlement.pending_settlement': 'Awaiting settlement',
  'settlement.bill_generated': 'On a bill',
  'settlement.manually_paid': 'Paid manually',
  'settlement.exception': 'Held — being looked at',
};

export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { vi, en };

/** Every locale holds every key. Asserted by a test, not hoped for. */
export function missingKeys(locale: Locale): MessageKey[] {
  const keys = Object.keys(vi) as MessageKey[];
  return keys.filter((k) => {
    const value = MESSAGES[locale][k];
    return typeof value !== 'string' || value.trim() === '';
  });
}

export const t = (locale: Locale, key: MessageKey): string => MESSAGES[locale][key];
