# Bản viết lại tiếng Việt — ứng dụng người thu thập

Chủ dự án duyệt từng dòng. Cột **trước** là chữ đang có trong kho, cột **sau**
là chữ đề xuất. Dòng có ⚖️ là câu pháp lý, chấp thuận hoặc khai báo: **nghĩa
giữ nguyên**, chỉ đổi cách nói — xin đọc kỹ những dòng này.

Nguyên tắc dùng cho cả bản: chữ thường ngày; gọi người dùng là **bạn**; nút bắt
đầu bằng động từ (Đăng nhập, Tiếp tục, Gửi mã, Tải lên); không có tính từ quảng
cáo ("nền tảng", "trải nghiệm", "tối ưu", "hành trình", "giải pháp"); không giữ
trật tự mệnh đề của câu tiếng Anh; không bị động "được … bởi"; câu nói việc gì
xảy ra, không nói máy móc làm gì — **"Máy chủ" không còn trong chuỗi nào của
ứng dụng**.

## Hai quyết định từ vựng cần chủ dự án gật đầu

1. **"phiên thu thập" → "phiên ghi hình".** "Phiên thu thập" là dịch thẳng
   "collection session" và không ai nói vậy. Nhãn tab vẫn là **Phiên**, mã phiên
   vẫn là **Mã phiên**. Tiếng Anh và tiếng Trung giữ nguyên "collection session"
   / 采集会话 — nghĩa như nhau, cách gọi tự nhiên hơn.
2. **"phút hiệu quả" giữ nguyên.** Đây có vẻ là từ trong hợp đồng thí điểm nên
   không đụng vào. Nếu chủ dự án thấy nên đổi, **"phút hợp lệ"** dễ hiểu hơn cho
   người đi thu thập, và đó là một lần đổi ở 5 chuỗi.

## Ba chỗ nghĩa hẹp lại so với en/zh (không sửa en/zh, chỉ báo)

| khóa | thay đổi |
|---|---|
| `exam.intro` | Bỏ câu "Máy chủ cũng kiểm tra điều này." Người thi không cần biết chỗ nào kiểm tra. en/zh vẫn còn câu đó. |
| `guide.income.split` | "Mọi con số là của máy chủ" → "Người duyệt quyết định các con số này". Cùng ý, nói bằng người thay vì bằng máy. |
| `delivery.ingesting` / `delivery.ingested` | Bỏ chủ ngữ "Máy chủ": còn "Đang đo" / "Đã nhận và đo xong". |

## Tham khảo Mobbin

Đã tra Mobbin (`search_screens`) các ứng dụng Zalo, MoMo, Grab, Be, Shopee,
Tiki. **Không mượn được chữ nào**: bản chụp của Grab, Shopee, GoPay… trên Mobbin
đều là bản tiếng Anh hoặc tiếng Indonesia, không có bản tiếng Việt. Thứ duy nhất
lấy được là *bố cục câu* của màn hình nhập mã (Grab: "Get new code in 00:19"),
và `signIn.resendIn` — "Gửi lại sau {s} giây" — đã đúng khuôn đó từ trước, giữ
nguyên.


---

# `apps/collector/src/i18n.ts`

## Chung

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `common.refreshFailed` | Chưa cập nhật được. Kết quả lần tải trước được giữ lại; vui lòng thử lại. | **Chưa cập nhật được. Đây vẫn là dữ liệu lần trước. Thử lại.** | Bỏ thể bị động "được giữ lại" và dấu chấm phẩy kiểu văn viết tiếng Anh. |
| `common.loadFailed` | Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại. | **Không tải được. Kiểm tra mạng rồi thử lại.** | "kết nối" → "mạng", chữ người dùng thật sự nói. |
| `common.actionFailed` | Không thực hiện được. Vui lòng thử lại. | **Thao tác chưa xong. Thử lại.** | "Không thực hiện được. Vui lòng thử lại." là văn hành chính. |
| `common.next` | Tiếp | **Tiếp tục** | Nút bấm dùng động từ đủ chữ, như Zalo/MoMo. "Tiếp" cụt. |
| `income.stale` | Dữ liệu lần tải trước — chưa cập nhật được. | **Dữ liệu lần trước. Chưa cập nhật được.** | Bỏ gạch ngang thay cho dấu chấm (thói quen tiếng Anh). |

## Thanh tab

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `tab.home` | Trang chính | **Trang chủ** | "Trang chính" là dịch sát "Home"; người Việt nói Trang chủ. Cũng vừa 320dp (mock đã dùng). |
| `tab.sessionHint` | Mở phần chuẩn bị phiên thu thập. Không bắt đầu ghi hình. | **Mở bước chuẩn bị cho phiên ghi hình. Không bắt đầu ghi.** | Bỏ "phần chuẩn bị phiên thu thập"; nói thẳng việc. |

## Màn hình chào

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `landing.slogan3` | Phút được duyệt, được trả. | **Phút nào được duyệt, phút đó có tiền.** | "Phút được duyệt, được trả." là cấu trúc tiếng Anh rút gọn, đọc lên không ra câu. |
| `landing.registerNote` | Tài khoản được mở tại quầy hỗ trợ. Hãy đăng nhập bằng số điện thoại bạn đã khai ở quầy. | **Quầy hỗ trợ sẽ mở tài khoản cho bạn. Đăng nhập bằng số điện thoại bạn đã đưa ở quầy.** | Bỏ bị động "Tài khoản được mở"; chủ ngữ là quầy. |

## Lời chào

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `greeting.nightOwl` | Chào ca đêm | **Khuya rồi, chào bạn** | "Chào ca đêm" là chào một ca làm việc, không chào người. en "Working late". |

