import { Failure, StatePanel } from '../ui/StatePanel.tsx';
import { useToast } from '../ui/Toast.tsx';
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
import { getBatteryLevelAsync, isLowPowerModeEnabledAsync } from 'expo-battery';
import { freeDiskBytes } from '../upload/delivery-native.ts';
import { gb } from '../money.ts';
import { Body, Button, Card, Choice, Loading, Note, Row, Screen, Title } from '../ui.tsx';

const SESSION_ERRORS: Record<string, MessageKey> = {
  scenario_not_found: 'session.scenarioUnavailable',
  task_not_claimable: 'session.taskUnavailable',
  task_not_claimed: 'session.needClaim',
  device_not_bound: 'session.deviceUnavailable',
};

/**
 * Where "low" starts, for APP-19's warning.
 *
 * Nothing in the runbook, `apps/collector/README.md` or `RELEASE.md` names a
 * threshold — grepped, 2026-09-15 — so these are the work order's defaults and
 * they are here, named, for whoever does get told a real number.
 */
const LOW_BATTERY = 0.2;
const LOW_FREE_BYTES = 2 * 1024 ** 3;

/**
 * APP-19: the phone's battery and free space, as facts, before the two APP-17b
 * declarations.
 *
 * **It is not a gate.** A collector under either threshold can still create the
 * session and go and record — the camera records on its own buttons and the
 * phone is not in that path, so a phone about to die is a reason to warn and
 * never a reason to refuse. Inline and below the facts, per the work order's
 * §3.4 rule: a blocking thing sits next to its control, a toast is for
 * acknowledgements, and this is neither.
 *
 * **These are the PHONE's numbers.** The app has no way to read the camera's
 * battery or the space left on its card: the BLE surface is scan, connect,
 * Wi-Fi provisioning and an IP query, and `devices.noReadings` already says
 * the device record carries no battery field. So the copy names whose numbers
 * these are instead of letting somebody read "82%" as the camera's.
 */
function PhonePrecheck() {
  const tt = useT();
  const theme = useTheme();
  /**
   * One read, through the query client the screen already uses. Deliberately
   * NOT joined to the three queries that gate this screen's render: a battery
   * read that fails must not stop a session being created.
   */
  const phone = useQuery({
    queryKey: ['phone-precheck'],
    retry: false,
    queryFn: async () => {
      const [level, saver] = await Promise.all([
        getBatteryLevelAsync().catch(() => null),
        isLowPowerModeEnabledAsync().catch(() => false),
      ]);
      // `expo-battery` answers -1 on a platform that will not say.
      return { level: level !== null && level >= 0 ? level : null, saver, free: freeDiskBytes() };
    },
  });
  const facts = phone.data;
  const warnings = facts === undefined ? [] : [
    facts.level !== null && facts.level < LOW_BATTERY ? tt('prechecks.lowBattery') : null,
    facts.saver ? tt('prechecks.lowPower') : null,
    facts.free !== null && facts.free < LOW_FREE_BYTES ? tt('prechecks.lowSpace') : null,
  ].filter((sentence): sentence is string => sentence !== null);
  return <View style={{ gap: theme.space[2] }}>
    <Card>
      <Row label={tt('prechecks.phoneBattery')}
        value={facts?.level == null ? tt('prechecks.unknown')
          : `${Math.round(facts.level * 100)}%${facts.saver ? ` · ${tt('prechecks.saverOn')}` : ''}`} />
      <Row label={tt('prechecks.phoneFree')} value={facts?.free == null ? tt('prechecks.unknown') : gb(facts.free)} />
      <Body muted>{tt('prechecks.camera')}</Body>
    </Card>
    {warnings.length > 0 ? <Note tone="pending" text={warnings.join(' ')} /> : null}
  </View>;
}

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
  const toast = useToast();
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
      toast(tt('session.created'));
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
    return <Screen title={tt('session.title')}><Failure error={queries.find(query => query.isError)?.error} text={tt('common.loadFailed')} busy={queries.some((q) => q.isFetching)} onRetry={() => { for (const q of queries) void q.refetch(); }} /></Screen>;
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
  const progress = <View accessibilityRole="progressbar" accessibilityLabel={tt('session.title')} accessibilityValue={{ min: 0, max: titles.length, now: step }}
    style={{ flex: 1, maxWidth: 160, height: theme.space[1], borderRadius: theme.radius.pill, backgroundColor: theme.collector.line, overflow: 'hidden' }}>
    <View style={{ width: `${step / titles.length * 100}%`, height: '100%', backgroundColor: theme.collector.plum }} />
  </View>;
  return <Screen progress={progress} title={tt(titles[step]!)} onBack={() => step > 0 ? setStep(step - 1) : nav.back()}
    right={<Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} onPress={() => nav.reset({ name: 'home' })}
      style={{ minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}><Text style={{ ...theme.collector.type.h2, color: theme.collector.ink }}>×</Text></Pressable>}
    footer={<Button label={tt(create.isPending ? 'common.saving' : step === 4 ? 'session.create' : 'common.next')}
      busy={create.isPending} disabled={!ready || create.isPending} onPress={next} />}>
    {step === 0 ? <>
      <Body muted>{tt('session.intro')}</Body>
      {claimedTasks.length === 0 ? <StatePanel title={tt('state.empty')} text={tt('session.needClaim')} action={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} /> : null}
      {pick(claimedTasks, t => t.id, t => t.title, tt('session.task'), taskId, setTaskId)}
    </> : null}
    {step === 1 ? <>
      <Body>{tt('session.chooseScenario')}</Body>
      {pick([...SCENARIOS], s => s, s => tt(`scenario.${s}`), tt('session.scenario'), scenario, s => setScenario(s as Scenario))}
    </> : null}
    {step === 2 ? <>
      {(devices.data ?? []).length === 0 ? <StatePanel title={tt('state.empty')} text={tt('session.needDevice')} action={tt('home.devices')} onPress={() => nav.push({ name: 'devices' })} /> : null}
      {pick(devices.data ?? [], d => d.serial, d => d.serial, tt('session.device'), deviceSerial, setDeviceSerial)}
      {/*
        * APP-19, on the last step before the two APP-17b declarations. It is on
        * this step and not repeated on the others because this is also the step
        * where the confusion it exists to prevent lives: the collector is
        * picking a camera by serial here, and the next thing they read is the
        * phone's battery.
        */}
      <PhonePrecheck />
    </> : null}
    {step === 3 ? <YesNo question={tt('session.othersTitle')} value={others} disabled={create.isPending}
      onChange={v => { if (!submitting.current) setOthers(v); }} /> : null}
    {step === 4 ? <YesNo question={tt('session.sensitiveTitle')} value={sensitive} disabled={create.isPending}
      onChange={v => { if (!submitting.current) setSensitive(v); }} /> : null}
    {step >= 3 && (others === null || sensitive === null) ? <Body muted>{tt('session.needDeclarations')}</Body> : null}
    {create.isError ? <Failure onRetry={next} busy={create.isPending} error={create.error} text={tt(SESSION_ERRORS[create.error.message] ?? 'common.actionFailed')} /> : null}
    <Body muted>{tt('session.noRecord')}</Body>
  </Screen>;
}
