/**
 * The debug-delivery page's chrome, in the three console locales.
 *
 * Chrome only. Everything the SERVER says is shown in the server's own words:
 * the delivery state is the raw word off `collector_uploads.state`, and a
 * `held_reason` or `failed_reason` is looked up in the shared catalogue at
 * `bo.refused.<reason>` — which already holds all three languages — and printed
 * verbatim when it is not there. A reason a delivery was refused on is not
 * somewhere to print this page's paraphrase.
 *
 * `vi` and `zh` are complete because `Copy` is `Record<keyof typeof en, string>`
 * and an English string without its counterparts fails the typecheck. That is
 * the rule for every console screen (DESIGN.md, Localisation) and a debug page
 * is not an exemption from it: an upload centre's operator reads Vietnamese.
 */
const en = {
  dbg: 'Debug delivery',
  dbgOpen: 'Open debug delivery',
  dbgNote:
    'Push a session directory from this PC through the collector app’s own upload routes. Same registration, same signed URLs, same read-back, same refusals. Nothing here is simulated and nothing here is measured in the browser.',
  dbgWhyNote:
    'Shown because this server reports PLAYERONE_DEBUG_DELIVERY=1. It adds no route and grants no access: every call below is a route the phone already uses, made with the credential that route already requires.',
  dbgPrereq: 'Before you start',
  dbgPrereqCors:
    'The bucket needs one CORS rule for this console’s origin, or the browser cancels the PUT and fetch fails with no status: node packages/api/scripts/bucket-cors.mjs {{origin}}',
  dbgPrereqClip:
    'No session directory to hand? Make one from an ordinary clip: node packages/api/scripts/make-session.mjs <clip.mp4> <outdir> — then pick that folder.',

  dbgSignIn: 'Sign in as the collector',
  dbgSignInNote:
    'The phone’s own two routes. The token is held in this tab’s memory only — never in storage, never in a cookie — and it is separate from your operator session.',
  dbgPhone: 'Collector phone',
  dbgRequestCode: 'Send the code',
  dbgCode: 'Six-digit code',
  dbgCodeFilled:
    'This server answered with that number’s code, because it is the one named in PLAYERONE_DEMO_PHONE. Every other number answers 204 and says nothing.',
  dbgCodeSilent:
    'The server answered 204 and said nothing, which is what it answers for any number. Read the code out of the server log, or set PLAYERONE_DEMO_PHONE to this number.',
  dbgVerify: 'Verify and hold the token',
  dbgSignedIn: 'Signed in as a collector. The token is in memory and dies with this tab.',
  dbgForget: 'Forget the token',

  dbgSession: 'Collection session',
  dbgSessionNote:
    'APP-16: a recording belongs to a session the collector declared before wearing the camera. A wrong attribution is a wrong payment, so this is chosen and never guessed.',
  dbgDeclare: 'Declare a new session',
  dbgDeclareNote:
    'Uses the collector’s first active claim and first bound device, scenario “home”. Both APP-17b declarations are sent as NO — an operator pushing a folder is not a collector answering a consent question.',
  dbgNoSessions: 'This collector has no declared sessions yet. Declare one.',
  dbgNoClaim: 'This collector has no active claim or no bound device. Run seed-demo.mjs.',

  dbgPick: 'Session directory',
  dbgPickNote:
    'Pick the folder itself, not the files in it. The folder’s own name becomes session_basename, and the episode id is derived from it and from nothing else.',
  dbgPickButton: 'Choose a folder',
  dbgDirectory: 'Directory',
  dbgFiles: 'Files',
  dbgBytes: 'Bytes',

  dbgStart: 'Hash and deliver',
  dbgHashing: 'Hashing in this browser',
  dbgSending: 'Sending to the object store',
  dbgHeld: 'A delivery is held in this browser',
  dbgHeldNote:
    'Kept so the hashing is not paid twice, and so a second attempt is the same delivery rather than a second delivery of one recording. Pick the same folder again to resume it.',
  dbgResume: 'Resume this delivery',
  dbgDiscard: 'Forget this delivery',

  dbgVerdict: 'What the server made of the bytes',
  dbgUploadId: 'Upload id',
  dbgState: 'State',
  dbgReason: 'Reason',
  dbgEpisodeId: 'Episode',
  dbgOpenEpisode: 'Open this episode',
  dbgOpenQueue: 'Open the review queue',
  dbgIngested: 'Ingested. The server verified every object, measured the session and made the episode.',

  dbgReasonPickEmpty: 'Nothing was picked.',
  dbgReasonManyRoots: 'Those files come from more than one folder. Pick one session folder.',
  dbgReasonNested:
    'That folder has subfolders. The engine reads a flat session directory, and the upload route refuses a file name carrying a path separator.',
  dbgReasonBadName:
    'That folder’s name is not a session directory name. Expected ego_<serial>_YYYYMMDD_HHMMSS — you may have picked the folder above the session.',
  dbgReasonBlocked:
    'The browser would not send the PUT. Almost always the bucket has no CORS rule for this origin: run packages/api/scripts/bucket-cors.mjs and try again.',
  dbgReasonUnauthorized: 'The collector token is gone or was refused. Sign in again.',
  dbgReasonUnknownState: 'The server answered with a delivery state this console does not know.',
  dbgReasonStorage: 'This server has no object store configured, so it cannot plan an upload.',
  dbgReasonReadShort:
    'A read of that file returned no bytes. The folder may have been moved or unmounted since it was picked — pick it again.',
  dbgReasonCredentials: 'That number and code were not accepted.',
  dbgReasonRateLimited: 'Too many attempts. Wait, then ask for a code again.',
};