## Đăng nhập

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `signIn.intro` | Nhập số điện thoại của bạn. Chúng tôi gửi mã dùng một lần qua Zalo. Không cần mật khẩu. | **Nhập số điện thoại. Mã dùng một lần sẽ gửi qua Zalo. Không cần mật khẩu.** | Bỏ "của bạn" thừa và "Chúng tôi gửi" (dịch từ "We send"). |
| `signIn.codeSent` | Nếu số này đã được đăng ký, mã sẽ đến qua Zalo trong ít phút. Hãy mở Zalo để xem. | **Nếu số này đã đăng ký, mã sẽ tới Zalo trong ít phút. Mở Zalo để xem mã.** | ⚖️ Pháp lý/bảo mật: giữ nguyên nghĩa "nếu số đã đăng ký" (không xác nhận số có tồn tại). |
| `signIn.demoFilled` | Máy chủ đang ở chế độ trình diễn nên đã điền sẵn mã. | **Bản trình diễn tự điền sẵn mã.** | Bỏ "Máy chủ". |
| `signIn.badCode` | Mã không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới. | **Mã không đúng hoặc đã hết hạn. Gửi lại mã mới.** | "Hãy yêu cầu mã mới" là dịch của "Ask for a new one". |
| `signIn.rateLimited` | Bạn đã thử quá nhiều lần. Hãy đợi ít phút rồi thử lại. | **Bạn thử quá nhiều lần. Đợi vài phút rồi thử lại.** | Bỏ "đã" và "ít phút" (dịch của "a few minutes"). |
| `signIn.unavailable` | Hiện chưa gửi được mã đăng nhập. Hãy liên hệ điểm hỗ trợ. | **Chưa gửi được mã lúc này. Hãy tới điểm hỗ trợ.** | Bỏ "Hiện" đứng đầu câu kiểu "Currently". |
| `signIn.restoring` | Đang khôi phục phiên đăng nhập… | **Đang đăng nhập lại…** | "khôi phục phiên đăng nhập" là từ của lập trình viên. |
| `signIn.chinaNote` | Mã chỉ gửi được tới số Việt Nam qua Zalo. Số +86 chưa nhận được mã. Hãy đến điểm hỗ trợ để đăng nhập. | **Zalo chỉ gửi mã tới số Việt Nam. Số +86 chưa nhận được mã. Hãy tới điểm hỗ trợ để đăng nhập.** | ⚖️ Pháp lý/minh bạch: giữ nguyên nghĩa (số +86 KHÔNG nhận được mã, không phải thiếu điều kiện). |
| `signIn.clearFailed` | Không xóa được thông tin đăng nhập đã lưu. Hãy thử lại trước khi giao điện thoại cho người khác. | **Chưa xóa được thông tin đăng nhập đã lưu. Thử lại trước khi đưa máy cho người khác.** | "giao điện thoại" → "đưa máy". |

## Đăng ký

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `register.intro` | Tạo tài khoản người thu thập để nhận nhiệm vụ và được trả công theo phút hiệu quả. | **Mở tài khoản người thu thập để nhận nhiệm vụ và nhận tiền theo phút hiệu quả.** | Bỏ bị động "được trả công". |
| `register.missing` | Điền đầy đủ họ tên và số điện thoại. | **Nhập đủ họ tên và số điện thoại.** | "Điền đầy đủ" là mẫu câu giấy tờ. |

## Thỏa thuận

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `agreements.intro` | Đăng ký chỉ hoàn tất khi bạn đồng ý cả sáu thỏa thuận. Mỗi lần đồng ý được ghi lại kèm phiên bản và thời điểm. | **Đăng ký chỉ xong khi bạn đồng ý cả sáu thỏa thuận. Mỗi lần đồng ý đều lưu kèm phiên bản và thời điểm.** | ⚖️ Pháp lý, giữ nguyên nghĩa: bỏ bị động "được ghi lại", giữ đủ "phiên bản và thời điểm". |
| `agreements.incomplete` | Cần đồng ý cả sáu thỏa thuận. | **Bạn cần đồng ý cả sáu thỏa thuận.** | ⚖️ Pháp lý, giữ nguyên nghĩa: thêm chủ ngữ "bạn", câu cũ không có ai. |

## Đào tạo

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `training.body` | Nội dung đào tạo do PaXini cung cấp và được VNG bản địa hóa: cách đeo thiết bị, thu thập ngoại tuyến và thẻ TF, đổi Wi-Fi và điểm phát sóng, hàng đợi tải lên, quyền chạy nền, pin và bộ nhớ, không gián đoạn công việc thật để tải lên, ủy quyền bối cảnh và người xung quanh, báo cáo sự cố. | **PaXini soạn nội dung đào tạo, VNG dịch sang tiếng Việt: cách đeo thiết bị, ghi hình khi không có mạng và thẻ nhớ TF, đổi Wi-Fi và phát sóng từ điện thoại, hàng đợi tải lên, quyền chạy nền, pin và bộ nhớ, không để việc tải lên làm gián đoạn công việc thật, xin phép về bối cảnh và người xung quanh, báo sự cố.** | Bỏ bị động "được VNG bản địa hóa"; "ngoại tuyến" → "khi không có mạng"; "điểm phát sóng" → "phát sóng từ điện thoại". |
| `training.placeholder` | Phần khung — nội dung thật sẽ thay thế khi PaXini bàn giao. | **Đây là phần khung. Nội dung thật sẽ thay khi PaXini bàn giao.** | Bỏ gạch ngang thay dấu chấm. |

## Bài kiểm tra

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `exam.intro` | Chưa đạt bài kiểm tra thì chưa thể nhận nhiệm vụ. Máy chủ cũng kiểm tra điều này. | **Đạt bài kiểm tra rồi bạn mới nhận được nhiệm vụ.** | Bỏ "Máy chủ cũng kiểm tra điều này" (nghĩa hẹp hơn en/zh — xem ghi chú cuối bảng). |
| `exam.q3` | Tôi hiểu rằng dữ liệu chỉ được tải lên khi tôi tự xác nhận. | **Tôi hiểu là dữ liệu chỉ tải lên khi tôi bấm xác nhận.** | ⚖️ Khai báo, giữ nguyên nghĩa: bỏ bị động "chỉ được tải lên", "rằng" là văn viết. |
| `exam.passed` | Đạt. Bạn có thể nhận nhiệm vụ. | **Đạt rồi. Bạn có thể nhận nhiệm vụ.** | "Đạt." một chữ đọc như máy. |

