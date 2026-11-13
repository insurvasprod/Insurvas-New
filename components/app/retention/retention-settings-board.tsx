"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { LadderRulesBoard, ladderChanges, SAVED_LADDER } from "@/components/app/retention/ladder-rules-board";
import { BAND_TAKES, HoldoutDialog, isYours, OwnerDialog, QueueDialog, QueueTakesDialog, SettingsDialog, ShareDialog, TalkTrackDialog, WinbackDialog } from "@/components/app/retention/retention-settings-dialogs";
import { CountLink, postSettings, putLadderRules, SheetInfoProvider } from "@/components/app/retention/retention-settings-rows";
import { SectionTabs, useAnchorTab } from "@/components/app/settings/setting-row";
import {
  GroupRow, NowCell, plainValue, SettingFoot, SettingRow, SettingTable, shortDay, StatusLine, UsedCell, ValueCell, WhoCell,
  type Affect, type HistoryItem, type ValueKind,
} from "@/components/app/settings/money/setting-kit";
import { WeightsSheet } from "@/components/app/settings/money/weights-sheet";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { ViewTab } from "@/components/ui/view-tabs";
import { DEFAULT_OWNER_ROLE, LA5_OWNER_ROLE_LABELS, LA5_QUEUE_LABELS, LA5_QUEUES, type La5OwnerRole, type La5Queue } from "@/lib/retention/assignment";
import { PLATFORM_TALK_TRACK } from "@/lib/retention/campaign";
import { DEFAULT_LADDER_SETTINGS, type Reason } from "@/lib/retention/cases/ladder";
import type { FlaggedWord, LadderRules } from "@/lib/retention/cases/rulesStore";
import { PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, SIGNAL_LABELS, SIGNALS, WINBACK_REASONS, type RetentionSettings, type WinbackReason } from "@/lib/retention/constants";
import { SORT_LABELS } from "@/lib/retention/queue";
import { diff, FIELDS, resetSection, thresholdConsequence, WINBACK_LABELS, type HubSection } from "@/lib/retention/settingsHub";
import type { Hub } from "@/lib/retention/settingsHubStore";
import { notify } from "@/lib/notify";

/**
 * Settings › Retention (LA-5.11). Round 7 (owner pick 7·A "By what it drives", 2026-11-10) gave it five tabs named
 * after what they change: Ladder (what Cases runs on) · Who works it · Requests · Win-back · Radar.
 *
 * Round 8 (docs/design/settings-r8/money-compliance-settings.html §4–5, owner "Build all four" 2026-11-12): every
 * setting is one line, Setting · Now · Used by · Changed (gold avatar · date) · Value (Yours or Insurvas) · ›, and a
 * row opens a right sheet that changes that one setting, with what it affects and its own history (Put back on the
 * newest change). Scoring weights open as a wide sheet with a live preview of the book and Save as version N. The
 * title line holds History and More (reset this tab, results, Open Cases); a status line under it says how many
 * values are yours and who changed one last, or that a sheet is open with nothing saved yet.
 */
export type Tab = "ladder" | "who" | "requests" | "winback" | "radar";
export const TAB_KEYS: readonly Tab[] = ["ladder", "who", "requests", "winback", "radar"];
const TAB_LABELS: Record<Tab, string> = { ladder: "Ladder", who: "Who works it", requests: "Requests", winback: "Win-back", radar: "Radar" };
export const tabHref = (tab: Tab) => `/app/retention-settings?tab=${tab}`;

/** The five tabs, with what needs the owner as each one's count. Shared with the weights page. */
export function retentionTabs({ off, reps }: { off: number; reps: number | null }): ViewTab<Tab>[] {
  return TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    count: key === "ladder" ? off || null : key === "who" ? (reps === 1 ? 1 : null) : null,
    tone: "danger" as const,
  }));
}

/** Every anchor Settings search links to (#holdout), and the tab that holds it. */
export const SECTION_TAB = {
  weights: "radar",
  thresholds: "radar",
  queue: "radar",
  signals: "radar",
  holdout: "radar",
  assignment: "who",
  campaigns: "requests",
  reinstatement: "requests",
  servicing: "requests",
  winback: "winback",
} as const satisfies Record<string, Tab>;
/** The hub sections a tab's reset puts back (weights reset from their sheet, the ladder through its rules). */
const TAB_SECTIONS: Record<Exclude<Tab, "ladder">, Exclude<HubSection, "weights">[]> = {
  who: ["assignment"],
  requests: ["servicing", "campaigns", "reinstatement"],
  winback: ["winback"],
  radar: ["thresholds", "queue", "signals", "holdout"],
};

