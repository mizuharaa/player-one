import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { GlyphPlus } from '../glyphs.tsx';
import {
  Body,
  CardLink,
  Chip,
  Hatch,
  ListScreen,
  Note,
  Tag,
  Title,
  face,
  useTabBarReserve,
} from '../ui.tsx';

/**
 * The community feed: collectors asking each other about collection work.
 *
 * **There is no forum behind this screen.** No API exists, none is being built
 * this sprint, and nothing here reads or writes one — `POSTS` below is local
 * mock data and every control that would touch a server is a no-op carrying a
 * `ponytail:` note naming the route that would replace it. Those routes do not
 * exist yet; they are the shape of the request, not a promise about a path.
 * `forum.notConnected` is what the screen says out loud when one is pressed,
 * so a collector is never left tapping a control that answers nothing.
 *
 * **Who may do what here.** `PRODUCT.md` puts collectors — members of the
 * public — in this app and operators — VNG staff — in the console. So a
 * collector posts and replies, and that is the whole of it. Moderation
 * (removing a post, locking a thread, pinning an answer) is the operator's
 * job and belongs in the back office; there is deliberately no moderation
 * control on this screen, because a collector must never see one.
 *
 * **Author names are collector references.** `PRODUCT.md` records that
 * `collectors` has no display-name column and the console shows an external
 * reference, so the feed shows `c-1`, `c-2` and so on. Inventing a display
 * name here would be inventing a column.
 *
 * **The mock content is Vietnamese and stays in this file.** Every label,
 * filter and sentence the app itself says is in `i18n.ts` in all three
 * catalogues; the posts are content, not chrome, and the collector language is
 * Vietnamese (LOC-01). Real posts would arrive in whatever language a
 * collector typed them in, which is exactly what this shows.
 *
 * The one lime moment is the **answered** tag: on a feed of questions about
 * whether a scenario counts and why an episode was rejected, "somebody has
 * replied to this" is the state worth spending the accent on. It carries the
 * word as well as the fill — never colour alone.
 */

/**
 * The signed-in collector, for the "my posts" filter.
 *
 * ponytail: a constant, not `api.profile()`. The rest of this screen is mock
 * data with no server behind it, so reading the real profile would make one
 * line of it true and the other forty pretend. When the feed is real, this is
 * the `collector_ref` on the profile the app already fetches.
 */
const ME = 'c-1';

interface Post {
  id: string;
  /** A collector reference. There is no display name to show; see above. */
  author: string;
  ago: string;
  title: string;
  body: string;
  topics: string[];
  reactions: number;
  replies: number;
  answered: boolean;
}

/** ponytail: mock. `GET /api/me/forum/posts` when there is a forum service. */
const POSTS: Post[] = [
  {
    id: 'p-1',
    author: 'c-4',
    ago: '2 giờ trước',
    title: 'Nấu ăn ở nhà có tính là kịch bản trong nhà không?',
    body: 'Tôi nấu ăn khoảng 40 phút, giữa chừng ra ban công phơi đồ 5 phút. Đoạn ngoài ban công có bị trừ không?',
    topics: ['Kịch bản', 'Trong nhà'],
    reactions: 18,
    replies: 6,
    answered: true,
  },
  {
    id: 'p-2',
    author: 'c-2',
    ago: '5 giờ trước',
    title: 'Máy nóng lên sau khoảng 40 phút quay',
    body: 'Quay ở kho hàng buổi trưa. Sau 40 phút thân máy rất nóng và pin tụt nhanh hơn hẳn. Ai gặp giống vậy chưa?',
    topics: ['Thiết bị', 'Kho hàng'],
    reactions: 31,
    replies: 12,
    answered: false,
  },
  {
    id: 'p-3',
    author: 'c-1',
    ago: 'Hôm qua',
    title: 'Tập của tôi bị từ chối, lý do ghi là thiếu sáng',
    body: 'Tập quay buổi tối trong bếp bị từ chối, lý do là thiếu sáng. Tôi đã bật đèn trần rồi. Nên quay giờ nào?',
    topics: ['Duyệt', 'Trong nhà'],
    reactions: 9,
    replies: 4,
    answered: true,
  },
  {
    id: 'p-4',
    author: 'c-7',
    ago: '2 ngày trước',
    title: 'Xin phép quản lý trước khi quay trong cửa hàng',
    body: 'Trước tôi bị nhân viên hỏi ba lần một buổi. Giờ tôi gặp quản lý trước và cho xem thẻ, không ai hỏi nữa.',
    topics: ['Cửa hàng', 'Kinh nghiệm'],
    reactions: 44,
    replies: 8,
    answered: false,
  },
  {
    id: 'p-5',
    author: 'c-1',
    ago: '3 ngày trước',
    title: 'Đeo camera ở siêu thị có cần báo trước không?',
    body: 'Siêu thị gần nhà rất đông. Tôi chưa rõ có phải báo với bảo vệ ở cửa không. Ai quay rồi chỉ giúp với.',
    topics: ['Cửa hàng'],
    reactions: 6,
    replies: 2,
    answered: false,
  },
];