## Trang chủ

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `home.session` | Tạo phiên thu thập | **Tạo phiên ghi hình** | "phiên thu thập" là dịch máy của "collection session"; xem ghi chú từ vựng cuối bảng. |
| `home.gateExam` | Chưa đạt bài kiểm tra — chưa thể nhận nhiệm vụ. | **Đạt bài kiểm tra rồi mới nhận được nhiệm vụ.** | Bỏ gạch ngang nối hai mệnh đề kiểu tiếng Anh. |
| `home.gateDevice` | Chưa liên kết thiết bị — chưa thể tạo phiên thu thập. | **Liên kết thiết bị rồi mới tạo được phiên ghi hình.** | Như trên. |
| `home.ringLoading` | Đang đếm tập dữ liệu… | **Đang đếm số tập…** | "tập dữ liệu" nghe như thuật ngữ; ứng dụng gọi là "tập". |
| `home.claimableEmpty` | Hiện chưa có nhiệm vụ nào mở. | **Chưa có nhiệm vụ nào đang mở.** | "Hiện chưa có… nào mở" lặp và cứng. |
| `home.more` | Nơi khác trong ứng dụng | **Các mục khác** | "Nơi khác trong ứng dụng" dịch sát "Elsewhere in the app". |

## Hướng dẫn nhanh

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `guide.offerBody` | Vài bước ngắn. Bạn có thể mở lại bất cứ lúc nào từ trang chính. | **Chỉ vài bước ngắn. Mở lại bất cứ lúc nào ở Trang chủ.** | Bỏ "Bạn có thể" (dịch của "You can"). |
| `guide.home.ring` | Vòng nhỏ này đếm số tập đã duyệt trong danh sách máy chủ trả về. Không phải số phút, không phải tiền. Chạm để xem tất cả. | **Vòng này đếm số tập đã được duyệt. Không phải số phút, không phải tiền. Chạm để xem tất cả.** | Bỏ "Máy chủ" và "danh sách máy chủ trả về". |
| `guide.home.tabs` | Nút đen ở giữa mở phần chuẩn bị phiên thu thập. Ứng dụng không bao giờ bắt đầu hay dừng ghi hình. | **Nút đen ở giữa mở phần chuẩn bị phiên ghi hình. Ứng dụng không bật, không tắt máy ghi.** | Bỏ "không bao giờ bắt đầu hay dừng ghi hình" (dịch của never start or stop). |
| `guide.tasks.list` | Mỗi nhiệm vụ ghi rõ đơn giá, mục tiêu và số người đã nhận. Nhiệm vụ đã đủ người thì không nhận được nữa. | **Mỗi nhiệm vụ ghi rõ đơn giá, mục tiêu và số người đã nhận. Đủ người rồi thì không nhận thêm.** | Câu sau ngắn lại, bỏ "Nhiệm vụ đã đủ người thì không nhận được nữa". |
| `guide.uploads.confirm` | Dữ liệu chỉ rời máy của bạn khi bạn tự xác nhận từng tập. Không có nút tải lên tất cả. | **Dữ liệu chỉ rời máy khi bạn xác nhận từng tập. Không có nút tải lên tất cả.** | Bỏ "của bạn" và "tự" thừa. |
| `guide.income.split` | Ước tính có viền đứt nét; đã xác nhận có viền liền và nhãn riêng. Mọi con số là của máy chủ. | **Ước tính có viền đứt nét, đã xác nhận có viền liền. Người duyệt quyết định các con số này.** | Bỏ "Mọi con số là của máy chủ" (nghĩa: người duyệt quyết định). |

## Sảnh nhiệm vụ

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `hall.search` | Tìm theo tên nhiệm vụ hoặc địa điểm | **Tìm nhiệm vụ hoặc địa điểm** | "Tìm theo tên nhiệm vụ hoặc địa điểm" dài cho một ô tìm kiếm. |
| `hall.noMatches` | Không có nhiệm vụ phù hợp. Thử tên khác hoặc chọn Tất cả. | **Không tìm thấy nhiệm vụ nào. Thử từ khóa khác hoặc chọn Tất cả.** | "Thử tên khác" → "từ khóa khác", đúng việc người dùng đang làm. |
| `hall.pricePerMinute` | Đơn giá mỗi phút hiệu quả được duyệt | **Giá mỗi phút hiệu quả đã duyệt** | Bỏ bị động "được duyệt"; "Đơn giá" là từ kế toán. |

## Bối cảnh

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `scenario.home` | Tại nhà | **Ở nhà** | "Tại nhà" là văn bản hành chính; chip trong app đọc là "Ở nhà". |

## Chi tiết nhiệm vụ

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `detail.unavailable` | Nhiệm vụ này hiện không thể nhận. | **Nhiệm vụ này hiện không nhận được.** | "không thể nhận" là cấu trúc dịch. |
| `detail.notQualified` | Bạn chưa được xác nhận đủ điều kiện. Vui lòng liên hệ nhân viên tại quầy. | **Bạn chưa đủ điều kiện nhận việc. Hỏi nhân viên ở quầy.** | Bỏ bị động "chưa được xác nhận đủ điều kiện" và "Vui lòng liên hệ". |
| `detail.needExam` | Cần đạt bài kiểm tra trước khi nhận nhiệm vụ. | **Bạn cần đạt bài kiểm tra trước đã.** | Bỏ "trước khi nhận nhiệm vụ" — đang đứng ở màn hình nhiệm vụ. |
| `detail.full` | Nhiệm vụ đã đủ người nhận. | **Nhiệm vụ này đã đủ người.** | Bỏ "nhận" thừa. |
| `detail.needAgreements` | Cần đồng ý cả sáu thỏa thuận trước khi nhận nhiệm vụ. | **Bạn cần đồng ý cả sáu thỏa thuận trước đã.** | ⚖️ Pháp lý, giữ nguyên nghĩa. |
| `detail.needTraining` | Cần hoàn thành đào tạo trước khi nhận nhiệm vụ. | **Bạn cần học xong phần đào tạo trước đã.** | "hoàn thành đào tạo" là từ trong biểu mẫu. |
| `detail.notSupplied` | PaXini chưa cung cấp nội dung này. | **PaXini chưa gửi nội dung này.** | "cung cấp" → "gửi". |

