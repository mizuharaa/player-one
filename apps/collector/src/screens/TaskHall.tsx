import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import * as SecureStore from 'expo-secure-store';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { SCENARIOS, type Scenario, type Task } from '../api/types.ts';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Button, ListScreen, Note, Tag, face, useInsets } from '../ui.tsx';
import { EmptyTasks } from '../ui/illustrations/index.tsx';
import { Skeleton, taskImage } from '../v2.tsx';
import { dong } from '../money.ts';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.4 — Explore: photo-led task cards, a search overlay, a chips
 * row with a sort control, a filter sheet and a preferences sheet.
 *
 * References, in the order they appear on the screen: the chips row and the
 * sort control copy klarna-099..105; the lead card over a two-column grid
 * copies klarna-162; the search overlay copies klarna-159..162; the filter
 * sheet copies klarna-143; the availability slider copies klarna-167..169 and
 * the skills grid klarna-186..188; the empty state copies `08-empty-states`.
 *
 * **What the app is allowed to do to this list.** It filters on what the
 * collector typed and on their own preferences, and it orders by two integer
 * counts the server sent. It never sorts by rate: `unitPriceVndPerMinute` is a
 * money string, comparing two of them means parsing them, and every figure on
 * a money path is the server's (CLAUDE.md). It computes no total and no
 * projection anywhere.
 */

/* ── Size, and the one thing here that is not a server field ────────────── */

/**
 * How big a task is, as a word, and the ceiling in server minutes that ends
 * each band.
 *
 * **`targetMinutes` is the task's whole target, not one session.** The seed
 * tasks are 3,000 / 6,000 / 9,000 minutes against `claimedMinutes` of 420 /
 * 5,800 / 0, and `hall.progress` already prints the pair — so this is how much
 * work the task wants in total, shared across its claimants. An earlier draft
 * of this screen read it as a session length and banded it at 30 and 90
 * minutes, which put every seeded task in the same red band.
 *
 * ponytail: bands over a number the server sent, because `/api/me/tasks` has
 * no size or effort field. Nothing is added, multiplied or shown as a quantity
 * — the figure printed on the card is `targetMinutes` itself. The upgrade path
 * is one column: when a task carries its own effort, delete this and read it.
 */
const SIZE_CEILING = { small: 1000, medium: 5000, large: null } as const;

type Size = keyof typeof SIZE_CEILING;

const sizeOf = (targetMinutes: number): Size =>
  targetMinutes <= SIZE_CEILING.small ? 'small' : targetMinutes <= SIZE_CEILING.medium ? 'medium' : 'large';

const SIZE_LABEL: Record<Size, MessageKey> = {
  small: 'explore.effortShort',
  medium: 'explore.effortMedium',
  large: 'explore.effortLong',
};

/** The scenario code a task actually carries, however it was sent. */
const codeOf = (task: Task): Scenario | null =>
  task.scenario ?? SCENARIOS.find((s) => s === task.type) ?? null;

/* ── Preferences, on this phone only ────────────────────────────────────── */

export interface Preferences {
  /** The biggest task the collector will take, in minutes. `null` = any. */
  maxMinutes: number | null;
  /** Where they can record. Empty means "anywhere", not "nowhere". */
  scenarios: Scenario[];
}

const NO_PREFERENCES: Preferences = { maxMinutes: null, scenarios: [] };

/**
 * The slider's stops: the size bands' own ceilings, and "any".
 *
 * Not an invented ladder of minutes. The bands are the only thresholds this
 * screen has, the card already shows a task's band, and a slider whose stops
 * are something else would filter on a scale nothing on screen displays.
 */
const MINUTE_STOPS = [SIZE_CEILING.small, SIZE_CEILING.medium, null] as const;

/**
 * Where the preferences live.
 *
 * `expo-secure-store`, keyed per collector, because that is the only durable
 * store this app has (`guide/seen.ts` makes the same argument for the same
 * reason) and because two collectors sharing a phone must not inherit each
 * other's filters. A read that throws is no preferences at all — the worst
 * case is a collector setting them again, and the alternative is a screen that
 * refuses to list work because a keystore was unavailable.
 *
 * **These are a filter over the list the server already sent.** Nothing here
 * reaches the platform, there is no new route, and the suggestions are not a
 * ranking — §9 decision 4.
 */
const prefsKey = (collectorId: string) => `playerone.collector.prefs.${collectorId}`;
const recentsKey = (collectorId: string) => `${prefsKey(collectorId)}.recents`;

/**
 * One write queue per collector.
 *
 * Every write and the clear go through it, in order, so a save that was still
 * in flight when the collector signed out cannot land *after* the delete and
 * resurrect what was just cleared. Serialising is enough here and a lock is
 * not needed: there is one writer, this phone.
 *
 * ponytail: a `Map` of promises, not a mutex library. The entry is dropped
 * once it is the last link, so the map does not grow with every keystroke.
 */
const writeQueue = new Map<string, Promise<void>>();

function enqueue(collectorId: string, work: () => Promise<void>): Promise<void> {
  const tail = writeQueue.get(collectorId) ?? Promise.resolve();
  // `then(work, work)` rather than `finally`: a failed earlier write must not
  // stop the next one, and it must not stop the clear either.
  const settled = tail.then(work, work);
  writeQueue.set(collectorId, settled);
  const clean = () => { if (writeQueue.get(collectorId) === settled) writeQueue.delete(collectorId); };
  void settled.then(clean, clean);
  return settled;
}

