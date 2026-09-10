/**
 * APP-03 / LOC-03. Supplied source: PXCap Ego Usage Guidelines.pdf, pp. 1–3,
 * C:/Users/user/Downloads/PXCap Ego Usage Guidelines.pdf
 * Extract: C:/Users/user/OneDrive/Documents/player-one/.claude/workflows/reliability-20260909/pxcap-guidelines.txt
 * Each item cites the source section below. Physical buttons and Path C handover
 * follow CLAUDE.md and Engineering Brief APP-16/17b. Source §4.3 does NOT grant
 * permission to clear a TF card: PlayerOne preserves all source media (ADR 0001).
 * This is reading material, never device telemetry or another consent record.
 */
// Keep the supplied Chinese guide without pretending the whole app supports it.
type Translation = Record<'vi' | 'en' | 'zh', string>;
const tr = (vi: string, en: string, zh: string): Translation => ({ vi, en, zh });

export const HEADSET_COPY = {
  shiftTitle: tr('Trước mỗi ca ghi hình', 'Before each recording shift', '每次采集前'),
  intro: tr(
    'Đọc hướng dẫn sử dụng thiết bị trước khi làm bài kiểm tra và nhận nhiệm vụ. Nội dung nhiệm vụ nằm trong phần chi tiết nhiệm vụ; hướng dẫn này không thay thế nội dung đó.',
    'Read the device guidance before the exam and claiming tasks. Task instructions are in the task details; this guide does not replace them.',
    '请在考试和领取任务前阅读设备指南。具体任务要求见任务详情；本指南不能替代任务要求。'),
  external: tr(
    'Tự kiểm tra thiết bị và nhờ nhân viên vận hành kiểm tra trên phần mềm máy chủ bên ngoài ứng dụng này. Ứng dụng không hiển thị hình trực tiếp, đồng bộ giờ, đo pin, dung lượng trống hay xác nhận đang ghi. Nếu chưa kiểm tra được, nhờ nhân viên vận hành hỗ trợ trước khi ghi.',
    'Check the device yourself and ask the operator to check the external host software. This app does not show live preview, synchronize time, measure battery or free storage, or confirm recording status. If a check is unavailable, ask the operator for help before recording.',
    '请自行检查设备，并请工作人员使用本应用以外的主机软件检查。本应用不提供实时预览、时间同步、电量或剩余空间检测，也不能确认录制状态。无法完成检查时，请先联系工作人员再录制。'),
  shiftIntro: tr(
    'Xem lại hướng dẫn và thực hiện các kiểm tra bên ngoài ứng dụng trước mỗi ca. Nút bên dưới chỉ mở biểu mẫu chuẩn bị phiên; không ghi nhận kết quả kiểm tra và không bật camera.',
    'Review the guidance and perform the external checks before each shift. The button below only opens session preparation; it does not record check results or turn on the camera.',
    '每次采集前请复习指南并在应用外完成检查。下方按钮仅打开采集准备表单，不记录检查结果，也不会开启摄像头。'),
  continue: tr('Tiếp tục chuẩn bị phiên', 'Continue to session preparation', '继续准备采集'),
  source: tr('Nguồn: PXCap Ego Usage Guidelines, trang 1–3.', 'Source: PXCap Ego Usage Guidelines, pages 1–3.', '来源：PXCap Ego Usage Guidelines，第 1–3 页。'),
};

