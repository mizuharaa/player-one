import { Failure } from '../ui/StatePanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Switch, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { EXAM_QUESTION_COUNT } from '../api/mock.ts';
import { useApi } from '../api/context.tsx';
import { DemoSkip } from '../ui/DemoSkip.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Note, Screen, face, useReducedMotion } from '../ui.tsx';

/**
 * APP-04: pass/fail recorded; APP-05's gate follows from the result.
 * SPEC.md §8 — behaviour unchanged, restyled to §6's shape.
 *
 * **The app does not decide pass or fail** and does not mark which answer was
 * wrong. `api.submitExam` returns a boolean and `exam.failed` says to review
 * the training. No score, no per-question feedback, no timer, no retry limit —
 * the server owns any limit.
 *
 * The result renders in place of the intro on the verdict's own fill, and it
 * carries a glyph as well as a colour. That is not decoration: red/green
 * colour blindness is common and this is the axis that decides whether the
 * collector may claim work at all.
 *
 * The three rows are §6's rows — the whole 56 pt row is the target and the
 * switch is its indicator — and the commit is pinned through `Screen`'s
 * footer for §6's reason.
 */
export function Exam() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [answers, setAnswers] = useState<boolean[]>(Array(EXAM_QUESTION_COUNT).fill(false));
  const [result, setResult] = useState<'passed' | 'failed' | null>(null);
  const submitting = useRef(false);
  const completed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const questions = [tt('exam.q1'), tt('exam.q2'), tt('exam.q3')];

  const submit = useMutation({
    mutationFn: (snapshot: boolean[]) => api.submitExam(snapshot),
    onSuccess: ({ passed }) => {
      if (!mounted.current) return;
      // The server preserves a pass; this screen must preserve its handoff too.
      completed.current = passed;
      setResult(passed ? 'passed' : 'failed');
    },
    onSettled: () => { submitting.current = false; },
  });

  const sendAnswers = () => {
    if (!mounted.current || submitting.current || completed.current) return;
    submitting.current = true;
    setResult(null);
    submit.mutate([...answers]);
  };

  const answer = (index: number, value: boolean) => {
    if (submitting.current || completed.current || submit.isPending) return;
    setResult(null);
    setAnswers((a) => a.map((x, j) => (j === index ? value : x)));
  };

  const locked = submit.isPending || result === 'passed';

  return (
    <Screen
      title={tt('exam.title')}
      right={<DemoSkip from="exam" to="home" disabled={submit.isPending} onSkipped={() => nav.reset({ name: 'home' })} />}
      footer={
        <>
          {submit.isError ? <Failure onRetry={sendAnswers} busy={submit.isPending} error={submit.error} text={tt('common.actionFailed')} /> : null}
          {result === 'passed' ? (
            <Button label={tt('home.tasks')} onPress={() => nav.reset({ name: 'home' })} />
          ) : (
            <Button
              label={tt(submit.isPending ? 'common.saving' : submit.isError ? 'common.retry' : 'exam.submit')}
              disabled={submit.isPending}
              onPress={sendAnswers}
            />
          )}
        </>
      }
    >
      {result === null ? (
        <Body muted>{tt('exam.intro')}</Body>
      ) : (
        <Verdict
          passed={result === 'passed'}
          text={tt(result === 'passed' ? 'exam.passed' : 'exam.failed')}
          reduced={reduced}
        />
      )}

      {questions.map((q, i) => {
        const on = answers[i] === true;
        return (
          <Pressable
            key={q}
            accessibilityRole="switch"
            accessibilityState={{ checked: on, disabled: locked }}
            accessibilityLabel={q}
            onPress={() => answer(i, !on)}
            disabled={locked}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: theme.space[12] + theme.space[2],
              padding: theme.space[4],
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: pressed ? theme.color.muted : theme.color.surface,
            })}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: theme.color.foreground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.base,
                  lineHeight: Math.round(theme.fontSize.base * 1.45),
                }}
              >
                {q}
              </Text>
            </View>
            <Switch
              accessibilityLabel={q}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              disabled={locked}
              value={on}
              onValueChange={(v) => answer(i, v)}
              thumbColor={theme.color.surface}
              trackColor={{ false: theme.color.fieldBorder, true: theme.color.action }}
            />
          </Pressable>
        );
      })}
    </Screen>
  );
}

/**
 * The server's answer, in the place the intro was.
 *
 * It fades and rises 12 dp over `duration.slow` — `opacity` and `transform`,
 * native driver, and under reduced motion it is simply there on first paint
 * rather than playing a shorter version of the same entrance.
 */
function Verdict({ passed, text, reduced }: { passed: boolean; text: string; reduced: boolean }) {
  const theme = useTheme();
  const progress = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: theme.duration.slow,
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [passed, progress, reduced, theme.duration.slow]);
  const verdict = passed ? theme.color.verdict.pass : theme.color.verdict.reject;
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={{
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.space[3],
        backgroundColor: verdict.bg,
        borderRadius: theme.radius.lg,
        padding: theme.space[4],
      }}
    >
      <Text
        // Not spoken: the sentence beside it already says the verdict in
        // words, and TalkBack reading "check mark" before it adds nothing.
        importantForAccessibility="no"
        style={{
          color: verdict.fg,
          fontFamily: face(theme),
          fontSize: theme.fontSize.lg,
          fontWeight: theme.fontWeight.bold,
        }}
      >
        {passed ? '✓' : '✕'}
      </Text>
      <Text
        style={{
          flex: 1,
          color: verdict.fg,
          fontFamily: face(theme),
          fontSize: theme.fontSize.base,
          lineHeight: Math.round(theme.fontSize.base * 1.45),
        }}
      >
        {text}
      </Text>
    </Animated.View>
  );
}