const FILTERS = ['all', 'mine', 'answered'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_KEYS = {
  all: 'forum.filter.all',
  mine: 'forum.filter.mine',
  answered: 'forum.filter.answered',
} as const;

const keep = (post: Post, filter: Filter): boolean =>
  filter === 'all' ? true : filter === 'mine' ? post.author === ME : post.answered;

export function Forum() {
  const tabReserve = useTabBarReserve();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  /**
   * Raised by any control that would need the service that does not exist.
   * The filters are real and do not raise it — they sort what is already on
   * the phone, which is the one thing this screen can honestly do.
   */
  const [notice, setNotice] = useState(false);
  const filtersTarget = useGuideTarget('forum.filters');

  const posts = POSTS.filter((post) => keep(post, filter));

  const caption = (text: string) => (
    <Text
      style={{
        color: theme.color.mutedForeground,
        fontFamily: face(theme),
        fontSize: theme.fontSize.sm,
      }}
    >
      {text}
    </Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        title={tt('forum.title')}
        right={
          <Chip label={tt('groups.title')} onPress={() => nav.push({ name: 'groupChats' })} />
        }
        data={posts}
        keyOf={(post) => post.id}
        header={
          <View ref={filtersTarget} collapsable={false} style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {FILTERS.map((name) => (
                <Chip
                  key={name}
                  label={tt(FILTER_KEYS[name])}
                  selected={filter === name}
                  onPress={() => setFilter(name)}
                />
              ))}
            </View>
            {notice ? <Note text={tt('forum.notConnected')} /> : null}
          </View>
        }
        empty={<Hatch text={tt('forum.empty')} />}
        renderItem={(post) => (
          <CardLink
            label={post.title}
            hint={tt('forum.open')}
            // ponytail: no-op. `GET /api/me/forum/posts/:id` and its thread
            // would open here; until that exists the screen says so rather
            // than pushing an empty route.
            onPress={() => setNotice(true)}
          >
            {caption(`${post.author} · ${post.ago}`)}
            <Title>{post.title}</Title>
            <Body>{post.body}</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {post.topics.map((topic) => (
                <Chip key={topic} label={topic} />
              ))}
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: theme.space[3],
              }}
            >
              {caption(
                `${post.reactions} ${tt('forum.reactions')} · ${post.replies} ${tt('forum.replies')}`,
              )}
              {post.answered ? (
                <Tag
                  label={tt('forum.filter.answered')}
                  // The measured pair: `lime[500]` is a fill and only a fill,
                  // and `stage.ground` is the fixed near-black it was measured
                  // against — 13.94:1, and neither moves with the scheme.
                  fg={theme.color.stage.ground}
                  bg={theme.color.lime[500]}
                />
              ) : null}
            </View>
          </CardLink>
        )}
      />
      {/* The compose action floats over the feed rather than sitting in the
          header: it is the one thing this screen is for, and the header is
          already carrying the way into the group chats. Ink, like every
          primary in this world, and ringed in the page colour so it separates
          from whatever card it happens to be over. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tt('forum.compose')}
        // ponytail: no-op. `POST /api/me/forum/posts` would be behind a
        // composer here.
        onPress={() => setNotice(true)}
        style={({ pressed }) => ({
          position: 'absolute',
          right: theme.space[4],
          bottom: tabReserve + theme.space[2],
          width: theme.space[12] + theme.space[2],
          height: theme.space[12] + theme.space[2],
          borderRadius: (theme.space[12] + theme.space[2]) / 2,
          backgroundColor: theme.color.action,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: theme.space[0.5],
          borderColor: theme.color.background,
          elevation: theme.elevation.floating,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <GlyphPlus size={theme.space[6]} color={theme.color.actionInk} />
      </Pressable>
    </View>
  );
}
