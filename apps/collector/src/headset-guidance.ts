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
    'Đọc hướng dẫn sử dụng thiết bị trước khi làm bài kiểm tra và nhận nhiệm vụ. Bạn vẫn cần đọc hướng dẫn riêng trong phần chi tiết của từng nhiệm vụ.',
    'Read the device guidance before the exam and claiming tasks. Task instructions are in the task details; this guide does not replace them.',
    '请在考试和领取任务前阅读设备指南。具体任务要求见任务详情；本指南不能替代任务要求。'),
  external: tr(
    'Bạn cần tự kiểm tra thiết bị và nhờ nhân viên vận hành kiểm tra thêm bằng phần mềm trên máy tính. Ứng dụng này không có hình xem trực tiếp, không đồng bộ giờ, không đọc được pin, dung lượng trống hay trạng thái ghi hình của camera. Nếu chưa kiểm tra được, hãy nhờ nhân viên hỗ trợ trước khi ghi.',
    'Check the device yourself and ask the operator to check the external host software. This app does not show live preview, synchronize time, measure battery or free storage, or confirm recording status. If a check is unavailable, ask the operator for help before recording.',
    '请自行检查设备，并请工作人员使用本应用以外的主机软件检查。本应用不提供实时预览、时间同步、电量或剩余空间检测，也不能确认录制状态。无法完成检查时，请先联系工作人员再录制。'),
  shiftIntro: tr(
    'Trước mỗi ca, hãy xem lại hướng dẫn và kiểm tra thiết bị bên ngoài ứng dụng. Nút bên dưới chỉ mở phần chuẩn bị phiên ghi hình, không lưu kết quả kiểm tra và không bật camera.',
    'Review the guidance and perform the external checks before each shift. The button below only opens session preparation; it does not record check results or turn on the camera.',
    '每次采集前请复习指南并在应用外完成检查。下方按钮仅打开采集准备表单，不记录检查结果，也不会开启摄像头。'),
  continue: tr('Tiếp tục chuẩn bị', 'Continue to session preparation', '继续准备采集'),
  source: tr('Nguồn: PXCap Ego Usage Guidelines, trang 1–3.', 'Source: PXCap Ego Usage Guidelines, pages 1–3.', '来源：PXCap Ego Usage Guidelines，第 1–3 页。'),
};

