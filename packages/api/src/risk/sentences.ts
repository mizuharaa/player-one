import type { Evidence, Flag } from './types.ts';

/**
 * Every flag as one plain sentence a non-technical operator understands, with
 * the number that caused it, in English, Chinese and Vietnamese.
 *
 * Same shape as `MESSAGES` in `../i18n.ts` — a flat map of dotted keys, every
 * locale holding every key — so Agent D can lift these keys into the console
 * catalogue unchanged. The one difference is that these strings are templates:
 * `{name}` is filled from the flag's evidence, because "43 episodes on 12 Aug"
 * is the sentence and "many episodes" is not.
 *
 * Placeholders: `{key}` renders `evidence[key]`; `{key_pct}` renders a 0-1
 * fraction as a percentage; a list renders comma-separated; a missing value
 * renders as `?` rather than throwing, because a sentence with a gap is still
 * more useful to an operator than a stack trace.
 *
 * The wording states what was measured and never a conclusion about the
 * person. "Shares a phone with collector c-0002" is a fact the operator can
 * check; "is a fraudster" is a legal finding this engine may not make.
 */

export const RISK_LOCALES = ['en', 'zh', 'vi'] as const;
export type RiskLocale = (typeof RISK_LOCALES)[number];

const en = {
  'risk.band.clear': 'Clear',
  'risk.band.notice': 'Notice',
  'risk.band.review': 'Review',
  'risk.band.hold': 'On hold',
  'risk.verdict.false_positive': 'Checked, nothing wrong',
  'risk.verdict.accepted': 'Risk accepted, pay anyway',
  'risk.verdict.resolved': 'Cause fixed',

  'risk.signal.META.EVALUATED': 'Evaluated with {findings} finding(s).',

  'risk.signal.IDENT.NAME_MISMATCH':
    'Name on ZaloPay is {verified_name}; the agreement says {declared_name}.',
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
  'risk.signal.IDENT.WALLET_LOCKED':
    'ZaloPay reported on {verified_at} that this wallet is locked (code {sub_return_code}).',

  'risk.signal.VOL.HOURS_PER_DAY':
    '{hours} hours of recording on {day} across {episodes} episode(s). The daily maximum is {max_hours} hours.',
  'risk.signal.VOL.ABOVE_COHORT_P95':
    '{episodes} episodes on {day}. 95 in 100 collector-days have {p95} or fewer ({cohort_days} collector-days compared).',
  'risk.signal.VOL.STEP_CHANGE':
    '{minutes} minutes on {day}. This collector’s usual day is {median_minutes} minutes, so this is {ratio}×.',
  'risk.signal.VOL.NO_GAP':
    'Episodes {episode_a} and {episode_b} overlap by {overlap_s} seconds. One person cannot record both at once.',
  'risk.signal.VOL.NOCTURNAL':
    '{night_minutes} of {total_minutes} minutes ({share_pct}) were recorded between {night_hours} on task type {task_type}. Night work is a real job; this is context.',

  'risk.signal.CONT.MOOV_DAMAGED':
    'The MP4 {file} fails the container check: {verdict}.',
  'risk.signal.CONT.TIMING_TRUNCATED':
    'The {stream} timestamp index stopped early: {pts_rows} rows against {media_packets} media packets. Typical of an interrupted recording.',
  'risk.signal.CONT.TIMING_PACKET_DELTA':
    'The {stream} timestamp index has {pts_rows} rows but the media has only {media_packets} packets: the video was cut or rewritten after its index.',
  'risk.signal.CONT.IMU_CLOCK_DRIFT':
    'The IMU clock is off: {clock_outlier_rows} rows carry a time nowhere near the session ({detail}).',
  'risk.signal.CONT.PTS_MANIFEST_DELTA':
    'The manifest claims {declared_s} s and the media measures {measured_s} s, a ratio of {ratio}. This device usually reads {baseline_ratio} ({baseline_episodes} episodes).',
  'risk.signal.CONT.NEAR_DUPLICATE':
    'The footage matches episode {other_episode_id} by collector {other_collector_ref} ({method}, {match_share_pct} of frames).',
  'risk.signal.CONT.STATIC_SCENE':
    'The picture changed very little across {frames} sampled frames: motion {motion_energy}, where normal footage is above {max_motion_energy}.',
  'risk.signal.CONT.LOW_LUMA_VARIANCE':
    '{dark_share_pct} of sampled frames are dark and {flat_share_pct} are flat (mean brightness {mean_luma} of 255). The lens may have been covered.',
  'risk.signal.CONT.AUDIO_ABSENT':
    'No usable audio ({reason}) on a task that expects sound ({task_type}).',
  'risk.signal.CONT.FINGERPRINT':
    'A frame fingerprint of {frames} frames was recorded for duplicate checks.',
  'risk.signal.CONT.REDELIVERY_CHURN':
    'This episode was delivered {deliveries} times over {hours_between} hours, and the bytes differed on {mismatch_deliveries} of them. More than {max_deliveries} deliveries is unusual.',
  'risk.signal.CONT.MEDIA_SUBSTITUTED':
    'A later delivery replaced {changed_media_count} media file(s) that had already arrived whole ({changed_media}) and now measures {measured_s} s against {prior_measured_s} s before. A lost link loses bytes; it does not exchange them.',

  'risk.signal.PROV.PRNU_MISMATCH':
    'The sensor noise pattern of the footage correlates {correlation} with the fingerprint enrolled for device {device_serial}; a match is above {min_correlation}.',
  'risk.signal.PROV.IMU_VIDEO_DECORR':
    'Over {seconds} seconds the motion in the picture and the motion the IMU recorded correlate {correlation}; a real recording is above {min_correlation}.',
  'risk.signal.PROV.ENCODER_MISMATCH':
    'The file was not written the way firmware {firmware} writes files: {mismatches}.',
  'risk.signal.PROV.SCREEN_RECAPTURE':
    'The footage looks like a filmed screen: {cues} ({frames} frames checked).',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC':
    'The footage has almost no sensor noise ({noise_floor}, cameras read above {max_noise_floor}). A weak cue on its own.',
  'risk.signal.PROV.STALE_RECORDING':
    'The recording is dated {recorded_at} but was first delivered on {first_delivered_at}, {age_days} days later. More than {max_age_days} days is unusual.',

  'risk.signal.HIST.REPEAT_CONTENT_FINDINGS':
    '{episodes} of this collector’s {episodes_evaluated} evaluated episodes ({share_pct}) carry a content or provenance finding: {signals}. More than {max_episodes} episodes is the finding.',
  'risk.signal.HIST.PRIOR_ACCEPTED_HOLDS':
    'An operator has held a bill of this collector’s and paid it anyway {accepted_holds} times, most recently on {last_cleared_at} ({signal_ids}). More than {max_accepted} is the finding.',

  'risk.signal.OPS.REVIEW_TOO_FAST':
    'Reviewer {reviewer_ref} recorded a {verdict} verdict in {time_to_verdict_s} s on an episode that runs {measured_duration_s} s.',
  'risk.signal.OPS.APPROVAL_OUTLIER':
    'Reviewer {reviewer_ref} approved {approval_rate_pct} of {decided} episodes; the other {reviewers} reviewers approve {cohort_median_pct}.',
  'risk.signal.OPS.SELF_DEALING':
    'Operator {operator_ref} created this collector on {created_at} and also {paid_action} the bill on {paid_at}.',
  'risk.signal.OPS.CONCENTRATION':
    'Operator {operator_ref} handled {share_pct} of the {events} actions on this collector’s bills while {operators} operators were active.',
} as const;

