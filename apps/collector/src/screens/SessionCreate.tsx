import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Choice, Note, Row, Screen, Title } from '../ui.tsx';

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
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const tt = useT();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Body>{question}</Body>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Choice
          label={tt('session.yes')}
          describedBy={question}
          selected={value === true}
          onPress={() => onChange(true)}
        />
        <Choice
          label={tt('session.no')}
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

  const claimedTasks = (tasks.data ?? []).filter((t) =>
    (claims.data ?? []).some((c) => c.taskId === t.id),
  );
  const task = claimedTasks.find((t) => t.id === taskId);
  const device = (devices.data ?? []).find((d) => d.serial === deviceSerial);

  const create = useMutation({
    mutationFn: () => {
      if (task === undefined || device === undefined || others === null || sensitive === null) {
        throw new Error('incomplete');
      }
      return api.createSession({
        taskId: task.id,
        deviceSerial: device.serial,
        scenario: task.scenario,
        othersInFrame: others,
        sensitiveInfo: sensitive,
      });
    },
    onSuccess: (session) => setCreatedId(session.id),
  });

  const pick = <T,>(
    items: T[],
    key: (x: T) => string,
    label: (x: T) => string,
    describedBy: string,
    selected: string | null,
    onPick: (k: string) => void,
  ) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {items.map((item) => (
        <Choice
          key={key(item)}
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
        {claimedTasks.length === 0 ? <Note text={tt('session.needClaim')} /> : null}
        {pick(claimedTasks, (t) => t.id, (t) => t.title, tt('session.task'), taskId, setTaskId)}
        {task !== undefined ? (
          <Row label={tt('session.scenario')} value={tt(`scenario.${task.scenario}`)} />
        ) : null}
      </Card>

      <Card>
        <Title>{tt('session.device')}</Title>
        {(devices.data ?? []).length === 0 ? <Note text={tt('session.needDevice')} /> : null}
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
        <YesNo question={tt('session.othersTitle')} value={others} onChange={setOthers} />
        <YesNo question={tt('session.sensitiveTitle')} value={sensitive} onChange={setSensitive} />
        {others === null || sensitive === null ? <Note text={tt('session.needDeclarations')} /> : null}
      </Card>

      {createdId !== null ? (
        <Card>
          <Title>{tt('session.created')}</Title>
          <Row label={tt('session.id')} value={createdId} />
        </Card>
      ) : null}

      <Button
        label={tt('session.create')}
        disabled={
          task === undefined || device === undefined || others === null || sensitive === null
        }
        onPress={() => create.mutate()}
      />
      <Note text={tt('session.noRecord')} />
    </Screen>
  );
}