type Copy = Record<keyof typeof en, string>;

const vi: Copy = {
  dbg: 'Gỡ lỗi tải lên',
  dbgOpen: 'Mở trang gỡ lỗi tải lên',
  dbgNote:
    'Đẩy một thư mục phiên từ máy này qua đúng các tuyến tải lên của ứng dụng cộng tác viên. Cùng bước đăng ký, cùng URL đã ký, cùng bước đọc lại, cùng các lý do từ chối. Không có gì được mô phỏng và không có gì được đo trong trình duyệt.',
  dbgWhyNote:
    'Hiện ra vì máy chủ này báo PLAYERONE_DEBUG_DELIVERY=1. Nó không thêm tuyến nào và không cấp thêm quyền: mọi lệnh gọi bên dưới đều là tuyến mà điện thoại đã dùng, với đúng thông tin xác thực tuyến đó vẫn yêu cầu.',
  dbgPrereq: 'Trước khi bắt đầu',
  dbgPrereqCors:
    'Bucket cần một quy tắc CORS cho nguồn gốc của console này, nếu không trình duyệt sẽ hủy lệnh PUT và fetch thất bại mà không có mã trạng thái: node packages/api/scripts/bucket-cors.mjs {{origin}}',
  dbgPrereqClip:
    'Chưa có thư mục phiên? Tạo một thư mục từ video thường: node packages/api/scripts/make-session.mjs <clip.mp4> <outdir> — rồi chọn thư mục đó.',

  dbgSignIn: 'Đăng nhập với tư cách cộng tác viên',
  dbgSignInNote:
    'Đúng hai tuyến của điện thoại. Token chỉ nằm trong bộ nhớ của thẻ này — không lưu trữ, không cookie — và tách biệt với phiên vận hành của bạn.',
  dbgPhone: 'Số điện thoại cộng tác viên',
  dbgRequestCode: 'Gửi mã',
  dbgCode: 'Mã sáu số',
  dbgCodeFilled:
    'Máy chủ trả về mã của số này, vì đây là số được nêu trong PLAYERONE_DEMO_PHONE. Mọi số khác đều trả 204 và không nói gì.',
  dbgCodeSilent:
    'Máy chủ trả 204 và không nói gì, đúng như với mọi số. Hãy đọc mã trong log máy chủ, hoặc đặt PLAYERONE_DEMO_PHONE bằng số này.',
  dbgVerify: 'Xác minh và giữ token',
  dbgSignedIn: 'Đã đăng nhập với tư cách cộng tác viên. Token nằm trong bộ nhớ và mất khi đóng thẻ.',
  dbgForget: 'Xóa token',

  dbgSession: 'Phiên thu thập',
  dbgSessionNote:
    'APP-16: một bản ghi thuộc về phiên mà cộng tác viên đã khai báo trước khi mang camera. Gán sai phiên là trả sai tiền, nên phiên được chọn chứ không bao giờ đoán.',
  dbgDeclare: 'Khai báo phiên mới',
  dbgDeclareNote:
    'Dùng nhiệm vụ đang nhận đầu tiên và thiết bị đã gắn đầu tiên của cộng tác viên, bối cảnh “home”. Cả hai khai báo APP-17b đều gửi là KHÔNG — người vận hành đẩy một thư mục không phải là cộng tác viên trả lời câu hỏi đồng ý.',
  dbgNoSessions: 'Cộng tác viên này chưa có phiên nào được khai báo. Hãy khai báo một phiên.',
  dbgNoClaim: 'Cộng tác viên này chưa nhận nhiệm vụ hoặc chưa gắn thiết bị. Hãy chạy seed-demo.mjs.',

  dbgPick: 'Thư mục phiên',
  dbgPickNote:
    'Chọn chính thư mục, không phải các tệp bên trong. Tên thư mục trở thành session_basename, và mã tập được suy ra từ đó và chỉ từ đó.',
  dbgPickButton: 'Chọn thư mục',
  dbgDirectory: 'Thư mục',
  dbgFiles: 'Số tệp',
  dbgBytes: 'Số byte',

  dbgStart: 'Băm và gửi',
  dbgHashing: 'Đang băm trong trình duyệt',
  dbgSending: 'Đang gửi lên kho đối tượng',
  dbgHeld: 'Trình duyệt này đang giữ một lượt gửi',
  dbgHeldNote:
    'Được giữ để không phải băm lại, và để lần thử thứ hai vẫn là cùng một lượt gửi chứ không thành lượt gửi thứ hai của một bản ghi. Chọn lại đúng thư mục đó để tiếp tục.',
  dbgResume: 'Tiếp tục lượt gửi này',
  dbgDiscard: 'Bỏ lượt gửi này',

  dbgVerdict: 'Máy chủ kết luận gì về các byte',
  dbgUploadId: 'Mã lượt gửi',
  dbgState: 'Trạng thái',
  dbgReason: 'Lý do',
  dbgEpisodeId: 'Tập',
  dbgOpenEpisode: 'Mở tập này',
  dbgOpenQueue: 'Mở hàng chờ duyệt',
  dbgIngested: 'Đã nhập. Máy chủ đã xác minh từng đối tượng, đo phiên và tạo tập.',

  dbgReasonPickEmpty: 'Chưa chọn gì.',
  dbgReasonManyRoots: 'Các tệp đó đến từ nhiều thư mục. Hãy chọn một thư mục phiên.',
  dbgReasonNested:
    'Thư mục đó có thư mục con. Engine chỉ đọc thư mục phiên phẳng, và tuyến tải lên từ chối tên tệp mang dấu phân cách đường dẫn.',
  dbgReasonBadName:
    'Tên thư mục đó không phải tên thư mục phiên. Cần ego_<serial>_YYYYMMDD_HHMMSS — có thể bạn đã chọn thư mục cha của phiên.',
  dbgReasonBlocked:
    'Trình duyệt không gửi được lệnh PUT. Hầu như luôn là bucket chưa có quy tắc CORS cho nguồn gốc này: hãy chạy packages/api/scripts/bucket-cors.mjs rồi thử lại.',
  dbgReasonUnauthorized: 'Token cộng tác viên đã mất hoặc bị từ chối. Hãy đăng nhập lại.',
  dbgReasonUnknownState: 'Máy chủ trả về một trạng thái lượt gửi mà console này không biết.',
  dbgReasonStorage: 'Máy chủ này chưa cấu hình kho đối tượng nên không thể lập kế hoạch tải lên.',
  dbgReasonReadShort:
    'Lần đọc tệp đó không trả về byte nào. Có thể thư mục đã bị di chuyển hoặc tháo sau khi chọn — hãy chọn lại.',
  dbgReasonCredentials: 'Số điện thoại và mã đó không được chấp nhận.',
  dbgReasonRateLimited: 'Quá nhiều lần thử. Hãy đợi rồi yêu cầu mã lại.',
};