export type RiskMessageKey = keyof typeof en;

const zh: Record<RiskMessageKey, string> = {
  'risk.band.clear': '正常',
  'risk.band.notice': '提示',
  'risk.band.review': '需复核',
  'risk.band.hold': '已暂停支付',
  'risk.verdict.false_positive': '已核查，无问题',
  'risk.verdict.accepted': '接受风险，照常支付',
  'risk.verdict.resolved': '原因已解决',

  'risk.signal.META.EVALUATED': '已评估，发现 {findings} 项。',

  'risk.signal.IDENT.NAME_MISMATCH': 'ZaloPay 上的姓名为 {verified_name}，协议上的姓名为 {declared_name}。',
  'risk.signal.IDENT.PHONE_SHARED':
    '钱包手机号 {phone_masked} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.ACCOUNT_SHARED':
    '银行账户 {bank_code} ···{account_no_last4} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.MUID_SHARED':
    'ZaloPay 钱包 {m_u_id_masked} 同时出现在另外 {count} 位采集者的收款账户上：{other_collector_refs}。',
  'risk.signal.IDENT.ACCOUNT_CHANGED_LATE':
    '收款账户于 {changed_at} 更改，距结算周期 {period_end} 结束仅 {days_before_end} 天。',
  'risk.signal.IDENT.UNVERIFIED_KYC':
    'ZaloPay 于 {verified_at} 反馈该钱包尚未完成实名认证（代码 {sub_return_code}）。',
  'risk.signal.IDENT.KYC_LIMIT_REPEATED':
    'ZaloPay 反馈收款额度已达上限 {occurrences} 次（代码 {sub_return_code}）；一个人超过 {max_occurrences} 次并不常见。',
  'risk.signal.IDENT.WALLET_LOCKED': 'ZaloPay 于 {verified_at} 反馈该钱包已被锁定（代码 {sub_return_code}）。',

  'risk.signal.VOL.HOURS_PER_DAY':
    '{day} 当天 {episodes} 个片段合计录制 {hours} 小时，每日上限为 {max_hours} 小时。',
  'risk.signal.VOL.ABOVE_COHORT_P95':
    '{day} 当天录制了 {episodes} 个片段；100 个采集者日中有 95 个不超过 {p95} 个（共比较 {cohort_days} 个采集者日）。',
  'risk.signal.VOL.STEP_CHANGE':
    '{day} 当天录制 {minutes} 分钟，该采集者平时每天约 {median_minutes} 分钟，为平时的 {ratio} 倍。',
  'risk.signal.VOL.NO_GAP': '片段 {episode_a} 与 {episode_b} 在时间上重叠 {overlap_s} 秒，一个人无法同时录制两段。',
  'risk.signal.VOL.NOCTURNAL':
    '任务类型 {task_type} 的 {total_minutes} 分钟中有 {night_minutes} 分钟（{share_pct}）录制于 {night_hours} 之间。夜班是正常工作，此项仅供参考。',

  'risk.signal.CONT.MOOV_DAMAGED': 'MP4 文件 {file} 未通过容器检查：{verdict}。',
  'risk.signal.CONT.TIMING_TRUNCATED':
    '{stream} 的时间戳索引提前结束：{pts_rows} 行，而媒体有 {media_packets} 个数据包。这是录制被中断的典型表现。',
  'risk.signal.CONT.TIMING_PACKET_DELTA':
    '{stream} 的时间戳索引有 {pts_rows} 行，但媒体只有 {media_packets} 个数据包：视频在建立索引之后被截断或改写。',
  'risk.signal.CONT.IMU_CLOCK_DRIFT': 'IMU 时钟异常：{clock_outlier_rows} 行的时间与本次会话相差甚远（{detail}）。',
  'risk.signal.CONT.PTS_MANIFEST_DELTA':
    '清单声称 {declared_s} 秒，媒体实测 {measured_s} 秒，比值 {ratio}；该设备通常为 {baseline_ratio}（基于 {baseline_episodes} 个片段）。',
  'risk.signal.CONT.NEAR_DUPLICATE':
    '画面与采集者 {other_collector_ref} 的片段 {other_episode_id} 相同（{method}，{match_share_pct} 的帧匹配）。',
  'risk.signal.CONT.STATIC_SCENE':
    '{frames} 个抽样帧之间画面几乎没有变化：运动量 {motion_energy}，正常拍摄高于 {max_motion_energy}。',
  'risk.signal.CONT.LOW_LUMA_VARIANCE':
    '{dark_share_pct} 的抽样帧过暗，{flat_share_pct} 的帧没有细节（平均亮度 {mean_luma}/255）。镜头可能被遮挡。',
  'risk.signal.CONT.AUDIO_ABSENT': '没有可用的音频（{reason}），而任务类型 {task_type} 应当有声音。',
  'risk.signal.CONT.FINGERPRINT': '已记录 {frames} 帧的画面指纹，用于重复检查。',
  'risk.signal.CONT.REDELIVERY_CHURN':
    '该片段在 {hours_between} 小时内被交付了 {deliveries} 次，其中 {mismatch_deliveries} 次内容不一致。超过 {max_deliveries} 次交付属于异常。',
  'risk.signal.CONT.MEDIA_SUBSTITUTED':
    '后一次交付替换了 {changed_media_count} 个已完整到达的媒体文件（{changed_media}），现在实测 {measured_s} 秒，此前为 {prior_measured_s} 秒。链路中断只会丢失数据，不会替换数据。',

  'risk.signal.PROV.PRNU_MISMATCH':
    '画面的传感器噪声模式与设备 {device_serial} 登记的指纹相关性为 {correlation}，匹配应高于 {min_correlation}。',
  'risk.signal.PROV.IMU_VIDEO_DECORR':
    '在 {seconds} 秒内，画面中的运动与 IMU 记录的运动相关性为 {correlation}，真实录制应高于 {min_correlation}。',
  'risk.signal.PROV.ENCODER_MISMATCH': '该文件的写入方式与固件 {firmware} 不同：{mismatches}。',
  'risk.signal.PROV.SCREEN_RECAPTURE': '画面像是翻拍的屏幕：{cues}（检查了 {frames} 帧）。',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC':
    '画面几乎没有传感器噪声（{noise_floor}，相机通常高于 {max_noise_floor}）。单独看只是弱线索。',
  'risk.signal.PROV.STALE_RECORDING':
    '该录制的日期为 {recorded_at}，但首次交付是在 {first_delivered_at}，相隔 {age_days} 天。超过 {max_age_days} 天属于异常。',

  'risk.signal.HIST.REPEAT_CONTENT_FINDINGS':
    '该采集者已评估的 {episodes_evaluated} 个片段中有 {episodes} 个（{share_pct}）存在画面或来源方面的发现：{signals}。超过 {max_episodes} 个片段即构成本项。',
  'risk.signal.HIST.PRIOR_ACCEPTED_HOLDS':
    '运营人员曾对该采集者的账单挂起后仍决定付款 {accepted_holds} 次，最近一次为 {last_cleared_at}（{signal_ids}）。超过 {max_accepted} 次即构成本项。',

  'risk.signal.OPS.REVIEW_TOO_FAST':
    '审核员 {reviewer_ref} 用 {time_to_verdict_s} 秒给出了 {verdict} 结论，而该片段时长 {measured_duration_s} 秒。',
  'risk.signal.OPS.APPROVAL_OUTLIER':
    '审核员 {reviewer_ref} 在 {decided} 个片段中通过了 {approval_rate_pct}，其他 {reviewers} 位审核员的通过率为 {cohort_median_pct}。',
  'risk.signal.OPS.SELF_DEALING':
    '操作员 {operator_ref} 于 {created_at} 创建了该采集者，又于 {paid_at} 对账单执行了 {paid_action}。',
  'risk.signal.OPS.CONCENTRATION':
    '在 {operators} 位操作员都在处理的情况下，操作员 {operator_ref} 处理了该采集者账单 {events} 次操作中的 {share_pct}。',
};

