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
              trackColor={{ false: theme.color.borderStrong, true: theme.color.sun[500] }}
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
