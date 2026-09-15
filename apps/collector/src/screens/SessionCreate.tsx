import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { SCENARIOS, type Scenario } from '../api/types.ts';
import type { MessageKey } from '../i18n.ts';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { RecordingSteps } from './SessionReminder.tsx';
import { Body, Button, Card, Choice, Loading, Note, Row, Screen, Title } from '../ui.tsx';

const SESSION_ERRORS: Record<string, MessageKey> = {
  scenario_not_found: 'session.scenarioUnavailable',
  task_not_claimable: 'session.taskUnavailable',
  task_not_claimed: 'session.needClaim',
  device_not_bound: 'session.deviceUnavailable',
};

/**
 * APP-16/17: one session binds task + collector + device + scenario, before
 * recording. APP-17b: the two declarations are explicit answers — no default,
 * no pre-ticked switch; unanswered means the session cannot be created.
 *
 * Nothing here sends a duration, an amount, or a start/stop — the session is
 * a binding, and recording happens on the device.
 */
function YesNo({
  question,
  value,
  onChange,
  disabled,
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  const tt = useT();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        <Choice
          label={tt('session.yes')}
          disabled={disabled}
          describedBy={question}
          selected={value === true}
          onPress={() => onChange(true)}
        />
        <Choice
          label={tt('session.no')}
          disabled={disabled}
          describedBy={question}
          selected={value === false}
          onPress={() => onChange(false)}
        />
      </View>
    </View>
  );
}

