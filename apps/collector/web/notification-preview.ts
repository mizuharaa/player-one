import type { CollectorNotification } from '../src/screens/Notifications.tsx';

// Browser/test simulation only; never mounted by the live route.
export const NOTIFICATION_PREVIEW: readonly CollectorNotification[] = [
  {
    id: 'n-1',
    kind: 'review',
    title: 'Một video đã được duyệt',
    body: 'Buổi ghi ngày 12/09 đã qua duyệt. Số phút hiệu quả nằm trong mục Thu nhập.',
    at: new Date().toISOString(),
    read: false,
  },
  {
    id: 'n-2',
    kind: 'session',
    title: 'Nhớ mang thẻ nhớ tới quầy',
    body: 'Buổi ghi hôm nay đã xong. Mang thẻ tới quầy để nhân viên nhận.',
    at: new Date().toISOString(),
    read: false,
  },
  {
    id: 'n-3',
    kind: 'payment',
    title: 'Kỳ thanh toán đã chốt',
    body: 'Kỳ 01/09 – 07/09 đã chốt. Xem chi tiết trong mục Thu nhập.',
    at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    read: true,
  },
  {
    id: 'n-4',
    kind: 'device',
    title: 'Thiết bị cần sạc',
    body: 'Máy EGO1-PILOT-0007 báo pin yếu ở lần bàn giao trước.',
    at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    read: true,
  },
];
