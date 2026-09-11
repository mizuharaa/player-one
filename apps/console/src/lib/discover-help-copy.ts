const vi={
  trucTitle:'Hỏi Trúc.',trucLabel:'Hướng dẫn nhanh',trucBody:'Tìm hiểu nhiệm vụ, camera và cách duyệt. Câu trả lời soạn sẵn; chưa kết nối trò chuyện AI.',
  trucOpen:'Mở phần hỏi Trúc',trucClose:'Đóng phần hỏi Trúc',trucPause:'Dừng chuyển động',trucResume:'Bật chuyển động',trucPrepared:'Câu trả lời soạn sẵn',
  privacyTitle:'Quyền riêng tư',privacyDraft:'Bản nháp cho trang giới thiệu',privacyBack:'Về PlayerOne',
  privacyIntro:'Đây là bản nháp mô tả trang giới thiệu công khai, bản demo trên trang và Phòng thử nghiệm sau đăng nhập. Tài liệu này chưa thay thế thông báo quyền riêng tư và các thoả thuận áp dụng cho việc thu thập dữ liệu thật.',
  privacyLocalTitle:'Các lựa chọn lưu trên trình duyệt',privacyLocalBody:'Trang ghi nhớ ngôn ngữ, giao diện và lựa chọn cookie trong bộ nhớ của trình duyệt. Bạn có thể xoá các lựa chọn này qua cài đặt dữ liệu trang web của trình duyệt.',
  privacyDemoTitle:'Bản demo trên trang giới thiệu và Trúc',privacyDemoBody:'Các thao tác trong bản demo tương tác trên trang giới thiệu và câu hỏi soạn sẵn của Trúc chỉ thay đổi trạng thái cục bộ trên trang đó. Chúng không nhận nhiệm vụ thật, bắt đầu ghi hình hay gửi câu hỏi đến một dịch vụ AI. Hình ảnh và phim minh hoạ không phải bằng chứng về người thu thập thực tế.',
  privacyStudioTitle:'Phòng thử nghiệm sau đăng nhập',privacyStudioBody:'Phòng thử nghiệm lưu video riêng tư trong cơ sở dữ liệu máy chủ, gắn với tài khoản người vận hành đã tải lên. Video có thể truy cập trong bảy ngày; chủ sở hữu có thể xoá video trong thời gian này. Khi hết hạn, video không thể truy cập và được xoá bởi đợt dọn dẹp hằng giờ hoặc lần tải lên tiếp theo. Nếu dịch vụ dừng, dữ liệu hết hạn có thể còn lưu đến khi dịch vụ hoạt động và dọn dẹp trở lại. Các quyết định duyệt thử không tạo phê duyệt hay khoản thanh toán thật. Siêu dữ liệu kiểm toán vẫn được giữ sau khi xoá video; bản sao lưu cơ sở dữ liệu tuân theo thời gian lưu giữ riêng của nhà cung cấp.',
  privacyCookiesTitle:'Cookie và lưu trữ',privacyCookiesBody:'Trang giới thiệu này không tích hợp công cụ phân tích hay quảng cáo tuỳ chọn. Chấp nhận hoặc từ chối đều lưu lựa chọn của bạn và không kích hoạt công cụ theo dõi. Đăng nhập console là một luồng riêng, sử dụng phiên xác thực cần thiết.',
  privacyScopeTitle:'Phạm vi cần hoàn thiện',privacyScopeBody:'Trước khi thu thập thật, thông báo chính thức cần xác định đơn vị chịu trách nhiệm, dữ liệu được xử lý, thời gian lưu giữ, việc chia sẻ và cách liên hệ hoặc thực hiện yêu cầu. Các chi tiết này chưa được xác nhận trong bản nháp. Nhà cung cấp hạ tầng có thể xử lý dữ liệu kỹ thuật của yêu cầu truy cập; bản nháp không đưa ra cam kết về thời gian lưu nhật ký.',
  cookieTitle:'Cookie và lựa chọn của bạn',cookieBody:'Trang lưu các lựa chọn cần thiết trên trình duyệt. Hiện không có công cụ theo dõi tuỳ chọn; cả hai lựa chọn dưới đây đều không bật theo dõi.',cookieAccept:'Chấp nhận',cookieDecline:'Từ chối',cookieSettings:'Lựa chọn cookie',cookieSavedAccept:'Đã lưu: chấp nhận.',cookieSavedDecline:'Đã lưu: từ chối.',cookieSaveFailed:'Trình duyệt không cho phép lưu lựa chọn. Lựa chọn chỉ áp dụng trong lần xem trang này.',
  reviewFilmLabel:'Phim minh hoạ · góc nhìn bên ngoài, không phải hướng dẫn đeo thiết bị',
};
type Copy=Record<keyof typeof vi,string>;
const en:Copy={
  trucTitle:'Ask Trúc.',trucLabel:'A little guidance',trucBody:'Get to know tasks, the camera and review. Prepared answers; live AI chat is not connected.',
  trucOpen:'Open Ask Trúc',trucClose:'Close Ask Trúc',trucPause:'Pause movement',trucResume:'Resume movement',trucPrepared:'Prepared answer',
  privacyTitle:'Privacy',privacyDraft:'Showcase draft',privacyBack:'Back to PlayerOne',
  privacyIntro:'This draft describes the public landing page, its on-page demo and the signed-in Demo studio. It does not replace the privacy notice and agreements required for real data collection.',
  privacyLocalTitle:'Preferences stored in your browser',privacyLocalBody:'The site remembers your language, theme and cookie choice in browser storage. You can remove these preferences through your browser’s site-data settings.',
  privacyDemoTitle:'The landing demo and Trúc',privacyDemoBody:'Actions in the landing page’s interactive demo and Trúc’s prepared questions only change that page’s local state. They do not claim real tasks, start recording or send questions to an AI service. Illustrative images and films are not evidence of actual collectors.',
  privacyStudioTitle:'Signed-in Demo studio',privacyStudioBody:'Demo studio stores private videos in the server database, owned by the operator account that uploaded them. Videos remain accessible for seven days, and their owner can delete them during that period. Expired videos become inaccessible and are removed by hourly cleanup or the next upload. If the service is stopped, expired bytes may remain until service and cleanup resume. Demo review decisions create no real approvals or payments. Audit metadata remains after video deletion; database backups follow the provider’s separate retention policy.',
  privacyCookiesTitle:'Cookies and storage',privacyCookiesBody:'This showcase has no optional analytics or advertising integration. Accepting or declining saves your choice and does not enable tracking. Console sign-in is a separate flow that uses a necessary authentication session.',
  privacyScopeTitle:'Details still to be confirmed',privacyScopeBody:'Before real collection, the formal notice needs to identify the responsible organisation, processed data, retention, sharing, and contact or request channels. Those details are not confirmed in this draft. Infrastructure providers may process technical request data; this draft makes no promise about log retention.',
  cookieTitle:'Cookies and your choice',cookieBody:'The site stores essential preferences in your browser. There are currently no optional trackers; neither choice below enables tracking.',cookieAccept:'Accept',cookieDecline:'Decline',cookieSettings:'Cookie settings',cookieSavedAccept:'Saved: accepted.',cookieSavedDecline:'Saved: declined.',cookieSaveFailed:'Your browser did not allow the choice to be saved. It applies only for this page visit.',
  reviewFilmLabel:'Illustrative film · external view, not a device-fitting guide',
};
const zh:Copy={
  trucTitle:'问问 Trúc。',trucLabel:'快速指引',trucBody:'了解任务、相机和审核。以下为预设解答，尚未连接实时 AI 聊天。',
  trucOpen:'打开 Trúc 问答',trucClose:'关闭 Trúc 问答',trucPause:'暂停动作',trucResume:'恢复动作',trucPrepared:'预先编写的回答',
  privacyTitle:'隐私',privacyDraft:'展示页面草案',privacyBack:'返回 PlayerOne',
  privacyIntro:'本草案描述公开介绍页面、页面内演示及登录后的演示工作室，不替代真实数据采集所需的隐私通知与协议。',
  privacyLocalTitle:'保存在浏览器中的偏好',privacyLocalBody:'网站通过浏览器存储记住语言、主题和 Cookie 选择。你可以通过浏览器的网站数据设置删除这些偏好。',
  privacyDemoTitle:'介绍页面演示与 Trúc',privacyDemoBody:'介绍页面内的交互演示操作和 Trúc 的预设问题只改变该页面的本地状态，不会领取真实任务、开始录制或向 AI 服务发送问题。示意图片和影片不代表真实采集员。',
  privacyStudioTitle:'登录后的演示工作室',privacyStudioBody:'演示工作室将私有视频保存在服务器数据库中，归上传视频的操作员账号所有。视频可访问七天，所有者可在此期间删除。到期后视频立即不可访问，并在每小时清理或下一次上传时删除。如果服务停止，到期数据可能保留至服务恢复并完成清理。演示审核决定不会产生真实批准或付款。视频删除后，审计元数据仍保留；数据库备份遵循提供商独立的保留政策。',
  privacyCookiesTitle:'Cookie 与存储',privacyCookiesBody:'本展示页面未接入可选的分析或广告工具。接受或拒绝都会保存你的选择，且不会启用跟踪。控制台登录是独立流程，使用必要的身份验证会话。',
  privacyScopeTitle:'仍待确认的内容',privacyScopeBody:'真实采集开始前，正式通知需要明确负责机构、处理的数据、保留时间、共享方式以及联系和请求渠道。本草案尚未确认这些内容。基础设施提供商可能处理访问请求的技术数据；本草案不承诺日志保留时间。',
  cookieTitle:'Cookie 与你的选择',cookieBody:'网站在浏览器中保存必要偏好。目前没有可选跟踪工具；以下任一选择都不会启用跟踪。',cookieAccept:'接受',cookieDecline:'拒绝',cookieSettings:'Cookie 设置',cookieSavedAccept:'已保存：接受。',cookieSavedDecline:'已保存：拒绝。',cookieSaveFailed:'浏览器不允许保存此选择。该选择仅适用于本次页面访问。',
  reviewFilmLabel:'示意影片 · 外部视角，并非设备佩戴指南',
};
export const DISCOVER_HELP_COPY={vi,en,zh};