export function SessionCreate() {
  const api = useApi();
  const nav = useNav();
  const submitting = useRef(false);
  /**
   * Whether this screen is still the one on the stack.
   *
   * A mutation's callbacks outlive the component that started them. Submit,
   * press Back to Home while the request is in flight, and the success that
   * arrives afterwards used to call `nav.reset` — which pulled the collector
   * out of Home and into a fresh, editable session form without the reminder
   * in front of it. That is the exact bypass PRV-02 exists to close, reached
   * from the other direction.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    api.beginSessionAttempt();
    return () => {
      mounted.current = false;
    };
  }, [api]);
  const tt = useT();
  const theme = useTheme();

  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });

  const [step, setStep] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [deviceSerial, setDeviceSerial] = useState<string | null>(null);
  const [others, setOthers] = useState<boolean | null>(null);
  const [sensitive, setSensitive] = useState<boolean | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);

  const claimedTasks = (tasks.data ?? []).filter((t) =>
    (claims.data ?? []).some((c) => c.taskId === t.id),
  );
  const task = claimedTasks.find((t) => t.id === taskId);
  const device = (devices.data ?? []).find((d) => d.serial === deviceSerial);

  const create = useMutation({
    mutationFn: () => {
      if (task === undefined || device === undefined || scenario === null || others === null || sensitive === null) {
        throw new Error('incomplete');
      }
      return api.createSession({
        taskId: task.id,
        deviceSerial: device.serial,
        scenario,
        othersInFrame: others,
        sensitiveInfo: sensitive,
      });
    },
    onSuccess: (session) => {
      // The session was created and the server is the record; it shows up under
      // Uploads. Somebody who left mid-request stays where they went.
      if (!mounted.current) return;
      setCreatedId(session.id);
      nav.reset({ name: 'sessionCreate' });
    },
    onError: () => {
      if (!mounted.current) return;
      submitting.current = false;
    },
  });

  const queries = [claims, tasks, devices];
  if (queries.some((q) => q.isError)) {
    return <Screen title={tt('session.title')}><Note text={tt('common.loadFailed')} /><Button label={tt('common.retry')} disabled={queries.some((q) => q.isFetching)} onPress={() => { for (const q of queries) void q.refetch(); }} /></Screen>;
  }
  if (queries.some((q) => q.isPending)) {
    return <Screen title={tt('session.title')}><Loading /></Screen>;
  }

  const pick = <T,>(
    items: T[],
    key: (x: T) => string,
    label: (x: T) => string,
    describedBy: string,
    selected: string | null,
    onPick: (k: string) => void,
  ) => (
    <View style={{ gap: theme.space[2] }}>
      {items.map((item) => (
        <Choice
          key={key(item)}
          disabled={create.isPending || createdId !== null}
          label={label(item)}
          describedBy={describedBy}
          selected={selected === key(item)}
          onPress={() => { if (!submitting.current) onPick(key(item)); }}
        />
      ))}
    </View>
  );

  if (createdId !== null) {
    return (
      <Screen title={tt('session.created')}>
        <Card>
          <Row label={tt('session.id')} value={createdId} />
          <Row label={tt('session.task')} value={task?.title ?? ''} />
          <Row label={tt('session.device')} value={deviceSerial ?? ''} />
        </Card>
        <Note text={tt('session.noRecord')} />
        <RecordingSteps />
        <Button label={tt('uploads.deliverTitle')} onPress={() => nav.push({ name: 'uploads', openDelivery: true })} />
        <Button variant="secondary" label={tt('session.home')} onPress={() => nav.reset({ name: 'home' })} />
      </Screen>
    );
  }

  const ready = [task !== undefined, scenario !== null, device !== undefined, others !== null, sensitive !== null][step];
  const titles: MessageKey[] = ['session.task', 'session.scenario', 'session.device', 'session.othersTitle', 'session.sensitiveTitle'];
  const next = () => {
    if (!ready || submitting.current) return;
    if (step < titles.length - 1) { setStep(step + 1); return; }
    if (task === undefined || device === undefined || scenario === null || others === null || sensitive === null) return;
    submitting.current = true;
    create.mutate();
  };
  return <Screen title={tt(titles[step]!)} onBack={() => step > 0 ? setStep(step - 1) : nav.back()}
    right={<Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} onPress={() => nav.reset({ name: 'home' })}
      style={{ minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...theme.collector.type.h2, color: theme.collector.ink }}>×</Text></Pressable>}
    footer={<Button label={tt(create.isPending ? 'common.saving' : step === 4 ? 'session.create' : 'common.next')}
      busy={create.isPending} disabled={!ready || create.isPending} onPress={next} />}>
    <View accessibilityRole="progressbar" accessibilityLabel={tt('session.title')}
      accessibilityValue={{ min: 0, max: titles.length, now: step }}
      style={{ flexDirection: 'row', gap: theme.space[1], paddingVertical: theme.space[3] }}>
      {titles.map((title, index) => <View key={title} style={{ flex: 1, height: theme.space[1], borderRadius: theme.radius.pill,
        backgroundColor: index <= step ? theme.collector.plum : theme.collector.line }} />)}
    </View>
    {step === 0 ? <>
      <Body muted>{tt('session.intro')}</Body>
      {claimedTasks.length === 0 ? <><Note text={tt('session.needClaim')} /><Button label={tt('hall.title')} variant="secondary" onPress={() => nav.push({ name: 'taskHall' })} /></> : null}
      {pick(claimedTasks, t => t.id, t => t.title, tt('session.task'), taskId, setTaskId)}
    </> : null}
    {step === 1 ? <>
      <Body>{tt('session.chooseScenario')}</Body>
      {pick([...SCENARIOS], s => s, s => tt(`scenario.${s}`), tt('session.scenario'), scenario, s => setScenario(s as Scenario))}
    </> : null}
    {step === 2 ? <>
      {(devices.data ?? []).length === 0 ? <><Note text={tt('session.needDevice')} /><Button label={tt('home.devices')} variant="secondary" onPress={() => nav.push({ name: 'devices' })} /></> : null}
      {pick(devices.data ?? [], d => d.serial, d => d.serial, tt('session.device'), deviceSerial, setDeviceSerial)}
    </> : null}
    {step === 3 ? <YesNo question={tt('session.othersTitle')} value={others} disabled={create.isPending}
      onChange={v => { if (!submitting.current) setOthers(v); }} /> : null}
    {step === 4 ? <YesNo question={tt('session.sensitiveTitle')} value={sensitive} disabled={create.isPending}
      onChange={v => { if (!submitting.current) setSensitive(v); }} /> : null}
    {step >= 3 && (others === null || sensitive === null) ? <Body muted>{tt('session.needDeclarations')}</Body> : null}
    {create.isError ? <Note tone="error" text={tt(SESSION_ERRORS[create.error.message] ?? 'common.actionFailed')} /> : null}
    <Body muted>{tt('session.noRecord')}</Body>
  </Screen>;
}
