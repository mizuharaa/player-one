/**
 * Every string the mock renders, keyed by its `i18n.ts` key.
 *
 * THIS IS THE ONLY PLACE VIETNAMESE COPY LIVES IN THE MOCK. `index.html`
 * carries no user-facing words at all — it carries `data-t="<key>"` and the
 * fill pass writes the text in. So a copy rewrite changes this file and
 * nothing re-lays-out.
 *
 * Two kinds of entry, and the distinction is load-bearing:
 *
 *   EXISTING — the value is byte-equal to `apps/collector/src/i18n.ts`'s `vi`
 *              catalogue. Do not edit it here; edit i18n.ts and copy across.
 *   NEW      — the key does not exist yet. Every one of these is listed in
 *              SPEC.md with its vi/en/zh values, and SPEC.md is the source.
 *
 * `NEW` entries are marked. A string in the mock that is in neither state is
 * a bug: it means a screen is showing words no catalogue will ever have.
 */
export const NEW = new Set([
  'splash.caption', 'splash.partners',
  'signIn.sentTo', 'signIn.resendIn', 'signIn.checking',
  'register.phoneVerified', 'register.phoneLocked',
  'home.cycleTitle', 'home.cycleUnavailable', 'home.cycleWithEstimate',
  'home.nextTitle', 'home.nextUpload',
  'guide.home.earnings',
  'hall.imageLabel',
  'payout.title', 'payout.zalopay', 'payout.verified', 'payout.awaiting',
  'payout.none', 'payout.unknown',
  'uploads.waitingReviewer',
  'home.uploadedCaption', 'profile.language',
  'states.loading', 'states.empty', 'states.error',
]);

