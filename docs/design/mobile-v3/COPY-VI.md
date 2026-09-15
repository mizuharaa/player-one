# Vietnamese copy for the v3 screens — for approval

Every Vietnamese string the Opus lane added, beside the English it was written
from. **English is the source**: the English column is what was specified, the
Vietnamese column is what a collector reads, and the two are deliberately not
literal translations of each other.

The register is Zalo / MoMo / Grab — short sentences, `bạn` and never
`quý khách`, no `vui lòng`, no corporate formality, and the words a
collector at the desk actually uses: *buổi ghi* for a session, *quầy*
for the desk, *thẻ nhớ* for the card, *duyệt* for review.

This table is generated from `apps/collector/src/i18n.ts`, so it cannot drift
from what ships. Regenerate it if a string changes.

**Not in this table:** keys that existed before this lane (this lane reuses
them unchanged), and `tab.profile`, which Astra added — listed at the end for
the same approval pass.

**Not here at all:** the privacy policy text. An earlier draft of the Privacy
screen had four sections written for it; that copy is deleted and the screen
now reads the six agreement names, their versions and the two APP-17b
declarations that the app already ships. Privacy wording is legal's to write.

| Column | Means |
| --- | --- |
| Key | the `i18n.ts` key, unchanged from here on |
| English | the source string |
| Vietnamese | what ships, pending your approval |

## Onboarding (§4.1)

| Key | English | Vietnamese |
| --- | --- | --- |
| `onboarding.findBody` | Browse the tasks, see what one reviewed minute pays, and take the one that fits your day. | Xem danh sách nhiệm vụ, xem mỗi phút được duyệt được bao nhiêu, rồi nhận việc phù hợp với lịch của bạn. |
| `onboarding.findTitle` | FIND WORK NEAR YOU | TÌM VIỆC GẦN BẠN |
| `onboarding.paidBody` | Hand the card in at the desk. A reviewer watches the footage and you are paid for every reviewed effective minute. | Mang thẻ nhớ tới quầy. Nhân viên sẽ xem video, và bạn được trả theo từng phút hiệu quả đã duyệt. |
| `onboarding.paidTitle` | REVIEWED, THEN PAID | DUYỆT XONG LÀ CÓ TIỀN |
| `onboarding.progress` | Intro cards | Thẻ giới thiệu |
| `onboarding.skip` | Skip | Bỏ qua |
| `onboarding.tour` | Show me around | Dẫn tôi đi một vòng |
| `onboarding.wearBody` | Put the Ego on and start it with the buttons on the camera. This app never starts or stops a recording. | Đeo Ego lên rồi bấm nút trên máy để bắt đầu. Ứng dụng này không bật, không tắt ghi hình. |
| `onboarding.wearTitle` | THE CAMERA RECORDS. YOU JUST WEAR IT. | MÁY TỰ GHI. BẠN CHỈ CẦN ĐEO. |

## Explore (§4.4)

| Key | English | Vietnamese |
| --- | --- | --- |
| `explore.anyLength` | Any size | Lớn nhỏ gì cũng được |
| `explore.availability` | Biggest task you will take | Việc lớn nhất bạn nhận |
| `explore.clearAll` | Clear all | Bỏ hết bộ lọc |
| `explore.clearText` | Clear what I typed | Xóa chữ đã nhập |
| `explore.effort` | Task size | Việc lớn hay nhỏ |
| `explore.effortLong` | Large | Lớn |
| `explore.effortMedium` | Medium | Vừa |
| `explore.effortShort` | Small | Nhỏ |
| `explore.emptyAction` | Clear the filters | Bỏ bộ lọc |
| `explore.emptyTitle` | Nothing matches | Không có việc nào khớp |
| `explore.filters` | Filters | Bộ lọc |
| `explore.forYou` | Tasks for you | Nhiệm vụ cho bạn |
| `explore.onlyMine` | Only the tasks I took | Chỉ việc tôi đã nhận |
| `explore.openTask` | Open this task | Mở nhiệm vụ này |
| `explore.prefsIntro` | These stay on this phone and only change what this screen shows you. | Mấy mục này chỉ lưu trên máy bạn, và chỉ đổi những gì màn hình này hiện ra. |
| `explore.prefsTitle` | Preferences | Tùy chọn của tôi |
| `explore.recent` | Recent searches | Tìm gần đây |
| `explore.recentRemove` | Remove this search | Xóa lần tìm này |
| `explore.refresh` | Refresh | Tải lại |
| `explore.results` | Results | Kết quả |
| `explore.savePrefs` | Save preferences | Lưu tùy chọn |
| `explore.searchOpen` | Search tasks | Tìm nhiệm vụ |
| `explore.show` | Show | Hiện |
| `explore.showResults` | Show results | Xem kết quả |
| `explore.skills` | Where you can record | Nơi bạn ghi hình được |
| `explore.sort` | Sort | Sắp xếp |
| `explore.sortListed` | As the platform lists them | Theo thứ tự của hệ thống |
| `explore.sortShortest` | Shortest session first | Buổi ngắn lên trước |
| `explore.sortSlots` | Most places left | Còn nhiều chỗ nhất |