## Nhiệm vụ của tôi

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `mine.empty` | Chưa nhận nhiệm vụ nào. | **Bạn chưa nhận nhiệm vụ nào.** | Thêm chủ ngữ. |

## Thiết bị

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `devices.unavailable` | Thiết lập Bluetooth và quét QR chưa khả dụng trong bản này. Nhập mã thiết bị để liên kết. | **Bản này chưa có Bluetooth và quét QR. Nhập số sê-ri để liên kết thiết bị.** | "chưa khả dụng" → "chưa có"; "mã thiết bị" → "số sê-ri" cho khớp các dòng khác. |
| `devices.bindFailed` | Không liên kết được thiết bị. Kiểm tra mã thiết bị rồi thử lại. | **Không liên kết được thiết bị. Kiểm tra số sê-ri rồi thử lại.** | Thống nhất "số sê-ri". |
| `devices.notFound` | Không tìm thấy thiết bị có mã này. Kiểm tra mã rồi thử lại. | **Không có thiết bị nào mang số sê-ri này. Kiểm tra lại số trên máy.** | Nói rõ số in ở đâu. |
| `devices.otherCollector` | Thiết bị đang được liên kết với người khác. Liên hệ nhân viên tại quầy. | **Thiết bị này đang thuộc về người khác. Hỏi nhân viên ở quầy.** | Bỏ bị động "đang được liên kết với". |
| `devices.empty` | Chưa liên kết thiết bị nào. | **Bạn chưa liên kết thiết bị nào.** | Thêm chủ ngữ. |
| `devices.qrMock` | Máy quét giả lập — trả về số sê-ri mẫu. | **Máy quét giả lập. Trả về một số sê-ri mẫu.** | Bỏ gạch ngang thay dấu chấm. |
| `devices.provision` | Cấu hình Wi-Fi qua Bluetooth | **Cài Wi-Fi qua Bluetooth** | "Cấu hình" là từ kỹ thuật. |

## Cài đặt thiết bị

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `prov.title` | Cấu hình thiết bị | **Cài đặt thiết bị** | "Cấu hình" → "Cài đặt". |
| `prov.hint` | Điện thoại gửi Wi-Fi của bạn cho thiết bị qua Bluetooth; thiết bị trả về địa chỉ IP để tải dữ liệu về máy. | **Điện thoại gửi Wi-Fi cho thiết bị qua Bluetooth. Thiết bị trả lại địa chỉ IP để tải dữ liệu về máy.** | Bỏ dấu chấm phẩy và "Wi-Fi của bạn". |
| `prov.send` | Gửi cấu hình Wi-Fi | **Gửi Wi-Fi cho thiết bị** | Nút: động từ + việc, bỏ "cấu hình". |
| `prov.sent` | Đã gửi cấu hình | **Đã gửi** | Như trên. |

## Nhắc trước khi ghi

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `reminder.title` | Trước mỗi phiên thu thập | **Trước khi ghi hình** | "Trước mỗi phiên thu thập" là tiêu đề dịch máy. |
| `reminder.body` | Tránh ghi lại thẻ căn cước, thẻ ngân hàng, mật khẩu, thông tin nhạy cảm trên màn hình, trẻ em, thông tin y tế riêng tư, địa chỉ nhà chi tiết. | **Đừng ghi hình căn cước, thẻ ngân hàng, mật khẩu, màn hình có thông tin riêng tư, trẻ em, hồ sơ sức khỏe, địa chỉ nhà cụ thể.** | ⚖️ Quyền riêng tư, giữ nguyên nghĩa và đủ bảy mục: "Tránh ghi lại" → "Đừng ghi hình"; "thẻ căn cước" → "căn cước". |

