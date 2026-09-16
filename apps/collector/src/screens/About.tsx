import { PhantomPressable } from '../ui/PhantomPressable.tsx';
import { TASK_PHOTO_CREDITS } from '../ui/taskImage.ts';
import { ServerSettings } from '../ui/ServerSettings.tsx';
import { useState } from 'react';
import { LanguageChoices, LOCALE_NAME } from './Profile.tsx';
import { Sheet } from './TaskHall.tsx';
import { useNav } from '../nav.tsx';
import { Image, Linking, Platform, Text, View, useWindowDimensions } from 'react-native';
import { useLocale, useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Card, NavRow, Screen, face } from '../ui.tsx';
import wordmark from '../../assets/discover/playerone-wordmark.png';
import app from '../../app.json';

/** About keeps a paper header, shared Server settings and bundled photo credits. */
export function About({ onPrivacy }: { onPrivacy?: () => void } = {}) {
  const [credits, setCredits] = useState(false);
  const [server, setServer] = useState(false);
  const [language, setLanguage] = useState(false);
  const { fontScale } = useWindowDimensions();
  const { locale } = useLocale();
  const nav = useNav();
  const openDocument = onPrivacy ?? (() => nav.push({ name: 'privacy' }));
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;

  return (
    <Screen title={tt('profile.about')}>
      {/* The header block. `Screen` draws the page title above it; this is the
          mark, not a second title. */}
      <Card>
        <View style={{ alignItems: 'center', gap: theme.space[3] }}>
        <Image
          source={wordmark}
          accessibilityLabel={tt('app.name')}
          resizeMode="contain"
          style={{ width: '70%', height: theme.space[10], tintColor: c.ink }}
        />
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
          {tt('splash.partners')}
        </Text>
        </View>
      </Card>

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

      <NavRow label={tt('photos.title')} onPress={() => setCredits(!credits)} />
      {credits ? <Card>
        <Body muted>{tt('photos.edited')}</Body>
        {TASK_PHOTO_CREDITS.map(photo => <View key={photo.source} style={{ gap: 8 }}>
          <PhantomPressable accessibilityRole="link" accessibilityLabel={photo.title} onPress={() => void Linking.openURL(photo.source)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}><Text style={{ ...c.type.body, color: c.plum, fontFamily: face(theme), textDecorationLine: 'underline' }}>{photo.title}</Text></PhantomPressable>
          <Body>{photo.author}</Body>
          <PhantomPressable accessibilityRole="link" accessibilityLabel={photo.license} onPress={() => void Linking.openURL(photo.licenseUrl)} style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}><Text style={{ ...c.type.caption, color: c.plum, fontFamily: face(theme), textDecorationLine: 'underline' }}>{photo.license}</Text></PhantomPressable>
        </View>)}
      </Card> : null}
      <NavRow label={tt('server.title')} onPress={() => setServer(true)} />
      {server ? <ServerSettings onClose={() => setServer(false)} /> : null}
      <NavRow label={tt('profile.language')} subtitle={LOCALE_NAME[locale]} onPress={() => setLanguage(true)} />
      <Sheet open={language} onClose={() => setLanguage(false)} title={tt('profile.language')}>
        <LanguageChoices stacked={fontScale > 1.2} onPicked={() => setLanguage(false)} />
      </Sheet>

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
