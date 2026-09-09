import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Field, Note, Screen } from '../ui.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * APP-01. The number, then the code that comes back over Zalo.
 *
 * Two steps in one screen and not two routes: this is not somewhere a collector
 * navigates to, it is what the app is when there is no session, so it has no
 * entry in the route registry and no Back.
 *
 * **What this screen must never say.** `POST /auth/collector/request-code`
 * answers 204 for every number, enrolled or not, so that nobody can use this
 * app to find out which numbers belong to collectors; and
 * `POST /auth/collector/verify` answers one 401 whether the code was wrong,
 * expired, or guessed at six times. So sending always says the same sentence,
 * and a refusal always says the same sentence. A more helpful message here
 * would undo the reason those routes are shaped that way.
 *
 * A collector whose number has no Zalo account cannot receive a code at all —
 * the named refusal `zns_no_zalo_account`, recorded server-side against the
 * collector so an operator can find them. The app cannot see that and must not
 * pretend to: `signIn.codeSent` tells them to check Zalo, and the way out is a
 * person at a counter.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const api = useApi();
  const tt = useT();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** True when the server filled the code in, so the screen can say why. */
  const [filled, setFilled] = useState(false);

  /** One message per named refusal, and one fallback that admits nothing. */
  const failed = (err: unknown): void => {
    const refusal = err instanceof ApiError ? err.code : '';
    if (refusal === 'rate_limited') setProblem('signIn.rateLimited');
    else if (refusal === 'sign_in_unavailable') setProblem('signIn.unavailable');
    else if (refusal === 'credentials') setProblem('signIn.badCode');
    else setProblem('common.actionFailed');
  };

  const request = useMutation({
    mutationFn: async () => {
      // The number this answer belongs to, captured before the request goes.
      const asked = phone.trim();
      return { asked, result: await api.requestSignInCode(asked) };
    },
    onSuccess: ({ asked, result }) => {
      setProblem(null);
      setSent(true);
      // A demonstration server echoes this one number's code. Ordinary servers
      // send nothing back and this is never reached.
      const demo = result?.demo_code;
      // Not if the collector has edited the number since: that code belongs to
      // the number it was asked for, and filling it in under a different one
      // would be a code for somebody else.
      if (demo !== undefined && asked === phone.trim()) {
        setCode(demo);
        setFilled(true);
      }
    },
    onError: failed,
  });

  const verify = useMutation({
    mutationFn: () => api.signIn(phone.trim(), code.trim()),
    onSuccess: onSignedIn,
    onError: failed,
  });

  return (
    <Screen title={tt('signIn.title')}>
      <Body muted>{tt('signIn.intro')}</Body>
      <Card>
        <Field
          label={tt('signIn.phone')}
          value={phone}
          onChangeText={(next) => {
            setPhone(next);
            // A code belongs to the number it was sent for, so editing the
            // number clears it. Unconditional: `filled` is turned off as soon
            // as the collector types in the code box, and a stale code must
            // still be cleared after that.
            setCode('');
            setFilled(false);
          }}
        />
        {sent ? (
          <>
            <Note text={tt('signIn.codeSent')} />
            <Field
              label={tt('signIn.code')}
              value={code}
              onChangeText={(next) => {
                setCode(next);
                setFilled(false);
              }}
            />
            {filled ? <Note text={tt('signIn.demoFilled')} /> : null}
          </>
        ) : null}
        {problem !== null ? <Note text={tt(problem)} /> : null}
        {sent ? (
          <Button label={tt('signIn.submit')} onPress={() => verify.mutate()} />
        ) : (
          <Button label={tt('signIn.sendCode')} onPress={() => request.mutate()} />
        )}
      </Card>
    </Screen>
  );
}
