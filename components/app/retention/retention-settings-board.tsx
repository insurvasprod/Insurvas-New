"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import { LadderRulesBoard, ladderChanges, SAVED_LADDER } from "@/components/app/retention/ladder-rules-board";
import { BAND_TAKES, HoldoutDialog, isYours, OwnerDialog, QueueDialog, QueueTakesDialog, SettingsDialog, ShareDialog, TalkTrackDialog, WinbackDialog } from "@/components/app/retention/retention-settings-dialogs";
import { CountLink, GroupRow, OpenRow, postSettings, putLadderRules } from "@/components/app/retention/retention-settings-rows";
import { SectionTabs, useAnchorTab } from "@/components/app/settings/setting-row";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import type { ViewTab } from "@/components/ui/view-tabs";
import { LA5_OWNER_ROLE_LABELS, LA5_QUEUE_LABELS, LA5_QUEUES, type La5OwnerRole, type La5Queue } from "@/lib/retention/assignment";
import { PLATFORM_TALK_TRACK } from "@/lib/retention/campaign";
import { DEFAULT_LADDER_SETTINGS, type Reason } from "@/lib/retention/cases/ladder";
import type { FlaggedWord, LadderRules } from "@/lib/retention/cases/rulesStore";
import { PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, SIGNALS, WINBACK_REASONS, type RetentionSettings, type WinbackReason } from "@/lib/retention/constants";
import { SORT_LABELS } from "@/lib/retention/queue";
import { diff, resetSection, thresholdConsequence, WINBACK_LABELS, type HubSection } from "@/lib/retention/settingsHub";
import type { Hub } from "@/lib/retention/settingsHubStore";
import { notify } from "@/lib/notify";