## Task detail (§4.5)

| Key | English | Vietnamese |
| --- | --- | --- |
| `detail.claimedMinutes` | Minutes taken so far | Số phút đã có người nhận |
| `detail.noTotal` | The platform works out what you are paid from the minutes a reviewer passes. There is no total to show yet. | Số tiền do hệ thống tính từ số phút được duyệt. Chưa có tổng nào để hiện ở đây. |
| `detail.rates` | Task rates | Giá của nhiệm vụ |
| `detail.slotsLeft` | Places left | Còn lại |
| `detail.where` | Where you record | Ghi ở đâu |

## Profile (§4.10)

| Key | English | Vietnamese |
| --- | --- | --- |
| `profile.about` | About | Về ứng dụng |
| `profile.aboutSub` | Who builds this, and the version | Ai làm ứng dụng này và đang ở bản mấy |
| `profile.account` | Your account | Tài khoản của bạn |
| `profile.actions` | Actions and agreements | Thao tác và thỏa thuận |
| `profile.agreementsSub` | What you accepted, and which version | Bạn đã đồng ý những gì, bản nào |
| `profile.devicesSub` | The cameras linked to you | Các máy đang liên kết với bạn |
| `profile.help` | Help | Trợ giúp |
| `profile.helpSub` | Ask the desk | Hỏi nhân viên ở quầy |
| `profile.language` | Language | Ngôn ngữ |
| `profile.logOut` | Log out | Đăng xuất |
| `profile.logOutBody` | You will need a new Zalo code to sign in again. | Lần sau đăng nhập lại, bạn cần mã Zalo mới. |
| `profile.logOutConfirm` | Yes, log out | Đăng xuất luôn |
| `profile.logOutSure` | Are you sure? | Bạn chắc chưa? |
| `profile.notInBuild` | This part is not in this build yet. The desk can help in the meantime. | Phần này chưa có trong bản này. Trong lúc chờ, bạn hỏi nhân viên ở quầy nhé. |
| `profile.notifications` | Notifications | Thông báo |
| `profile.notificationsSub` | What the platform may send you | Những gì hệ thống được gửi cho bạn |
| `profile.preferencesSub` | Task size, and where you can record | Việc lớn nhỏ và nơi bạn ghi được |
| `profile.privacy` | Privacy | Quyền riêng tư |
| `profile.privacySub` | How your footage is handled | Video của bạn được xử lý thế nào |
| `profile.role` | Collector | Người ghi dữ liệu |
| `profile.settings` | Settings | Cài đặt |
| `profile.title` | Profile | Tài khoản |
| `profile.version` | Version | Phiên bản |

## Notifications (§4.11)

| Key | English | Vietnamese |
| --- | --- | --- |
| `notif.earlier` | Earlier | Trước đó |
| `notif.email` | Email | Qua email |
| `notif.emptyBody` | Review results, payments and session reminders show up here. | Kết quả duyệt, thanh toán và nhắc buổi ghi sẽ hiện ở đây. |
| `notif.emptyTitle` | Nothing yet | Chưa có gì |
| `notif.groupPayment` | Payments | Thanh toán |
| `notif.groupPaymentWhy` | When a settlement cycle closes or money is sent. | Khi một kỳ thanh toán chốt hoặc tiền được chuyển. |
| `notif.groupReview` | Review results | Kết quả duyệt |
| `notif.groupReviewWhy` | When a reviewer passes or fails a video you handed in. | Khi nhân viên duyệt xong video bạn đã gửi. |
| `notif.groupSession` | Session reminders | Nhắc buổi ghi |
| `notif.groupSessionWhy` | Before a session you booked, and when a card is due at the desk. | Trước buổi ghi bạn đã đặt, và khi cần mang thẻ tới quầy. |
| `notif.markAllRead` | Mark all as read | Đánh dấu đã đọc hết |
| `notif.noPush` | Push messages are not switched on in this build. The desk still calls you for anything urgent. | Bản này chưa bật thông báo đẩy. Có gì gấp, nhân viên ở quầy vẫn gọi cho bạn. |
| `notif.push` | Push | Thông báo đẩy |
| `notif.settings` | Notification settings | Cài đặt thông báo |
| `notif.settingsIntro` | Nothing here is sent yet, because the channel is not built. Choose what you want and it applies when it is. | Mấy mục này chưa gửi đi đâu, vì kênh gửi chưa làm xong. Bạn chọn trước, khi nào xong sẽ áp dụng. |
| `notif.today` | Today | Hôm nay |
| `notif.unread` | Unread | Chưa đọc |

