import { useNav } from '../nav.tsx';
import { Image, Platform, Text, View } from 'react-native';
import { HeaderGradient } from '../ui/HeaderGradient.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Card, NavRow, Screen, face } from '../ui.tsx';
import wordmark from '../../assets/discover/playerone-wordmark.png';
import app from '../../app.json';

/**
 * Work order §4.13 — About, copying klarna-334's block: the wordmark on the
 * gradient, then what the app is for, who builds it, and the version.
 *
 * **This is one of the three gradient surfaces**, with the splash and Income
 * (SPEC.md). The gradient is `theme.collector.gradient` — three stops in one
 * hue family, over about a third of the viewport, never on the text and never
 * full-screen. There is no fourth.
 *
 * The links row is `legal.privacy` and `legal.dataNotice`, which are the two
 * documents this product actually has. `Privacy` is a screen in this lane;
 * the data notice has no screen and no route, so the row says so through the
 * caller's handler rather than pretending to open something.
 */
export function About({ onPrivacy }: { onPrivacy?: () => void } = {}) {
  const nav = useNav();
  const openDocument = onPrivacy ?? (() => nav.push({ name: 'privacy' }));
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;

  return (
    <Screen title={tt('profile.about')}>
      {/* The header block. `Screen` draws the page title above it; this is the
          mark, not a second title. */}
      <HeaderGradient>
        <View style={{ alignItems: 'center', gap: theme.space[3] }}>
        <Image
          source={wordmark}
          accessibilityLabel={tt('app.name')}
          resizeMode="contain"
          style={{ width: '70%', height: theme.space[10], tintColor: c.surface }}
        />
        <Text style={{ ...c.type.caption, color: c.surface, fontFamily: face(theme) }}>
          {tt('splash.partners')}
        </Text>
        </View>
      </HeaderGradient>

      <Card>
        <Text
          accessibilityRole="header"
          style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
        >
          {tt('about.what')}
        </Text>
        <Body>{tt('about.whatBody')}</Body>
      </Card>

      <Card>
        <Text
          accessibilityRole="header"
          style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
        >
          {tt('about.who')}
        </Text>
        <Body>{tt('about.whoBody')}</Body>
      </Card>

      {/* The one document this product has a screen for. `legal.dataNotice`
          exists as a name and has no screen, so it is not a row here: a
          chevron that opens nothing is worse than no row. */}
      <View style={{ marginTop: theme.space[2] }}>
        <NavRow label={tt('legal.privacy')} subtitle={tt('profile.privacySub')} onPress={openDocument} />
      </View>

      {/* The version, and which platform's build it is.
          `app.json`'s `expo.version` and `Platform.OS`, not `expo-constants`:
          that module is not a dependency of this app and the only question
          this line answers is which build somebody is looking at. */}
      <View style={{ marginTop: c.sectionGap, gap: theme.space[1] }}>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
          {`${tt('profile.version')} ${app.expo.version}`}
        </Text>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
          {`${tt('about.build')} ${Platform.OS}`}
        </Text>
      </View>
    </Screen>
  );
}
