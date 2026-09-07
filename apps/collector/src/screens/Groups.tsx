import { Text, View } from 'react-native';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Button, CardLink, Hatch, ListScreen, Note, Screen, face } from '../ui.tsx';

/**
 * The group chats, and one group's thread.
 *
 * **There is no chat service behind either of them.** `GROUPS` and `MESSAGES`
 * below are local mock data; nothing is fetched, nothing is sent, and the
 * composer in the thread is disabled and says why. Every control that would
 * need a server carries a `ponytail:` note naming the route that would replace
 * it — routes that do not exist yet, and are the shape of the request rather
 * than a promise about a path.
 *
 * **Who may do what.** `PRODUCT.md` puts collectors — members of the public —
 * in this app and operators — VNG staff — in the console. A collector reads
 * every group and writes in the ones they are a member of. The announcements
 * channel is the one place that asymmetry is visible: only operators post
 * there, so its composer says so instead of saying "not connected". Removing a
 * message, muting a member and closing a group are the operator's, they belong
 * in the back office, and there is deliberately no control for any of them
 * here — a collector must never see one.
 *
 * **Names are what the row can honestly show.** A group has a name because an
 * operator gave it one; a person is a collector reference, because
 * `collectors` has no display-name column (`PRODUCT.md`). So the previews read
 * `c-2: …` and the announcements come from `op-2`.
 *
 * The mock content is Vietnamese and stays in this file: the chrome is in
 * `i18n.ts` in all three catalogues, and what people typed is content.
 *
 * The one lime moment on the list is the **unread** dot, which is also carried
 * by the group's name going semibold and its preview going full-strength ink —
 * never colour alone, on the one state that decides whether a collector opens
 * the row.
 */

interface Group {
  id: string;
  name: string;
  /** Two characters, so a row has a mark without an image asset to ship. */
  initials: string;
  ago: string;
  preview: string;
  unread: number;
  /** The announcements channel. A collector reads it and cannot post to it. */
  readOnly: boolean;
}

/** ponytail: mock. `GET /api/me/groups` when there is a chat service. */
const GROUPS: Group[] = [
  {
    id: 'g-1',
    name: 'Điểm hỗ trợ Quận 7',
    initials: 'Q7',
    ago: '09:41',
    preview: 'c-9: Mình vừa nộp thẻ xong, quầy khá vắng.',
    unread: 3,
    readOnly: false,
  },
  {
    id: 'g-2',
    name: 'Kịch bản: Nhà bếp',
    initials: 'NB',
    ago: 'Hôm qua',
    preview: 'c-3: Cảm ơn, tối nay mình thử thêm đèn bếp.',
    unread: 0,
    readOnly: false,
  },
  {
    id: 'g-3',
    name: 'Thông báo Player One',
    initials: 'PO',
    ago: 'Thứ Hai',
    preview: 'op-2: Đơn giá phút hiệu quả tháng 9 đã cập nhật.',
    unread: 1,
    readOnly: true,
  },
];

interface Message {
  id: string;
  author: string;
  at: string;
  text: string;
  /** Written by the signed-in collector. Drawn in ink, aligned right. */
  mine: boolean;
}

/** ponytail: mock. `GET /api/me/groups/:id/messages` when there is a service. */
const MESSAGES: Record<string, Message[]> = {
  'g-1': [
    { id: 'm-1', author: 'c-2', at: '08:12', text: 'Sáng nay quầy mở từ 8h nhé.', mine: false },
    {
      id: 'm-2',
      author: 'c-1',
      at: '08:30',
      text: 'Mình mang thẻ qua trước 9h được không?',
      mine: true,
    },
    {
      id: 'm-3',
      author: 'c-2',
      at: '08:34',
      text: 'Được. Nhớ mang theo mã phiên ghi trong ứng dụng, quầy cần đối chiếu.',
      mine: false,
    },
    {
      id: 'm-4',
      author: 'c-9',
      at: '09:41',
      text: 'Mình vừa nộp thẻ xong, quầy khá vắng.',
      mine: false,
    },
  ],
  'g-2': [
    {
      id: 'm-5',
      author: 'c-5',
      at: '19:02',
      text: 'Mình quay bữa tối, ánh sáng đèn vàng có sao không?',
      mine: false,
    },
    {
      id: 'm-6',
      author: 'c-1',
      at: '19:20',
      text: 'Mình từng bị từ chối một tập vì thiếu sáng. Bật thêm đèn bếp thì đạt.',
      mine: true,
    },
    {
      id: 'm-7',
      author: 'c-3',
      at: '19:35',
      text: 'Cảm ơn, tối nay mình thử thêm đèn bếp.',
      mine: false,
    },
  ],
  'g-3': [
    {
      id: 'm-8',
      author: 'op-2',
      at: 'Thứ Sáu · 16:20',
      text: 'Điểm hỗ trợ Quận 7 nghỉ Chủ nhật. Hãy nộp thẻ vào thứ Bảy.',
      mine: false,
    },
    {
      id: 'm-9',
      author: 'op-2',
      at: 'Thứ Hai · 10:00',
      text: 'Đơn giá phút hiệu quả tháng 9 đã cập nhật. Xem ở trang Thu nhập.',
      mine: false,
    },
  ],
};

