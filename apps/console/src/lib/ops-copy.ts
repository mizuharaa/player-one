/** Console presentation copy, kept separate from the server's workflow labels. */
const en = {
  navigation: 'Navigation',
  menu: 'Open navigation',
  close: 'Close navigation',
  skip: 'Skip to workspace',
  film: 'Everyday work. A different perspective.',
  filmNote: 'Illustrative film · external view, not footage recorded by Ego.',
  filmError: 'The film could not load. You can still sign in.',
  play: 'Play film',
  pause: 'Pause film',
};

export const OPS_COPY: Record<'en' | 'vi' | 'zh', Record<keyof typeof en, string>> = {
  en,
  vi: {
    navigation: 'Điều hướng', menu: 'Mở điều hướng', close: 'Đóng điều hướng',
    skip: 'Đến khu vực làm việc', film: 'Việc mỗi ngày. Một góc nhìn khác.',
    filmNote: 'Phim minh họa · góc nhìn bên ngoài, không phải hình ảnh do Ego ghi lại.',
    filmError: 'Không tải được phim. Bạn vẫn có thể đăng nhập.',
    play: 'Phát phim', pause: 'Tạm dừng phim',
  },
  zh: {
    navigation: '导航', menu: '打开导航', close: '关闭导航', skip: '跳至工作区',
    film: '日常工作，不同视角。', filmNote: '示意影片 · 外部视角，并非 Ego 拍摄的画面。',
    filmError: '影片暂时无法加载。你仍可登录。', play: '播放影片', pause: '暂停影片',
  },
};