const HISTORY = "/app/settings?history=retention#settings-history";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sortWords = (s: RetentionSettings["queueDefaultSort"]) => SORT_LABELS[s].replace(" (default)", "").toLowerCase();
const STRATEGY: Record<RetentionSettings["assignmentStrategy"], string> = { round_robin: "Round-robin", by_carrier: "By carrier", by_exposure: "By exposure" };

type Open =
  | { k: "owner"; queue: La5Queue } | { k: "share" } | { k: "handover" }
  | { k: "servicing" } | { k: "cooloff" } | { k: "talk" } | { k: "countdown" }
  | { k: "winback"; reason: WinbackReason }
  | { k: "takes" } | { k: "bands" } | { k: "weights" } | { k: "queue" } | { k: "signals" } | { k: "holdout" };

type Key = keyof RetentionSettings;
/** The settings each sheet edits (owners and weights keep their own records). */
const KEYS: Record<Exclude<Open["k"], "owner" | "winback" | "weights">, Key[]> = {
  share: ["assignmentStrategy", "assignmentCarrierReps", "assignmentRepOrder"],
  handover: ["reinstatementEscalateDays"],
  servicing: ["servicingGraceDays"],
  cooloff: ["billDeclineCooloffDays"],
  talk: ["billTalkTrack"],
  countdown: ["reinstatementAmberDays", "reinstatementRedDays", "reinstatementPinDays"],
  takes: ["queueMinBand"],
  bands: ["mediumFrom", "highFrom", "criticalFrom"],
  queue: ["workedCooldownDays", "maxCards", "queueDefaultSort", "includeMediumWhenEmpty"],
  signals: ["sampleFloor", "carrierSampleFloor", "affordabilityLowBp", "affordabilityHighBp", "dangerMonthFrom", "dangerMonthTo"],
  holdout: ["holdoutEnabled", "holdoutShareBp", "holdoutMaxExposureCents", "predictionHorizonDays"],
};
const column = (k: Key) => (k === "assignmentCarrierReps" ? "assignment_carrier_reps" : k === "assignmentRepOrder" ? "assignment_rep_order" : FIELDS[k as keyof typeof FIELDS]?.column ?? k);
const KEY_OF_COLUMN = new Map<string, Key>((Object.keys(FIELDS) as (keyof typeof FIELDS)[]).map((k) => [FIELDS[k].column, k]));
const WINBACK_OF_COLUMN = new Map<string, WinbackReason>(WINBACK_REASONS.map((r) => [`winback_${r}_days`, r]));
/** The audit rows a sheet's history reads. */
function columnsOf(open: Open): string[] {
  if (open.k === "owner") return [`queue_owner_${open.queue}`];
  if (open.k === "winback") return [`winback_${open.reason}_days`];
  if (open.k === "weights") return ["weights"];
  return KEYS[open.k].map(column);
}
/** A stored value in the words its row uses. */
function words(col: string, value: unknown): string {
  if (value === null || value === undefined) return col === "bill_talk_track" ? "Insurvas's talk track" : "none";
  if (col.startsWith("queue_owner_")) return LA5_OWNER_ROLE_LABELS[value as La5OwnerRole] ?? String(value);
  if (col === "assignment_strategy") return STRATEGY[value as RetentionSettings["assignmentStrategy"]] ?? String(value);
  if (col === "queue_min_band") return BAND_TAKES[value as RetentionSettings["queueMinBand"]] ?? String(value);
  if (col === "queue_default_sort") return sortWords(value as RetentionSettings["queueDefaultSort"]);
  if (col.endsWith("_days") && typeof value === "number") return plural(value, "day");
  if (col === "max_cards" && typeof value === "number") return `${value} cards`;
  if (col === "assignment_carrier_reps" || col === "assignment_rep_order") return "changed";
  return plainValue(col, value);
}
const LABEL_OF_COLUMN: Record<string, string> = {
  reinstatement_amber_days: "Amber", reinstatement_red_days: "Red", reinstatement_pin_days: "Pinned", medium_from: "Medium", high_from: "High", critical_from: "Critical",
  worked_cooldown_days: "Rest", max_cards: "Most shown", queue_default_sort: "Sort", include_medium_when_empty: "With nothing high risk",
  sample_floor: "Lead source floor", carrier_sample_floor: "Carrier floor", affordability_low_bp: "Affordable below", affordability_high_bp: "Unaffordable above",
  danger_month_from: "Danger from", danger_month_to: "Danger to", holdout_enabled: "Holdout", holdout_share_bp: "Share", holdout_max_exposure_cents: "Never above",
  prediction_horizon_days: "Look after", assignment_strategy: "Mode", assignment_carrier_reps: "Reps by carrier", assignment_rep_order: "Rep order",
};

