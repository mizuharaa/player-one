import { polish } from '../theme.tsx';
import { useState } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { ApiError } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Field, Note, Title, useInsets } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * The demo bypass sheet. Owner's request, 2026-09-16, for debugging and the
 * Thursday demonstration only.
 *
 * One field and one button, because there is one thing to present: the
 * administrator key the owner generated at deploy time. On success the app
 * holds an ordinary collector token for the seeded demo collector and lands on
 * Home like any other sign-in — `onSignedIn` is the same callback the Zalo and
 * code paths call, so nothing downstream knows which door was used.
 *
 * ponytail: `Modal` and `ServerSettings`'s own layout, not a new sheet
 * component. That file is already the pre-authentication modal in this app and
 * this is the same shape — a label, a field, a primary and a cancel.
 *
 * **What this screen must not do.** It must not be rendered at all on a Play
 * build: `SignIn.tsx` gates the control that opens it on `BUILD_PROFILE`, the
 * same gate the Server row uses, and `test/demo-bypass.test.tsx` measures its
 * absence. The gate is in the caller rather than here so that there is exactly
 * one place to read the answer to "can a shipped app reach this".
 */
export function DemoBypass({
  onSignedIn,
  onClose,
}: {
  onSignedIn: () => void;
  onClose: () => void;
}) {
  const tt = useT();
  const api = useApi();
  const insets = useInsets();
  const [key, setKey] = useState('');
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * One sentence per named refusal. Unlike the code path — where every failure
   * is deliberately the same sentence so that nobody can ask this app which
   * numbers are enrolled — these may be named: none of them is about a
   * collector, and the person holding this sheet is staff.
   */
  const enter = async () => {
    if (busy || key.trim() === '') return;
    setBusy(true);
    setProblem(null);
    try {
      await api.signInWithDemoKey(key.trim());
      onSignedIn();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setProblem(
        code === 'demo_unavailable'
          ? 'demo.unavailable'
          : code === 'demo_collector_absent'
            ? 'demo.unseeded'
            : code === 'credentials'
              ? 'demo.badKey'
              : code === 'rate_limited'
                ? 'signIn.rateLimited'
                : code === 'server_unreachable'
                  ? 'state.offline'
                  : 'common.actionFailed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: polish.paper }}
        contentContainerStyle={{
          padding: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          gap: 20,
        }}
      >
        <Title>{tt('demo.title')}</Title>
        <Body muted>{tt('demo.body')}</Body>
        <Field
          label={tt('demo.key')}
          value={key}
          editable={!busy}
          onChangeText={(next) => {
            setKey(next);
            setProblem(null);
          }}
        />
        {problem === null ? null : <Note text={tt(problem)} tone="error" />}
        <Button label={tt('demo.enter')} busy={busy} onPress={() => void enter()} />
        <View>
          <Button
            label={tt('common.cancel')}
            variant="ghost"
            disabled={busy}
            onPress={onClose}
          />
        </View>
      </ScrollView>
    </Modal>
  );
}