export function GroupChats() {
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();

  return (
    <ListScreen
      title={tt('groups.title')}
      data={GROUPS}
      keyOf={(group) => group.id}
      empty={<Hatch text={tt('forum.empty')} />}
      renderItem={(group) => {
        const unread = group.unread > 0;
        return (
          <CardLink
            // The unread count rides in the spoken name, because the dot that
            // carries it visually is a shape TalkBack has nothing to say about.
            label={unread ? `${group.name}, ${group.unread} ${tt('groups.unread')}` : group.name}
            hint={tt('groups.open')}
            onPress={() => nav.push({ name: 'groupThread', groupId: group.id })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View
                style={{
                  width: theme.space[10],
                  height: theme.space[10],
                  borderRadius: theme.space[5],
                  backgroundColor: theme.color.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  style={{
                    color: theme.color.foreground,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.sm,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  {group.initials}
                </Text>
              </View>
              <View style={{ flexGrow: 1, flexShrink: 1, gap: theme.space[0.5] }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    gap: theme.space[2],
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.color.foreground,
                      fontFamily: face(theme),
                      fontSize: theme.fontSize.md,
                      fontWeight: unread ? theme.fontWeight.semibold : theme.fontWeight.medium,
                      flexGrow: 1,
                      flexShrink: 1,
                    }}
                  >
                    {group.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: theme.color.mutedForeground,
                      fontFamily: face(theme),
                      fontSize: theme.fontSize.sm,
                      // The name gives way, not the time: at 320dp "Hôm qua"
                      // wrapped onto a second line and grew the row, which is
                      // the one thing a list of rows must not do.
                      flexShrink: 0,
                    }}
                  >
                    {group.ago}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    // An unread row's preview is full-strength ink and a read
                    // one's is muted: the second carrier of the state, so the
                    // dot is never the only one.
                    color: unread ? theme.color.foreground : theme.color.mutedForeground,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.sm,
                  }}
                >
                  {group.preview}
                </Text>
              </View>
              {unread ? (
                <View
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: theme.space[2],
                    height: theme.space[2],
                    borderRadius: theme.space[1],
                    backgroundColor: theme.color.lime[500],
                  }}
                />
              ) : null}
            </View>
          </CardLink>
        );
      }}
    />
  );
}

export function GroupThread() {
  const { groupId } = useRoute('groupThread');
  const tt = useT();
  const theme = useTheme();
  const group = GROUPS.find((g) => g.id === groupId);
  const messages = MESSAGES[groupId] ?? [];

  // A group id with no group is a route that could only be reached by a
  // programming error, so it says the list is empty rather than crashing.
  if (group === undefined) {
    return (
      <Screen title={tt('groups.title')}>
        <Hatch text={tt('forum.empty')} />
      </Screen>
    );
  }

  return (
    // `Screen` flexes and the composer takes its own height under it, so the
    // messages scroll and the composer stays put — which is what a composer
    // does, and what an absolutely positioned one would have needed a matching
    // bottom padding inside the scroller to fake.
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <Screen title={group.name}>
        {messages.map((message) => (
          <View
            key={message.id}
            style={{
              alignItems: message.mine ? 'flex-end' : 'flex-start',
              gap: theme.space[1],
            }}
          >
            <Text
              style={{
                color: theme.color.mutedForeground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.sm,
              }}
            >
              {message.author} · {message.at}
            </Text>
            <View
              style={{
                // The collector's own line takes the ink the rest of this app
                // gives their own actions; everybody else's takes the neutral
                // one step off the page. Both invert with the scheme, so
                // neither is a light bubble on a dark phone.
                backgroundColor: message.mine ? theme.color.action : theme.color.muted,
                borderRadius: theme.radius.lg,
                paddingVertical: theme.space[3],
                paddingHorizontal: theme.space[4],
                maxWidth: '86%',
              }}
            >
              <Text
                style={{
                  color: message.mine ? theme.color.actionInk : theme.color.foreground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.base,
                  lineHeight: theme.fontSize.base * 1.5,
                }}
              >
                {message.text}
              </Text>
            </View>
          </View>
        ))}
      </Screen>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: theme.color.border,
          padding: theme.space[4],
          gap: theme.space[3],
        }}
      >
        <Note text={group.readOnly ? tt('groups.operatorsOnly') : tt('groups.notConnected')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <View
            style={{
              flexGrow: 1,
              flexShrink: 1,
              backgroundColor: theme.color.surface,
              borderWidth: 1,
              borderColor: theme.color.borderStrong,
              borderRadius: theme.radius.sm,
              minHeight: theme.space[12],
              justifyContent: 'center',
              paddingHorizontal: theme.space[3],
            }}
          >
            {/* Not a `TextInput`. A field that accepts typing and then throws
                the words away is worse than one that never offered. */}
            <Text
              style={{
                color: theme.color.mutedForeground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.base,
              }}
            >
              {tt('groups.placeholder')}
            </Text>
          </View>
          <Button
            label={tt('groups.send')}
            disabled
            // ponytail: no-op, and disabled so it cannot be reached anyway.
            // `POST /api/me/groups/:id/messages` when there is a service.
            onPress={() => {}}
          />
        </View>
      </View>
    </View>
  );
}