const NO_WORDS: FlaggedWord[] = [];
const DEFAULT_RULES: LadderRules = { disabled: [], urgentDays: DEFAULT_LADDER_SETTINGS.urgentDays, unreachableAfter: DEFAULT_LADDER_SETTINGS.unreachableAfter };

/** The ladder props are optional so the Settings design preview (components/design/settings-preview.tsx) still draws it. */
export function RetentionSettingsBoard({ hub, hubProblem = null, ladder: initialLadder = DEFAULT_RULES, words: flagged = NO_WORDS, openByReason = null, canEdit, initialTab = "ladder" }: {
  hub: Hub | null;
  /** Why the hub could not load (it needs a database update): the four hub tabs say so. */
  hubProblem?: string | null;
  ladder?: LadderRules;
  words?: FlaggedWord[];
  openByReason?: Partial<Record<Reason, number>> | null;
  canEdit: boolean;
  initialTab?: Tab;
}) {
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>(initialTab);
  // The tab is kept in the address (?tab=), without a round trip to the server.
  const [open, setOpen] = useState<Open | null>(null);
  // A tab change (a click, or a search link's #anchor) closes any open sheet.
  const setTab = useCallback((next: Tab) => {
    setOpen(null);
    setTabState(next);
    try { const query = new URLSearchParams(window.location.search); query.set("tab", next); window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}${window.location.hash}`); } catch { /* the tab still shows */ }
  }, []);
  useAnchorTab(SECTION_TAB, setTab);
  const [settings, setSettingsState] = useState<RetentionSettings | null>(hub?.settings ?? null);
  const [rules, setRulesState] = useState<Record<La5Queue, La5OwnerRole> | null>(hub?.rules ?? null);
  const [log, setLog] = useState<Hub["changes"]>(hub?.changes ?? []);
  const [ladder, setLadder] = useState<LadderRules>(initialLadder);
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { setOpen(null); setWeightsDirty(false); };
  const now = () => new Date().toISOString();
  // A save adds its own lines to the history at once (the page reads the log again on refresh).
  const setSettings = (next: RetentionSettings) => {
    if (settings) setLog((cur) => [...diff(settings, next).map((c) => ({ ...c, by: "You", at: now() })), ...cur]);
    setSettingsState(next);
  };
  const setRules = (next: Record<La5Queue, La5OwnerRole>) => {
    if (rules) setLog((cur) => [...LA5_QUEUES.filter((q) => rules[q] !== next[q]).map((q) => ({ setting: `queue_owner_${q}`, from: rules[q], to: next[q], by: "You", at: now() })), ...cur]);
    setRulesState(next);
  };

  const resetTo = (): { next: RetentionSettings | null; changes: number } => {
    if (tab === "ladder") return { next: null, changes: ladderChanges(ladder) };
    if (!settings) return { next: null, changes: 0 };
    const next = TAB_SECTIONS[tab].reduce((cur, section) => resetSection(cur, section), settings);
    return { next, changes: diff(settings, next).length };
  };
  const resetTab = async () => {
    setBusy(true);
    try {
      if (tab === "ladder") {
        const back = ladderChanges(ladder);
        if (back) await putLadderRules(DEFAULT_RULES);
        setLadder(DEFAULT_RULES);
        notify.done(back ? SAVED_LADDER : "Already on Insurvas's values");
      } else if (settings) {
        let changed = 0;
        let next = settings;
        for (const section of TAB_SECTIONS[tab]) {
          changed += (await postSettings({ action: "reset", section, confirmation: null })).changes?.length ?? 0;
          next = resetSection(next, section);
        }
        setSettings(next);
        notify.done(changed ? `${plural(changed, "value")} back to Insurvas's` : "Already on Insurvas's values");
      }
      setResetting(false);
      router.refresh();
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't reset");
    } finally {
      setBusy(false);
    }
  };
  const pendingReset = resetting ? resetTo() : null;

  /** Put the newest change back: the setting, the win-back days or the queue owner it was before. */
  const putBack = async (col: string, from: unknown) => {
    try {
      if (col.startsWith("queue_owner_") && rules) {
        const q = col.replace("queue_owner_", "") as La5Queue;
        const next = { ...rules, [q]: from as La5OwnerRole };
        await postSettings({ action: "save_rules", rules: next });
        setRules(next);
      } else if (settings) {
        const reason = WINBACK_OF_COLUMN.get(col);
        const key = KEY_OF_COLUMN.get(col);
        const next: RetentionSettings = reason ? { ...settings, winbackDays: { ...settings.winbackDays, [reason]: from as number } } : key ? { ...settings, [key]: from } as RetentionSettings : settings;
        await postSettings({ action: "save_settings", settings: next, confirmation: null, holdout_acknowledged: false });
        setSettings(next);
      }
      notify.done("Put back as it was.");
      close();
      router.refresh();
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
    }
  };

  const lastOf = (cols: string[]) => log.find((c) => cols.includes(c.setting)) ?? null;
  const historyOf = (o: Open): HistoryItem[] => {
    const cols = columnsOf(o);
    return log.filter((c) => cols.includes(c.setting)).slice(0, 6).map((c, i) => ({
      key: `${c.setting}-${c.at}-${i}`,
      who: c.by,
      at: c.at,
      line: <>{cols.length > 1 && LABEL_OF_COLUMN[c.setting] ? `${LABEL_OF_COLUMN[c.setting]}: ` : ""}{words(c.setting, c.from)} → {words(c.setting, c.to)}</>,
      // Shortening the wait for clients who could not afford it, or switching the holdout on, asks first: no Put back.
      onPutBack: i === 0 && canEdit && c.setting !== "bill_talk_track" && !(c.setting === "winback_affordability_days" && Number(c.from) < Number(c.to)) && !(c.setting === "holdout_enabled" && c.from === true) && c.setting !== "assignment_carrier_reps" && c.setting !== "assignment_rep_order"
        ? () => void putBack(c.setting, c.from) : null,
    }));
  };
  const valueOf = (keys: Key[]): ValueKind => (settings && isYours(settings, keys) ? "yours" : "insurvas");
  const who = (cols: string[]) => { const last = lastOf(cols); return <WhoCell name={last?.by} at={last?.at} />; };

  const notOn = <TableCard><EmptyState title="Not switched on yet" hint={hubProblem ?? ""} /></TableCard>;
  const consequence = hub?.distribution && settings ? thresholdConsequence(hub.distribution, settings) : null;
  const repsText = !hub ? "—" : hub.reps.length === 0 ? "Nobody holds the retention role yet" : hub.reps.length === 1 ? `1 rep, nothing to share yet` : `${hub.reps.length} reps: ${hub.reps.map((r) => r.name).join(", ")}`;
  const peopleIn = (role: La5OwnerRole) => (role === "retention" ? (hub?.reps.length ? hub.reps.map((r) => r.name).join(", ") : "nobody holds the role yet") : role === "writing_agent" ? "each policy's writing agent" : "you");
  const weightsChanges = log.filter((c) => c.setting === "weights");
  const lastWeights = weightsChanges[0] ?? null;
  const topWeight = hub ? [...SIGNALS].sort((a, b) => hub.weights[b] - hub.weights[a])[0] : null;

  /** What the open sheet affects, and where it sits. */
  const AFFECTS: Record<Open["k"], Affect[]> = {
    owner: [{ label: "Who gets this queue's cards", where: "Cases" }, { label: "A role with nobody in it falls back", where: "Writing agent or you" }],
    share: [{ label: "Who each new card goes to", where: "Save queue · Reinstatements" }, { label: "Cards already handed out stay with their rep", where: "Nothing changes backwards" }],
    handover: [{ label: "The writing agent takes the case over", where: "Reinstatement cases" }],
    servicing: [{ label: "When a servicing request fails", where: "Requests" }],
    cooloff: [{ label: "When a client who said no is asked again", where: "Paper-bill campaign" }, { label: "Win-back calls for the same client", where: "Win-back" }],
    talk: [{ label: "What the rep reads on the campaign card", where: "Save call screen" }],
    countdown: [{ label: "Reinstatement cases turn amber, red, then pinned", where: "Cases" }, { label: "Each carrier's own window is Insurvas's", where: "Never edited here" }],
    winback: [{ label: "When a lapsed client comes back as a lead", where: "Win-back" }],
    takes: [{ label: consequence ? `Today the queue would hold ${consequence.queue.toLocaleString("en-US")} cards` : "Which policies reach the save queue", where: "Save queue" }],
    bands: [{ label: "Where a score turns medium, high and critical", where: "Radar · Save queue" }],
    weights: [],
    queue: [{ label: "Which cards show, and in what order", where: "Save queue" }],
    signals: [{ label: "How each signal is read before it is weighted", where: "Every risk score" }],
    holdout: [{ label: "A share of the queue is held back to measure it", where: "Results › Radar" }],
  };
  const where: Record<Open["k"], Tab> = { owner: "who", share: "who", handover: "who", servicing: "requests", cooloff: "requests", talk: "requests", countdown: "requests", winback: "winback", takes: "radar", bands: "radar", weights: "radar", queue: "radar", signals: "radar", holdout: "radar" };
  const openLabel = (o: Open) => (o.k === "owner" ? `Who owns ${LA5_QUEUE_LABELS[o.queue]}` : o.k === "winback" ? WINBACK_LABELS[o.reason] : ({ share: "Share work between reps", handover: "Hand a reinstatement to the writing agent", servicing: "Fail a servicing request", cooloff: "After a client says no, ask again in", talk: "Talk track", countdown: "Reinstatement countdown", takes: "The save queue takes", bands: "Risk bands", weights: "Scoring weights", queue: "Queue: rest, most shown, sort", signals: "Signals", holdout: "Holdout" } as const)[o.k]);
  const isOpen = (o: Open) => open !== null && open.k === o.k && JSON.stringify(open) === JSON.stringify(o);
  const row = (o: Open) => ({ selected: isOpen(o), onOpen: () => setOpen(o) });

  /** The values on a tab, for its status line and its card foot. */
  const tabValues = (t: Exclude<Tab, "ladder">): { values: ValueKind[]; cols: string[] } => {
    if (!settings) return { values: [], cols: [] };
    if (t === "who") return { values: [...LA5_QUEUES.map((q) => (rules && rules[q] !== DEFAULT_OWNER_ROLE[q] ? "yours" as const : "insurvas" as const)), valueOf(KEYS.share), valueOf(KEYS.handover)], cols: [...LA5_QUEUES.map((q) => `queue_owner_${q}`), ...[...KEYS.share, ...KEYS.handover].map(column)] };
    if (t === "requests") return { values: [valueOf(KEYS.servicing), valueOf(KEYS.cooloff), valueOf(KEYS.talk), valueOf(KEYS.countdown)], cols: [...KEYS.servicing, ...KEYS.cooloff, ...KEYS.talk, ...KEYS.countdown].map(column) };
    if (t === "winback") return { values: WINBACK_REASONS.map((r) => (settings.winbackDays[r] !== PLATFORM_DEFAULT_SETTINGS.winbackDays[r] ? "yours" as const : "insurvas" as const)), cols: WINBACK_REASONS.map((r) => `winback_${r}_days`) };
    return { values: [valueOf(KEYS.takes), valueOf(KEYS.bands), hub?.weightIsPlatform ? "insurvas" : "yours", valueOf(KEYS.queue), valueOf(KEYS.signals), valueOf(KEYS.holdout)], cols: [...KEYS.takes, ...KEYS.bands, ...KEYS.queue, ...KEYS.signals, ...KEYS.holdout].map(column).concat("weights") };
  };

  const status = (() => {
    if (!canEdit) return <StatusLine tone="warn">Read-only: your plan&apos;s billing is paused. Values show, nothing saves.</StatusLine>;
    if (open && (open.k !== "weights" || weightsDirty)) return <StatusLine tone="warn">{openLabel(open)} being changed · nothing saved yet</StatusLine>;
    if (tab === "ladder") {
      const n = ladderChanges(ladder);
      return <StatusLine>Saved · {n ? `${plural(n, "ladder rule")} ${n === 1 ? "is" : "are"} yours` : "the ladder is on Insurvas's rules"}{hubProblem ? " · the other tabs need a database update" : ""}</StatusLine>;
    }
    if (!settings) return <StatusLine tone="bad">These settings need a database update. The Ladder tab still works.</StatusLine>;
    const { values, cols } = tabValues(tab);
    const last = lastOf(cols);
    return <StatusLine>Saved · {values.filter((v) => v === "yours").length} of {values.length} values are yours{last ? ` · last change by ${last.by} on ${shortDay(last.at)}` : ""}</StatusLine>;
  })();

  const card = (t: Exclude<Tab, "ladder">, children: ReactNode, note?: ReactNode) => (
    <SettingTable fill footer={<SettingFoot values={tabValues(t).values}>{note}</SettingFoot>}>{children}</SettingTable>
  );

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-3">
      <SectionTabs label="Retention settings" tabs={retentionTabs({ off: ladder.disabled.length, reps: hub ? hub.reps.length : null })} value={tab} onChange={(next) => { setWeightsDirty(false); setTab(next); }}
        actions={(
          <>
            <Button asChild variant="outline"><Link href={HISTORY}>History</Link></Button>
            <MoreMenu items={[
              canEdit && (tab === "ladder" || settings) && { label: `Reset ${TAB_LABELS[tab]} to Insurvas values`, onSelect: () => setResetting(true) },
              { label: "See results", href: "/app/retention-results" },
              { label: "Open Cases", href: "/app/retention" },
            ]} />
          </>
        )} />
      {status}

      {tab === "ladder" && (
        <SheetInfoProvider value={{ where: "Ladder", affects: [{ label: "Which policies go on the ladder, and which step", where: "Cases" }] }}>
          <LadderRulesBoard rules={ladder} words={flagged} openByReason={openByReason} canEdit={canEdit} onSaved={setLadder} />
        </SheetInfoProvider>
      )}

      {tab === "who" && (!hub || !settings || !rules ? notOn : card("who", (
        <tbody>
          {LA5_QUEUES.map((q) => (
            <SettingRow key={q} label={`Who owns ${LA5_QUEUE_LABELS[q]}`} {...row({ k: "owner", queue: q })}>
              <NowCell>{LA5_OWNER_ROLE_LABELS[rules[q]]} · {peopleIn(rules[q])}</NowCell>
              <UsedCell>{LA5_QUEUE_LABELS[q]}</UsedCell>
              {who([`queue_owner_${q}`])}
              <ValueCell value={rules[q] !== DEFAULT_OWNER_ROLE[q] ? "yours" : "insurvas"} />
            </SettingRow>
          ))}
          <SettingRow id="assignment" label="Share work between reps" {...row({ k: "share" })}>
            <NowCell title={repsText}>{STRATEGY[settings.assignmentStrategy]} · {repsText}</NowCell>
            <UsedCell>Save queue, Reinstatements</UsedCell>
            {who(KEYS.share.map(column))}
            <ValueCell value={valueOf(KEYS.share)} />
          </SettingRow>
          <SettingRow label="Hand a reinstatement to the writing agent" {...row({ k: "handover" })}>
            <NowCell>Inside {plural(settings.reinstatementEscalateDays, "day")} of the deadline</NowCell>
            <UsedCell>Reinstatement cases</UsedCell>
            {who(KEYS.handover.map(column))}
            <ValueCell value={valueOf(KEYS.handover)} />
          </SettingRow>
        </tbody>
      ), <>Who holds the retention role is set in <Link className="hover:underline" href="/app/settings#team-access">Team &amp; access</Link></>))}

      {tab === "requests" && (!settings ? notOn : card("requests", (
        <tbody>
          <SettingRow id="servicing" label="Fail a servicing request" {...row({ k: "servicing" })}>
            <NowCell>{plural(settings.servicingGraceDays, "day")} after its expected date</NowCell>
            <UsedCell>Servicing requests</UsedCell>
            {who(KEYS.servicing.map(column))}
            <ValueCell value={valueOf(KEYS.servicing)} />
          </SettingRow>
          <GroupRow>Paper bill to bank draft</GroupRow>
          <SettingRow id="campaigns" label="After a client says no, ask again in" {...row({ k: "cooloff" })}>
            <NowCell>{plural(settings.billDeclineCooloffDays, "day")}</NowCell>
            <UsedCell>Paper-bill campaign, Win-back</UsedCell>
            {who(KEYS.cooloff.map(column))}
            <ValueCell value={valueOf(KEYS.cooloff)} />
          </SettingRow>
          <SettingRow label="Talk track" {...row({ k: "talk" })}>
            <NowCell title={settings.billTalkTrack ?? PLATFORM_TALK_TRACK}>&ldquo;{(settings.billTalkTrack ?? PLATFORM_TALK_TRACK).trim().split(/\s+/).slice(0, 6).join(" ")}…&rdquo; · {plural((settings.billTalkTrack ?? PLATFORM_TALK_TRACK).trim().split(/\s+/).filter(Boolean).length, "word")}</NowCell>
            <UsedCell>Save call screen</UsedCell>
            {who(KEYS.talk.map(column))}
            <ValueCell value={valueOf(KEYS.talk)} />
          </SettingRow>
          <GroupRow>Reinstatement countdown</GroupRow>
          <SettingRow id="reinstatement" label="Turn a case amber · red · pinned" {...row({ k: "countdown" })}>
            <NowCell><span className="tabular-nums">{settings.reinstatementAmberDays} · {settings.reinstatementRedDays} · {settings.reinstatementPinDays}</span> days before the carrier&apos;s deadline</NowCell>
            <UsedCell>Reinstatement cases</UsedCell>
            {who(KEYS.countdown.map(column))}
            <ValueCell value={valueOf(KEYS.countdown)} />
          </SettingRow>
        </tbody>
      ), <>Insurvas keeps each carrier&apos;s retention windows, grace periods and chargeback rules; draft days are capped at the {PLATFORM_CAPS.draftDayCap}th</>))}

      {tab === "winback" && (!settings ? notOn : card("winback", (
        <tbody id="winback" className="scroll-mt-24">
          {WINBACK_REASONS.map((r) => (
            <SettingRow key={r} label={WINBACK_LABELS[r]} {...row({ k: "winback", reason: r })}>
              <NowCell>Wait {plural(settings.winbackDays[r], "day")} before calling</NowCell>
              <UsedCell>Win-back</UsedCell>
              {who([`winback_${r}_days`])}
              <ValueCell value={settings.winbackDays[r] !== PLATFORM_DEFAULT_SETTINGS.winbackDays[r] ? "yours" : "insurvas"} />
            </SettingRow>
          ))}
        </tbody>
      )))}

      {tab === "radar" && (!hub || !settings ? notOn : card("radar", (
        <tbody>
          <SettingRow id="thresholds" label="The save queue takes" {...row({ k: "takes" })}>
            <NowCell>{BAND_TAKES[settings.queueMinBand]}{consequence ? <> · would hold <CountLink href="/app/save-queue" value={consequence.queue} /></> : null}</NowCell>
            <UsedCell>Save queue</UsedCell>
            {who(KEYS.takes.map(column))}
            <ValueCell value={valueOf(KEYS.takes)} />
          </SettingRow>
          <SettingRow label="Risk bands" {...row({ k: "bands" })}>
            <NowCell>Medium from {settings.mediumFrom} · High from {settings.highFrom} · Critical from {settings.criticalFrom}</NowCell>
            <UsedCell>Radar, Save queue</UsedCell>
            {who(KEYS.bands.map(column))}
            <ValueCell value={valueOf(KEYS.bands)} />
          </SettingRow>
          <SettingRow id="weights" label="Scoring weights" {...row({ k: "weights" })}>
            <NowCell>{SIGNALS.length} signals · version {hub.weightVersion}{topWeight ? ` · ${SIGNAL_LABELS[topWeight].toLowerCase()} leads at ${hub.weights[topWeight]}` : ""}</NowCell>
            <UsedCell>Every risk score</UsedCell>
            <WhoCell name={lastWeights?.by} at={lastWeights?.at} />
            <ValueCell value={hub.weightIsPlatform ? "insurvas" : "yours"} />
          </SettingRow>
          <SettingRow id="queue" label="Queue: rest, most shown, sort" {...row({ k: "queue" })}>
            <NowCell>{plural(settings.workedCooldownDays, "day")} · {settings.maxCards} cards · {sortWords(settings.queueDefaultSort)}</NowCell>
            <UsedCell>Save queue</UsedCell>
            {who(KEYS.queue.map(column))}
            <ValueCell value={valueOf(KEYS.queue)} />
          </SettingRow>
          <SettingRow id="signals" label="Signals: sample floors, income, danger months" {...row({ k: "signals" })}>
            <NowCell><span className="tabular-nums">{settings.sampleFloor} · {settings.carrierSampleFloor} · {settings.affordabilityLowBp / 100}%–{settings.affordabilityHighBp / 100}% · months {settings.dangerMonthFrom}–{settings.dangerMonthTo}</span></NowCell>
            <UsedCell>Every risk score</UsedCell>
            {who(KEYS.signals.map(column))}
            <ValueCell value={valueOf(KEYS.signals)} />
          </SettingRow>
          <SettingRow id="holdout" label="Holdout" {...row({ k: "holdout" })}>
            <NowCell>{settings.holdoutEnabled ? `On · ${settings.holdoutShareBp / 100}% held back` : "Off"}</NowCell>
            <UsedCell>Results</UsedCell>
            {who(KEYS.holdout.map(column))}
            <ValueCell value={valueOf(KEYS.holdout)} />
          </SettingRow>
        </tbody>
      ), <>The predictive save queue is off the Retention menu; these still score it and Results › Radar reads them</>))}

      {open?.k === "weights" && hub && (
        <WeightsSheet weights={hub.weights} version={hub.weightVersion} isPlatform={hub.weightIsPlatform} platformWeights={hub.platformWeights} changes={weightsChanges}
          canEdit={canEdit} readOnlyWhy="Your plan's billing is paused, so nothing saves." onClose={close} onDirty={setWeightsDirty} />
      )}

      {settings && open && open.k !== "weights" && (
        <SheetInfoProvider value={{ where: TAB_LABELS[where[open.k]], affects: AFFECTS[open.k], history: historyOf(open), historyHref: HISTORY }}>
          {(() => {
            const common = { settings, canEdit, onSaved: setSettings, onClose: close };
            switch (open.k) {
              case "owner": return rules ? <OwnerDialog queue={open.queue} rules={rules} canEdit={canEdit} onSaved={setRules} onClose={close} /> : null;
              case "share": return hub ? <ShareDialog hub={hub} {...common} readValue={`${STRATEGY[settings.assignmentStrategy]} · ${repsText}`} /> : null;
              case "handover": return <SettingsDialog title="Hand a reinstatement to the writing agent" said="Inside this many days of the carrier's deadline, the agent who sold the policy takes the case over." {...common}
                specs={[{ key: "reinstatementEscalateDays", label: "Days before its deadline", unit: "days" }]} readValue={`Inside ${plural(settings.reinstatementEscalateDays, "day")} of the deadline`} />;
              case "servicing": return <SettingsDialog title="Fail a servicing request" said="A carrier file that still disagrees this many days after a change was due fails the request." {...common}
                specs={[{ key: "servicingGraceDays", label: "Days after its expected date", unit: "days" }]} readValue={`${plural(settings.servicingGraceDays, "day")} after its expected date`} />;
              case "cooloff": return <SettingsDialog title="After a client says no, ask again in" said="They leave the campaign list until then." {...common}
                specs={[{ key: "billDeclineCooloffDays", label: "Ask again in", unit: "days" }]} readValue={plural(settings.billDeclineCooloffDays, "day")} />;
              case "talk": return <TalkTrackDialog {...common} />;
              case "countdown": return <SettingsDialog title="Reinstatement countdown" said="Days left before the carrier's reinstatement deadline. Each carrier's window is kept by Insurvas." {...common}
                specs={[{ key: "reinstatementAmberDays", label: "Amber with", unit: "days" }, { key: "reinstatementRedDays", label: "Red with", unit: "days" }, { key: "reinstatementPinDays", label: "Pinned to the top with", unit: "days" }]}
                readValue={`Amber ${settings.reinstatementAmberDays} · red ${settings.reinstatementRedDays} · pinned ${settings.reinstatementPinDays} days left`} />;
              case "winback": return <WinbackDialog reason={open.reason} {...common} />;
              case "takes": return hub ? <QueueTakesDialog hub={hub} {...common} /> : null;
              case "bands": return <SettingsDialog title="Risk bands" said="Where a score out of 100 turns medium, high and critical." {...common}
                specs={[{ key: "mediumFrom", label: "Medium from" }, { key: "highFrom", label: "High from" }, { key: "criticalFrom", label: "Critical from" }]}
                readValue={`Medium from ${settings.mediumFrom} · high from ${settings.highFrom} · critical from ${settings.criticalFrom}`} />;
              case "queue": return <QueueDialog {...common} readValue={`Rest ${plural(settings.workedCooldownDays, "day")} · at most ${settings.maxCards} cards · ${sortWords(settings.queueDefaultSort)} · with nothing high risk, ${settings.includeMediumWhenEmpty ? "show medium" : "an empty queue"}`} />;
              case "signals": return <SettingsDialog title="Signals: sample floors, income, danger months" said="Below a sample floor a lead source's or a carrier's signal is left out rather than counted as weak. Premium below the first share of income is affordable; above the second it is unaffordable. The danger window is the months since issue when a policy is most likely to lapse." {...common}
                specs={[
                  { key: "sampleFloor", label: "Lead source floor", unit: "policies" }, { key: "carrierSampleFloor", label: "Carrier floor", unit: "policies" },
                  { key: "affordabilityLowBp", label: "Affordable below", unit: "%", scale: 100 }, { key: "affordabilityHighBp", label: "Unaffordable above", unit: "%", scale: 100 },
                  { key: "dangerMonthFrom", label: "Danger from month" }, { key: "dangerMonthTo", label: "Danger to month" },
                ]}
                readValue={`Floors ${settings.sampleFloor} and ${settings.carrierSampleFloor} · affordable below ${settings.affordabilityLowBp / 100}%, unaffordable above ${settings.affordabilityHighBp / 100}% · danger months ${settings.dangerMonthFrom}–${settings.dangerMonthTo}`} />;
              case "holdout": return <HoldoutDialog {...common} />;
            }
          })()}
        </SheetInfoProvider>
      )}

      <ConfirmDialog open={resetting} onOpenChange={setResetting} busy={busy} destructive={false}
        title={`Reset ${TAB_LABELS[tab]} to Insurvas values?`}
        description={pendingReset && pendingReset.changes > 0
          ? `${pendingReset.changes} ${pendingReset.changes === 1 ? "value of yours goes" : "values of yours go"} back to Insurvas's.${tab === "who" ? " Queue owners are not touched." : ""} The change is recorded in History.`
          : "Every value on this tab is already Insurvas's."}
        confirmLabel="Reset to Insurvas values" cancelLabel="Keep my values" onConfirm={() => void resetTab()} />
    </div>
  );
}
