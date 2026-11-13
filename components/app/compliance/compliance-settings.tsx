"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";

import { Recipients, regulatorName, useComplianceBundle } from "@/components/app/compliance/compliance-settings-data";
import { DeadlineSheet, HoldSheet, NewHoldSheet, RecordTypeSheet, RunSheet } from "@/components/app/compliance/compliance-settings-pages";
import { SettingsTableCard, st } from "@/components/app/settings/primitives";
import { SectionTabs, useAnchorTab } from "@/components/app/settings/setting-row";
import {
  Avatar, LineLink, LockedSheet, NowCell, SettingFoot, SettingRow, SettingSheet, SettingTable, shortDay, StatusLine, UsedCell, ValueCell, WhoCell,
  type Affect, type HistoryItem, type ValueKind,
} from "@/components/app/settings/money/setting-kit";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl, inputControl, Switch } from "@/components/ui/field";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { dateTime, viewerTimeZone } from "@/lib/format/dates";
import { METHOD_LABELS, VERIFICATION_METHODS } from "@/lib/compliance/dataSubject";
import { TILE_KEYS, TILE_LABELS } from "@/lib/compliance/dashboardCore";
import { GAP_CATEGORIES } from "@/lib/compliance/evidenceGaps";
import { ACTION_LABELS, HOLD_SCOPE_LABELS, NOT_LEGAL_ADVICE, RECORD_TYPES, describeDays, type RetentionAction } from "@/lib/compliance/retention";
import type { ComplianceSettings } from "@/lib/compliance/settingsStore";
import { cn } from "@/lib/utils";

/**
 * LA-6.8 · compliance settings. Every save goes to /api/app/compliance/settings, which validates it, enforces the
 * platform caps and writes an audit row. Coverage over silence: an unset licensed state is a row of the deadlines
 * list with an amber chip.
 *
 * Round 8 (docs/design/settings-r8/money-compliance-settings.html §6–9, owner "Build all four" 2026-11-12): the page
 * save bar is gone. Each tab is cards of one-line rows (Setting · Now · Used by · Changed · Value · ›), and each row
 * opens a right sheet that saves that one setting (a one-key patch to the same route), with what it affects and its
 * own history. Response deadlines, record ages, holds, runs and deletion rules are each a card; a deadline, a record
 * type's rules, a hold and a run open as sheets over their tab, the list staying behind them. Locked rows (the
 * litigator and internal do-not-call checks, the never-deleted do-not-call list) open a sheet that says why. The
 * title line holds History and the tab's one action; a status line under it says what was saved last.
 */
type Tab = "start" | "complaints" | "records" | "holds" | "transfers";
/** Every anchor Settings search links to (#purge), and the tab that holds it. */
export const SECTION_TAB = {
  deadlines: "complaints",
  "index-checks": "transfers",
  retention: "records",
  purge: "records",
  holds: "holds",
  deletion: "holds",
  gate: "transfers",
  report: "transfers",
  dashboard: "transfers",
} as const satisfies Record<string, Tab>;
const TAB_LABEL: Record<Tab, string> = { start: "Start here", complaints: "Complaints", records: "Records", holds: "Holds & deletion", transfers: "Gate & reports" };

type Flat = Record<string, unknown>;
const flatten = (s: ComplianceSettings): Flat => Object.fromEntries(Object.entries(s).flatMap(([section, values]) => Object.entries(values).map(([k, v]) => [`${section}.${k}`, v])));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const toggle = (list: string[], key: string, on: boolean) => (on ? [...list, key] : list.filter((x) => x !== key));
const PAGE = 10;
const HISTORY = "/app/settings?history=compliance#settings-history";

/** One setting row and its sheet: the flat keys it saves, its words, and its control. */
type FieldId =
  | "consentMissing" | "purgeSchedule" | "urgent"
  | "purgeWindow" | "purgeRecipients"
  | "deletionHold" | "deletionMethods" | "deletionRoles"
  | "federalDnc" | "consent" | "existingCustomer" | "callingHours" | "timeout"
  | "reportRoles" | "gapChecks" | "monthlyEmail" | "tiles";
type Field = {
  title: string;
  tab: Tab;
  keys: string[];
  said: string;
  usedBy: string;
  affects: Affect[];
  now: (v: Flat) => ReactNode;
  control: (v: Flat, set: (key: string, value: unknown) => void) => ReactNode;
  check?: (v: Flat) => string | null;
};
type LockId = "dnc" | "litigator" | "internalDnc";
type Open =
  | { k: "field"; id: FieldId } | { k: "lock"; id: LockId }
  | { k: "deadline"; regulator: string | null; preset?: string | null } | { k: "record"; type: string }
  | { k: "newHold" } | { k: "hold"; id: string } | { k: "run"; id: string };

const LOCKS: Record<LockId, { title: string; tab: Tab; now: string; usedBy: string; why: string; means: Affect[] }> = {
  dnc: {
    title: "The do-not-call list is never deleted", tab: "start", now: "Kept forever, by everything", usedBy: "Purge, Deletions",
    why: "A number someone asked never to be called again must stay on the list, or the next import calls them. No schedule, deletion request or rule removes it.",
    means: [{ label: "Every purge skips the internal do-not-call list", where: "Records › Runs" }, { label: "A deletion request keeps the do-not-call entry", where: "Deletions" }],
  },
  litigator: {
    title: "TCPA litigator check", tab: "transfers", now: "Always on", usedBy: "Every transfer",
    why: "A known serial TCPA plaintiff is the single most expensive call an agency can take. The check runs on every transfer and can't be switched off.",
    means: [{ label: "A transfer from a known litigator is refused", where: "Transfers from partners" }],
  },
  internalDnc: {
    title: "Internal do-not-call check", tab: "transfers", now: "Always on", usedBy: "Every transfer",
    why: "Someone who asked you never to call again is never put through, whoever sends them. The check can't be switched off.",
    means: [{ label: "A transfer of a number on your do-not-call list is refused", where: "Transfers from partners" }],
  },
};