const zh: Copy = {
  dbg: '上传调试',
  dbgOpen: '打开上传调试页',
  dbgNote:
    '把本机上的一个会话目录通过采集员应用自己的上传路由推送出去。相同的注册、相同的签名 URL、相同的回读校验、相同的拒绝原因。这里没有任何模拟，浏览器里也不做任何测量。',
  dbgWhyNote:
    '之所以显示，是因为该服务器报告 PLAYERONE_DEBUG_DELIVERY=1。它不新增路由，也不放宽权限：下面每次调用都是手机已经在用的路由，并使用该路由本来就要求的凭据。',
  dbgPrereq: '开始之前',
  dbgPrereqCors:
    '存储桶需要为本控制台的来源配置一条 CORS 规则，否则浏览器会取消 PUT，fetch 失败且没有状态码：node packages/api/scripts/bucket-cors.mjs {{origin}}',
  dbgPrereqClip:
    '手头没有会话目录？用普通视频生成一个：node packages/api/scripts/make-session.mjs <clip.mp4> <outdir>，然后选择那个文件夹。',

  dbgSignIn: '以采集员身份登录',
  dbgSignInNote:
    '就是手机用的那两个路由。令牌只保存在此标签页的内存中——不写入存储，不写入 Cookie——并与你的操作员会话相互独立。',
  dbgPhone: '采集员手机号',
  dbgRequestCode: '发送验证码',
  dbgCode: '六位验证码',
  dbgCodeFilled:
    '该服务器返回了这个号码的验证码，因为它正是 PLAYERONE_DEMO_PHONE 指定的号码。其他号码一律返回 204，不透露任何信息。',
  dbgCodeSilent:
    '服务器返回 204 且不透露任何信息，对任何号码都是如此。请从服务器日志中读取验证码，或把 PLAYERONE_DEMO_PHONE 设为此号码。',
  dbgVerify: '验证并保存令牌',
  dbgSignedIn: '已以采集员身份登录。令牌在内存中，关闭标签页即失效。',
  dbgForget: '清除令牌',

  dbgSession: '采集会话',
  dbgSessionNote:
    'APP-16：一段录制归属于采集员戴上相机之前声明的会话。归属错误就是付款错误，所以这里必须选择，绝不猜测。',
  dbgDeclare: '声明新会话',
  dbgDeclareNote:
    '使用该采集员的第一个有效领取任务和第一台已绑定设备，场景为 “home”。两项 APP-17b 声明都按“否”提交——操作员推送文件夹并不等于采集员回答同意问题。',
  dbgNoSessions: '该采集员还没有已声明的会话。请先声明一个。',
  dbgNoClaim: '该采集员没有有效领取任务或没有绑定设备。请运行 seed-demo.mjs。',

  dbgPick: '会话目录',
  dbgPickNote:
    '请选择文件夹本身，而不是其中的文件。文件夹名即 session_basename，片段 ID 仅由它推导，别无其他来源。',
  dbgPickButton: '选择文件夹',
  dbgDirectory: '目录',
  dbgFiles: '文件数',
  dbgBytes: '字节数',

  dbgStart: '计算哈希并发送',
  dbgHashing: '正在浏览器中计算哈希',
  dbgSending: '正在发送到对象存储',
  dbgHeld: '此浏览器中保留着一次上传',
  dbgHeldNote:
    '保留它，是为了不必重复计算哈希，也为了第二次尝试仍是同一次上传，而不是同一段录制的第二次上传。重新选择同一个文件夹即可续传。',
  dbgResume: '续传这次上传',
  dbgDiscard: '丢弃这次上传',

  dbgVerdict: '服务器对这些字节的判定',
  dbgUploadId: '上传 ID',
  dbgState: '状态',
  dbgReason: '原因',
  dbgEpisodeId: '片段',
  dbgOpenEpisode: '打开该片段',
  dbgOpenQueue: '打开审核队列',
  dbgIngested: '已导入。服务器已校验每个对象、测量会话并生成片段。',

  dbgReasonPickEmpty: '未选择任何内容。',
  dbgReasonManyRoots: '这些文件来自多个文件夹。请选择一个会话文件夹。',
  dbgReasonNested:
    '该文件夹含有子文件夹。引擎只读取扁平的会话目录，上传路由也会拒绝带路径分隔符的文件名。',
  dbgReasonBadName:
    '该文件夹名不是会话目录名。应为 ego_<serial>_YYYYMMDD_HHMMSS——你可能选到了会话的上一级文件夹。',
  dbgReasonBlocked:
    '浏览器没有发出 PUT。几乎总是因为存储桶没有为此来源配置 CORS 规则：请运行 packages/api/scripts/bucket-cors.mjs 后重试。',
  dbgReasonUnauthorized: '采集员令牌已失效或被拒绝。请重新登录。',
  dbgReasonUnknownState: '服务器返回了本控制台不认识的上传状态。',
  dbgReasonStorage: '该服务器未配置对象存储，无法规划上传。',
  dbgReasonReadShort:
    '读取该文件没有返回任何字节。文件夹可能在选择后被移动或卸载——请重新选择。',
  dbgReasonCredentials: '该号码与验证码未被接受。',
  dbgReasonRateLimited: '尝试次数过多。请稍候再索取验证码。',
};

export const DEBUG_DELIVERY_COPY = { en, vi, zh };