## Tạo phiên

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `session.title` | Tạo phiên thu thập | **Tạo phiên ghi hình** | Xem ghi chú từ vựng cuối bảng. |
| `session.intro` | Một phiên gắn nhiệm vụ + người thu thập + thiết bị + bối cảnh, trước khi ghi hình. | **Một phiên gồm nhiệm vụ, người thu thập, thiết bị và bối cảnh. Khai trước khi ghi hình.** | Bỏ dấu "+" nối bốn danh từ (kiểu ghi chú kỹ thuật). |
| `session.declare` | Hai khai báo bắt buộc trước khi ghi hình: | **Bạn phải trả lời hai câu này trước khi ghi hình:** | ⚖️ APP-17b, giữ nguyên nghĩa: "Hai khai báo bắt buộc" là ngôn ngữ biểu mẫu. |
| `session.needClaim` | Cần nhận một nhiệm vụ trước. | **Bạn cần nhận một nhiệm vụ trước đã.** | Thêm chủ ngữ. |
| `session.needDevice` | Cần liên kết thiết bị trước. | **Bạn cần liên kết thiết bị trước đã.** | Thêm chủ ngữ. |
| `session.needDeclarations` | Cần trả lời cả hai khai báo. | **Bạn cần trả lời cả hai câu.** | ⚖️ APP-17b, giữ nguyên nghĩa: "khai báo" → "câu", khớp với session.declare. |
| `session.noRecord` | Ứng dụng không bao giờ bắt đầu hay dừng ghi hình. Nút ghi hình nằm trên thiết bị, trong tay bạn. | **Ứng dụng không bật và không tắt máy ghi. Nút ghi nằm trên thiết bị, trong tay bạn.** | Bỏ "không bao giờ bắt đầu hay dừng ghi hình". |
| `session.chooseScenario` | Chọn nơi bạn sẽ thực hiện phiên thu thập. | **Chọn nơi bạn sẽ ghi hình.** | Bỏ "thực hiện phiên thu thập". |
| `session.scenarioUnavailable` | Địa điểm đã chọn chưa khả dụng. Liên hệ nhân viên tại quầy. | **Bối cảnh này chưa dùng được. Hỏi nhân viên ở quầy.** | "Địa điểm đã chọn chưa khả dụng" — bỏ "khả dụng". |
| `session.taskUnavailable` | Nhiệm vụ không còn khả dụng. Tải lại danh sách trước khi tiếp tục. | **Nhiệm vụ này không còn nữa. Tải lại danh sách rồi làm tiếp.** | Bỏ "khả dụng" và "trước khi tiếp tục". |
| `session.deviceUnavailable` | Thiết bị không còn được liên kết với bạn. Tải lại danh sách thiết bị. | **Thiết bị này không còn liên kết với bạn. Tải lại danh sách thiết bị.** | Bỏ bị động "không còn được liên kết". |
| `session.home` | Về trang chính | **Về trang chủ** | Khớp với tab.home. |

## Tải lên

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `uploads.confirmBody` | Dữ liệu chỉ rời máy của bạn khi bạn xác nhận. Không bao giờ tự động, không bao giờ âm thầm. | **Dữ liệu chỉ rời máy khi bạn bấm xác nhận. Không tự động, không âm thầm.** | ⚖️ Chấp thuận, giữ nguyên nghĩa: bỏ "không bao giờ" lặp hai lần. |
| `uploads.empty` | Chưa có tập dữ liệu nào. | **Chưa có tập nào.** | "tập dữ liệu" → "tập". |
| `uploads.sizeUnknown` | Chưa có thông tin | **Chưa rõ** | "Chưa có thông tin" dài cho một ô giá trị. |
| `uploads.deliverBody` | Chọn thư mục phiên trên điện thoại. Máy chủ kiểm tra và đo, không phải điện thoại. | **Chọn thư mục phiên trên điện thoại. Việc kiểm tra và đo do chúng tôi làm, không phải điện thoại.** | Bỏ "Máy chủ". |
| `uploads.pickFailed` | Chưa chọn được thư mục. Hãy chọn thư mục phiên ghi hình. | **Chưa chọn được thư mục. Chọn đúng thư mục của phiên ghi hình.** | Bỏ "Hãy" lặp. |
| `uploads.chooseSession` | Chọn phiên thu thập mà bản ghi này thuộc về. | **Chọn phiên ghi hình của bản ghi này.** | "phiên thu thập mà bản ghi này thuộc về" là mệnh đề quan hệ kiểu tiếng Anh. |
| `uploads.noSessions` | Bạn chưa khai phiên thu thập nào. Hãy tạo phiên trước khi tải lên. | **Bạn chưa tạo phiên ghi hình nào. Tạo phiên trước khi tải lên.** | "khai phiên" → "tạo phiên", khớp nút. |
| `uploads.hashing` | Đang tính mã kiểm tra tệp | **Đang kiểm tra tệp** | "tính mã kiểm tra tệp" là từ kỹ thuật. |
| `uploads.resume` | Tiếp tục lần tải lên chưa xong | **Tải tiếp lần dở dang** | Nút: động từ trước, ngắn. |
| `uploads.reasonChecksum` | Bản trên máy chủ không khớp với tệp trên điện thoại. Hãy gửi lại. | **Bản nhận được không khớp với tệp trên điện thoại. Hãy gửi lại.** | Bỏ "Máy chủ". |
| `uploads.reasonCollision` | Máy chủ đã có một phiên khác cùng tên. Nhân viên sẽ kiểm tra; không tệp nào bị ghi đè. | **Đã có một phiên khác trùng tên. Nhân viên sẽ kiểm tra. Không tệp nào bị ghi đè.** | Bỏ "Máy chủ" và dấu chấm phẩy. |
| `uploads.reasonUnknownSession` | Không tìm thấy phiên thu thập này. | **Không tìm thấy phiên ghi hình này.** | Từ vựng phiên. |
| `uploads.reasonForeignSession` | Phiên thu thập này không thuộc về bạn. | **Phiên ghi hình này không phải của bạn.** | "không thuộc về bạn" là cấu trúc dịch. |
| `uploads.reasonAlreadyComplete` | Phiên này đã được tải lên xong trước đó. | **Phiên này đã tải lên xong từ trước.** | Bỏ bị động "đã được tải lên". |
| `uploads.reasonTooLarge` | Phiên này lớn hơn mức máy chủ nhận cho một lần tải lên. | **Phiên này lớn hơn mức cho phép của một lần tải lên.** | Bỏ "Máy chủ". |
| `uploads.reasonSuperseded` | Đã có lần tải lên khác cho phiên này. Hãy tải lại danh sách. | **Phiên này đã có lần tải lên khác. Tải lại danh sách.** | Đảo lại trật tự mệnh đề cho thuận tiếng Việt. |
| `uploads.reasonBadName` | Tên thư mục không phải tên một phiên ghi hình. Hãy chọn đúng thư mục trên thẻ. | **Thư mục này không phải thư mục ghi hình. Chọn đúng thư mục trên thẻ nhớ.** | "tên thư mục không phải tên một phiên" lòng vòng; "thẻ" → "thẻ nhớ". |
| `uploads.reasonTransport` | Không gửi được tệp. Kiểm tra kết nối rồi thử lại. | **Không gửi được tệp. Kiểm tra mạng rồi thử lại.** | Khớp common.loadFailed. |
| `uploads.reasonExpired` | Đường dẫn tải lên đã hết hạn. Hãy thử lại. | **Lượt tải lên đã hết hạn. Thử lại.** | "Đường dẫn tải lên" là chi tiết kỹ thuật người dùng không cần biết. |
| `uploads.reasonPlanMismatch` | Danh sách tệp của máy chủ khác với trên điện thoại. Hãy chọn lại thư mục. | **Danh sách tệp không khớp với thư mục trên điện thoại. Chọn lại thư mục.** | Bỏ "Máy chủ". |
| `uploads.reasonNotReady` | Hãy chọn thư mục phiên và phiên thu thập trước khi tải lên. | **Chọn thư mục và chọn phiên ghi hình trước khi tải lên.** | Bỏ "Hãy", nói rõ hai việc. |
| `uploads.reasonReleased` | Nhân viên đã kết thúc lần tải lên này. Không có tệp nào bị xoá. Bạn có thể gửi lại phiên này như một lần tải lên mới. | **Nhân viên đã đóng lần tải lên này. Không tệp nào bị xóa. Bạn gửi lại phiên này như một lần mới.** | "kết thúc" → "đóng"; bỏ "có thể" (dịch của can). |