const vi: Record<RiskMessageKey, string> = {
  'risk.band.clear': 'Bình thường',
  'risk.band.notice': 'Lưu ý',
  'risk.band.review': 'Cần xem xét',
  'risk.band.hold': 'Tạm giữ thanh toán',
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
  'risk.signal.CONT.REDELIVERY_CHURN':
    'Phiên này được nộp {deliveries} lần trong {hours_between} giờ, và dữ liệu khác nhau ở {mismatch_deliveries} lần. Quá {max_deliveries} lần nộp là bất thường.',
  'risk.signal.CONT.MEDIA_SUBSTITUTED':
    'Lần nộp sau đã thay thế {changed_media_count} tệp video hoặc âm thanh vốn đã về đủ ({changed_media}) và nay đo được {measured_s} giây so với {prior_measured_s} giây trước đó. Mất kết nối làm mất dữ liệu, không thay dữ liệu.',

  'risk.signal.PROV.PRNU_MISMATCH':
    'Mẫu nhiễu cảm biến của video tương quan {correlation} với dấu vân đã đăng ký cho thiết bị {device_serial}; khớp phải trên {min_correlation}.',
  'risk.signal.PROV.IMU_VIDEO_DECORR':
    'Trong {seconds} giây, chuyển động trong hình và chuyển động IMU ghi được tương quan {correlation}; ghi hình thật phải trên {min_correlation}.',
  'risk.signal.PROV.ENCODER_MISMATCH': 'Tệp không được ghi theo cách firmware {firmware} ghi tệp: {mismatches}.',
  'risk.signal.PROV.SCREEN_RECAPTURE': 'Video giống như quay lại từ màn hình: {cues} (đã kiểm tra {frames} khung hình).',
  'risk.signal.PROV.SYNTHETIC_HEURISTIC':
    'Video gần như không có nhiễu cảm biến ({noise_floor}, máy quay thường trên {max_noise_floor}). Chỉ là dấu hiệu yếu nếu đứng một mình.',
  'risk.signal.PROV.STALE_RECORDING':
    'Bản ghi đề ngày {recorded_at} nhưng lần nộp đầu tiên là {first_delivered_at}, muộn hơn {age_days} ngày. Quá {max_age_days} ngày là bất thường.',

  'risk.signal.HIST.REPEAT_CONTENT_FINDINGS':
    '{episodes} trong {episodes_evaluated} phiên đã đánh giá của cộng tác viên này ({share_pct}) có phát hiện về nội dung hoặc nguồn gốc: {signals}. Quá {max_episodes} phiên là mức phát hiện.',
  'risk.signal.HIST.PRIOR_ACCEPTED_HOLDS':
    'Nhân viên vận hành đã tạm giữ hoá đơn của cộng tác viên này rồi vẫn quyết định chi trả {accepted_holds} lần, gần nhất là {last_cleared_at} ({signal_ids}). Quá {max_accepted} lần là mức phát hiện.',

  'risk.signal.OPS.REVIEW_TOO_FAST':
    'Người duyệt {reviewer_ref} đưa ra kết luận {verdict} trong {time_to_verdict_s} giây cho phiên dài {measured_duration_s} giây.',
  'risk.signal.OPS.APPROVAL_OUTLIER':
    'Người duyệt {reviewer_ref} chấp thuận {approval_rate_pct} trong {decided} phiên; {reviewers} người duyệt khác chấp thuận {cohort_median_pct}.',
  'risk.signal.OPS.SELF_DEALING':
    'Nhân viên {operator_ref} đã tạo cộng tác viên này vào {created_at} và cũng thực hiện {paid_action} cho hóa đơn vào {paid_at}.',
  'risk.signal.OPS.CONCENTRATION':
    'Nhân viên {operator_ref} xử lý {share_pct} trong {events} thao tác trên hóa đơn của cộng tác viên này trong khi có {operators} nhân viên cùng làm.',
};

