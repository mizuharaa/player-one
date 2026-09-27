import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import { Body, Button, Header, Loading, face, useInsets, useReducedMotion } from '../ui.tsx';
import { TaskPhotoLabel } from '../ui/TaskPhotoLabel.tsx';
import { Icon } from '../ui/Icon.tsx';
import { taskImage, taskImageLabel } from '../ui/taskImage.ts';
import { taskDuration } from '../duration.ts';
import { Failure } from '../ui/StatePanel.tsx';
import { useToast } from '../ui/Toast.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { dong } from '../money.ts';
import type { MessageKey } from '../i18n.ts';

const CLAIM_ERRORS: Record<string, MessageKey> = {
  collector_not_onboarded: 'detail.needOnboarding', exam_not_passed: 'detail.needExam',
  agreements_incomplete: 'detail.needAgreements', training_incomplete: 'detail.needTraining',
  task_at_capacity: 'detail.full', already_claimed: 'detail.claimed',
  not_qualified: 'detail.notQualified', task_not_claimable: 'detail.unavailable',
};
const claimErrorKey = (error: unknown): MessageKey =>
  CLAIM_ERRORS[error instanceof Error ? error.message : ''] ?? 'common.actionFailed';

/** The photograph remains the context from browse through explicit claim confirmation. */
export function TaskDetail() {
  const api = useApi(), toast = useToast(), nav = useNav(), tt = useT(), theme = useTheme();
  const insets = useInsets(), c = theme.collector, reduced = useReducedMotion();
  const { taskId } = useRoute('taskDetail');
  const queryClient = useQueryClient();
  const [footer, setFooter] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [beforeStart, setBeforeStart] = useState(false);
  const { width, height } = useWindowDimensions();
  const compact = width < 360 || height < 700;
  const [confirming, setConfirming] = useState(false);
  const content = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.task(taskId) });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const mounted = useRef(true), submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const claim = useMutation({
    mutationFn: () => api.claimTask(taskId),
    onSettled: () => { submitting.current = false; },
    onError: () => { if (mounted.current) { setConfirming(false); content.current?.scrollTo({ y: 0, animated: !reduced }); } },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (mounted.current) { setConfirming(false); toast(tt('detail.claimed')); nav.push({ name: 'sessionReminder' }); }
    },
  });
  const submit = () => { if (submitting.current) return; submitting.current = true; claim.mutate(); };
  if ([task, profile, claims].some(query => query.isError)) return <View style={{ flex: 1, backgroundColor: c.paper, padding: c.gutter, paddingTop: insets.top }}>
    <Header title={tt('detail.title')} />
    <Failure error={[task, profile, claims].find(query => query.isError)?.error} text={tt('common.loadFailed')}
      busy={task.isFetching || profile.isFetching || claims.isFetching}
      onRetry={() => { void task.refetch(); void profile.refetch(); void claims.refetch(); }} />
  </View>;
  if (task.data === undefined || profile.data === undefined || claims.data === undefined) return <View style={{ flex: 1, backgroundColor: c.paper, padding: c.gutter, paddingTop: insets.top }}><Loading kind="body" /></View>;

  const data = task.data;
  const examPassed = profile.data !== null && profile.data.examPassed;
  const onboarded = profile.data === null || profile.data.onboarded;
  const trainingDone = profile.data !== null && profile.data.trainingDone;
  const alreadyClaimed = data.claimedByMe || claims.data.some(row => row.taskId === taskId);
  const full = data.claimants >= data.maxClaimants;
  const refusal: MessageKey | null = claim.isError ? claimErrorKey(claim.error)
    : alreadyClaimed ? 'detail.claimed' : !onboarded ? 'detail.needOnboarding'
    : !examPassed ? 'detail.needExam' : !trainingDone ? 'detail.needTraining' : full ? 'detail.full'
    : !data.published || !data.claimable ? 'detail.unavailable' : null;
  const image = taskImage(data) as unknown as ImageSource;
  const bodyStyle = { ...c.type.body, fontFamily: face(theme), color: polish.darkMuted };
  const headingStyle = { ...c.type.h2, fontFamily: face(theme), color: c.surface };
  const sectionStyle = { backgroundColor: polish.darkGlass, borderRadius: 18, padding: 16, gap: 12 };
  const rows: [MessageKey, string][] = [
    ['hall.perMinute', dong(data.unitPriceVndPerMinute)],
    ['detail.target', taskDuration(data.targetMinutes, tt)],
    ['detail.claimedMinutes', taskDuration(data.claimedMinutes, tt)],
    ['detail.slotsLeft', tt(data.remainingSlots === 1 ? 'detail.slotCountOne' : 'detail.slotCount').replace('{count}', String(data.remainingSlots))],
  ];
  return <View testID="task-detail-atmosphere" style={{ flex: 1, backgroundColor: c.night }}>
    <Image source={image} blurRadius={45} contentFit="cover" accessible={false} style={[StyleSheet.absoluteFill, { opacity: .14 }]} />
    <Animated.ScrollView ref={content} scrollEventThrottle={16}
      onScroll={reduced ? undefined : Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
      contentContainerStyle={{ paddingBottom: footer + 24 }}>
      <View style={{ height: Math.min(340, width * .85) + insets.top, overflow: 'hidden', backgroundColor: c.nightSurface }}>
        <Animated.View style={{ width: '100%', height: '115%', transform: [{ translateY: reduced ? 0 : scrollY.interpolate({ inputRange: [0, 500], outputRange: [-15, 45], extrapolate: 'clamp' }) }] }}>
          <Image source={image} blurRadius={confirming ? 12 : 0} contentFit="cover" style={{ width: '100%', height: '100%' }} accessible={false} />
        </Animated.View>
        <LinearGradient pointerEvents="none" colors={['transparent', c.night]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 75 }} />
        <View style={{ position: 'absolute', left: c.gutter, right: c.gutter, top: insets.top + 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={tt('common.back')} onPress={nav.back}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface, opacity: pressed ? .75 : 1, alignItems: 'center', justifyContent: 'center' })}><Icon name="arrowLeft" color={c.ink} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={tt('profile.help')} onPress={() => nav.push({ name: 'about' })}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface, opacity: pressed ? .75 : 1, alignItems: 'center', justifyContent: 'center' })}><Icon name="help" color={c.ink} /></Pressable>
        </View>
        <TaskPhotoLabel label={taskImageLabel(data)} />
      </View>
      <View style={{ paddingHorizontal: c.gutter, paddingTop: 14, gap: 14 }}>
        {claim.isError && refusal ? <Failure error={claim.error} text={tt(refusal)} onRetry={refusal === 'common.actionFailed' ? () => { claim.reset(); setConfirming(true); } : undefined} busy={claim.isPending} />
          : refusal ? <Text accessibilityLiveRegion="polite" style={bodyStyle}>{tt(refusal)}</Text> : null}
        <View style={{ gap: 7 }}>
          <Text accessibilityRole="header" style={{ ...c.type.h1, color: c.surface, fontFamily: face(theme), fontWeight: '700', letterSpacing: -.6 }}>{data.title}</Text>
          <Text style={{ ...c.type.h2, fontFamily: face(theme), color: c.glow, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{dong(data.unitPriceVndPerMinute)} <Text style={bodyStyle}>{tt('detail.perMinute')}</Text></Text>
          <Text style={{ ...c.type.body, fontFamily: face(theme), color: c.surface }}>{tt(data.remainingSlots === 1 ? 'detail.availableOne' : 'detail.available').replace('{count}', String(data.remainingSlots))}</Text>
          <Text style={{ ...c.type.caption, color: polish.darkMuted, fontFamily: face(theme) }}>{tt('hall.pricePerMinute')}</Text>
        </View>
        <View style={sectionStyle}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} accessibilityLabel={tt('detail.instructions')} accessibilityHint={tt(expanded ? 'detail.collapse' : 'detail.expand')} onPress={() => setExpanded(value => !value)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text accessibilityRole="header" style={{ ...headingStyle, flex: 1, fontWeight: '700' }}>{tt('detail.instructions')}</Text>
            <View style={{ transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }}><Icon name="chevronRight" color={c.surface} size={18} /></View>
          </Pressable>
          {expanded ? <Text style={bodyStyle}>{data.instructions.trim() || tt('detail.notSupplied')}</Text> : null}
        </View>
        <View style={sectionStyle}>
          <Pressable accessibilityRole="button" accessibilityLabel={tt('detail.beforeStart')} accessibilityState={{ expanded: beforeStart }} aria-expanded={beforeStart} onPress={() => setBeforeStart(value => !value)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text accessibilityRole="header" style={{ ...headingStyle, flex: 1, fontWeight: '600' }}>{tt('detail.beforeStart')}</Text><View style={{ transform: [{ rotate: beforeStart ? '-90deg' : '90deg' }] }}><Icon name="chevronRight" color={c.surface} size={18} /></View>
          </Pressable>
          {beforeStart ? <>
            <Text accessibilityRole="header" style={headingStyle}>{tt('detail.rates')}</Text>
            {rows.map(([label, value]) => <View key={label} style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: polish.darkEdge }}>
              <Text style={{ ...bodyStyle, flexGrow: 1 }}>{tt(label)}</Text><Text style={{ ...c.type.body, color: c.surface, fontFamily: face(theme), fontWeight: '600', fontVariant: ['tabular-nums'] }}>{value}</Text>
            </View>)}
            <Text style={bodyStyle}>{tt('detail.sharedTarget')}</Text>
            <Text style={bodyStyle}>{tt('detail.noTotal')}</Text>
            <Text style={bodyStyle}>{data.paymentRule.trim() || tt('detail.notSupplied')}</Text>
            <Text accessibilityRole="header" style={headingStyle}>{tt('detail.where')}</Text>
            <Text style={bodyStyle}>{data.privacyNotice.trim() || tt('detail.notSupplied')}</Text>
          </> : null}
        </View>
      </View>
    </Animated.ScrollView>
    <LinearGradient pointerEvents="none" colors={['transparent', c.night]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: footer + 32 }} />
    <View testID="task-detail-footer" onLayout={event => setFooter(event.nativeEvent.layout.height)}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: c.gutter, paddingTop: 12, paddingBottom: 12 + Math.max(insets.bottom, 16), gap: 8 }}>
      {refusal === null ? <Button label={tt('detail.claim')} onDark onPress={() => setConfirming(true)} /> : null}
      {alreadyClaimed ? <Button label={tt('session.title')} onDark onPress={() => nav.push({ name: 'sessionCreate' })} /> : null}
    </View>
    <Sheet open={confirming} dismissible={!claim.isPending} dark title={tt('detail.reviewClaim')} onClose={() => { if (!claim.isPending) setConfirming(false); }}
      footer={<View style={{ gap: 8 }}>
        <View testID="claim-payment-disclosures" style={{ gap: 6 }}>
          {[tt('detail.sharedTarget'), tt('detail.noTotal')].map(text => <View key={text} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}><Icon name="info" color={c.surface} size={18} /><Text style={{ ...c.type.caption, fontFamily: face(theme), color: polish.darkMuted, flex: 1 }}>{text}</Text></View>)}
        </View>
        <Button label={tt('detail.confirmClaim')} onDark busy={claim.isPending} disabled={refusal !== null} onPress={submit} /><Button label={tt('common.cancel')} accessibilityHint={tt('detail.cancelHint')} onDark variant="ghost" disabled={claim.isPending} onPress={() => setConfirming(false)} /></View>}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 4 }}>
        <Image source={image} contentFit="cover" accessible={false} style={{ width: compact ? 48 : 84, height: compact ? 48 : 72, borderRadius: 14 }} />
        <View style={{ flex: 1, gap: 5 }}><Text style={{ ...headingStyle, fontWeight: '700' }}>{data.title}</Text><Text style={{ ...c.type.body, fontFamily: face(theme), color: c.glow, fontWeight: '700' }}>{dong(data.unitPriceVndPerMinute)} <Text style={bodyStyle}>{tt('detail.perMinute')}</Text></Text></View>
      </View>
      <View>
        {([
          ['camera', tt('detail.target'), taskDuration(data.targetMinutes, tt)],
          ['profile', tt('detail.slotsLeft'), String(data.remainingSlots)],
          ['file', tt('training.title'), tt(trainingDone ? 'detail.trainingComplete' : 'detail.needTraining')],
        ] as const).map(([icon, label, value]) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: compact ? 8 : 14, borderTopWidth: 1, borderColor: polish.darkEdge }}><Icon name={icon} color={c.surface} size={22} /><Text style={{ ...bodyStyle, flex: 1 }}>{label}</Text><Text style={{ ...bodyStyle, color: c.surface, fontWeight: '600', flexShrink: 1, textAlign: 'right', maxWidth: '48%' }}>{value}</Text></View>)}
      </View>
    </Sheet>
  </View>;
}