## Trạng thái giao dữ liệu

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `delivery.verified` | Đã kiểm tra dữ liệu | **Đã kiểm tra xong** | Bỏ "dữ liệu" thừa. |
| `delivery.ingesting` | Máy chủ đang đo | **Đang đo** | Bỏ "Máy chủ". |
| `delivery.ingested` | Máy chủ đã nhận và đo xong | **Đã nhận và đo xong** | Bỏ "Máy chủ". |
| `delivery.failed` | Thất bại | **Không thành công** | "Thất bại" nặng nề với người đang chờ tiền. |

## Thu nhập

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `income.estimatedHint` | Ước tính — con số cuối cùng do máy chủ quyết định sau khi duyệt. | **Đây là ước tính. Số tiền cuối cùng chốt sau khi duyệt.** | Bỏ "Máy chủ". |
| `income.intro` | Từng tập một. Ứng dụng không cộng gộp và không tự tính tiền. | **Tiền tính theo từng tập. Ứng dụng không cộng gộp, không tự tính.** | "Từng tập một." chưa thành câu. |
| `income.empty` | Chưa có thu nhập nào. | **Chưa có khoản thu nhập nào.** | Thêm "khoản" cho thành câu. |
| `income.progress` | Tiến trình | **Tiến độ** | Khớp hall.progress; "Tiến trình" là từ kỹ thuật. |
| `settlement.not_paid` | Không được chấp nhận | **Không được duyệt** | "Không được chấp nhận" mơ hồ; en "Not paid" sau khi duyệt trượt. |

## Diễn đàn & nhóm

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `forum.notConnected` | Diễn đàn đang ở bản xem trước. Bạn chưa gửi được bài hay trả lời. Chúng tôi sẽ báo khi mở. | **Diễn đàn đang là bản xem trước. Bạn chưa đăng bài hay trả lời được. Mở xong chúng tôi sẽ báo.** | "Chúng tôi sẽ báo khi mở" là trật tự mệnh đề tiếng Anh. |
| `groups.notConnected` | Chưa kết nối. Bạn chưa gửi được tin nhắn. | **Chưa kết nối. Bạn chưa gửi được tin.** | "tin nhắn" → "tin" cho gọn. |
| `groups.operatorsOnly` | Chỉ nhân viên vận hành đăng ở kênh này. | **Chỉ nhân viên vận hành đăng tin ở đây.** | "ở kênh này" → "ở đây". |

---

# `docs/design/mobile-v2/mock/copy.js`

## mock lệch catalogue

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `signIn.chinaNote` | Số Trung Quốc nhận mã qua Zalo như số Việt Nam. | **Zalo chỉ gửi mã tới số Việt Nam. Số +86 chưa nhận được mã. Hãy tới điểm hỗ trợ để đăng nhập.** | Mock đang hiện chữ không có trong i18n.ts; chép lại cho khớp. |
| `training.body` | Đeo thiết bị đúng cách, xin phép trước khi ghi hình người khác, và chỉ tải lên khi bạn tự xác nhận. | **PaXini soạn nội dung đào tạo, VNG dịch sang tiếng Việt: cách đeo thiết bị, ghi hình khi không có mạng và thẻ nhớ TF, đổi Wi-Fi và phát sóng từ điện thoại, hàng đợi tải lên, quyền chạy nền, pin và bộ nhớ, không để việc tải lên làm gián đoạn công việc thật, xin phép về bối cảnh và người xung quanh, báo sự cố.** | Mock đang hiện chữ không có trong i18n.ts; chép lại cho khớp. |
| `scenario.home` | Nhà | **Ở nhà** | Mock đang hiện chữ không có trong i18n.ts; chép lại cho khớp. |

---

# `docs/design/mobile-v2/mock/copy.js + SPEC.md`

## Đăng nhập (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `signIn.sentTo` | Mã đã gửi tới {phone} | **Đã gửi mã tới {phone}** | Nút/thông báo: động từ trước. |

## Đăng ký (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `register.phoneLocked` | Số này đã xác minh ở bước trước nên không sửa ở đây. | **Số này đã xác minh ở bước trước, không sửa ở đây được.** | Bỏ "nên" nối hai mệnh đề kiểu dịch. |

## Trang chủ (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `home.cycleUnavailable` | Chưa có tổng của kỳ này. Bạn vẫn xem được tiền của từng tập ở mục Thu nhập. | **Chưa có tổng của kỳ này. Bạn vẫn xem được tiền từng tập ở mục Thu nhập.** | Bỏ "của" thừa. |
| `home.cycleWithEstimate` | Kể cả ước tính: {amount} | **Tính cả ước tính: {amount}** | "Kể cả" mang nghĩa nhượng bộ. |