export const HEADSET_GUIDANCE = [
  {
    id: 'fit', title: tr('Đeo thiết bị và kiểm tra trước ca', 'Fit and pre-shift checks', '佩戴与采集前检查'),
    items: [
      { id: 'mount', source: '§1.1, p1', text: tr(
        'Kiểm tra vòng đeo, dây và đệm có bị hỏng không. Đeo chắc chắn rồi lắc đầu vài lần để kiểm tra thiết bị có xê dịch không. Chỉnh camera chính gần song song với hướng nhìn.',
        'Check that the headband, straps and padding are intact. Fit firmly and shake your head a few times to check for movement; align the main camera roughly with your line of sight.',
        '检查头带、绑带和衬垫完好。佩戴稳固，轻摇头数次确认不移位；主摄像头方向应大致平行于视线。') },
      { id: 'lens', source: '§1.1, p1', text: tr(
        'Làm sạch ống kính; kiểm tra không có dấu vân tay, dầu bẩn hay vết xước.',
        'Clean the lens; check for fingerprints, oil and scratches.',
        '清洁镜头，检查是否有指纹、油污或划痕。') },
      { id: 'power', source: '§1.2, p1', text: tr(
        'Kiểm tra trên thiết bị hoặc nhờ nhân viên vận hành xác nhận pin và dung lượng trống đủ cho nhiệm vụ. Ghi thử một đoạn ngắn để kiểm tra thiết bị ghi dữ liệu đúng cách.',
        'Check on the device or with the operator that battery and free storage are sufficient for the task. Make a short test recording to confirm data is captured correctly.',
        '在设备上或由工作人员确认电量和剩余空间足够完成任务。先录制一小段测试视频，确认数据采集正常。') },
      { id: 'preview', source: '§1.3, p1', text: tr(
        'Nhờ nhân viên vận hành kết nối thiết bị và đồng bộ giờ bằng phần mềm trên máy tính. Xem hình trực tiếp trên phần mềm để kiểm tra hình không bị đen, lỗi hoặc lệch màu; độ phơi sáng và cân bằng trắng bình thường; khu vực thao tác nằm giữa khung hình.',
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
        'Không ghi lại dữ liệu sinh trắc học của người khác, giấy tờ tùy thân hoặc mật khẩu không liên quan đến nhiệm vụ. Nếu không thể tránh, hãy liên hệ nhân viên vận hành để xử lý theo quy trình ẩn danh dữ liệu và bảo vệ quyền riêng tư.',
        'Do not capture other people’s biometric data, ID documents or passwords unrelated to the task. If unavoidable, contact the operator to follow the anonymization and compliance process.',
        '不得采集与任务无关的他人生物特征、身份证件或密码。如无法避免，请联系工作人员，按匿名化和合规流程处理。') },
      { id: 'discomfort', source: '§5.3, p3', text: tr(
        'Dừng ghi ngay bằng nút trên thiết bị nếu chóng mặt, đau đầu hoặc khó chịu.',
        'Stop recording immediately with the device button if you feel dizzy, have a headache or feel unwell.',
        '如出现头晕、头痛或其他不适，立即用设备按键停止录制。') },
    ],
  },
  {
    id: 'record', title: tr('Cách ghi hình nhiệm vụ', 'Start, perform and finish', '开始、操作与结束'),
    items: [
      { id: 'sequence', source: '§2.1, p1; §2.5, p2; CLAUDE.md physical buttons', text: tr(
        'Bấm nút trên camera để bắt đầu và dừng ghi hình. Kiểm tra camera đã bắt đầu ghi trước khi làm nhiệm vụ. Mỗi bản ghi cần có đầy đủ quá trình thực hiện nhiệm vụ. Trình tự nên làm: giữ yên 3 giây → thực hiện nhiệm vụ → giữ yên 3 giây. Hoàn tất các thao tác rồi mới bấm nút trên camera để dừng ghi.',
        'Use the physical camera buttons to start and stop recording. Confirm recording has actually started before task actions. One recording should cover the complete task. Recommended pattern: hold still for 3 seconds → perform the task → hold still for 3 seconds. Finish the actions first, then stop recording with the camera button.',
        '使用摄像头实体按键开始和停止录制。确认已开始录制后再操作。一次录制应涵盖完整任务。建议流程：静止 3 秒 → 执行任务 → 静止 3 秒。先结束动作，再用摄像头按键停止录制。') },
      { id: 'posture', source: '§2.2–3, pp1–2', text: tr(
        'Cử động đầu tự nhiên, tránh quay đầu nhanh, gật mạnh hoặc nhìn lên, nhìn xuống quá lâu. Giữ tay và các thao tác chính trong khung hình của camera chính. Tránh để tay che ống kính nhiều lần.',
        'Move your head naturally; avoid rapid turns, vigorous nodding or looking up/down for too long. Keep hands and key operations in the main camera’s field of view; avoid repeatedly covering the lens with your hands.',
        '头部自然移动，避免快速转头、剧烈点头或长时间低头、仰头。双手和关键操作应在主摄像头视野内，避免双手频繁遮挡镜头。') },
      { id: 'natural', source: '§2.4, p2', text: tr(
        'Làm theo hướng dẫn nhiệm vụ với nhịp độ tự nhiên, không cố làm nhanh hay diễn lại cho camera. Nếu thao tác sai, hãy làm lại nhiệm vụ. Giữ nguyên cả bản ghi trước đó, không chỉnh sửa hoặc cắt ghép dữ liệu.',
        'Follow the task instructions naturally, without speeding up or acting. If you make a mistake, restart the task. Do not edit or stitch data; retain the original recording too.',
        '按任务要求自然操作，不加速、不表演。操作失误时重新执行任务。不得剪辑或拼接数据，原始录像也须保留。') },
    ],
  },
  {
    id: 'monitor', title: tr('Trong ca: kiểm tra mỗi 30 phút', 'During the shift: check every 30 minutes', '采集中：每 30 分钟检查'),
    items: [
      { id: 'periodic', source: '§2.6, p2', text: tr(
        'Cứ 30 phút, kiểm tra pin, dung lượng trống và trạng thái ghi hình trên thiết bị hoặc nhờ nhân viên vận hành kiểm tra. Nếu có bất thường, bấm nút trên thiết bị để dừng ghi ngay và ghi lại sự cố. Ứng dụng không tự theo dõi hoặc nhắc bạn thực hiện các kiểm tra này.',
        'Every 30 minutes, check battery, free storage and recording status on the device or with the operator. Stop recording immediately with the physical button and log any anomaly. This app does not monitor or schedule these checks.',
        '每 30 分钟在设备上或由工作人员检查电量、剩余空间和录制状态。发现异常立即用实体按键停止录制并记录。本应用不会自动监控或定时提醒这些检查。') },
    ],
  },
  {
    id: 'faults', title: tr('Khi thiết bị gặp sự cố', 'If the device has a fault', '设备故障处理'),
    items: [
      { id: 'heat', source: '§4.1, p2', text: tr(
        'Nếu thiết bị quá nóng, bấm nút trên thiết bị để dừng ghi và đợi nguội trước khi dùng lại. Ghi lại nhiệt độ môi trường và báo cho nhân viên vận hành.',
        'Overheating: stop with the physical button and let the device cool before reuse; log the ambient temperature and tell the operator.',
        '过热：用实体按键停止录制，冷却后再使用；记录环境温度并告知工作人员。') },
      { id: 'crash', source: '§4.2, p2', text: tr(
        'Nếu thiết bị bị treo hoặc ghi hình bị gián đoạn, khởi động lại thiết bị và nhờ nhân viên vận hành kiểm tra firmware. Giữ nguyên dữ liệu gốc để đội kỹ thuật tìm nguyên nhân.',
        'Crash or recording interruption: restart the device and ask the operator to check firmware. Preserve the original footage for the technical team to investigate.',
        '死机或录制中断：重启设备，请工作人员检查固件。保留原始录像供技术团队排查。') },
      { id: 'storage', source: '§4.3, p2; ADR 0001 retention', text: tr(
        'Nếu không đủ dung lượng, bấm nút trên thiết bị để dừng ghi và liên hệ nhân viên vận hành để sao lưu, xác minh dữ liệu. Giữ nguyên thẻ nhớ và các tệp gốc. Không xóa tệp hoặc dọn thẻ.',
        'Insufficient storage: stop with the physical button and contact the operator for backup and verification. Preserve the card and original files; do not delete files or clear the card.',
        '空间不足：用实体按键停止录制，联系工作人员备份并核验数据。保留存储卡和原始文件，不删除文件、不清空卡。') },
      { id: 'sync', source: '§4.4, p3', text: tr(
        'Nếu bị lỗi kết nối hoặc đồng bộ giờ, hãy dừng ghi và nhờ nhân viên vận hành hỗ trợ khởi động lại, ghép nối lại thiết bị. Dữ liệu ghi trong khoảng thời gian bị lỗi không dùng được. Bạn vẫn cần giữ nguyên dữ liệu và báo rõ thời gian xảy ra lỗi.',
        'Connection or time-sync fault: stop recording, restart and re-pair with the operator. Data from the affected period is unusable; still preserve it and report the affected time interval.',
        '连接或时间同步异常：停止录制，与工作人员一起重启并重新配对。异常期间的数据不可用，但仍须保留并报告异常时段。') },
    ],
  },
  {
    id: 'preserve', title: tr('Sau ca: bàn giao và giữ nguyên tệp', 'After the shift: hand over and preserve files', '采集后：交接并保留原始文件'),
    items: [
      { id: 'handover', source: '§3.1–2, p2; CLAUDE.md Path C', text: tr(
        'Bàn giao thẻ nhớ tại điểm tải lên có nhân viên hỗ trợ. Nhờ nhân viên vận hành chuyển đầy đủ tệp vào máy tính và kiểm tra dung lượng từng tệp. Giữ nguyên thẻ nhớ gốc; không đổi tên, chỉnh sửa, cắt ghép hoặc xóa tệp.',
        'Hand the card to a staffed upload centre. Ask the operator to transfer all files to the host and verify file sizes. Do not rename, alter, edit, stitch or delete original files; preserve the source card.',
        '将存储卡交到有工作人员的上传中心。请工作人员完整传输文件到主机并核验文件大小。不得重命名、修改、剪辑、拼接或删除原始文件；保留源卡。') },
      { id: 'confidential', source: '§3.1, p2; §5.2, p3', text: tr(
        'Bảo quản dữ liệu theo yêu cầu bảo mật. Không sao chép, chia sẻ hoặc tải lên đám mây cá nhân khi chưa được phép.',
        'Handle data according to confidentiality requirements. Do not copy, share or upload it to personal cloud storage without authorization.',
        '按保密要求保管数据。未经授权，不得复制、分享或上传至个人云盘。') },
      { id: 'putAway', source: '§3.3, p2', text: tr(
        'Làm sạch ống kính và cất thiết bị đúng chỗ. Ghi lại mọi bất thường để nhân viên vận hành đưa vào nhật ký hoặc lập phiếu sửa chữa.',
        'Clean the lens, return the device to storage and record any anomalies for the operator’s log or repair ticket.',
        '清洁镜头，将设备归位，并记录异常，交由工作人员登记日志或维修单。') },
    ],
  },
] as const;
