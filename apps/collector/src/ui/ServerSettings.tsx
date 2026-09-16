import { polish } from '../theme.tsx';
import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { API_BASE_URL, BUILD_PROFILE } from '../api/config.ts';
import { getApiOrigin, originOf, setApiOrigin } from '../api/origin.ts';
import { useSignOut } from '../session.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Field, Note, Title, useInsets } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/** The same server setting remains reachable before authentication. */
export function ServerSettings({ onClose }: { onClose: () => void }) {
  const tt = useT(), signOut = useSignOut(), insets = useInsets();
  const [origin, setOrigin] = useState(getApiOrigin);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saving, setSaving] = useState(false);
  const change = async (next: string | null) => {
    if (saving) return;
    if (next !== null && originOf(next) === null) { setError('server.invalid'); return; }
    setSaving(true); setError(null);
    try { await setApiOrigin(next); signOut({ landing: true }); }
    catch { setError('common.actionFailed'); }
    finally { setSaving(false); }
  };
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: polish.paper }} contentContainerStyle={{ padding: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, gap: 20 }}>
      <Body muted>{`${tt('profile.title')} / ${tt('profile.about')}`}</Body>
      <Title>{tt('server.title')}</Title>
      {BUILD_PROFILE === 'play' ? <Body>{getApiOrigin()}</Body> : <>
        <Body muted>{tt('server.signsOut')}</Body>
        <Field label={tt('server.address')} value={origin} onChangeText={next => { setOrigin(next); setError(null); }} />
        {error ? <Note text={tt(error)} tone="error" /> : null}
        <Button label={tt('server.save')} busy={saving} onPress={() => void change(origin)} />
        <Button label={tt('server.reset')} disabled={saving} variant="secondary" onPress={() => { setOrigin(API_BASE_URL); setError(null); }} />
      </>}
      <View><Button label={tt('common.cancel')} variant="ghost" onPress={onClose} /></View>
    </ScrollView>
  </Modal>;
}
