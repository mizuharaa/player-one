import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useNav } from '../nav.tsx';
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
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Choice
          label={tt('session.yes')}
          describedBy={question}
          selected={value === true}
          disabled={disabled}
          onPress={() => onChange(true)}
        />
        <Choice
          label={tt('session.no')}
          describedBy={question}
          selected={value === false}
          disabled={disabled}
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
          disabled={create.isPending}
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
        <Button label={tt('session.home')} onPress={() => nav.reset({ name: 'home' })} />
      </Screen>
    );
  }

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
        <YesNo question={tt('session.othersTitle')} value={others} disabled={create.isPending}
          onChange={(v) => { if (!submitting.current) setOthers(v); }} />
        <YesNo question={tt('session.sensitiveTitle')} value={sensitive} disabled={create.isPending}
          onChange={(v) => { if (!submitting.current) setSensitive(v); }} />
        {others === null || sensitive === null ? <Note text={tt('session.needDeclarations')} /> : null}
      </Card>

      {create.isError ? <Note text={tt('common.actionFailed')} /> : null}

      <Button
        label={tt('session.create')}
        disabled={
          create.isPending || task === undefined || device === undefined || others === null || sensitive === null
        }
        onPress={() => {
          if (submitting.current) return;
          submitting.current = true;
          create.mutate();
        }}
      />
      <Note text={tt('session.noRecord')} />
    </Screen>
  );
}