export const vi = {
  // ---- existing: common ------------------------------------------------
  'common.back': 'Quay lại',
  'common.retry': 'Thử lại',
  'common.next': 'Tiếp tục',
  'common.saving': 'Đang gửi…',
  'common.language': 'English',
  'common.loadFailed': 'Không tải được. Kiểm tra mạng rồi thử lại.',
  'common.refreshFailed': 'Chưa cập nhật được. Đây vẫn là dữ liệu lần trước. Thử lại.',
  'common.actionFailed': 'Thao tác chưa xong. Thử lại.',

  // ---- existing: the bar -----------------------------------------------
  // tab.home's vi value changes from 'Trang chính' — it wraps at 360dp.
  'tab.home': 'Trang chủ',
  'tab.tasks': 'Nhiệm vụ',
  'tab.session': 'Phiên',
  'tab.uploads': 'Tải lên',
  'tab.income': 'Thu nhập',

  // ---- existing: welcome -----------------------------------------------
  'landing.slogan1': 'Đeo camera.',
  'landing.slogan2': 'Sống như mọi ngày.',
  'landing.slogan3': 'Phút nào được duyệt, phút đó có tiền.',
  'landing.signIn': 'Đăng nhập',
  'landing.register': 'Đăng ký tại quầy',
  'landing.registerNote': 'Quầy hỗ trợ sẽ mở tài khoản cho bạn. Đăng nhập bằng số điện thoại bạn đã đưa ở quầy.',
  'legal.privacy': 'Chính sách quyền riêng tư',
  'legal.dataNotice': 'Thông báo thu thập dữ liệu',

  // ---- existing: sign-in -----------------------------------------------
  'signIn.title': 'Đăng nhập',
  'signIn.intro': 'Nhập số điện thoại. Mã dùng một lần sẽ gửi qua Zalo. Không cần mật khẩu.',
  'signIn.phone': 'Số điện thoại',
  'signIn.sendCode': 'Gửi mã',
  'signIn.code': 'Mã dùng một lần',
  'signIn.resendCode': 'Gửi lại mã',
  'signIn.codeSent': 'Nếu số này đã đăng ký, mã sẽ tới Zalo trong ít phút. Mở Zalo để xem mã.',
  'signIn.countryCode': 'Mã quốc gia',
  'signIn.chinaNote': 'Zalo chỉ gửi mã tới số Việt Nam. Số +86 chưa nhận được mã. Hãy tới điểm hỗ trợ để đăng nhập.',
  'signIn.signOut': 'Đăng xuất / đổi tài khoản',

  // ---- existing: register / agreements ---------------------------------
  'register.title': 'Đăng ký',
  'register.intro': 'Mở tài khoản người thu thập để nhận nhiệm vụ và nhận tiền theo phút hiệu quả.',
  'register.name': 'Họ và tên',
  'register.phone': 'Số điện thoại',
  'register.submit': 'Tạo tài khoản',
  'agreements.title': 'Sáu thỏa thuận',
  'agreements.intro': 'Đăng ký chỉ xong khi bạn đồng ý cả sáu thỏa thuận. Mỗi lần đồng ý đều lưu kèm phiên bản và thời điểm.',
  'agreements.version': 'Phiên bản',
  'agreements.submit': 'Đồng ý cả sáu',
  'agreements.incomplete': 'Bạn cần đồng ý cả sáu thỏa thuận.',
  'agreement.user': 'Thỏa thuận người dùng',
  'agreement.privacy': 'Thỏa thuận quyền riêng tư',
  'agreement.data_collection': 'Ủy quyền thu thập dữ liệu',
  'agreement.commercial_use': 'Ủy quyền sử dụng dữ liệu thương mại',
  'agreement.manual_review': 'Mô tả quy trình duyệt thủ công',
  'agreement.offline_settlement': 'Mô tả thanh toán thủ công ngoại tuyến',

  // ---- existing: training / exam ---------------------------------------
  'training.title': 'Đào tạo',
  'training.body': 'PaXini soạn nội dung đào tạo, VNG dịch sang tiếng Việt: cách đeo thiết bị, ghi hình khi không có mạng và thẻ nhớ TF, đổi Wi-Fi và phát sóng từ điện thoại, hàng đợi tải lên, quyền chạy nền, pin và bộ nhớ, không để việc tải lên làm gián đoạn công việc thật, xin phép về bối cảnh và người xung quanh, báo sự cố.',
  'training.placeholder': 'Đây là phần khung. Nội dung thật sẽ thay khi PaXini bàn giao.',
  'training.done': 'Hoàn thành đào tạo',
  'exam.title': 'Bài kiểm tra',
  'exam.intro': 'Đạt bài kiểm tra rồi bạn mới nhận được nhiệm vụ.',
  'exam.q1': 'Tôi đã hiểu cách đeo thiết bị và ghi hình đúng.',
  'exam.q2': 'Tôi sẽ xin phép trước khi ghi hình người khác hoặc địa điểm riêng.',
  'exam.q3': 'Tôi hiểu là dữ liệu chỉ tải lên khi tôi bấm xác nhận.',
  'exam.submit': 'Nộp bài',
  'exam.passed': 'Đạt rồi. Bạn có thể nhận nhiệm vụ.',

  // ---- existing: home --------------------------------------------------
  'greeting.earlyBird': 'Chào buổi sớm',
  'shift.earlyBird': 'Ca sớm',
  'home.claimable': 'Việc có thể nhận',
  'home.claimableEmpty': 'Chưa có nhiệm vụ nào đang mở.',
  'home.more': 'Các mục khác',
  'home.incomeLink': 'Thu nhập theo từng tập',
  'home.reviewedCaption': 'tập đã duyệt',
  'home.myTasks': 'Nhiệm vụ của tôi',
  'home.devices': 'Thiết bị của tôi',
  'home.training': 'Đào tạo & kiểm tra',
  'guide.open': 'Hướng dẫn nhanh',
  'guide.step': 'Bước',
  'guide.offerNo': 'Để sau',
  'forum.title': 'Diễn đàn',
  'groups.title': 'Nhóm chat',

  // ---- existing: hall / detail -----------------------------------------
  'hall.title': 'Sảnh nhiệm vụ',
  'hall.search': 'Tìm nhiệm vụ hoặc địa điểm',
  'hall.all': 'Tất cả',
  'hall.availableOnly': 'Có thể nhận',
  'hall.perMinute': 'đ/phút hiệu quả',
  'hall.pricePerMinute': 'Giá mỗi phút hiệu quả đã duyệt',
  'hall.progress': 'Tiến độ',
  'hall.slots': 'Người nhận',
  'hall.full': 'Đã đủ người',
  'scenario.home': 'Ở nhà',
  'scenario.office': 'Văn phòng',
  'scenario.shop': 'Cửa hàng',
  'scenario.warehouse': 'Kho hàng',
  'detail.instructions': 'Hướng dẫn',
  'detail.privacy': 'Lưu ý quyền riêng tư',
  'detail.payment': 'Quy tắc thanh toán',
  'detail.target': 'Mục tiêu',
  'detail.minutes': 'phút',
  'detail.claim': 'Nhận nhiệm vụ',

  // ---- existing: uploads -----------------------------------------------
  'uploads.title': 'Tải lên',
  'uploads.size': 'Dung lượng',
  'uploads.upload': 'Tải lên',
  'uploads.reason': 'Lý do',
  'uploads.session': 'Phiên',
  'uploads.sending': 'Đang gửi tệp',
  'state.pending_upload': 'Chờ tải lên',
  'state.uploading': 'Đang tải lên',
  'state.under_review': 'Đang duyệt',
  'state.review_passed': 'Duyệt đạt',
  'state.uploaded': 'Đã tải lên',
  'state.review_failed': 'Duyệt không đạt',

  // ---- existing: income ------------------------------------------------
  'income.title': 'Thu nhập',
  'income.estimated': 'Ước tính',
  'income.confirmed': 'Đã xác nhận',
  'income.minutes': 'Phút hiệu quả',
  'income.settlement': 'Thanh toán',
  'income.estimatedHint': 'Đây là ước tính. Số tiền cuối cùng chốt sau khi duyệt.',
  'income.intro': 'Tiền tính theo từng tập. Ứng dụng không cộng gộp, không tự tính.',
  'income.empty': 'Chưa có khoản thu nhập nào.',
  'settlement.on_a_bill': 'Đã lên hóa đơn',
  'settlement.paid': 'Đã chi trả',
  'settlement.pending_review': 'Chờ duyệt',
  'settlement.uploaded': 'Đã tải lên, chờ duyệt',

  // ---- existing: devices -----------------------------------------------
  'devices.title': 'Thiết bị của tôi',
  'devices.status': 'Trạng thái',
  'devices.active': 'Hoạt động',
  'devices.serial': 'Số sê-ri',
  'devices.scanQr': 'Quét mã QR',
  'devices.qrMock': 'Máy quét giả lập. Trả về một số sê-ri mẫu.',
  'devices.typed': 'Số sê-ri in trên thiết bị',
  'devices.bind': 'Liên kết thiết bị',
  'devices.boundAt': 'Liên kết lúc',
  'devices.provision': 'Cài Wi-Fi qua Bluetooth',
  'devices.unavailable': 'Bản này chưa có Bluetooth và quét QR. Nhập số sê-ri để liên kết thiết bị.',

  // ---- NEW: listed in SPEC.md with vi/en/zh ----------------------------
  // Provisional wording. A native-speaker copy pass owns these; the keys and
  // the layout do not move when the words change.
  'splash.caption': 'Thu thập dữ liệu đời thường',
  'splash.partners': 'VNG × PaXini',
  'signIn.sentTo': 'Đã gửi mã tới {phone}',
  'signIn.resendIn': 'Gửi lại sau {s} giây',
  'signIn.checking': 'Đang kiểm tra mã…',
  'register.phoneVerified': 'đã xác minh',
  'register.phoneLocked': 'Số này đã xác minh ở bước trước, không sửa ở đây được.',
  'home.cycleTitle': 'Thu nhập kỳ này',
  // S19: was "Máy chủ chưa gửi tổng của kỳ" — the server's plumbing is not
  // the collector's business. This speaks to the person about their money.
  'home.cycleUnavailable': 'Chưa có tổng của kỳ này. Bạn vẫn xem được tiền từng tập ở mục Thu nhập.',
  'home.cycleWithEstimate': 'Tính cả ước tính: {amount}',
  'home.nextTitle': 'Bước tiếp theo',
  'home.nextUpload': 'Có {n} tập chờ tải lên',
  // S19: was "Con số này là của máy chủ… Ứng dụng không tự cộng."
  'guide.home.earnings': 'Đây là tiền của các tập đã duyệt trong kỳ này. Người duyệt quyết định con số, không phải ứng dụng.',
  'hall.imageLabel': 'Ảnh minh họa bối cảnh',
  'payout.title': 'Nơi nhận tiền',
  'payout.zalopay': 'Ví ZaloPay',
  'payout.verified': 'Đã xác minh',
  'payout.awaiting': 'Chờ xác minh',
  'payout.none': 'Chưa khai báo. Hỏi điểm hỗ trợ.',
  // S19: was "Máy chủ chưa gửi trạng thái nhận tiền."
  'payout.unknown': 'Chưa rõ bạn nhận tiền ở đâu. Điểm hỗ trợ sẽ cài giúp bạn.',
  'uploads.waitingReviewer': 'Đang chờ người duyệt',
  'home.uploadedCaption': 'tập đã tải lên',
  'profile.language': 'Ngôn ngữ',
  // Artboard headings for the states gallery. Not shipped copy — they label
  // the mock for the owner and are marked NEW so they cannot be mistaken
  // for strings the app renders.
  'states.loading': 'ĐANG TẢI — khung xương, không phải vòng xoay',
  'states.empty': 'TRỐNG',
  'states.error': 'LỖI — ba loại, không thay thế cho nhau',
};

/** Data, not copy: task titles and ids come from the server in every locale. */
export const DATA = {
  name: 'Nguyễn Văn A',
  phone: '+84 90 000 0001',
  tasks: [
    { title: 'Nấu ăn tại nhà', price: '4.500', scenario: 'home', img: 'setting-kitchen.jpg', pct: 64, slots: 2 },
    { title: 'Một buổi làm việc', price: '3.800', scenario: 'office', img: 'setting-workspace.webp', pct: 30, slots: 3 },
    { title: 'Đi chợ buổi sáng', price: '5.200', scenario: 'shop', img: 'setting-terraces.webp', pct: 88, slots: 1 },
    { title: 'Ca kho hàng', price: '6.000', scenario: 'warehouse', img: 'setting-warehouse.webp', pct: 100, slots: 0 },
  ],
};