/**
 * Forget everything this phone remembers about one collector.
 *
 * Work order §9.4: the local store is scoped per account **and cleared on
 * logout**. Both keys go — preferences and recent searches — and only for the
 * id given, so a second collector who uses this phone keeps their own.
 *
 * It resolves after any outstanding write for that collector has been applied
 * and then deleted, which is the property that matters: `App.tsx` captures the
 * profile id before it clears the query cache and awaits this, and a save the
 * collector made a moment before tapping Log out must not survive it.
 */
export type ClearPreferences = (collectorId: string) => Promise<void>;

export const clearPreferences: ClearPreferences = (collectorId) =>
  enqueue(collectorId, async () => {
    await SecureStore.deleteItemAsync(prefsKey(collectorId));
    await SecureStore.deleteItemAsync(recentsKey(collectorId));
  });

async function readPreferences(collectorId: string): Promise<Preferences> {
  try {
    const raw = await SecureStore.getItemAsync(prefsKey(collectorId));
    if (raw === null) return NO_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      maxMinutes: typeof parsed.maxMinutes === 'number' ? parsed.maxMinutes : null,
      scenarios: Array.isArray(parsed.scenarios)
        ? parsed.scenarios.filter((s): s is Scenario => SCENARIOS.some((known) => known === s))
        : [],
    };
  } catch {
    return NO_PREFERENCES;
  }
}

function writePreferences(collectorId: string, value: Preferences): Promise<void> {
  return enqueue(collectorId, async () => {
    try {
      await SecureStore.setItemAsync(prefsKey(collectorId), JSON.stringify(value));
    } catch {
      // Nothing to recover: the sheet keeps what it was given for this session
      // and the collector sets it again next time.
    }
  });
}

/** Kept with the preferences: the last few things typed into search. */
const RECENTS_LIMIT = 5;

async function readRecents(collectorId: string): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(recentsKey(collectorId));
    const parsed = raw === null ? [] : (JSON.parse(raw) as unknown);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeRecents(collectorId: string, value: string[]): Promise<void> {
  return enqueue(collectorId, async () => {
    try {
      await SecureStore.setItemAsync(recentsKey(collectorId), JSON.stringify(value));
    } catch {
      // Same as above: a lost recent search costs one retype.
    }
  });
}

/**
 * The collector's stored preferences, and the one way to change them.
 *
 * A hook rather than two screens each doing their own read and write: Explore
 * filters on them and Profile has a row that opens the same sheet, and the
 * failure mode of duplicating that is one screen writing to the keystore while
 * the other only updates its own state — which looks like it worked until the
 * app is next opened.
 *
 * It reads the collector id off the profile query rather than taking it as an
 * argument, so a caller cannot pass the wrong one, and it re-reads when the
 * identity changes.
 */
export function usePreferences(): { prefs: Preferences; save: (next: Preferences) => void } {
  const api = useApi();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const collectorId = profile.data?.id ?? null;
  const [prefs, setPrefs] = useState<Preferences>(NO_PREFERENCES);
  /**
   * Has the collector changed anything since the hydrating read started?
   *
   * The keystore read is asynchronous, and a collector can open the sheet and
   * save before it resolves — on a cold start with a slow keystore that is a
   * real sequence, not a theoretical one. Without this the read lands second
   * and silently replaces what they just chose. A change always wins; the
   * stored value only applies if nothing has been set since the read began.
   */
  const changed = useRef(false);

  useEffect(() => {
    if (collectorId === null) return;
    let live = true;
    // A different collector is a different hydration, and nothing has been
    // set for them yet.
    changed.current = false;
    void readPreferences(collectorId).then((value) => {
      if (live && !changed.current) setPrefs(value);
    });
    return () => { live = false; };
  }, [collectorId]);

  return {
    prefs,
    save: (next) => {
      changed.current = true;
      setPrefs(next);
      if (collectorId !== null) void writePreferences(collectorId, next);
    },
  };
}

/* ── The screen ─────────────────────────────────────────────────────────── */

type Sort = 'listed' | 'shortest' | 'slots';

const SORT_LABEL: Record<Sort, MessageKey> = {
  listed: 'explore.sortListed',
  shortest: 'explore.sortShortest',
  slots: 'explore.sortSlots',
};