## Hướng dẫn nhanh (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `guide.home.earnings` | Đây là tiền của những tập đã được duyệt trong kỳ này. Người duyệt quyết định con số, không phải ứng dụng. | **Đây là tiền của các tập đã duyệt trong kỳ này. Người duyệt quyết định con số, không phải ứng dụng.** | Bỏ bị động "đã được duyệt". |

## Nơi nhận tiền (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `payout.none` | Chưa khai báo — liên hệ điểm hỗ trợ | **Chưa khai báo. Hỏi điểm hỗ trợ.** | Gạch ngang thay dấu chấm. |
| `payout.unknown` | Chưa rõ bạn sẽ nhận tiền ở đâu. Hỏi điểm hỗ trợ giúp bạn. | **Chưa rõ bạn nhận tiền ở đâu. Điểm hỗ trợ sẽ cài giúp bạn.** | "Hỏi điểm hỗ trợ giúp bạn" tối nghĩa (ai giúp ai). |

---

# `packages/api/src/i18n.ts`

## API: nhận nhiệm vụ

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.task_not_found` | Nhiệm vụ đó không còn nữa. | **Nhiệm vụ này không còn nữa.** | "đó" dịch từ "that"; tiếng Việt dùng "này". |
| `bo.refused.task_not_claimable` | Nhiệm vụ đó hiện không mở, nên không thể nhận và không thể ghi hình cho nhiệm vụ đó. | **Nhiệm vụ này chưa mở nên chưa nhận và chưa ghi hình được.** | Bỏ lặp "nhiệm vụ đó" ở cuối câu. |
| `bo.refused.task_at_capacity` | Nhiệm vụ đó đã đủ số người thu thập. Hãy chọn nhiệm vụ khác. | **Nhiệm vụ này đã đủ người. Hãy chọn nhiệm vụ khác.** | Bỏ "số người thu thập". |
| `bo.refused.exam_not_passed` | Bạn phải đạt bài kiểm tra trước khi nhận nhiệm vụ. Hãy làm bài ở màn hình đào tạo. | **Đạt bài kiểm tra rồi bạn mới nhận được nhiệm vụ. Bài nằm ở mục Đào tạo.** | "màn hình đào tạo" → "mục Đào tạo", đúng tên trong app. |
| `bo.refused.not_qualified` | Tài khoản này chưa được duyệt để thu thập. Trung tâm tải lên có thể cho biết tình trạng hiện tại. | **Tài khoản của bạn chưa được duyệt để đi thu thập. Trung tâm tải lên sẽ cho bạn biết tình trạng hiện tại.** | "Tài khoản này" → "của bạn"; "có thể cho biết" → "sẽ cho bạn biết". |
| `bo.refused.agreements_incomplete` | Bạn phải chấp nhận đủ sáu thỏa thuận trước khi nhận nhiệm vụ. | **Bạn cần đồng ý đủ sáu thỏa thuận trước khi nhận nhiệm vụ.** | ⚖️ Pháp lý, giữ nguyên nghĩa: "chấp nhận" → "đồng ý" cho khớp app. |
| `bo.refused.claim_id_reused` | Mã đó đã thuộc về một nhiệm vụ khác. Hãy thử nhận nhiệm vụ lại. | **Mã này đã thuộc về một nhiệm vụ khác. Hãy nhận lại nhiệm vụ.** | Bỏ "thử… lại". |
| `bo.refused.claim_released` | Bạn đã trả lại nhiệm vụ này trước đó, nên mã đó không dùng lại được. Hãy nhận lại để có mã mới. | **Bạn đã trả lại nhiệm vụ này nên mã cũ không dùng lại được. Nhận lại nhiệm vụ để có mã mới.** | Bỏ "trước đó" thừa. |

## API: thỏa thuận

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.agreement_version_unknown` | Các thỏa thuận trên màn hình này đã cũ. Hãy tải lại và đọc trước khi chấp nhận. | **Thỏa thuận trên màn hình này đã cũ. Tải lại và đọc bản mới trước khi đồng ý.** | ⚖️ Pháp lý, giữ nguyên nghĩa: nói rõ "bản mới". |

## API: thiết bị

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.device_not_found` | Không có thiết bị nào mang số sê-ri đó. Hãy kiểm tra số in trên vỏ máy. | **Không có thiết bị nào mang số sê-ri này. Kiểm tra số in trên vỏ máy.** | "đó" → "này"; bỏ "Hãy". |
| `bo.refused.device_not_available` | Thiết bị đó đã ngừng sử dụng, nên không thể ghép nối. | **Thiết bị này đã ngừng sử dụng nên không liên kết được.** | "ghép nối" → "liên kết" cho khớp app. |
| `bo.refused.already_bound` | Thiết bị đó đã được ghép nối với người khác. | **Thiết bị này đang liên kết với người khác.** | Bỏ bị động "đã được ghép nối". |
| `bo.refused.device_not_bound` | Thiết bị đó chưa ghép nối với bạn. Hãy ghép nối trước khi bắt đầu phiên thu thập. | **Thiết bị này chưa liên kết với bạn. Liên kết trước khi tạo phiên ghi hình.** | Thống nhất "liên kết" và "phiên ghi hình". |

## API: phiên

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.task_not_claimed` | Bạn không giữ nhiệm vụ đó, nên không thể ghi hình cho nó. Hãy nhận nhiệm vụ trước. | **Bạn chưa nhận nhiệm vụ này nên chưa ghi hình được. Hãy nhận nhiệm vụ trước.** | "Bạn không giữ nhiệm vụ đó" là dịch sát "you do not hold". |
| `bo.refused.scenario_not_found` | Nền tảng không ghi nhận bối cảnh đó. | **Không có bối cảnh này.** | Bỏ "Nền tảng" (từ bị cấm) và "ghi nhận". |
| `bo.refused.session_id_reused` | Mã đó đã thuộc về một phiên thu thập khác. Hãy tạo lại phiên. | **Mã này đã thuộc về một phiên khác. Hãy tạo lại phiên.** | "đó" → "này". |