## Devices and how to record (§4.12)

| Key | English | Vietnamese |
| --- | --- | --- |
| `devices.battery` | Battery | Pin |
| `devices.howTitle` | How to record | Cách ghi hình |
| `devices.lastUsed` | Last used | Lần dùng gần nhất |
| `devices.noReadings` | This build cannot read the battery or when the camera was last used: the device record has no such field yet. Ask the desk. | Bản này chưa đọc được pin hay lần cuối máy hoạt động, vì dữ liệu thiết bị chưa có mục đó. Bạn hỏi nhân viên ở quầy. |
| `devices.notReported` | Not reported | Chưa có dữ liệu |
| `devices.step1` | Charge it the night before | Sạc máy từ tối hôm trước |
| `devices.step1Body` | A full battery is about one working day. Check the card is in the camera before you leave. | Pin đầy dùng được khoảng một ngày làm việc. Trước khi đi, kiểm tra thẻ nhớ đã nằm trong máy. |
| `devices.step2` | Put it on level | Đeo cho ngay ngắn |
| `devices.step2Body` | The lens looks where you look. If the band sits crooked the footage is crooked, and a crooked video is harder to pass. | Máy nhìn theo hướng bạn nhìn. Đeo lệch thì video lệch, mà video lệch thì khó qua duyệt hơn. |
| `devices.step3` | Start and stop it on the camera | Bấm nút trên máy để bắt đầu và kết thúc |
| `devices.step3Body` | Only the buttons on the camera start and stop a recording. This app cannot do it and never will. | Chỉ nút trên máy mới bật và tắt ghi hình. Ứng dụng này không làm được việc đó, và sẽ không bao giờ làm. |
| `devices.step4` | Bring the card to the desk | Mang thẻ tới quầy |
| `devices.step4Body` | Hand the card in as it is. Do not delete anything on it: a deleted file is work nobody can pay you for. | Mang thẻ tới quầy nguyên như vậy. Không xóa gì trong thẻ: file đã xóa là công không ai trả được cho bạn. |

## About (§4.13)

| Key | English | Vietnamese |
| --- | --- | --- |
| `about.build` | Build | Bản dựng |
| `about.what` | What this app is for | Ứng dụng này để làm gì |
| `about.whatBody` | Player One pays people to record everyday activity with a head-worn camera. A reviewer watches the footage, and you are paid for every reviewed effective minute. | Player One trả tiền cho người ghi lại hoạt động thường ngày bằng máy ghi gắn trên đầu. Nhân viên duyệt sẽ xem video, và bạn được trả theo từng phút hiệu quả đã duyệt. |
| `about.who` | Who builds it | Ai làm |
| `about.whoBody` | VNG PT Lab builds the platform. PaXini supplies the Ego camera and reviews the data. | VNG PT Lab làm nền tảng. PaXini cung cấp máy Ego và duyệt dữ liệu. |

## Privacy (§4.13)

| Key | English | Vietnamese |
| --- | --- | --- |
| `privacy.helpful` | Was this helpful? | Phần này có giúp được bạn không? |
| `privacy.index` | On this page | Trong trang này |
| `privacy.no` | No | Không |
| `privacy.thanks` | Thank you. The desk reads these. | Cảm ơn bạn. Nhân viên ở quầy sẽ đọc. |
| `privacy.yes` | Yes | Có |

## Added by Astra, listed here for the same pass

| Key | English | Vietnamese |
| --- | --- | --- |
| `tab.profile` | Profile | Tài khoản |

`Tài khoản`, not `Cá nhân` or `Tôi`: the dock's fifth
destination is the account — devices, language, agreements, log out — and
`Tài khoản` is the word MoMo and ZaloPay both use for that tab. It also
matches `profile.title`, so the tab and the screen agree.

## Four choices you may want to change

1. **`explore.effortShort/Medium/Long` read Nhỏ / Vừa / Lớn**
   ("small / medium / large"). They describe how big a *task* is, not how long
   one session is: `targetMinutes` is the task's whole target, shared across
   its claimants. An earlier draft said Ngắn / Vừa / Dài
   ("short / medium / long"), which read as a session length and was wrong.
2. **`notif.email` reads "Qua email"** rather than "Email", because a string
   byte-identical in English and Vietnamese is exactly what the catalogue's
   "translated, not copied" check refuses — and it caught this one.
3. **The three language names are not keys.** A language written in its own
   language is the same string in every catalogue, so Tiếng Việt /
   English / 中文 are data in `Profile.tsx`, beside `prov.rssi`'s
   reasoning.
4. **`devices.notReported` reads "Chưa có dữ liệu"**
   ("no data yet") rather than "Không biết" ("unknown"). The battery
   is a real property of the camera that the server does not send; "unknown"
   sounds like the camera is faulty.