/**
 * Settings › Retention (LA-5.11; round 7, owner pick 7·A "By what it drives", 2026-11-10; docs/la4/mockups-r7/
 * retention.html §7). Five tabs on the section's title line, named after what they change: Ladder (what Cases runs
 * on, the old Ladder rules page folded in) · Who works it · Requests · Win-back · Radar (the retired predictive
 * queue's numbers, kept). Every setting is one row with its value and whose it is; the row opens a dialog that edits
 * that one setting. No long forms, save bar, leave guard or folds. A tab's count is what needs the owner: the facts
 * switched off, a share mode with one rep. The title line holds Open Cases and More (reset this tab, History,
 * Results). Read-only says nothing on the page: a row opens its value with only Close.
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
/** The hub sections a tab's reset puts back (weights reset on their own page, the ladder through its rules). */
const TAB_SECTIONS: Record<Exclude<Tab, "ladder">, Exclude<HubSection, "weights">[]> = {
  who: ["assignment"],
  requests: ["servicing", "campaigns", "reinstatement"],
  winback: ["winback"],
  radar: ["thresholds", "queue", "signals", "holdout"],
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const sortWords = (s: RetentionSettings["queueDefaultSort"]) => SORT_LABELS[s].replace(" (default)", "").toLowerCase();
const STRATEGY: Record<RetentionSettings["assignmentStrategy"], string> = { round_robin: "Round-robin", by_carrier: "By carrier", by_exposure: "By exposure" };

type Open =
  | { k: "owner"; queue: La5Queue } | { k: "share" } | { k: "handover" }
  | { k: "servicing" } | { k: "cooloff" } | { k: "talk" } | { k: "countdown" }
  | { k: "winback"; reason: WinbackReason }
  | { k: "takes" } | { k: "bands" } | { k: "queue" } | { k: "signals" } | { k: "holdout" };

const NO_WORDS: FlaggedWord[] = [];
const DEFAULT_RULES: LadderRules = { disabled: [], urgentDays: DEFAULT_LADDER_SETTINGS.urgentDays, unreachableAfter: DEFAULT_LADDER_SETTINGS.unreachableAfter };

/** The ladder props are optional so the Settings design preview (components/design/settings-preview.tsx) still draws it. */
export function RetentionSettingsBoard({ hub, hubProblem = null, ladder: initialLadder = DEFAULT_RULES, words = NO_WORDS, openByReason = null, canEdit, initialTab = "ladder" }: {
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
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    try { window.history.replaceState(window.history.state, "", `${window.location.pathname}?tab=${next}${window.location.hash}`); } catch { /* the tab still shows */ }
  }, []);
  useAnchorTab(SECTION_TAB, setTab);
  const [settings, setSettings] = useState<RetentionSettings | null>(hub?.settings ?? null);
  const [rules, setRules] = useState<Record<La5Queue, La5OwnerRole> | null>(hub?.rules ?? null);
  const [ladder, setLadder] = useState<LadderRules>(initialLadder);
  const [open, setOpen] = useState<Open | null>(null);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => setOpen(null);

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

  const whose = (keys: (keyof RetentionSettings)[]) => (settings && isYours(settings, keys) ? "yours" : "Insurvas's");
  const notOn = <TableCard><EmptyState title="Not switched on yet" hint={hubProblem ?? ""} /></TableCard>;
  const head = (first: string, second: string, third = "Whose") => (
    <thead><tr><th>{first}</th><th>{second}</th><th className="w-[160px]">{third}</th><th className="w-[1%]"><span className="sr-only">Open</span></th></tr></thead>
  );
  const table = "portal-lead-table w-full min-w-[640px] text-left text-sm";
  const consequence = hub?.distribution && settings ? thresholdConsequence(hub.distribution, settings) : null;
  const repsText = !hub ? "—" : hub.reps.length === 0 ? "Nobody holds the retention role yet" : hub.reps.length === 1 ? `1 rep: nothing to share yet` : `${hub.reps.length} reps: ${hub.reps.map((r) => r.name).join(", ")}`;
  const peopleIn = (role: La5OwnerRole) => (role === "retention" ? (hub?.reps.length ? hub.reps.map((r) => r.name).join(", ") : "Nobody holds the retention role yet") : role === "writing_agent" ? "Each policy's writing agent" : "You");

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-4">
      <SectionTabs label="Retention settings" tabs={retentionTabs({ off: ladder.disabled.length, reps: hub ? hub.reps.length : null })} value={tab} onChange={setTab}
        actions={(
          <>
            <MoreMenu items={[
              canEdit && (tab === "ladder" || settings) && { label: "Reset this tab to Insurvas values", onSelect: () => setResetting(true) },
              { label: "History", href: "/app/settings?history=retention#settings-history" },
              { label: "Results", href: "/app/retention-results" },
            ]} />
            <Button asChild variant="outline"><Link href="/app/retention">Open Cases</Link></Button>
          </>
        )} />

      {tab === "ladder" && <LadderRulesBoard rules={ladder} words={words} openByReason={openByReason} canEdit={canEdit} onSaved={setLadder} />}

      {tab === "who" && (!hub || !settings || !rules ? notOn : (
        <TableCard footer={<span>Who holds the retention role is set in <Link className="hover:underline" href="/app/settings#team-access">Team &amp; access</Link>.</span>}>
          <table className={table} data-even="off">
            {head("Who owns", "Role", "People in it")}
            <tbody>
              {LA5_QUEUES.map((q) => (
                <OpenRow canEdit={canEdit} key={q} label={LA5_QUEUE_LABELS[q]} onOpen={() => setOpen({ k: "owner", queue: q })}>
                  <td className="whitespace-nowrap text-foreground">{LA5_OWNER_ROLE_LABELS[rules[q]]}</td>
                  <td className="whitespace-nowrap">{peopleIn(rules[q])}</td>
                </OpenRow>
              ))}
              <OpenRow canEdit={canEdit} id="assignment" label="Share work between reps" onOpen={() => setOpen({ k: "share" })}>
                <td className="whitespace-nowrap text-foreground">{STRATEGY[settings.assignmentStrategy]}</td>
                <td className="whitespace-nowrap">{hub.reps.length === 1 ? <StatusChip tone="warning">{repsText}</StatusChip> : repsText}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} label="Hand a reinstatement to the writing agent" onOpen={() => setOpen({ k: "handover" })}>
                <td className="whitespace-nowrap text-foreground">inside {plural(settings.reinstatementEscalateDays, "day")} of the deadline</td>
                <td className="whitespace-nowrap">{whose(["reinstatementEscalateDays"])}</td>
              </OpenRow>
            </tbody>
          </table>
        </TableCard>
      ))}

      {tab === "requests" && (!settings ? notOn : (
        <TableCard footer={<span>Insurvas keeps each carrier&apos;s retention windows, grace periods and chargeback rules. Draft days are capped at the {PLATFORM_CAPS.draftDayCap}th: carriers reject the 29th to the 31st.</span>}>
          <table className={table} data-even="off">
            {head("Setting", "Value")}
            <tbody>
              <OpenRow canEdit={canEdit} id="servicing" label="Fail a servicing request" onOpen={() => setOpen({ k: "servicing" })}>
                <td className="whitespace-nowrap text-foreground">{plural(settings.servicingGraceDays, "day")} after its expected date</td>
                <td className="whitespace-nowrap">{whose(["servicingGraceDays"])}</td>
              </OpenRow>
              <GroupRow span={4}>Paper bill to bank draft</GroupRow>
              <OpenRow canEdit={canEdit} id="campaigns" label="After a client says no, ask again in" onOpen={() => setOpen({ k: "cooloff" })}>
                <td className="whitespace-nowrap text-foreground">{plural(settings.billDeclineCooloffDays, "day")}</td>
                <td className="whitespace-nowrap">{whose(["billDeclineCooloffDays"])}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} label="Talk track" onOpen={() => setOpen({ k: "talk" })}>
                <td className="whitespace-nowrap text-foreground" title={settings.billTalkTrack ?? PLATFORM_TALK_TRACK}>{plural((settings.billTalkTrack ?? PLATFORM_TALK_TRACK).trim().split(/\s+/).filter(Boolean).length, "word")}</td>
                <td className="whitespace-nowrap">{whose(["billTalkTrack"])}</td>
              </OpenRow>
              <GroupRow span={4}>Reinstatement countdown</GroupRow>
              <OpenRow canEdit={canEdit} id="reinstatement" label="Turn a case amber · red · pinned" onOpen={() => setOpen({ k: "countdown" })}>
                <td className="whitespace-nowrap text-foreground tabular-nums">{settings.reinstatementAmberDays} · {settings.reinstatementRedDays} · {settings.reinstatementPinDays} days left</td>
                <td className="whitespace-nowrap">{whose(["reinstatementAmberDays", "reinstatementRedDays", "reinstatementPinDays"])}</td>
              </OpenRow>
            </tbody>
          </table>
        </TableCard>
      ))}

      {tab === "winback" && (!settings ? notOn : (
        <TableCard>
          <table className={table} data-even="off">
            {head("Why it ended", "Wait before calling")}
            <tbody id="winback" className="scroll-mt-24">
              {WINBACK_REASONS.map((r) => (
                <OpenRow canEdit={canEdit} key={r} label={WINBACK_LABELS[r]} onOpen={() => setOpen({ k: "winback", reason: r })}>
                  <td className="whitespace-nowrap text-foreground tabular-nums">{plural(settings.winbackDays[r], "day")}</td>
                  <td className="whitespace-nowrap">{settings.winbackDays[r] !== PLATFORM_DEFAULT_SETTINGS.winbackDays[r] ? "yours" : "Insurvas's"}</td>
                </OpenRow>
              ))}
            </tbody>
          </table>
        </TableCard>
      ))}

      {tab === "radar" && (!hub || !settings ? notOn : (
        <TableCard footer={<span>The predictive save queue is off the Retention menu (2026-11-05); these still score it and Results › Radar check reads them.</span>}>
          <table className={table} data-even="off">
            {head("Setting", "Value")}
            <tbody>
              <OpenRow canEdit={canEdit} id="thresholds" label="The save queue takes" onOpen={() => setOpen({ k: "takes" })}>
                <td className="whitespace-nowrap text-foreground">{BAND_TAKES[settings.queueMinBand]}{consequence ? <> · would hold <CountLink href="/app/save-queue" value={consequence.queue} /></> : null}</td>
                <td className="whitespace-nowrap">{whose(["queueMinBand"])}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} label="Risk bands" sub="medium · high · critical, out of 100" onOpen={() => setOpen({ k: "bands" })}>
                <td className="whitespace-nowrap text-foreground tabular-nums">{settings.mediumFrom} · {settings.highFrom} · {settings.criticalFrom}</td>
                <td className="whitespace-nowrap">{whose(["mediumFrom", "highFrom", "criticalFrom"])}</td>
              </OpenRow>
              <OpenRow id="weights" label="Scoring weights" href="/app/retention-settings/weights">
                <td className="whitespace-nowrap text-foreground">version {hub.weightVersion} · {SIGNALS.length} signals</td>
                <td className="whitespace-nowrap">{hub.weightIsPlatform ? "Insurvas's" : "yours"}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} id="queue" label="Queue: rest, most shown, sort" onOpen={() => setOpen({ k: "queue" })}>
                <td className="whitespace-nowrap text-foreground">{plural(settings.workedCooldownDays, "day")} · {settings.maxCards} cards · {sortWords(settings.queueDefaultSort)}</td>
                <td className="whitespace-nowrap">{whose(["workedCooldownDays", "maxCards", "queueDefaultSort", "includeMediumWhenEmpty"])}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} id="signals" label="Signals: sample floors, income, danger months" onOpen={() => setOpen({ k: "signals" })}>
                <td className="whitespace-nowrap text-foreground tabular-nums">{settings.sampleFloor} · {settings.carrierSampleFloor} · {settings.affordabilityLowBp / 100}%–{settings.affordabilityHighBp / 100}% · months {settings.dangerMonthFrom}–{settings.dangerMonthTo}</td>
                <td className="whitespace-nowrap">{whose(["sampleFloor", "carrierSampleFloor", "affordabilityLowBp", "affordabilityHighBp", "dangerMonthFrom", "dangerMonthTo"])}</td>
              </OpenRow>
              <OpenRow canEdit={canEdit} id="holdout" label="Holdout" onOpen={() => setOpen({ k: "holdout" })}>
                <td className="whitespace-nowrap text-foreground">{settings.holdoutEnabled ? `On · ${settings.holdoutShareBp / 100}% held back` : "Off"}</td>
                <td className="whitespace-nowrap">{whose(["holdoutEnabled", "holdoutShareBp", "holdoutMaxExposureCents", "predictionHorizonDays"])}</td>
              </OpenRow>
            </tbody>
          </table>
        </TableCard>
      ))}

      {settings && open && (() => {
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

      <ConfirmDialog open={resetting} onOpenChange={setResetting} busy={busy} destructive={false}
        title={`Reset ${TAB_LABELS[tab]} to Insurvas values?`}
        description={pendingReset && pendingReset.changes > 0
          ? `${pendingReset.changes} ${pendingReset.changes === 1 ? "value of yours goes" : "values of yours go"} back to Insurvas's.${tab === "who" ? " Queue owners are not touched." : ""} The change is recorded in History.`
          : "Every value on this tab is already Insurvas's."}
        confirmLabel="Reset to Insurvas values" cancelLabel="Keep my values" onConfirm={() => void resetTab()} />
    </div>
  );
}