## API: tải lên

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.upload_unknown_session` | Phiên thu thập đó không tồn tại. Hãy gán phiên trong ứng dụng trước khi tải lên. | **Không có phiên ghi hình này. Chọn phiên trong ứng dụng trước khi tải lên.** | "gán phiên" là từ của lập trình viên. |
| `bo.refused.upload_foreign_session` | Phiên thu thập đó thuộc về người thu thập khác, nên không thể tải dữ liệu lên phiên đó. | **Phiên ghi hình này của người khác nên bạn không tải lên được.** | Bỏ "người thu thập khác" và "lên phiên đó". |
| `bo.refused.upload_already_complete` | Lần tải lên này đã hoàn tất và đã được kiểm tra. Gửi lại cũng không thay đổi gì. | **Lần tải lên này đã xong và đã kiểm tra. Gửi lại cũng không thay đổi gì.** | "hoàn tất" → "xong"; bỏ bị động. |
| `bo.refused.upload_checksum_mismatch` | Một tệp trên đám mây không khớp với giá trị kiểm tra mà điện thoại đã tính. Đoạn ghi hình này bị giữ lại, không vào duyệt, cho đến khi được gửi lại. | **Có một tệp không khớp với bản trên điện thoại. Đoạn ghi hình này bị giữ lại, chưa vào duyệt, cho tới khi bạn gửi lại.** | Bỏ "trên đám mây" và "giá trị kiểm tra mà điện thoại đã tính". |
| `bo.refused.upload_payload_too_large` | Lần giao đó lớn hơn mức một lần tải lên được phép khai báo. Hãy gửi thành nhiều lần tải lên, hoặc nộp thẻ nhớ tại trung tâm tải lên. | **Lần này nhiều dữ liệu hơn mức cho phép của một lần tải lên. Hãy chia làm nhiều lần, hoặc mang thẻ nhớ tới trung tâm tải lên.** | "Lần giao đó lớn hơn mức… được phép khai báo" là câu dịch. |
| `bo.refused.upload_superseded` | Một lần giao mới hơn của đoạn ghi hình này đã đến trong khi các tệp đang được gửi, nên kết quả lần này không được ghi nhận. Hãy tải lên lại. | **Trong lúc gửi, một bản mới hơn của đoạn ghi hình này đã tới nên lần này không được tính. Hãy tải lên lại.** | Đảo mệnh đề thời gian ra trước, như tiếng Việt nói. |
| `bo.refused.upload_basename_collision` | Máy tải lên đã có một thư mục ghi hình cùng tên nhưng chứa các tệp khác. Không có gì bị thay đổi và không có gì bị ghi đè. Một nhân viên vận hành phải quyết định bản ghi nào mới là thật. | **Đã có một thư mục ghi hình trùng tên nhưng chứa tệp khác. Không có gì bị ghi đè. Nhân viên vận hành sẽ xác định bản nào là thật.** | Bỏ "Máy tải lên" và câu "Không có gì bị thay đổi" trùng ý. |
| `bo.refused.upload_ingest_failed` | Mọi tệp đều đến nguyên vẹn, nhưng bộ máy đo không đọc được đoạn ghi hình. Các tệp vẫn được giữ. Hãy báo lần tải lên này cho nhân viên vận hành. | **Tệp đã tới đủ nhưng chưa đo được đoạn ghi hình. Tệp vẫn được giữ. Hãy báo lần tải lên này cho nhân viên vận hành.** | "bộ máy đo không đọc được" → "chưa đo được". |
| `bo.refused.session_basename_unrecognised` | Thư mục đó không phải là thư mục ghi hình. Hãy chọn thư mục do máy ảnh tạo ra, tên của nó bắt đầu bằng thiết bị và số sê-ri. | **Thư mục này không phải thư mục ghi hình. Hãy chọn thư mục do thiết bị tạo ra, tên bắt đầu bằng số sê-ri của máy.** | "máy ảnh" → "thiết bị"; bỏ mệnh đề "tên của nó". |

## API: đăng nhập

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `bo.refused.sign_in_rate_limited` | Quá nhiều lần đăng nhập bị từ chối. Hãy đợi vài phút rồi thử lại — giới hạn tự hết hạn, không ai cần mở khóa. | **Bạn thử đăng nhập sai quá nhiều lần. Đợi vài phút rồi thử lại, không cần ai mở khóa.** | Bỏ "Quá nhiều lần đăng nhập bị từ chối" (bị động) và gạch ngang. |

---

# `docs/design/mobile-v2/SPEC.md`

## Hướng dẫn nhanh (khóa MỚI)

| khóa | trước | sau | vì sao |
|---|---|---|---|
| `guide.home.next` | Bước tiếp theo của bạn nằm ở đây — nhận việc, liên kết thiết bị, hay tải lên. | **Bước tiếp theo của bạn nằm ở đây: nhận việc, liên kết thiết bị hoặc tải lên.** | Gạch ngang → dấu hai chấm; "hay" → "hoặc". |

---

## Những gì KHÔNG đụng tới

- Tên khóa: không thêm, không bớt, không đổi thứ tự (304 khóa trước và sau).
- `en` và `zh`: không sửa một chữ nào.
- Tên sáu thỏa thuận (`agreement.*`) và hai nhãn pháp lý (`legal.privacy`,
  `legal.dataNotice`): giữ nguyên từng chữ.
- Các chuỗi back office trong `packages/api/src/i18n.ts` (màn hình duyệt, màn
  hình tài chính): chỉ nhân viên VNG/PaXini đọc, không hiện trên điện thoại, nên
  nằm ngoài đợt này. Ở đó vẫn còn "Máy chủ" và "nền tảng".
