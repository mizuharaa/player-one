import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { EXAM_QUESTION_COUNT } from '../api/mock.ts';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Screen, Tag } from '../ui.tsx';

/**
 * APP-04: pass/fail recorded; APP-05's gate follows from the result. The
 * questions are a shell until PaXini's exam content arrives.
 */
export function Exam() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const [answers, setAnswers] = useState<boolean[]>(Array(EXAM_QUESTION_COUNT).fill(false));
  const [result, setResult] = useState<'passed' | 'failed' | null>(null);

  const questions = [tt('exam.q1'), tt('exam.q2'), tt('exam.q3')];

  const submit = useMutation({
    mutationFn: () => api.submitExam(answers),
    onSuccess: ({ passed }) => setResult(passed ? 'passed' : 'failed'),
  });

  return (
    <Screen title={tt('exam.title')}>
      <Body muted>{tt('exam.intro')}</Body>
      {questions.map((q, i) => (
        <Card key={q}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: theme.space[3],
            }}
          >
            <View style={{ flexShrink: 1 }}>
              <Body>{q}</Body>
            </View>
            <Switch
              accessibilityLabel={q}
              value={answers[i] === true}
              onValueChange={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
              thumbColor={theme.color.background}
              /* On is the ink pill, the same mark `Chip` and `Button` carry:
                 the control's selected state is where the collector's action
                 is, and sun is the VNG mark now rather than an action colour.
                 Off is `fieldBorder`, the one border token this system holds
                 to a ratio. Measured off the rendered pixels, on the card this
                 switch sits on: `borderStrong` read 1.64:1 in light and 1.67:1
                 in dark, both under WCAG 1.4.11's 3:1 for the boundary that
                 identifies a control; `fieldBorder` reads 3.83:1 and 3.94:1. A
                 switch nobody can see off is a switch nobody knows is there. */
              trackColor={{ false: theme.color.fieldBorder, true: theme.color.action }}
            />
          </View>
        </Card>
      ))}
      {result === 'passed' ? (
        <Tag label={tt('exam.passed')} fg={theme.color.verdict.pass.fg} bg={theme.color.verdict.pass.bg} />
      ) : null}
      {result === 'failed' ? (
        <Tag label={tt('exam.failed')} fg={theme.color.verdict.reject.fg} bg={theme.color.verdict.reject.bg} />
      ) : null}
      {result === 'passed' ? (
        <Button label={tt('home.tasks')} onPress={() => nav.reset({ name: 'home' })} />
      ) : (
        <Button label={tt('exam.submit')} onPress={() => submit.mutate()} />
      )}
    </Screen>
  );
}