export function TaskHall() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const { width, fontScale } = useWindowDimensions();
  const listTarget = useGuideTarget('hall.list');

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const collectorId = profile.data?.id ?? null;

  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState<Sort>('listed');
  const [sheet, setSheet] = useState<'filters' | 'prefs' | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const { prefs, save: storePrefs } = usePreferences();

  /** The same hydration guard `usePreferences` documents, for recents. */
  const recentsChanged = useRef(false);

  useEffect(() => {
    if (collectorId === null) return;
    let live = true;
    recentsChanged.current = false;
    void readRecents(collectorId).then((v) => {
      if (live && !recentsChanged.current) setRecents(v);
    });
    return () => { live = false; };
  }, [collectorId]);

  const remember = (term: string) => {
    const trimmed = term.trim();
    if (trimmed === '') return;
    const next = [trimmed, ...recents.filter((r) => r !== trimmed)].slice(0, RECENTS_LIMIT);
    recentsChanged.current = true;
    setRecents(next);
    if (collectorId !== null) void writeRecents(collectorId, next);
  };

  const forgetRecent = (term: string) => {
    const next = recents.filter((r) => r !== term);
    recentsChanged.current = true;
    setRecents(next);
    if (collectorId !== null) void writeRecents(collectorId, next);
  };

  const savePrefs = (next: Preferences) => {
    storePrefs(next);
    setSheet(null);
  };

  const needle = search.trim().toLocaleLowerCase();
  const all = tasks.data ?? [];
  const matched = all.filter((task) => {
    const code = codeOf(task);
    const words = `${task.title} ${code === null ? (task.type ?? '') : tt(`scenario.${code}`)}`;
    return (
      words.toLocaleLowerCase().includes(needle) &&
      (!availableOnly || task.claimable) &&
      (!onlyMine || task.claimedByMe) &&
      (prefs.maxMinutes === null || task.targetMinutes <= prefs.maxMinutes) &&
      (prefs.scenarios.length === 0 || (code !== null && prefs.scenarios.includes(code)))
    );
  });

  // Ordering, and only over integer counts the server sent. `listed` keeps the
  // platform's own order and is the default.
  const visible =
    sort === 'shortest'
      ? [...matched].sort((a, b) => a.targetMinutes - b.targetMinutes)
      : sort === 'slots'
        ? [...matched].sort((a, b) => b.remainingSlots - a.remainingSlots)
        : matched;

  /**
   * One column at 320 dp or at enlarged text (work order §4.4). Two 148 dp
   * tiles plus the gutters do not leave a legible rate at 320, and at 1.2×
   * the title takes three lines in a half-width card.
   */
  const oneColumn = width <= 320 || fontScale >= 1.2;

  /**
   * Rows, not tasks: the first card is full width (klarna-162's lead store
   * card) and the rest pair up.
   *
   * `ListScreen` is the kit's virtualized screen and takes one item per row,
   * so the row is the item. That is cheaper than a second list component with
   * its own `numColumns` — which `FlatList` needs a key change to switch — and
   * it keeps the tab-bar reserve, the gutter and the empty slot in one place.
   */
  const rows: Task[][] = [];
  for (const [index, task] of visible.entries()) {
    const previous = rows[rows.length - 1];
    if (index === 0 || oneColumn || previous === undefined || previous.length === 2) rows.push([task]);
    else previous.push(task);
  }

  const filtered = needle !== '' || availableOnly || onlyMine || prefs.maxMinutes !== null || prefs.scenarios.length > 0;

  if (searching) {
    return (
      <SearchOverlay
        value={search}
        recents={recents}
        results={visible}
        onChange={setSearch}
        onSubmit={() => { remember(search); setSearching(false); }}
        onPick={(term) => { setSearch(term); remember(term); setSearching(false); }}
        onForget={forgetRecent}
        onClose={() => setSearching(false)}
        onOpenTask={(id) => { setSearching(false); nav.push({ name: 'taskDetail', taskId: id }); }}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ListScreen
        title={tt('hall.title')}
        data={rows}
        keyOf={(row) => row.map((task) => task.id).join('+')}
        /**
         * Refresh as a control, not a gesture.
         *
         * `ListScreen` at this branch point takes no `refresh` prop — the kit's
         * `FlatList` has no `RefreshControl` — and `ui.tsx` is not this lane's
         * file. So the way to re-read the hall is a named control in the header
         * slot, which is also the half of pull-to-refresh a screen reader can
         * actually use. When the kit grows `refresh`, pass
         * `{ refreshing: tasks.isFetching && !tasks.isPending, onRefresh }`
         * and keep this: a gesture with no visible equivalent is not reachable.
         */
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tt('explore.refresh')}
            accessibilityState={{ busy: tasks.isFetching }}
            onPress={() => void tasks.refetch()}
            hitSlop={theme.space[2]}
            style={({ pressed }) => ({
              minHeight: theme.space[12],
              justifyContent: 'center',
              opacity: pressed || tasks.isFetching ? 0.6 : 1,
            })}
          >
            <Text
              style={{
                ...c.type.caption,
                color: c.plum,
                fontFamily: face(theme),
                fontWeight: theme.fontWeight.medium,
              }}
            >
              {tt('explore.refresh')}
            </Text>
          </Pressable>
        }
        header={
          <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
            <SearchEntry text={search} onPress={() => setSearching(true)} />
            <ChipsRow
              filtersActive={availableOnly || onlyMine}
              availableOnly={availableOnly}
              onlyMine={onlyMine}
              onFilters={() => setSheet('filters')}
              onAll={() => { setAvailableOnly(false); setOnlyMine(false); }}
              onAvailable={() => setAvailableOnly(true)}
              onMine={() => setOnlyMine(true)}
            />
            <SectionRow
              title={tt(needle === '' ? 'explore.forYou' : 'explore.results')}
              action={tt(SORT_LABEL[sort])}
              onAction={() => setSheet('filters')}
            />
            {/* A failed refresh over data that is already on screen keeps the
                data and says so — and carries its own Retry, because a
                blocking error is inline next to the control with a way out and
                never a toast on a timer (§3.4). */}
            {tasks.isError && tasks.data !== undefined ? (
              <Note
                text={tt('common.refreshFailed')}
                tone="pending"
                busy={tasks.isFetching}
                onRetry={() => void tasks.refetch()}
              />
            ) : null}
            {/* The skeleton grid, while the first read is in flight. Two
                columns of it even at one column: it is the shape of what is
                coming, and `Skeleton` already holds the pulse and respects
                reduced motion. */}
            {tasks.isPending ? (
              // It announces itself, for the reason `Loading` in the kit
              // exists: a skeleton is silent, and a screen that has said
              // nothing since the tab was opened reads as an empty hall.
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={tt('common.loading')}
                style={{ flexDirection: 'row', gap: c.cardGap }}
              >
                <View style={{ flex: 1 }}>
                  <Skeleton ratio={3 / 5} radius={c.radius.card} />
                </View>
                <View style={{ flex: 1 }}>
                  <Skeleton ratio={3 / 5} radius={c.radius.card} />
                </View>
              </View>
            ) : null}
          </View>
        }
        empty={
          tasks.isPending ? null : tasks.isError ? (
            <Note text={tt('common.loadFailed')} tone="error" onRetry={() => void tasks.refetch()} busy={tasks.isFetching} />
          ) : (
            <EmptyHall
              cleared={filtered}
              onClear={() => {
                setSearch('');
                setAvailableOnly(false);
                setOnlyMine(false);
                savePrefs(NO_PREFERENCES);
              }}
            />
          )
        }
        renderItem={(row) => {
          const lead = row[0] !== undefined && row[0] === visible[0];
          return (
            <View style={{ flexDirection: 'row', gap: c.cardGap }}>
              {row.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  lead={lead}
                  onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}
                />
              ))}
              {/* An odd last row keeps its tile at half width rather than
                  stretching one card across the whole grid. */}
              {!oneColumn && row.length === 1 && !lead ? <View style={{ flex: 1 }} /> : null}
            </View>
          );
        }}
      />

      <Sheet open={sheet === 'filters'} onClose={() => setSheet(null)} title={tt('explore.filters')}>
        <FilterBody
          sort={sort}
          availableOnly={availableOnly}
          onlyMine={onlyMine}
          onSort={setSort}
          onAvailableOnly={setAvailableOnly}
          onOnlyMine={setOnlyMine}
          onClearAll={() => { setAvailableOnly(false); setOnlyMine(false); setSort('listed'); }}
          onDone={() => setSheet(null)}
          onPreferences={() => setSheet('prefs')}
        />
      </Sheet>

      <PreferencesSheet
        open={sheet === 'prefs'}
        value={prefs}
        tasks={all}
        onClose={() => setSheet(null)}
        onSave={savePrefs}
      />
    </View>
  );
}