export const HEADSET_GUIDANCE = [
  {
    id: 'fit', title: tr('Đeo thiết bị và kiểm tra trước ca', 'Fit and pre-shift checks', '佩戴与采集前检查'),
    items: [
      { id: 'mount', source: '§1.1, p1', text: tr(
        'Kiểm tra vòng đeo, dây và đệm còn nguyên vẹn. Đeo chắc, lắc đầu vài lần để kiểm tra thiết bị không xê dịch; hướng camera chính gần song song với hướng nhìn.',
        'Check that the headband, straps and padding are intact. Fit firmly and shake your head a few times to check for movement; align the main camera roughly with your line of sight.',
        '检查头带、绑带和衬垫完好。佩戴稳固，轻摇头数次确认不移位；主摄像头方向应大致平行于视线。') },
      { id: 'lens', source: '§1.1, p1', text: tr(
        'Làm sạch ống kính; kiểm tra không có dấu vân tay, dầu bẩn hay vết xước.',
        'Clean the lens; check for fingerprints, oil and scratches.',
        '清洁镜头，检查是否有指纹、油污或划痕。') },
      { id: 'power', source: '§1.2, p1', text: tr(
        'Kiểm tra pin và dung lượng trống đủ cho nhiệm vụ trên thiết bị hoặc với nhân viên vận hành. Ghi thử một đoạn ngắn để xác nhận dữ liệu được ghi đúng.',
        'Check on the device or with the operator that battery and free storage are sufficient for the task. Make a short test recording to confirm data is captured correctly.',
        '在设备上或由工作人员确认电量和剩余空间足够完成任务。先录制一小段测试视频，确认数据采集正常。') },
      { id: 'preview', source: '§1.3, p1', text: tr(
        'Nhờ nhân viên vận hành kết nối và đồng bộ giờ với phần mềm máy chủ. Trên phần mềm đó, kiểm tra hình trực tiếp không đen, lỗi hay lệch màu; phơi sáng và cân bằng trắng bình thường; vùng thao tác nằm giữa khung hình.',
        'Ask the operator to connect and synchronize time with the host software. There, check that live preview has no black or corrupted image or color cast, exposure and white balance are normal, and the work area is centered.',
        '请工作人员连接主机软件并同步时间。在该软件中确认预览无黑屏、花屏或偏色，曝光和白平衡正常，主要操作区域位于画面中央。') },
    ],
  },
  {
    id: 'environment', title: tr('Không gian ghi hình và an toàn', 'Recording environment and safety', '采集环境与安全'),
    items: [
      { id: 'light', source: '§1.4, p1', text: tr(
        'Tránh ngược sáng mạnh, đèn nhấp nháy và nơi quá tối. Kiểm tra địa điểm đáp ứng yêu cầu về quyền riêng tư.',
        'Avoid strong backlighting, flickering lights and very dark conditions. Check that the site meets privacy requirements.',
        '避免强逆光、闪烁光源和过暗环境。确认采集场所符合隐私要求。') },
      { id: 'privacy', source: '§5.1, p3', text: tr(
        'Không ghi dữ liệu sinh trắc học của người khác, giấy tờ tùy thân hay mật khẩu không liên quan đến nhiệm vụ. Nếu không tránh được, liên hệ nhân viên vận hành để làm theo quy trình ẩn danh và tuân thủ.',
        'Do not capture other people’s biometric data, ID documents or passwords unrelated to the task. If unavoidable, contact the operator to follow the anonymization and compliance process.',
        '不得采集与任务无关的他人生物特征、身份证件或密码。如无法避免，请联系工作人员，按匿名化和合规流程处理。') },
      { id: 'discomfort', source: '§5.3, p3', text: tr(
        'Dừng ghi ngay bằng nút trên thiết bị nếu chóng mặt, đau đầu hoặc khó chịu.',
        'Stop recording immediately with the device button if you feel dizzy, have a headache or feel unwell.',
        '如出现头晕、头痛或其他不适，立即用设备按键停止录制。') },
    ],
  },
  {
    id: 'record', title: tr('Bắt đầu, thao tác và kết thúc', 'Start, perform and finish', '开始、操作与结束'),
    items: [
      { id: 'sequence', source: '§2.1, p1; §2.5, p2; CLAUDE.md physical buttons', text: tr(
        'Dùng nút vật lý trên camera để bắt đầu và dừng ghi. Xác nhận thiết bị thực sự đang ghi trước khi làm nhiệm vụ. Một lần ghi cần bao trọn nhiệm vụ. Trình tự khuyến nghị: giữ yên 3 giây → làm nhiệm vụ → giữ yên 3 giây. Kết thúc thao tác trước, rồi mới dừng ghi bằng nút trên camera.',
        'Use the physical camera buttons to start and stop recording. Confirm recording has actually started before task actions. One recording should cover the complete task. Recommended pattern: hold still for 3 seconds → perform the task → hold still for 3 seconds. Finish the actions first, then stop recording with the camera button.',
        '使用摄像头实体按键开始和停止录制。确认已开始录制后再操作。一次录制应涵盖完整任务。建议流程：静止 3 秒 → 执行任务 → 静止 3 秒。先结束动作，再用摄像头按键停止录制。') },
      { id: 'posture', source: '§2.2–3, pp1–2', text: tr(
        'Giữ chuyển động đầu tự nhiên; tránh quay đầu nhanh, gật mạnh hoặc nhìn lên/xuống quá lâu. Giữ tay và các thao tác chính trong khung hình camera chính; tránh để tay che ống kính thường xuyên.',
        'Move your head naturally; avoid rapid turns, vigorous nodding or looking up/down for too long. Keep hands and key operations in the main camera’s field of view; avoid repeatedly covering the lens with your hands.',
        '头部自然移动，避免快速转头、剧烈点头或长时间低头、仰头。双手和关键操作应在主摄像头视野内，避免双手频繁遮挡镜头。') },
      { id: 'natural', source: '§2.4, p2', text: tr(
        'Thực hiện tự nhiên theo hướng dẫn nhiệm vụ, không tăng tốc hoặc diễn. Nếu làm sai, thực hiện lại nhiệm vụ. Không cắt sửa hay ghép dữ liệu; giữ nguyên cả đoạn đã ghi.',
        'Follow the task instructions naturally, without speeding up or acting. If you make a mistake, restart the task. Do not edit or stitch data; retain the original recording too.',
        '按任务要求自然操作，不加速、不表演。操作失误时重新执行任务。不得剪辑或拼接数据，原始录像也须保留。') },
    ],
  },
  {
    id: 'monitor', title: tr('Trong ca: kiểm tra mỗi 30 phút', 'During the shift: check every 30 minutes', '采集中：每 30 分钟检查'),
    items: [
      { id: 'periodic', source: '§2.6, p2', text: tr(
        'Mỗi 30 phút, tự kiểm tra pin, dung lượng trống và trạng thái ghi trên thiết bị hoặc với nhân viên vận hành. Nếu có bất thường, dừng ghi ngay bằng nút vật lý và ghi lại sự cố. Ứng dụng không tự theo dõi hay hẹn giờ nhắc các kiểm tra này.',
        'Every 30 minutes, check battery, free storage and recording status on the device or with the operator. Stop recording immediately with the physical button and log any anomaly. This app does not monitor or schedule these checks.',
        '每 30 分钟在设备上或由工作人员检查电量、剩余空间和录制状态。发现异常立即用实体按键停止录制并记录。本应用不会自动监控或定时提醒这些检查。') },
    ],
  },
  {
    id: 'faults', title: tr('Khi thiết bị gặp sự cố', 'If the device has a fault', '设备故障处理'),
    items: [
      { id: 'heat', source: '§4.1, p2', text: tr(
        'Quá nóng: dừng ghi bằng nút vật lý, để thiết bị nguội rồi mới dùng lại; ghi nhiệt độ môi trường và báo nhân viên vận hành.',
        'Overheating: stop with the physical button and let the device cool before reuse; log the ambient temperature and tell the operator.',
        '过热：用实体按键停止录制，冷却后再使用；记录环境温度并告知工作人员。') },
      { id: 'crash', source: '§4.2, p2', text: tr(
        'Treo máy hoặc gián đoạn ghi: khởi động lại thiết bị và nhờ nhân viên vận hành kiểm tra firmware. Giữ nguyên dữ liệu gốc để đội kỹ thuật điều tra.',
        'Crash or recording interruption: restart the device and ask the operator to check firmware. Preserve the original footage for the technical team to investigate.',
        '死机或录制中断：重启设备，请工作人员检查固件。保留原始录像供技术团队排查。') },
      { id: 'storage', source: '§4.3, p2; ADR 0001 retention', text: tr(
        'Không đủ dung lượng: dừng ghi bằng nút vật lý và liên hệ nhân viên vận hành để sao lưu, xác minh dữ liệu. Giữ nguyên thẻ và tệp gốc; không xóa tệp hay dọn thẻ.',
        'Insufficient storage: stop with the physical button and contact the operator for backup and verification. Preserve the card and original files; do not delete files or clear the card.',
        '空间不足：用实体按键停止录制，联系工作人员备份并核验数据。保留存储卡和原始文件，不删除文件、不清空卡。') },
      { id: 'sync', source: '§4.4, p3', text: tr(
        'Lỗi kết nối hoặc đồng bộ giờ: dừng ghi, khởi động lại và ghép nối lại với nhân viên vận hành. Dữ liệu trong thời gian bị lỗi không sử dụng được; vẫn giữ nguyên và báo rõ khoảng thời gian lỗi.',
        'Connection or time-sync fault: stop recording, restart and re-pair with the operator. Data from the affected period is unusable; still preserve it and report the affected time interval.',
        '连接或时间同步异常：停止录制，与工作人员一起重启并重新配对。异常期间的数据不可用，但仍须保留并报告异常时段。') },
    ],
  },
  {
    id: 'preserve', title: tr('Sau ca: bàn giao và giữ nguyên tệp', 'After the shift: hand over and preserve files', '采集后：交接并保留原始文件'),
    items: [
      { id: 'handover', source: '§3.1–2, p2; CLAUDE.md Path C', text: tr(
        'Bàn giao thẻ tại điểm tải lên có nhân viên. Nhờ nhân viên vận hành chuyển đầy đủ tệp vào máy chủ và xác minh kích thước tệp. Không đổi tên, chỉnh sửa, cắt ghép hoặc xóa tệp gốc; giữ nguyên thẻ nguồn.',
        'Hand the card to a staffed upload centre. Ask the operator to transfer all files to the host and verify file sizes. Do not rename, alter, edit, stitch or delete original files; preserve the source card.',
        '将存储卡交到有工作人员的上传中心。请工作人员完整传输文件到主机并核验文件大小。不得重命名、修改、剪辑、拼接或删除原始文件；保留源卡。') },
      { id: 'confidential', source: '§3.1, p2; §5.2, p3', text: tr(
        'Bảo quản dữ liệu theo yêu cầu bảo mật. Không sao chép, chia sẻ hoặc tải lên đám mây cá nhân khi chưa được phép.',
        'Handle data according to confidentiality requirements. Do not copy, share or upload it to personal cloud storage without authorization.',
        '按保密要求保管数据。未经授权，不得复制、分享或上传至个人云盘。') },
      { id: 'putAway', source: '§3.3, p2', text: tr(
        'Làm sạch ống kính, cất thiết bị đúng chỗ và ghi lại mọi bất thường để nhân viên vận hành lập nhật ký hoặc phiếu sửa chữa.',
        'Clean the lens, return the device to storage and record any anomalies for the operator’s log or repair ticket.',
        '清洁镜头，将设备归位，并记录异常，交由工作人员登记日志或维修单。') },
    ],
  },
] as const;