export const RISK_MESSAGES: Record<RiskLocale, Record<RiskMessageKey, string>> = { en, zh, vi };

/** Every locale holds every key. Asserted by a test, like the console catalogue. */
export function missingRiskKeys(locale: RiskLocale): RiskMessageKey[] {
  const keys = Object.keys(en) as RiskMessageKey[];
  return keys.filter((k) => {
    const value = RISK_MESSAGES[locale][k];
    return typeof value !== 'string' || value.trim() === '';
  });
}

/** The placeholders a template uses, so a test can prove every locale uses the same ones. */
export const placeholdersOf = (template: string): string[] =>
  [...template.matchAll(/\{([a-z0-9_]+)\}/g)].map((m) => m[1]!).sort();

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return '?';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.map(formatValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Fills a template from evidence. Pure. */
export function render(template: string, evidence: Evidence): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    if (key.endsWith('_pct')) {
      const base = evidence[key.slice(0, -4)];
      if (typeof base === 'number' && Number.isFinite(base)) return `${Math.round(base * 100)}%`;
      const direct = evidence[key];
      return direct === undefined ? '?' : formatValue(direct);
    }
    return formatValue(evidence[key]);
  });
}

/** The one sentence for a flag. Unknown signal ids render their id and evidence rather than nothing. */
export function sentence(flag: Pick<Flag, 'signalId' | 'evidence'>, locale: RiskLocale): string {
  const key = `risk.signal.${flag.signalId}` as RiskMessageKey;
  const template = RISK_MESSAGES[locale][key];
  if (template === undefined) return `${flag.signalId}: ${JSON.stringify(flag.evidence)}`;
  return render(template, flag.evidence);
}

export const bandLabel = (band: 'clear' | 'notice' | 'review' | 'hold', locale: RiskLocale): string =>
  RISK_MESSAGES[locale][`risk.band.${band}`];