/* ── Pieces of the screen ───────────────────────────────────────────────── */

/** The resting search field: a pill that opens the overlay (klarna-099). */
function SearchEntry({ text, onPress }: { text: string; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel={tt('explore.searchOpen')}
      accessibilityValue={text === '' ? undefined : { text }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.space[12],
        borderRadius: c.radius.pill,
        backgroundColor: pressed ? c.line : c.surface,
        borderWidth: 1,
        borderColor: c.line,
        paddingHorizontal: c.cardPad,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
      })}
    >
      <Lens />
      <Text
        numberOfLines={1}
        style={{ ...c.type.body, color: text === '' ? c.muted : c.ink, fontFamily: face(theme), flex: 1 }}
      >
        {text === '' ? tt('hall.search') : text}
      </Text>
    </Pressable>
  );
}

/** The magnifier, drawn rather than imported: two shapes, one stroke. */
function Lens() {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <View importantForAccessibility="no" style={{ width: theme.space[5], height: theme.space[5], justifyContent: 'center' }}>
      <View
        style={{
          width: theme.space[4],
          height: theme.space[4],
          borderRadius: c.radius.pill,
          borderWidth: 2,
          borderColor: c.muted,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: theme.space[1],
          width: theme.space[2],
          height: 2,
          borderRadius: 1,
          backgroundColor: c.muted,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/**
 * The chips row (klarna-099..105): the filter entry first, in the dark fill
 * with a caret, then the states.
 */
function ChipsRow({
  filtersActive,
  availableOnly,
  onlyMine,
  onFilters,
  onAll,
  onAvailable,
  onMine,
}: {
  filtersActive: boolean;
  availableOnly: boolean;
  onlyMine: boolean;
  onFilters: () => void;
  onAll: () => void;
  onAvailable: () => void;
  onMine: () => void;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: theme.space[2], paddingRight: c.gutter }}
    >
      <Pill label={`${tt('explore.filters')} ⌄`} accessibilityLabel={tt('explore.filters')} selected={filtersActive} onPress={onFilters} dark />
      <Pill label={tt('hall.all')} selected={!availableOnly && !onlyMine} onPress={onAll} />
      <Pill label={tt('hall.availableOnly')} selected={availableOnly} onPress={onAvailable} />
      <Pill label={tt('explore.onlyMine')} selected={onlyMine} onPress={onMine} />
    </ScrollView>
  );
}

/**
 * One chip.
 *
 * Not the kit's `Chip`: the reference's first chip is a night fill with a
 * caret and the rest are outlines, and `Chip`'s selected state is the sun
 * action colour — which is the primary-button fill and would put four primary
 * actions in a row (§2's button law).
 */
function Pill({
  label,
  accessibilityLabel,
  selected,
  onPress,
  dark = false,
}: {
  label: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
  dark?: boolean;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const fill = dark ? c.night : selected ? c.plum : c.surface;
  const ink = dark || selected ? c.surface : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.space[12],
        justifyContent: 'center',
        paddingHorizontal: c.cardPad,
        borderRadius: c.radius.pill,
        backgroundColor: fill,
        borderWidth: dark || selected ? 0 : 1,
        borderColor: c.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ ...c.type.caption, color: ink, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A heading with one text action on the right (klarna-099's "Recommended ⌃"). */
function SectionRow({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale > 1.2;
  return (
    <View
      style={{
        flexDirection: stacked ? 'column' : 'row',
        alignItems: stacked ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        gap: theme.space[2],
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2, flexShrink: 1 }}
      >
        {title}
      </Text>
      {action === undefined || onAction === undefined ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action}
          onPress={onAction}
          hitSlop={theme.space[2]}
          style={({ pressed }) => ({
            minHeight: theme.space[12],
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ ...c.type.caption, color: c.plum, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
            {`${action} ⌃`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * A task, photo first (klarna-162).
 *
 * The rate is the largest thing in the card's text block and it is the money
 * green ink shade, not the specified `green` — measured, `#12A150` is 3.06:1
 * on white, which fails AA for anything that is not large-bold text, and
 * `contrast.test.ts` holds `greenInk` instead. §2's figure is kept; the shade
 * is the one that is legible.
 */
function TaskCard({ task, lead, onPress }: { task: Task; lead: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const code = codeOf(task);
  const scenario = code === null ? (task.type ?? '') : tt(`scenario.${code}`);
  const size = sizeOf(task.targetMinutes);
  const tone =
    size === 'small'
      ? { fg: c.greenInk, bg: c.greenBg }
      : size === 'medium'
        ? { fg: c.amberInk, bg: c.amberBg }
        : { fg: c.redInk, bg: c.redBg };
  // At most three, and each one a word the server sent or our own name for a
  // code it sent. Never a decorative label.
  const tags = [scenario, task.claimedByMe ? tt('detail.claimed') : task.claimable ? tt('hall.open') : tt('hall.full')]
    .filter((label) => label !== '')
    .slice(0, 3);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={task.title}
      accessibilityHint={tt('explore.openTask')}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: c.radius.card,
        backgroundColor: pressed ? c.line : c.surface,
        borderWidth: 1,
        borderColor: c.line,
        overflow: 'hidden',
      })}
    >
      {/* An `aspectRatio` box, never a width/height pair: that pair is how the
          rejected build stretched every still. */}
      <View style={{ width: '100%', aspectRatio: lead ? 16 / 9 : 4 / 3, backgroundColor: c.line }}>
        <Image
          // `assets.d.ts` types a bundled import as React Native's source —
          // a module number under Metro, a URL string under Vite — and
          // `expo-image` accepts both. The cast is that one fact.
          source={taskImage(task.scenario, task.type) as unknown as ImageSource}
          contentFit="cover"
          style={{ width: '100%', height: '100%' }}
          accessible={false}
        />
      </View>
      <View style={{ padding: c.cardPad, gap: theme.space[2] }}>
        <Text
          numberOfLines={2}
          style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), fontWeight: theme.fontWeight.semibold }}
        >
          {task.title}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text
            style={{
              fontSize: 18,
              lineHeight: 24,
              color: c.greenInk,
              fontFamily: face(theme),
              fontWeight: theme.fontWeight.semibold,
              fontVariant: ['tabular-nums'],
            }}
          >
            {dong(task.unitPriceVndPerMinute)}
          </Text>
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), flexShrink: 1 }}>
            {tt('hall.perMinute')}
          </Text>
        </View>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>
          {`${tt('detail.target')} · ${task.targetMinutes} ${tt('detail.minutes')}`}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <Tag label={tt(SIZE_LABEL[size])} fg={tone.fg} bg={tone.bg} />
          {tags.map((label) => (
            <Tag key={label} label={label} fg={c.muted} bg={c.paper} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

/** One object, a bold headline, one line, one CTA (`08-empty-states`). */
function EmptyHall({ cleared, onClear }: { cleared: boolean; onClear: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  return (
    <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[8] }}>
      <EmptyTasks size={120} />
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme), textAlign: 'center' }}
      >
        {tt('explore.emptyTitle')}
      </Text>
      <Text style={{ ...c.type.body, color: c.muted, fontFamily: face(theme), textAlign: 'center' }}>
        {tt(cleared ? 'hall.noMatches' : 'home.claimableEmpty')}
      </Text>
      {/* The CTA only exists when there is something to undo. An empty hall is
          not the collector's doing and a button that clears nothing is worse
          than no button. */}
      {cleared ? <Button label={tt('explore.emptyAction')} variant="secondary" onPress={onClear} /> : null}
    </View>
  );
}

/* ── The search overlay (klarna-159..162) ───────────────────────────────── */

function SearchOverlay({
  value,
  recents,
  results,
  onChange,
  onSubmit,
  onPick,
  onForget,
  onClose,
  onOpenTask,
}: {
  value: string;
  recents: readonly string[];
  results: readonly Task[];
  onChange: (v: string) => void;
  onSubmit: () => void;
  onPick: (term: string) => void;
  onForget: (term: string) => void;
  onClose: () => void;
  onOpenTask: (id: string) => void;
}) {
  const theme = useTheme();
  const insets = useInsets();
  const c = theme.collector;
  const tt = useT();
  const typed = value.trim() !== '';
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <View
        style={{
          paddingTop: insets.top + theme.space[2],
          paddingHorizontal: c.gutter,
          paddingBottom: theme.space[3],
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
        }}
      >
        <View
          style={{
            flex: 1,
            minHeight: theme.space[12],
            borderRadius: c.radius.pill,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.line,
            paddingHorizontal: c.cardPad,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
          }}
        >
          <Lens />
          <TextInput
            value={value}
            onChangeText={onChange}
            onSubmitEditing={onSubmit}
            returnKeyType="search"
            autoFocus
            accessibilityLabel={tt('hall.search')}
            placeholder={tt('hall.search')}
            placeholderTextColor={c.muted}
            style={{ flex: 1, color: c.ink, fontFamily: face(theme), fontSize: c.type.body.fontSize, minHeight: theme.space[12] }}
          />
          {typed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tt('explore.clearText')}
              onPress={() => onChange('')}
              hitSlop={theme.space[3]}
              style={{ minWidth: theme.space[8], minHeight: theme.space[8], alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ ...c.type.body, color: c.muted, fontFamily: face(theme) }}>✕</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('common.cancel')}
          onPress={onClose}
          hitSlop={theme.space[2]}
          style={{ minHeight: theme.space[12], justifyContent: 'center' }}
        >
          <Text style={{ ...c.type.body, color: c.plum, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
            {tt('common.cancel')}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: c.gutter,
          paddingBottom: theme.space[6] + Math.max(insets.bottom, theme.space[6]),
          gap: theme.space[3],
        }}
      >
        {!typed && recents.length > 0 ? (
          <>
            <SectionRow title={tt('explore.recent')} />
            {recents.map((term) => (
              <View key={term} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={term}
                  onPress={() => onPick(term)}
                  style={{ flex: 1, minHeight: theme.space[12], justifyContent: 'center' }}
                >
                  <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme) }}>{term}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${tt('explore.recentRemove')}: ${term}`}
                  onPress={() => onForget(term)}
                  hitSlop={theme.space[2]}
                  style={{ minWidth: theme.space[12], minHeight: theme.space[12], alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ ...c.type.body, color: c.muted, fontFamily: face(theme) }}>✕</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}

        <SectionRow title={tt(typed ? 'explore.results' : 'explore.forYou')} />
        {results.length === 0 ? (
          <Text style={{ ...c.type.body, color: c.muted, fontFamily: face(theme) }}>{tt('hall.noMatches')}</Text>
        ) : (
          results.slice(0, 20).map((task) => (
            <Pressable
              key={task.id}
              accessibilityRole="button"
              accessibilityLabel={task.title}
              accessibilityHint={tt('explore.openTask')}
              onPress={() => onOpenTask(task.id)}
              style={{
                minHeight: theme.space[12],
                paddingVertical: theme.space[3],
                borderBottomWidth: 1,
                borderBottomColor: c.line,
                gap: theme.space[1],
              }}
            >
              <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme) }}>{task.title}</Text>
              <Text
                style={{
                  ...c.type.caption,
                  color: c.greenInk,
                  fontFamily: face(theme),
                  fontVariant: ['tabular-nums'],
                }}
              >
                {`${dong(task.unitPriceVndPerMinute)} ${tt('hall.perMinute')}`}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

/* ── Sheets ─────────────────────────────────────────────────────────────── */

/**
 * The bottom sheet every sheet on these screens is (klarna-143, klarna-333,
 * `18-sheets-and-toggles`).
 *
 * It lives here rather than in a module of its own because Explore is the
 * screen with three of them and the lane's file ownership puts new shared
 * modules in Astra's `ui.tsx`. Fable: this and `PreferencesSheet` are the two
 * things on this lane that want to move into the kit.
 *
 * Core `Modal` with `animationType="none"`: it is the only thing in core that
 * takes the Android back button and the accessibility focus trap with it, and
 * the kit owns motion.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useInsets();
  const c = theme.collector;
  const tt = useT();
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* The dim behind the sheet is the night ground at 55%, drawn as its
            own layer so the colour comes from `theme.collector.night` instead
            of an `rgba()` literal. `theme.collector` has no `scrim` token; one
            belongs there, and this is the only place in the lane that needs
            it. `opacity` on a parent would fade the sheet too, so the layer is
            a sibling behind it. */}
        <View
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          style={[StyleSheet.absoluteFill, { backgroundColor: c.night, opacity: 0.55 }]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={tt('common.close')} onPress={onClose} style={{ flex: 1 }} />
        <View
          style={{
            backgroundColor: c.surface,
            borderTopLeftRadius: c.radius.card * 1.5,
            borderTopRightRadius: c.radius.card * 1.5,
            paddingHorizontal: c.gutter,
            paddingTop: c.gutter,
            paddingBottom: c.gutter + Math.max(insets.bottom, theme.space[6]),
            maxHeight: '88%',
            gap: theme.space[3],
          }}
        >
          <View
            importantForAccessibility="no"
            style={{
              alignSelf: 'center',
              width: theme.space[10],
              height: theme.space[1],
              borderRadius: c.radius.pill,
              backgroundColor: c.line,
            }}
          />
          <Text accessibilityRole="header" style={{ ...c.type.h1, color: c.ink, fontFamily: face(theme) }}>
            {title}
          </Text>
          <ScrollView contentContainerStyle={{ gap: theme.space[3], paddingBottom: theme.space[2] }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Sort radios over a toggle list, then the commit (klarna-143). */
function FilterBody({
  sort,
  availableOnly,
  onlyMine,
  onSort,
  onAvailableOnly,
  onOnlyMine,
  onClearAll,
  onDone,
  onPreferences,
}: {
  sort: Sort;
  availableOnly: boolean;
  onlyMine: boolean;
  onSort: (s: Sort) => void;
  onAvailableOnly: (v: boolean) => void;
  onOnlyMine: (v: boolean) => void;
  onClearAll: () => void;
  onDone: () => void;
  onPreferences: () => void;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  return (
    <View style={{ gap: theme.space[3] }}>
      <GroupLabel text={tt('explore.sort')} />
      {(['listed', 'shortest', 'slots'] as const).map((option) => (
        <RadioRow
          key={option}
          label={tt(SORT_LABEL[option])}
          selected={sort === option}
          onPress={() => onSort(option)}
        />
      ))}
      <GroupLabel text={tt('explore.show')} />
      <ToggleRow label={tt('hall.availableOnly')} value={availableOnly} onChange={onAvailableOnly} />
      <ToggleRow label={tt('explore.onlyMine')} value={onlyMine} onChange={onOnlyMine} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tt('explore.prefsTitle')}
        onPress={onPreferences}
        style={{ minHeight: theme.space[12], justifyContent: 'center' }}
      >
        <Text style={{ ...c.type.body, color: c.plum, fontFamily: face(theme), fontWeight: theme.fontWeight.medium }}>
          {tt('explore.prefsTitle')}
        </Text>
      </Pressable>
      <Button label={tt('explore.showResults')} onPress={onDone} />
      <Button label={tt('explore.clearAll')} variant="secondary" onPress={onClearAll} />
    </View>
  );
}

function GroupLabel({ text }: { text: string }) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <Text
      accessibilityRole="header"
      style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), marginTop: theme.space[2] }}
    >
      {text}
    </Text>
  );
}

function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.space[12],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        backgroundColor: pressed ? c.paper : undefined,
      })}
    >
      <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), flexShrink: 1 }}>{label}</Text>
      <View
        importantForAccessibility="no"
        style={{
          width: theme.space[5],
          height: theme.space[5],
          borderRadius: c.radius.pill,
          borderWidth: 2,
          borderColor: selected ? c.plum : c.muted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? (
          <View style={{ width: theme.space[2], height: theme.space[2], borderRadius: c.radius.pill, backgroundColor: c.plum }} />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A toggle row.
 *
 * Drawn rather than core `Switch`: `Switch` takes a colour per platform and
 * neither default is in this palette, and the reference's toggle is a plum
 * track with a white knob. The state is announced as a switch either way.
 */
function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  const c = theme.collector;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      aria-checked={value}
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        minHeight: theme.space[12],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: theme.space[3],
        borderBottomWidth: 1,
        borderBottomColor: c.line,
        backgroundColor: pressed ? c.paper : undefined,
      })}
    >
      <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), flexShrink: 1 }}>{label}</Text>
      <View
        importantForAccessibility="no"
        style={{
          width: theme.space[10],
          height: theme.space[6],
          borderRadius: c.radius.pill,
          padding: 2,
          backgroundColor: value ? c.plum : c.line,
          alignItems: value ? 'flex-end' : 'flex-start',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: theme.space[5],
            height: theme.space[5],
            borderRadius: c.radius.pill,
            backgroundColor: c.surface,
          }}
        />
      </View>
    </Pressable>
  );
}

/**
 * Preferences (work order §4.4): the availability slider (klarna-167..169) and
 * the skills grid (klarna-186..188), stored per account on this phone.
 *
 * Exported because Profile's "Preferences" row opens the same sheet. One sheet,
 * two entry points — the alternative is two screens that can disagree about
 * what the collector chose.
 */
export function PreferencesSheet({
  open,
  value,
  tasks,
  onClose,
  onSave,
}: {
  open: boolean;
  value: Preferences;
  tasks: readonly Task[];
  onClose: () => void;
  onSave: (next: Preferences) => void;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const [draft, setDraft] = useState(value);

  // The sheet edits a draft, so Close discards. Re-seeded each time it opens,
  // which is also what makes Profile and Explore agree about what is stored.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  return (
    <Sheet open={open} onClose={onClose} title={tt('explore.prefsTitle')}>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('explore.prefsIntro')}</Text>

      <GroupLabel text={tt('explore.availability')} />
      <MinutesSlider
        tasks={tasks}
        value={draft.maxMinutes}
        onChange={(maxMinutes) => setDraft((d) => ({ ...d, maxMinutes }))}
      />

      <GroupLabel text={tt('explore.skills')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {SCENARIOS.map((scenario) => {
          const picked = draft.scenarios.includes(scenario);
          return (
            <Pressable
              key={scenario}
              accessibilityRole="checkbox"
              accessibilityLabel={tt(`scenario.${scenario}`)}
              accessibilityState={{ checked: picked }}
              onPress={() =>
                setDraft((d) => ({
                  ...d,
                  scenarios: picked ? d.scenarios.filter((s) => s !== scenario) : [...d.scenarios, scenario],
                }))
              }
              style={({ pressed }) => ({
                // Two per row at any width, so the grid never needs a measured
                // column count and survives 320 dp and 1.3× together.
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: theme.space[16],
                borderRadius: c.radius.card,
                borderWidth: 2,
                borderColor: picked ? c.plum : c.line,
                backgroundColor: picked ? c.plum : c.surface,
                padding: c.cardPad,
                justifyContent: 'flex-end',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              {/* A tick as well as the fill: the choice must be readable
                  without the plum. */}
              <Text
                importantForAccessibility="no"
                style={{ ...c.type.body, color: picked ? c.surface : c.muted, fontFamily: face(theme) }}
              >
                {picked ? '✓' : ''}
              </Text>
              <Text
                style={{
                  ...c.type.body,
                  color: picked ? c.surface : c.ink,
                  fontFamily: face(theme),
                  fontWeight: theme.fontWeight.semibold,
                }}
              >
                {tt(`scenario.${scenario}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button label={tt('explore.savePrefs')} onPress={() => onSave(draft)} />
      <Button label={tt('explore.clearAll')} variant="secondary" onPress={() => setDraft(NO_PREFERENCES)} />
    </Sheet>
  );
}

/**
 * The availability slider, copying klarna-167..169: a histogram above a track
 * with one handle and the value printed beside it.
 *
 * **The histogram is the real distribution of the fetched tasks**, one bar per
 * stop, scaled to the tallest bar. Counts of rows, not money and not a
 * duration — the app is allowed to count what it was sent, and a decorative
 * skyline over a real control would be the slop §2 bans.
 *
 * One handle, not two: the question is "how long a session can you do", which
 * has a ceiling and no floor. `PanResponder` is react-native core, so this
 * adds nothing to the build; `accessibilityActions` give the same control to a
 * reader, because a drag gesture is not operable by one.
 */
function MinutesSlider({
  tasks,
  value,
  onChange,
}: {
  tasks: readonly Task[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const [track, setTrack] = useState(0);
  const index = MINUTE_STOPS.findIndex((stop) => stop === value);
  const at = index === -1 ? MINUTE_STOPS.length - 1 : index;
  const atRef = useRef(at);
  atRef.current = at;
  const widthRef = useRef(0);
  widthRef.current = track;

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(MINUTE_STOPS.length - 1, next));
    onChange(MINUTE_STOPS[clamped] ?? null);
  };
  // The responder below is created once, so it reads the current `move`
  // through a ref rather than capturing the first render's closure.
  const moveRef = useRef(move);
  moveRef.current = move;

  // One responder for the life of the component; the current stop and track
  // width are read off refs so the closure never goes stale.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_event, gesture) => {
        const span = widthRef.current;
        if (span <= 0) return;
        const step = span / (MINUTE_STOPS.length - 1);
        moveRef.current(atRef.current + Math.round(gesture.dx / step));
      },
    }),
  ).current;

  const counts = MINUTE_STOPS.map((stop, i) => {
    const floor = i === 0 ? 0 : (MINUTE_STOPS[i - 1] ?? 0);
    return tasks.filter(
      (task) => task.targetMinutes > floor && (stop === null || task.targetMinutes <= stop),
    ).length;
  });
  const tallest = Math.max(1, ...counts);
  // The band's word and its ceiling in server minutes, so the control names
  // the same thing the cards do.
  const label =
    value === null
      ? tt('explore.anyLength')
      : `${tt(SIZE_LABEL[sizeOf(value)])} · ≤ ${value} ${tt('detail.minutes')}`;

  return (
    <View style={{ gap: theme.space[3] }}>
      <View
        importantForAccessibility="no"
        style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: theme.space[10] }}
      >
        {counts.map((count, i) => (
          <View
            key={MINUTE_STOPS[i] ?? 'any'}
            style={{
              flex: 1,
              height: `${Math.max(6, (count / tallest) * 100)}%`,
              borderTopLeftRadius: 3,
              borderTopRightRadius: 3,
              backgroundColor: i <= at ? c.plum : c.line,
            }}
          />
        ))}
      </View>

      <View
        accessibilityRole="adjustable"
        accessibilityLabel={tt('explore.availability')}
        accessibilityValue={{ text: label }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          move(at + (event.nativeEvent.actionName === 'decrement' ? -1 : 1));
        }}
        onLayout={(event) => setTrack(event.nativeEvent.layout.width)}
        {...pan.panHandlers}
        style={{ minHeight: theme.space[12], justifyContent: 'center' }}
      >
        <View style={{ height: theme.space[1], borderRadius: c.radius.pill, backgroundColor: c.line }}>
          <View
            style={{
              width: `${(at / (MINUTE_STOPS.length - 1)) * 100}%`,
              height: '100%',
              borderRadius: c.radius.pill,
              backgroundColor: c.plum,
            }}
          />
        </View>
        {/* A 44 pt handle, centred on its stop and kept inside the track. */}
        <View
          style={{
            position: 'absolute',
            left: `${(at / (MINUTE_STOPS.length - 1)) * 100}%`,
            marginLeft: -theme.space[6],
            width: theme.space[12],
            height: theme.space[12],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: theme.space[6],
              height: theme.space[6],
              borderRadius: c.radius.pill,
              backgroundColor: c.surface,
              borderWidth: 3,
              borderColor: c.plum,
            }}
          />
        </View>
      </View>

      <Text
        accessibilityLiveRegion="polite"
        style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), fontWeight: theme.fontWeight.semibold }}
      >
        {label}
      </Text>
    </View>
  );
}