export function ComplianceSettingsBoard({ readOnly }: { readOnly: boolean }) {
  const [tab, setTabState] = useState<Tab>("start");
  const [open, setOpen] = useState<Open | null>(null);
  // A tab change (a click, or a search link's #anchor) closes any open sheet.
  const setTab = useCallback((next: Tab) => { setOpen(null); setTabState(next); }, []);
  useAnchorTab(SECTION_TAB, setTab);
  const bundle = useComplianceBundle();
  const { data, error, busy, reload, write } = bundle;
  const [confirmLive, setConfirmLive] = useState(false);
  // A sheet's save error, shown in the sheet beside its control (the typed value kept).
  const [openError, setOpenError] = useState<string | null>(null);
  const [deadlinePage, setDeadlinePage] = useState(1);
  const [holdPage, setHoldPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [now] = useState(() => Date.now());
  const canEdit = !readOnly;

  // Title, tabs and status line stay while the card loads or fails (board: States).
  const c = data?.deadlines.coverage;
  const unset = c ? [...c.missing, ...(c.ftc ? [] : ["FTC"])] : [];
  const activeHolds = data ? data.holds.filter((h) => !h.releasedAt) : [];
  const tabs: { key: Tab; label: string; count?: number | null; tone?: "danger" }[] = [
    { key: "start", label: "Start here" },
    { key: "complaints", label: "Complaints", count: unset.length || null, tone: "danger" },
    { key: "records", label: "Records" },
    { key: "holds", label: "Holds & deletion", count: activeHolds.length || null },
    { key: "transfers", label: "Gate & reports" },
  ];
  const windowDays = data?.settings.purge.windowDays ?? 7;
  const lastDry = data?.runs.find((r) => r.mode === "dry_run" && r.finishedAt);
  const dryFresh = Boolean(lastDry && now - Date.parse(lastDry.finishedAt!) < windowDays * 86_400_000);
  const action = !canEdit || !data ? null
    : tab === "complaints" ? <Button onClick={() => setOpen({ k: "deadline", regulator: null })}>Add a regulator</Button>
    : tab === "records" ? <Button variant="outline" disabled={busy} onClick={() => void write("/api/app/compliance/retention/runs", { mode: "dry_run" }, "Dry run done")}>Start a dry run</Button>
    : tab === "holds" ? <Button onClick={() => setOpen({ k: "newHold" })}>New hold</Button>
    : null;
  const header = (
    <SectionTabs label="Compliance settings" tabs={tabs} value={tab} onChange={setTab}
      actions={<><Button asChild variant="outline"><Link href={HISTORY}>History</Link></Button>{action}</>} />
  );

  if (error) return (
    <div className="flex min-h-0 flex-grow flex-col gap-3">
      {header}
      <StatusLine tone="bad">Couldn&apos;t load these settings. <LineLink onClick={reload}>Try again</LineLink></StatusLine>
      <TableCard><EmptyState title="Couldn't load these settings" hint={error} action={<Button variant="outline" onClick={reload}>Try again</Button>} /></TableCard>
    </div>
  );
  if (!data) return (
    <div className="flex min-h-0 flex-grow flex-col gap-3">
      {header}
      <StatusLine>Loading the compliance settings</StatusLine>
      <TableCard><SectionLoading rows={6} columns={3} /></TableCard>
    </div>
  );
  if (!c) return null;

  const saved = flatten(data.settings);
  const defaults = data.defaults ? flatten(data.defaults) : null;
  const zone = viewerTimeZone();
  const nameOf = (id: string | null) => (id ? data.team.find((t) => t.id === id)?.name ?? "Someone" : "Insurvas");
  const people = (ids: unknown) => { const list = Array.isArray(ids) ? ids as string[] : []; return list.length ? list.map((id) => data.team.find((t) => t.id === id)?.name ?? "someone").join(", ") : "the owners"; };
  const lastOf = (keys: string[]) => data.changes.find((ch) => keys.includes(ch.setting)) ?? null;
  const valueOf = (keys: string[]): ValueKind => (defaults && keys.some((k) => !same(saved[k], defaults[k])) ? "yours" : "insurvas");

  /** A stored value in its row's words, for a history line. */
  const words = (key: string, v: unknown): string => {
    if (v === null || v === undefined) return "none";
    switch (key) {
      case "gate.consentMissing": return v === "block" ? "block the transfer" : "accept and flag it";
      case "gate.timeoutMs": return `${Number(v).toLocaleString("en-US")} ms`;
      case "complaints.amberDays": case "complaints.redDays": case "deletion.holdDays": case "purge.windowDays": return `${v} days`;
      case "deletion.methods": return Array.isArray(v) ? v.map((m) => METHOD_LABELS[m as keyof typeof METHOD_LABELS] ?? m).join(", ") : String(v);
      case "deletion.performerRoles": case "report.roles": return Array.isArray(v) && v.includes("producer") ? "owner and producers" : "owner only";
      case "purge.recipients": case "dashboard.recipients": return people(v);
      case "report.gapChecks": return `${Array.isArray(v) ? v.length : 0} of ${GAP_CATEGORIES.length} checks`;
      case "dashboard.hiddenTiles": return `${TILE_KEYS.length - (Array.isArray(v) ? v.length : 0)} of ${TILE_KEYS.length} tiles`;
      default: return typeof v === "boolean" ? (v ? "on" : "off") : String(v);
    }
  };
  const historyOf = (keys: string[], title: string): HistoryItem[] => data.changes.filter((ch) => keys.includes(ch.setting)).slice(0, 6).map((ch, i) => ({
    key: `${ch.setting}-${ch.at}-${i}`,
    who: nameOf(ch.by),
    at: ch.at,
    line: <>{keys.length > 1 ? `${ch.setting.split(".")[1].replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase())}: ` : ""}{words(ch.setting, ch.from)} → {words(ch.setting, ch.to)}</>,
    onPutBack: i === 0 && canEdit && same(saved[ch.setting], ch.to) ? () => void bundle.send("/api/app/compliance/settings", { op: "settings", patch: { [ch.setting]: ch.from } }, `Put back · ${title}`).then((failed) => { if (failed) setOpenError(failed); else setOpen(null); }) : null,
  }));
  const deadlineHistory = (regulator: string): HistoryItem[] => data.changes.filter((ch) => ch.section === "complaint_deadlines" && ch.setting === regulator).slice(0, 6).map((ch, i) => {
    const days = (x: unknown) => (x && typeof x === "object" && "response_days" in x ? `${(x as { response_days: number }).response_days} days` : "not set");
    return { key: `${ch.at}-${i}`, who: nameOf(ch.by), at: ch.at, line: <>{days(ch.from)} → {days(ch.to)}</> };
  });

  const switchLine = (key: string, label: string, v: Flat, set: (k: string, value: unknown) => void, onText = "On", offText = "Off") => (
    <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label={label} checked={Boolean(v[key])} onChange={(on) => set(key, on)} />{v[key] ? onText : offText}</span>
  );
  const numberLine = (key: string, label: string, v: Flat, set: (k: string, value: unknown) => void, unit: string, width = "w-24") => (
    <span className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <input aria-label={label} inputMode="numeric" className={cn(inputControl, "mt-0 tabular-nums", width)} value={v[key] === null || v[key] === undefined ? "" : String(v[key])} onChange={(e) => set(key, e.target.value === "" ? null : Math.round(Number(e.target.value.replace(/\D/g, ""))))} />{unit}
    </span>
  );
  const intIn = (key: string, lo: number, hi: number, what: string) => (v: Flat) => (Number.isInteger(v[key]) && (v[key] as number) >= lo && (v[key] as number) <= hi ? null : `${what}: enter ${lo.toLocaleString("en-US")} to ${hi.toLocaleString("en-US")}.`);
  const gateCheck = (key: string, label: string, title: string): Field => ({
    title, tab: "transfers", keys: [key], said: "A check that is off is not run on a partner's transfer.", usedBy: "Every transfer",
    affects: [{ label: "Transfers from partners", where: "Gate" }, { label: "A check that is off shows as off in the evidence report", where: "Gate & reports" }],
    now: (v) => (v[key] ? "On" : "Off"), control: (v, set) => switchLine(key, label, v, set),
  });

  const FIELDS: Record<FieldId, Field> = {
    consentMissing: {
      title: "If a transfer has no consent on file", tab: "complaints", keys: ["gate.consentMissing"], usedBy: "Transfers from partners",
      said: "Flagged transfers are accepted and counted on the compliance dashboard and in the evidence report. Blocked ones are refused before the call reaches you.",
      affects: [{ label: "Transfers from partners with no consent", where: "Gate" }, { label: "Flagged transfers on the dashboard", where: "Compliance dashboard" }],
      now: (v) => (v["gate.consentMissing"] === "block" ? "Block the transfer" : "Accept and flag it"),
      control: (v, set) => <Segmented label="If a transfer has no consent on file" value={v["gate.consentMissing"] as "warn" | "block"} onChange={(next) => set("gate.consentMissing", next)} options={[{ key: "warn", label: "Accept and flag it" }, { key: "block", label: "Block the transfer" }]} />,
    },
    purgeSchedule: {
      title: "Delete records on a schedule", tab: "records", keys: ["purge.scheduleEnabled"], usedBy: "Purge, Records",
      said: "Each day a dry run is emailed first; the live run follows after the window. Held records are never deleted. A retention policy nobody enforces is a document, not a control.",
      affects: [{ label: "Records past their age are deleted on schedule", where: "Records › Runs" }, { label: "Held records and the do-not-call list are skipped", where: "Holds & deletion" }],
      now: (v) => (v["purge.scheduleEnabled"] ? `On · a live run waits ${v["purge.windowDays"]} days after a dry run` : "Off · nothing is deleted unless you run it"),
      control: (v, set) => switchLine("purge.scheduleEnabled", "Delete records on a schedule", v, set),
    },
    urgent: {
      title: "When a complaint gets urgent", tab: "complaints", keys: ["complaints.amberDays", "complaints.redDays"], usedBy: "Complaints, Compliance dashboard",
      said: "Days left to respond. Inside red a complaint pins to the top of the compliance dashboard and the owner gets a daily email.",
      affects: [{ label: "Regulator complaints turn amber, then red", where: "Complaints" }, { label: "Red ones pin to the top and email the owner", where: "Compliance dashboard" }],
      now: (v) => `Amber with ${v["complaints.amberDays"]} days left · red with ${v["complaints.redDays"]}`,
      control: (v, set) => <div className="flex flex-wrap gap-4"><span className="flex flex-col gap-1.5 text-label text-[var(--body)]">Amber with{numberLine("complaints.amberDays", "Amber at (days left)", v, set, "days")}</span><span className="flex flex-col gap-1.5 text-label text-[var(--body)]">Red with{numberLine("complaints.redDays", "Red at (days left)", v, set, "days")}</span></div>,
      check: (v) => intIn("complaints.amberDays", 1, 90, "Amber")(v) ?? intIn("complaints.redDays", 1, 60, "Red")(v),
    },
    purgeWindow: {
      title: "A live run waits after a dry run", tab: "records", keys: ["purge.windowDays"], usedBy: "Purge", said: "A live run, by hand or on schedule, needs a dry run inside this many days.",
      affects: [{ label: "When a live run may follow a dry run", where: "Records › Runs" }],
      now: (v) => `${v["purge.windowDays"]} days`, control: (v, set) => numberLine("purge.windowDays", "Dry-run-to-live window (days)", v, set, "days"), check: intIn("purge.windowDays", 1, 30, "The window"),
    },
    purgeRecipients: {
      title: "Email the dry-run summary to", tab: "records", keys: ["purge.recipients"], usedBy: "Dry-run email", said: "They see what a live run would delete before it does.",
      affects: [{ label: "Who gets each dry run's summary", where: "Email" }],
      now: (v) => people(v["purge.recipients"]), control: (v, set) => <Recipients team={data.team} value={(v["purge.recipients"] as string[]) ?? []} disabled={false} onChange={(ids) => set("purge.recipients", ids)} label="Dry-run summary recipients" />,
    },
    deletionHold: {
      title: "Wait after identity is verified", tab: "holds", keys: ["deletion.holdDays"], usedBy: "Deletions",
      said: `The request can be cancelled during the wait. Insurvas never lets it go below ${data.caps.deletionHoldFloorDays} days.`,
      affects: [{ label: "When a verified deletion runs", where: "Deletions" }],
      now: (v) => `${v["deletion.holdDays"]} days`, control: (v, set) => numberLine("deletion.holdDays", "Hold after verification (days)", v, set, "days"), check: intIn("deletion.holdDays", data.caps.deletionHoldFloorDays, 45, "The wait"),
    },
    deletionMethods: {
      title: "Ways to verify who is asking", tab: "holds", keys: ["deletion.methods"], usedBy: "Deletions", said: "A request that none of these can verify is rejected with the reason recorded.",
      affects: [{ label: "How a deletion request is verified", where: "Deletions" }],
      now: (v) => words("deletion.methods", v["deletion.methods"]),
      control: (v, set) => (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Accepted ways to verify identity</legend>
          {VERIFICATION_METHODS.map((m) => <label key={m} className="flex items-start gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={cn(checkboxControl, "mt-0.5")} checked={((v["deletion.methods"] as string[]) ?? []).includes(m)} onChange={(e) => set("deletion.methods", toggle((v["deletion.methods"] as string[]) ?? [], m, e.target.checked))} />{METHOD_LABELS[m]}</label>)}
        </fieldset>
      ),
      check: (v) => (((v["deletion.methods"] as string[]) ?? []).length ? null : "Keep at least one way to verify identity."),
    },
    deletionRoles: {
      title: "Who may verify and perform a deletion", tab: "holds", keys: ["deletion.performerRoles"], usedBy: "Deletions", said: "The owner always may.",
      affects: [{ label: "Who can verify and run a deletion", where: "Deletions" }],
      now: (v) => (((v["deletion.performerRoles"] as string[]) ?? []).includes("producer") ? "Owner and producers" : "Owner only"),
      control: (v, set) => <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Producers may perform deletions" checked={((v["deletion.performerRoles"] as string[]) ?? []).includes("producer")} onChange={(on) => set("deletion.performerRoles", on ? ["owner", "producer"] : ["owner"])} />Producers too</span>,
    },
    federalDnc: gateCheck("gate.federalDnc", "Federal and state do-not-call", "Federal and state do-not-call check"),
    consent: gateCheck("gate.consent", "Consent on file", "Consent on file check"),
    existingCustomer: gateCheck("gate.existingCustomer", "Existing customer", "Existing customer check"),
    callingHours: gateCheck("gate.callingHours", "Inside legal calling hours", "Inside legal calling hours check"),
    timeout: {
      title: "Wait for each check up to", tab: "transfers", keys: ["gate.timeoutMs"], usedBy: "Every transfer", said: "A check slower than this is recorded as incomplete, never as passed.",
      affects: [{ label: "How long a transfer waits on each check", where: "Gate" }],
      now: (v) => `${Number(v["gate.timeoutMs"]).toLocaleString("en-US")} ms`, control: (v, set) => numberLine("gate.timeoutMs", "Time budget per check (ms)", v, set, "ms", "w-28"), check: intIn("gate.timeoutMs", 500, 10000, "The time budget"),
    },
    reportRoles: {
      title: "Who may generate a report", tab: "transfers", keys: ["report.roles"], usedBy: "Evidence report", said: "The owner always may. Producers generate it for their own leads only.",
      affects: [{ label: "Who can generate an evidence report", where: "Evidence" }],
      now: (v) => (((v["report.roles"] as string[]) ?? []).includes("producer") ? "Owner, and producers for their own leads" : "Owner only"),
      control: (v, set) => <span className="flex items-center gap-3 text-sm text-[var(--ink)]"><Switch label="Producers may generate reports" checked={((v["report.roles"] as string[]) ?? []).includes("producer")} onChange={(on) => set("report.roles", on ? ["owner", "producer"] : ["owner"])} />Producers, for their own leads</span>,
    },
    gapChecks: {
      title: "Gap checks that run", tab: "transfers", keys: ["report.gapChecks"], usedBy: "Evidence report", said: "A check that is off shows as off on every report, never as passed.",
      affects: [{ label: "What every evidence report checks", where: "Evidence" }, { label: "The book-wide gap scan in the monthly email", where: "Email" }],
      now: (v) => words("report.gapChecks", v["report.gapChecks"]),
      control: (v, set) => (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Gap checks</legend>
          {GAP_CATEGORIES.map((g) => <label key={g.key} className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={checkboxControl} checked={((v["report.gapChecks"] as string[]) ?? []).includes(g.key)} onChange={(e) => set("report.gapChecks", toggle((v["report.gapChecks"] as string[]) ?? [], g.key, e.target.checked))} />{g.label}</label>)}
        </fieldset>
      ),
    },
    monthlyEmail: {
      title: "Monthly coverage email", tab: "transfers", keys: ["dashboard.monthlyEmail", "dashboard.recipients"], usedBy: "Email", said: "The coverage figures and the book-wide gap scan, once a month.",
      affects: [{ label: "The monthly coverage email", where: "Email" }],
      now: (v) => (v["dashboard.monthlyEmail"] ? `On · to ${people(v["dashboard.recipients"])}` : "Off"),
      control: (v, set) => <>{switchLine("dashboard.monthlyEmail", "Monthly coverage email", v, set)}{Boolean(v["dashboard.monthlyEmail"]) && <Recipients team={data.team} value={(v["dashboard.recipients"] as string[]) ?? []} disabled={false} onChange={(ids) => set("dashboard.recipients", ids)} label="Monthly email recipients" />}</>,
    },
    tiles: {
      title: "Tiles on the dashboard", tab: "transfers", keys: ["dashboard.hiddenTiles"], usedBy: "Compliance dashboard", said: "A hidden tile leaves the compliance dashboard; its figure is still worked out.",
      affects: [{ label: "Which tiles show", where: "Compliance dashboard" }],
      now: (v) => words("dashboard.hiddenTiles", v["dashboard.hiddenTiles"]),
      control: (v, set) => (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="sr-only">Dashboard tiles</legend>
          {TILE_KEYS.map((k) => <label key={k} className="flex items-center gap-2 text-sm text-[var(--ink)]"><input type="checkbox" className={checkboxControl} checked={!((v["dashboard.hiddenTiles"] as string[]) ?? []).includes(k)} onChange={(e) => set("dashboard.hiddenTiles", toggle((v["dashboard.hiddenTiles"] as string[]) ?? [], k, !e.target.checked))} />{TILE_LABELS[k]}</label>)}
        </fieldset>
      ),
    },
  };

  const isOpen = (o: Open) => same(open, o);
  const fieldRow = (id: FieldId, extra?: { id?: string }) => {
    const f = FIELDS[id];
    const last = lastOf(f.keys);
    return (
      <SettingRow key={id} id={extra?.id} label={f.title} selected={isOpen({ k: "field", id })} onOpen={() => { setOpenError(null); setOpen({ k: "field", id }); }}>
        <NowCell>{f.now(saved)}</NowCell>
        <UsedCell>{f.usedBy}</UsedCell>
        <WhoCell name={last ? nameOf(last.by) : null} at={last?.at} />
        <ValueCell value={valueOf(f.keys)} />
      </SettingRow>
    );
  };
  const lockRow = (id: LockId) => (
    <SettingRow key={id} label={LOCKS[id].title} selected={isOpen({ k: "lock", id })} onOpen={() => setOpen({ k: "lock", id })}>
      <NowCell>{LOCKS[id].now}</NowCell><UsedCell>{LOCKS[id].usedBy}</UsedCell><WhoCell rule /><ValueCell value="locked" />
    </SettingRow>
  );
  const fieldValues = (ids: FieldId[], locks = 0): ValueKind[] => [...ids.map((id) => valueOf(FIELDS[id].keys)), ...Array.from({ length: locks }, () => "locked" as const)];

  // Response deadlines: unset licensed states first (amber), then the set ones.
  const deadlineRows = [
    ...unset.map((regulator) => ({ regulator, responseDays: null as number | null, notes: null as string | null })),
    ...data.deadlines.rows.map((r) => ({ ...r, responseDays: r.responseDays as number | null })),
  ].sort((a, b) => (a.responseDays === null) === (b.responseDays === null) ? a.regulator.localeCompare(b.regulator) : a.responseDays === null ? -1 : 1);
  const deadlines = paginate(deadlineRows, deadlinePage, PAGE);
  const holdsAll = [...data.holds].sort((a, b) => Number(Boolean(a.releasedAt)) - Number(Boolean(b.releasedAt)) || b.placedAt.localeCompare(a.placedAt));
  const holds = paginate(holdsAll, holdPage, PAGE);
  const runs = paginate(data.runs, runPage, PAGE);
  const platformRule = (t: string) => data.rules.find((r) => r.tenantId === null && r.recordType === t && r.state === null) ?? null;
  const mine = (t: string) => data.rules.filter((r) => r.tenantId !== null && r.recordType === t);
  const lastDeadline = data.changes.find((ch) => ch.section === "complaint_deadlines") ?? null;
  const lastDryMatched = lastDry ? lastDry.results.reduce((sum, r) => sum + Math.max(0, r.rows_matched - r.rows_held), 0) : 0;

  /** The status line: read-only, a sheet open, or what was saved last on this tab. */
  const status = (() => {
    if (readOnly) return <StatusLine tone="warn">Read-only: your plan&apos;s billing is paused. Values show, nothing saves.</StatusLine>;
    if (open && (open.k === "field" || open.k === "deadline")) return <StatusLine tone="warn">{open.k === "field" ? FIELDS[open.id].title : open.regulator ? `${regulatorName(open.regulator)} deadline` : "A new deadline"} being changed · nothing saved yet</StatusLine>;
    if (tab === "holds") return <StatusLine tone={activeHolds.length ? "warn" : "ok"}>{activeHolds.length ? `${activeHolds.length} hold${activeHolds.length === 1 ? "" : "s"} in force · records under a hold are skipped by every purge` : "No holds in force · a complaint or a dispute places one by itself"}</StatusLine>;
    if (tab === "records") return <StatusLine>{data.settings.purge.scheduleEnabled ? `Scheduled purge on · a live run waits ${windowDays} days after a dry run` : "Scheduled purge off · nothing is deleted unless you run it"}{lastDry ? ` · last dry run ${shortDay(lastDry.startedAt)}` : ""}</StatusLine>;
    if (tab === "complaints") {
      const last = data.changes.find((ch) => ch.section === "complaint_deadlines" || ch.setting.startsWith("complaints."));
      return <StatusLine tone={unset.length ? "warn" : "ok"}>{last ? `Saved · ${last.section === "complaint_deadlines" ? `${regulatorName(last.setting)} deadline` : "When a complaint gets urgent"} changed by ${nameOf(last.by)} on ${shortDay(last.at)} · ` : ""}{data.deadlines.rows.length} regulator{data.deadlines.rows.length === 1 ? " has" : "s have"} a response deadline{unset.length ? ` · ${unset.length} not set` : ""}</StatusLine>;
    }
    const keys = Object.values(FIELDS).filter((f) => f.tab === tab || (tab === "start" && (f === FIELDS.consentMissing || f === FIELDS.purgeSchedule))).flatMap((f) => f.keys);
    const last = data.changes.find((ch) => keys.includes(ch.setting));
    const field = last ? Object.values(FIELDS).find((f) => f.keys.includes(last.setting)) : null;
    return <StatusLine>{last ? `Saved · ${field?.title ?? "A setting"} changed by ${nameOf(last.by)} on ${shortDay(last.at)}` : "Saved · every setting here is on Insurvas's value"}</StatusLine>;
  })();

  const openField = open?.k === "field" ? FIELDS[open.id] : null;
  const openLock = open?.k === "lock" ? LOCKS[open.id] : null;

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-3">
      {header}
      {status}

      {tab === "start" && (
        <SettingTable fill footer={<SettingFoot values={fieldValues(["consentMissing", "purgeSchedule"], 1)}>The three decisions an owner makes first</SettingFoot>}>
          <tbody>
            <SettingRow label="Complaint response deadlines" onOpen={() => setTab("complaints")}>
              <NowCell title={c.sentence}>{c.sentence}</NowCell>
              <UsedCell>Complaints</UsedCell>
              <WhoCell name={lastDeadline ? nameOf(lastDeadline.by) : null} at={lastDeadline?.at} />
              <td className="w-[1%] whitespace-nowrap">{unset.length ? <StatusChip tone="warning">{unset.length} not set</StatusChip> : <StatusChip tone="good">All set</StatusChip>}</td>
            </SettingRow>
            {fieldRow("consentMissing")}
            {fieldRow("purgeSchedule")}
            {lockRow("dnc")}
          </tbody>
        </SettingTable>
      )}

      {tab === "complaints" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <SettingTable title="Rules">
            <tbody>{fieldRow("urgent")}{fieldRow("consentMissing")}</tbody>
          </SettingTable>
          <div id="deadlines" className="flex min-h-0 flex-1 scroll-mt-24 flex-col">
            {deadlineRows.length === 0 ? (
              <TableCard title="Response deadlines"><EmptyState title="No response deadlines yet" hint="Add each licensed state's response days, and the FTC's." action={canEdit ? <Button onClick={() => setOpen({ k: "deadline", regulator: null })}>Add a regulator</Button> : undefined} /></TableCard>
            ) : (
              <SettingTable fill title="Response deadlines" action={<span className="text-xs text-[var(--muted)]">How long each regulator gives you to answer a complaint</span>}
                columns={[{ label: "Regulator", className: "w-[300px]" }, { label: "Answer within" }, { label: "Open complaints", md: true }, { label: "Changed", md: true, className: "w-[200px]" }, { label: "Value", className: "w-[1%]" }]}
                footer={deadlineRows.length > PAGE ? <Pager page={deadlines.current} total={deadlineRows.length} noun="regulators" pageSize={PAGE} onPage={setDeadlinePage} /> : <><span>{deadlineRows.length} regulators{unset.length ? ` · ${unset.length} not set` : ""}</span><span>Click a row to change it</span></>}>
                <tbody>{deadlines.rows.map((r) => {
                  const last = data.changes.find((ch) => ch.section === "complaint_deadlines" && ch.setting === r.regulator) ?? null;
                  const o: Open = { k: "deadline", regulator: r.responseDays === null ? null : r.regulator, preset: r.responseDays === null ? r.regulator : null };
                  return (
                    <SettingRow key={r.regulator} label={regulatorName(r.regulator)} selected={isOpen(o)} onOpen={() => setOpen(o)}>
                      <NowCell title={r.notes ?? undefined}>{r.responseDays === null ? <span className="text-[var(--muted)]">Not set</span> : `${r.responseDays} days`}</NowCell>
                      <td className="hidden whitespace-nowrap tabular-nums md:table-cell">{r.responseDays === null ? "—" : data.openByRegulator ? (data.openByRegulator[r.regulator] ?? 0) : "—"}</td>
                      <WhoCell name={last ? nameOf(last.by) : null} at={last?.at} />
                      <td className="w-[1%] whitespace-nowrap">{r.responseDays === null ? <StatusChip tone="warning">Not set</StatusChip> : <ValueCellChip value={last ? "yours" : "insurvas"} />}</td>
                    </SettingRow>
                  );
                })}</tbody>
              </SettingTable>
            )}
          </div>
        </div>
      )}

      {tab === "records" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div id="retention" className="scroll-mt-24">
            <SettingTable title="How long records are kept" columns={[{ label: "Record", className: "w-[300px]" }, { label: "Kept for" }, { label: "Then", md: true }, { label: "Changed", md: true, className: "w-[200px]" }, { label: "Value", className: "w-[1%]" }]}
              footer={<span>{NOT_LEGAL_ADVICE} Your rule for a state beats your all-states rule, which beats Insurvas&apos;s. A record type with no rule is never deleted. Insurvas keeps each carrier&apos;s retention windows.</span>}>
              <tbody>{RECORD_TYPES.map((t) => {
                const p = platformRule(t.key);
                const own = mine(t.key);
                const shown = own.find((r) => r.state === null) ?? p;
                const isLocked = data.caps.neverDelete.includes(t.key);
                const last = data.changes.find((ch) => ch.section === "retention_rules" && ch.setting.split(":")[0] === t.key) ?? null;
                const o: Open = { k: "record", type: t.key };
                return (
                  <SettingRow key={t.key} label={t.label} selected={isOpen(o)} onOpen={() => setOpen(o)}>
                    <NowCell title={own.some((r) => r.state) ? `${own.filter((r) => r.state).length} state rule${own.filter((r) => r.state).length === 1 ? "" : "s"} too` : undefined}>{shown ? describeDays(shown.retainDays) : "Never deleted"}</NowCell>
                    <UsedCell>{shown ? ACTION_LABELS[shown.action as RetentionAction] ?? shown.action : "—"}</UsedCell>
                    <WhoCell name={last ? nameOf(last.by) : null} at={last?.at} rule={isLocked} />
                    <td className="w-[1%] whitespace-nowrap">{isLocked ? <StatusChip tone="neutral">Locked: never deleted</StatusChip> : own.length ? <StatusChip tone="action">Yours · {own.length} rule{own.length === 1 ? "" : "s"}</StatusChip> : p ? <StatusChip tone="neutral">Insurvas</StatusChip> : <StatusChip tone="neutral">No rule: never deleted</StatusChip>}</td>
                  </SettingRow>
                );
              })}</tbody>
            </SettingTable>
          </div>
          <div id="purge" className="scroll-mt-24">
            <SettingTable title="Scheduled purge" footer={<SettingFoot values={fieldValues(["purgeSchedule", "purgeWindow", "purgeRecipients"])}>A dry run first, every time</SettingFoot>}>
              <tbody>{fieldRow("purgeSchedule")}{fieldRow("purgeWindow")}{fieldRow("purgeRecipients")}</tbody>
            </SettingTable>
          </div>
          {data.runs.length === 0 ? <TableCard title="Runs"><EmptyState title="No runs yet" hint="Start with a dry run: it deletes nothing and shows what a live run would." /></TableCard> : (
            <SettingTable title="Runs"
              action={canEdit ? <Button size="sm" variant="outline" disabled={busy || !dryFresh} title={dryFresh ? undefined : `A live run needs a dry run in the last ${windowDays} days`} onClick={() => setConfirmLive(true)}>Live run</Button> : undefined}
              columns={[{ label: "Run", className: "w-[300px]" }, { label: "Kind" }, { label: "Would delete", md: true }, { label: "Started by", md: true, className: "w-[200px]" }, { label: "Result", className: "w-[1%]" }]}
              footer={data.runs.length > PAGE ? <Pager page={runs.current} total={data.runs.length} noun="runs" pageSize={PAGE} onPage={setRunPage} /> : undefined}>
              <tbody>{runs.rows.map((r) => {
                const live = r.mode === "live";
                const count = r.results.reduce((a, x) => a + (live ? x.rows_purged ?? 0 : Math.max(0, x.rows_matched - x.rows_held)), 0);
                const o: Open = { k: "run", id: r.id };
                return (
                  <SettingRow key={r.id} label={dateTime(r.startedAt, zone)} selected={isOpen(o)} onOpen={() => setOpen(o)}>
                    <NowCell>{live ? "Live run" : "Dry run"}</NowCell>
                    <UsedCell>{count.toLocaleString("en-US")} records{live ? " deleted" : ""}</UsedCell>
                    <td className="hidden whitespace-nowrap text-[var(--body)] md:table-cell">{r.triggeredBy === "schedule" ? "Schedule" : r.triggeredBy === "manual" ? "A person" : r.triggeredBy}</td>
                    <td className="w-[1%] whitespace-nowrap">{!r.finishedAt ? <StatusChip tone="info">Running</StatusChip> : r.liveSkippedReason ? <StatusChip tone="warning">Live run skipped</StatusChip> : <StatusChip tone="good">Done</StatusChip>}</td>
                  </SettingRow>
                );
              })}</tbody>
            </SettingTable>
          )}
        </div>
      )}

      {tab === "holds" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div id="holds" className="scroll-mt-24">
            {holdsAll.length === 0 ? <TableCard title="Legal holds"><EmptyState title="No holds yet" hint="A complaint or a commission dispute places one by itself. Place one by hand for litigation." action={canEdit ? <Button onClick={() => setOpen({ k: "newHold" })}>New hold</Button> : undefined} /></TableCard> : (
              <SettingTable title="Legal holds" action={<span className="text-xs text-[var(--muted)]">Nothing under a hold is deleted, by a schedule or a deletion request</span>}
                columns={[{ label: "Hold", className: "w-[300px]" }, { label: "Covers" }, { label: "Since", md: true }, { label: "Placed by", md: true, className: "w-[200px]" }, { label: "Status", className: "w-[1%]" }]}
                footer={holdsAll.length > PAGE ? <Pager page={holds.current} total={holdsAll.length} noun="holds" pageSize={PAGE} onPage={setHoldPage} /> : undefined}>
                <tbody>{holds.rows.map((h) => {
                  const o: Open = { k: "hold", id: h.id };
                  const by = nameOf(h.placedBy);
                  return (
                    <SettingRow key={h.id} label={<span title={h.note ?? undefined}>{h.note ? `${h.note}` : h.scopeValue ?? HOLD_SCOPE_LABELS[h.scope]}</span>} selected={isOpen(o)} onOpen={() => setOpen(o)}>
                      <NowCell>{HOLD_SCOPE_LABELS[h.scope]}{h.scopeValue ? ` · ${h.scopeValue}` : ""}</NowCell>
                      <UsedCell>{shortDay(h.placedAt)}</UsedCell>
                      <td className="hidden whitespace-nowrap md:table-cell"><span className="inline-flex items-center gap-1.5 text-[var(--body)]"><Avatar size="xs" name={by} />{by}</span></td>
                      <td className="w-[1%] whitespace-nowrap">{h.releasedAt ? <StatusChip tone="neutral">Released {shortDay(h.releasedAt)}</StatusChip> : h.sourceOpen ? <StatusChip tone="warning" title="Released automatically when it is closed">{h.reason === "complaint" ? "Complaint open" : "Dispute open"}</StatusChip> : <StatusChip tone="warning">In force</StatusChip>}</td>
                    </SettingRow>
                  );
                })}</tbody>
              </SettingTable>
            )}
          </div>
          <div id="deletion" className="scroll-mt-24">
            <SettingTable title="Deletion requests" footer={<SettingFoot values={fieldValues(["deletionHold", "deletionMethods", "deletionRoles"])} />}>
              <tbody>{fieldRow("deletionHold")}{fieldRow("deletionMethods")}{fieldRow("deletionRoles")}</tbody>
            </SettingTable>
          </div>
        </div>
      )}

      {tab === "transfers" && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
          <div id="gate" className="scroll-mt-24">
            <SettingTable title="Transfer gate" footer={<><span>{`A transfer with no consent on file is ${data.settings.gate.consentMissing === "block" ? "blocked" : "accepted and flagged"}`}; screening vendors are chosen by Insurvas</span><span>Calling windows are set in <Link className="underline" href="/app/settings#calling-windows">Settings › Calling windows</Link></span></>}>
              <tbody>{lockRow("litigator")}{lockRow("internalDnc")}{fieldRow("federalDnc")}{fieldRow("consent")}{fieldRow("existingCustomer")}{fieldRow("callingHours")}{fieldRow("timeout")}</tbody>
            </SettingTable>
          </div>
          <div id="report" className="scroll-mt-24">
            <SettingTable title="Evidence report" footer={<><span>No report copies are stored</span><span>Disclosures are edited in <Link className="underline" href="/app/settings#sales-disclosures">Settings › Disclosures</Link></span></>}>
              <tbody>{fieldRow("reportRoles")}{fieldRow("gapChecks")}</tbody>
            </SettingTable>
          </div>
          <div id="dashboard" className="scroll-mt-24">
            <SettingTable title="Dashboard and monthly email" footer={<><span>{TILE_KEYS.length - data.settings.dashboard.hiddenTiles.length} of {TILE_KEYS.length} tiles shown</span><Link className="underline" href="/app/compliance">Compliance dashboard</Link></>}>
              <tbody>{fieldRow("monthlyEmail")}{fieldRow("tiles")}</tbody>
            </SettingTable>
          </div>
          <div id="index-checks" className="scroll-mt-24">
            {/* LA-6.1 (Notion; round 7): the nightly reconciliation of the compliance record index. */}
            <SettingsTableCard title="Index checks" actions={<span className="text-sm text-muted-foreground">Every night · any record missing is a bug</span>}>
              {!data.indexChecks?.length ? <EmptyState title="No index checks yet" hint="The first check runs tonight." /> : (
                <table className={st.table}>
                  <thead><tr className={st.headRow}><th className={st.th}>Night of</th><th className={cn(st.th, "text-right")}>Missing</th><th className={cn(st.th, "text-right")}>Out of date</th><th className={cn(st.th, "text-right")}>No number</th><th className={st.th}>Status</th></tr></thead>
                  <tbody>{data.indexChecks.slice(0, PAGE).map((r) => (
                    <tr key={r.ranAt}>
                      <td className={cn(st.td, "whitespace-nowrap font-medium text-foreground tabular-nums")}>{dateTime(r.ranAt, zone)}</td>
                      <td className={cn(st.td, st.num)}>{r.missing.toLocaleString("en-US")}</td>
                      <td className={cn(st.td, st.num)}>{r.stale.toLocaleString("en-US")}</td>
                      <td className={cn(st.td, st.num)}>{r.unkeyed.toLocaleString("en-US")}</td>
                      <td className={st.td}>{r.missing > 0 ? <StatusChip tone="danger">{r.missing.toLocaleString("en-US")} missing</StatusChip> : <StatusChip tone="good">Clean</StatusChip>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </SettingsTableCard>
          </div>
        </div>
      )}

      {openField && open?.k === "field" && (
        <FieldSheet key={open.id} field={openField} saved={saved} defaults={defaults} canEdit={canEdit} busy={busy} history={historyOf(openField.keys, openField.title)} error={openError}
          onSave={async (patch, undo) => { const failed = await bundle.send("/api/app/compliance/settings", { op: "settings", patch }, `Saved · ${openField.title}`, { undo: { op: "settings", patch: undo } }); if (failed) setOpenError(failed); else { setOpenError(null); setOpen(null); } }}
          onClose={() => { setOpenError(null); setOpen(null); }} />
      )}
      {openLock && <LockedSheet title={openLock.title} where={`Compliance › ${TAB_LABEL[openLock.tab]}`} why={openLock.why} means={openLock.means} onClose={() => setOpen(null)} />}
      {open?.k === "deadline" && <DeadlineSheet key={`${open.regulator}-${open.preset}`} bundle={{ ...bundle, data }} regulator={open.regulator} preset={open.preset} canEdit={canEdit} history={open.regulator ? deadlineHistory(open.regulator) : []} onClose={() => setOpen(null)} />}
      {open?.k === "record" && <RecordTypeSheet bundle={{ ...bundle, data }} recordType={open.type} canEdit={canEdit} onClose={() => setOpen(null)} />}
      {open?.k === "newHold" && <NewHoldSheet bundle={{ ...bundle, data }} canEdit={canEdit} onClose={() => setOpen(null)} />}
      {open?.k === "hold" && <HoldSheet key={open.id} bundle={{ ...bundle, data }} id={open.id} canEdit={canEdit} onClose={() => setOpen(null)} />}
      {open?.k === "run" && <RunSheet data={data} id={open.id} onClose={() => setOpen(null)} />}

      <ConfirmDialog open={confirmLive} onOpenChange={setConfirmLive} busy={busy}
        title={`Delete ${lastDryMatched.toLocaleString("en-US")} records now?`}
        description={`This deletes what the ${lastDry ? dateTime(lastDry.startedAt, zone) : "last"} dry run listed, and anything that came due since. Held records and the do-not-call list are not touched. It cannot be undone.`}
        confirmLabel="Run the purge" cancelLabel="Not now"
        onConfirm={async () => { if (await write("/api/app/compliance/retention/runs", { mode: "live", confirm: true }, "Live run done")) setConfirmLive(false); }} />
    </div>
  );
}

/** The Value chip without its cell, for a row whose last cell mixes chips. */
function ValueCellChip({ value }: { value: ValueKind }) {
  return value === "yours" ? <StatusChip tone="action">Yours</StatusChip> : <StatusChip tone="neutral">Insurvas</StatusChip>;
}

/**
 * One compliance setting's sheet: its control over a draft of just its keys, Use Insurvas value when the value is
 * the agency's own, and Save this setting, which sends a patch of those keys only (Undo sends the old ones back).
 */
function FieldSheet({ field, saved, defaults, canEdit, busy, history, error, onSave, onClose }: {
  field: Field;
  saved: Flat;
  defaults: Flat | null;
  canEdit: boolean;
  busy: boolean;
  history: HistoryItem[];
  error: string | null;
  onSave: (patch: Flat, undo: Flat) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Flat>(() => Object.fromEntries(field.keys.map((k) => [k, saved[k]])));
  const [problem, setProblem] = useState<string | null>(null);
  const v: Flat = { ...saved, ...draft };
  const set = (key: string, value: unknown) => { setDraft((cur) => ({ ...cur, [key]: value })); setProblem(null); };
  const changed = field.keys.filter((k) => !same(draft[k], saved[k]));
  const yours = Boolean(defaults && field.keys.some((k) => !same(saved[k], defaults[k])));
  const undo = Object.fromEntries(field.keys.map((k) => [k, saved[k]]));
  const save = (patch: Flat) => {
    const p = field.check?.({ ...saved, ...patch }) ?? null;
    if (p) { setProblem(p); return; }
    void onSave(patch, undo);
  };
  return (
    <SettingSheet title={field.title} where={`Compliance › ${TAB_LABEL[field.tab]}`} canEdit={canEdit} readOnlyWhy="Your plan's billing is paused, so nothing saves."
      said={<>{field.said} {defaults ? <span className="text-[var(--muted)]">{yours ? `Insurvas value: ${field.now(defaults)}.` : "This is Insurvas's value."}</span> : null}</>}
      readValue={field.now(saved)} error={problem ?? error} busy={busy} saveDisabled={!changed.length}
      onSave={() => save(Object.fromEntries(changed.map((k) => [k, draft[k]])))}
      onUseInsurvas={yours && defaults ? () => save(Object.fromEntries(field.keys.filter((k) => !same(saved[k], defaults[k])).map((k) => [k, defaults[k]]))) : null}
      affects={field.affects} history={history} historyHref={HISTORY} historyEmpty={yours ? "No change recorded for this setting yet." : undefined}
      onClose={onClose}>
      {field.control(v, set)}
    </SettingSheet>
  );
}

