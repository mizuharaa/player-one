import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { SCENARIOS, type Scenario } from '../api/types.ts';
import type { MessageKey } from '../i18n.ts';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Choice, Note, Row, Screen, Title } from '../ui.tsx';

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
      <Body>{question}</Body>
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
  const tt = useT();
  const theme = useTheme();

  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });

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
    onSuccess: (session) => setCreatedId(session.id),
  });

  const queries = [claims, tasks, devices];
  if (queries.some((q) => q.isError)) {
    return <Screen title={tt('session.title')}><Note text={tt('common.loadFailed')} /><Button label={tt('common.retry')} disabled={queries.some((q) => q.isFetching)} onPress={() => { for (const q of queries) void q.refetch(); }} /></Screen>;
  }
  if (queries.some((q) => q.isPending)) {
    return <Screen title={tt('session.title')}><Body muted>{tt('common.loading')}</Body></Screen>;
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
          onPress={() => onPick(key(item))}
        />
      ))}
    </View>
  );

  return (
    <Screen title={tt('session.title')}>
      <Body muted>{tt('session.intro')}</Body>

      <Card>
        <Title>{tt('session.task')}</Title>
        {/*
          A gate that names what is missing and offers no way to it is a dead
          end: this screen is reached from the raised button in the bar, and a
          collector who has bound nothing arrived here to be told twice that
          they cannot continue, with the only exit being Back. The refusal
          keeps its wording — it is the same sentence the server enforces — and
          the control under it goes where the sentence points.
        */}
        {claimedTasks.length === 0 ? (
          <>
            <Note text={tt('session.needClaim')} />
            <Button
              label={tt('hall.title')}
              variant="secondary"
              onPress={() => nav.push({ name: 'taskHall' })}
            />
          </>
        ) : null}
        {pick(claimedTasks, (t) => t.id, (t) => t.title, tt('session.task'), taskId, setTaskId)}
      </Card>

      <Card>
        <Title>{tt('session.scenario')}</Title>
        <Body>{tt('session.chooseScenario')}</Body>
        {pick([...SCENARIOS], (s) => s, (s) => tt(`scenario.${s}`), tt('session.scenario'), scenario, (s) => setScenario(s as Scenario))}
      </Card>

      <Card>
        <Title>{tt('session.device')}</Title>
        {(devices.data ?? []).length === 0 ? (
          <>
            <Note text={tt('session.needDevice')} />
            <Button
              label={tt('home.devices')}
              variant="secondary"
              onPress={() => nav.push({ name: 'devices' })}
            />
          </>
        ) : null}
        {pick(
          devices.data ?? [],
          (d) => d.serial,
          (d) => d.serial,
          tt('session.device'),
          deviceSerial,
          setDeviceSerial,
        )}
      </Card>

      <Card>
        <Title>{tt('session.declare')}</Title>
        <View style={{ gap: theme.space[5] }}>
        <YesNo question={tt('session.othersTitle')} value={others} onChange={setOthers} disabled={create.isPending || createdId !== null} />
        <YesNo question={tt('session.sensitiveTitle')} value={sensitive} onChange={setSensitive} disabled={create.isPending || createdId !== null} />
        </View>
        {others === null || sensitive === null ? <Note text={tt('session.needDeclarations')} /> : null}
      </Card>

      {createdId !== null ? (
        <Card>
          <Title>{tt('session.created')}</Title>
          <Row label={tt('session.id')} value={createdId} />
        </Card>
      ) : null}

      {create.isError ? <Note text={tt(SESSION_ERRORS[create.error.message] ?? 'common.actionFailed')} /> : null}
      <Button
        label={tt(create.isPending ? 'common.saving' : 'session.create')}
        disabled={
          task === undefined || device === undefined || scenario === null || others === null || sensitive === null || create.isPending || createdId !== null
        }
        onPress={() => create.mutate()}
      />
      <Note text={tt('session.noRecord')} />
    </Screen>
  );
}
