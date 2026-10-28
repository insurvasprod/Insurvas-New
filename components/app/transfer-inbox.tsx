"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Callout, KeyValues, SettingsMeter, st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { SamePersonPrompt, type SamePersonCheck } from "@/components/app/same-person-prompt";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection } from "@/components/ui/bulk-bar";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { TeamViews } from "@/components/app/inbound/transfers-views";
import { callHref } from "@/components/app/inbound/use-floor";
import { WaitBar } from "@/components/app/inbound/stream-parts";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { InfoTip } from "@/components/ui/info-tip";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { productLineLabel } from "@/lib/format/productLine";
import { notify } from "@/lib/notify";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { claimedMessage, isWithAgent, releaseDialog, SCREENING_FILTER_OPTIONS, screeningSignal, type InboxSummary, type ScreeningSignal } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { ViewTabs } from "@/components/ui/view-tabs";

type Item = {
  id: string;
  leadId: string;
  /** LA-1.14's five states, as a label ("With a licensed agent"). */
  phaseLabel?: string;
  customer: string;
  age: string;
  state: string;
  productLine: string;
  partnerId: string | null;
  partnerName: string;
  status: string;
  ownerUserId: string | null;
  ownerName: string | null;
  claimedAt: string | null;
  waitSeconds: number;
  screeningOutcome: string;
  screeningWarning: string | null;
  duplicateWarning: boolean;
  preflightStatus: string;
  preflight: Omit<SamePersonCheck, "status"> | null;
  queuedAt: string;
  screening?: ScreeningSignal;
};
type Handoff = { id: string; workItemId: string; bufferName: string; productLine: string; customer: string; progressPercentage: number; expiresAt: string };
type Sla = { warnSeconds: number; escalateSeconds: number };
type Data = {
  items: Item[];
  partners: Array<{ id: string; name: string }>;
  products: string[];
  states: string[];
  claimedUsers: Array<{ id: string; name: string }>;
  handoffs: Handoff[];
  realtimeTopic?: string;
  truncated?: boolean;
  summary?: InboxSummary | null;
  sla?: Sla | null;
  currentUserId?: string;
  rowFacts?: Record<string, RowFact>;
  fetchedAt?: string;
};
type RowFact = { callStartedAt: string | null; outcome: string | null; escalatedAt: string | null };
type LostTransfer = { failureId: string; leadId: string; customer: string; partnerName: string | null; productLine: string | null; failedAt: string; error: string; alreadyQueued: boolean };
type PartnerToday = { partnerId: string; name: string; status: string; sent: number; completed: number; dropped: number; flagged: number };
type Extras = { lost: LostTransfer[]; byPartner: PartnerToday[]; canRecover: boolean };
type Ladder = { checked: boolean; summary: string; checkedAt: string | null; steps: Array<{ key: string; label: string; state: "passed" | "match" | "not_reached" | "unknown" }> };

/**
 * What a row is doing now, as the board separates it: talking and claimed are different facts.
 * `now` is the server's fetch time, so the label is the same on every render of one response.
 */
function rowState(item: Item, fact: RowFact | undefined, handoffIds: Set<string>, now: number): { text: string; tone: "success" | "warning" | "error" | "brand" | "neutral" } | null {
  if (fact?.callStartedAt) {
    const open = (now - new Date(fact.callStartedAt).getTime()) / 1000;
    // Past four hours nobody is still talking: the call record was never closed, and the row says so.
    if (open > 4 * 3600) return { text: `Call record open ${open >= 86400 ? `${Math.floor(open / 86400)}d ${Math.floor((open % 86400) / 3600)}h` : duration(open)}, never closed`, tone: "warning" };
    return { text: `On a call ${duration(open)}`, tone: "success" };
  }
  if (handoffIds.has(item.id)) return { text: "Handoff to you", tone: "brand" };
  if (fact?.outcome) return { text: fact.outcome, tone: "neutral" };
  if (item.status === "unclaimed") return fact?.escalatedAt ? { text: "Escalated", tone: "error" } : null;
  if (isWithAgent(item.status) && item.claimedAt) return { text: `Claimed ${duration((now - new Date(item.claimedAt).getTime()) / 1000)}, no call`, tone: "warning" };
  if (item.status === "completed" || item.status === "closed" || item.status === "dropped") return { text: item.status[0].toUpperCase() + item.status.slice(1), tone: "neutral" };
  return null;
}
const ROW_STATE_INK: Record<string, string> = { success: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", error: "text-[var(--error-ink)]", brand: "text-[var(--accent-ink)]", neutral: "text-[var(--muted)]" };
type Status = "unclaimed" | "claimed" | "all";
type Filters = { status: Status; partnerId: string; productLine: string; state: string; screeningOutcome: string; claimedBy: string };
type Realtime = "connecting" | "connected" | "offline";

// The inbox opens on every transfer with no filter on: a chip already set on arrival read as a
// filter someone forgot to clear. Waiting ones still sort first (longest wait first).
const DEFAULT_FILTERS: Filters = { status: "all", partnerId: "", productLine: "", state: "", screeningOutcome: "", claimedBy: "" };
/** "Clear filters" removes every chip: that is All transfers. */
const CLEARED_FILTERS: Filters = DEFAULT_FILTERS;
const STATUS_LABEL: Record<Status, string> = { unclaimed: "waiting", claimed: "claimed", all: "all" };
const PARTNER_PAGE = 10;

/**
 * Rows per page: as many as fit the screen under the header, strip and toolbar, so the pager sits
 * at the bottom of the window rather than a scroll away. Recomputed when the window is resized.
 */

/* ── formatting ─────────────────────────────────────────────────────────── */

/** A duration, never a bare number: "4m 12s", "0m 48s", "1h 05m". */
function duration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** The SLA target as the tiles say it: "2m", "45s", "1h 30m". */
function target(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return seconds % 60 === 0 ? `${seconds / 60}m` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** A person's age, never a bare number: "68 yrs". */
function ageLabel(age: string) {
  const value = age.trim();
  if (/^\d{1,3}$/.test(value)) return `${value} yrs`;
  return value || "—";
}

/** "Ray Delgado" → "R. Delgado"; the current user is "You". */
function ownerLabel(item: Item, currentUserId?: string) {
  if (!item.ownerUserId && !item.ownerName) return "Unclaimed";
  if (currentUserId && item.ownerUserId === currentUserId) return "You";
  const parts = (item.ownerName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Another agent";
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/** Waiting rows count up; a claimed row shows how long it waited before someone took it. */
function waitOf(item: Item): number | null {
  if (item.claimedAt) return Math.max(0, Math.round((new Date(item.claimedAt).getTime() - new Date(item.queuedAt).getTime()) / 1000));
  if (item.status === "unclaimed") return item.waitSeconds;
  return null;
}

function clock(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function signalOf(item: Item) {
  return item.screening ?? screeningSignal({ screeningOutcome: item.screeningOutcome, preflightStatus: item.preflightStatus, duplicateWarning: item.duplicateWarning });
}


function screeningNote(item: Item) {
  const signal = signalOf(item);
  const previous = item.preflight?.matches?.find((match) => match.partnerName)?.partnerName;
  if (item.screeningWarning) return item.screeningWarning;
  if (signal.key === "needs_review") return "This number is on a do-not-call list. Review it before calling.";
  if (signal.key === "duplicate") return previous ? `Possible duplicate: a previous lead came from ${previous}.` : "Possible duplicate. Review the earlier record before calling.";
  if (signal.key === "clear") return "No do-not-call match.";
  return "Screening has not run for this transfer yet.";
}

/* ── local controls ─────────────────────────────────────────────────────── */

const selectFull = cn(toolbarControl, "w-full");
const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

const PILL_TONE: Record<ScreeningSignal["tone"], PillTone> = { error: "error", warning: "warning", success: "success", neutral: "neutral" };

/** Inbound A: the callers in three groups, in this order. */
type Group = "waiting" | "with_agent" | "done";
const GROUP_LABEL: Record<Group, string> = { waiting: "Waiting", with_agent: "With an agent", done: "Done" };
function groupOf(item: Item): Group {
  if (item.status === "unclaimed") return "waiting";
  return isWithAgent(item.status) ? "with_agent" : "done";
}
function groupRank(item: Item) { return { waiting: 0, with_agent: 1, done: 2 }[groupOf(item)]; }

export function TransferInbox({ readOnly, role }: { readOnly: boolean; role: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimingNext, setClaimingNext] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [realtime, setRealtime] = useState<Realtime>("connecting");
  const [refreshing, setRefreshing] = useState(false);
  // Filter options seen so far. The server derives them from the rows it returned, so with one
  // partner chosen it would offer only that partner; keeping the union lets the agent switch
  // directly instead of going back through "All partners".
  const [options, setOptions] = useState<{ partners: Map<string, string>; products: Set<string>; states: Set<string>; users: Map<string, string> }>(() => ({ partners: new Map(), products: new Set(), states: new Set(), users: new Map() }));
  const router = useRouter();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [recovering, setRecovering] = useState(false);
  // Two views under the title, as on the Agent Floor: the transfers, and today's report by partner.
  const [tab, setTab] = useState<"transfers" | "partners">("transfers");
  const [partnerSearch, setPartnerSearch] = useState("");
  const [partnerPage, setPartnerPage] = useState(1);
  const PAGE_SIZE = useFittingPageSize(470, 57);

  // Lost transfers and today-by-partner change slowly; every 30 seconds, not on every realtime change.
  const loadExtras = useCallback(async () => {
    try {
      const response = await fetch("/api/app/inbound/today", { cache: "no-store" });
      if (response.ok) setExtras(await response.json() as Extras);
    } catch {
      /* the next interval retries; the inbox itself is unaffected */
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadExtras();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadExtras(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadExtras]);

  async function recoverLost(ids: string[]) {
    setRecovering(true);
    const response = await fetch("/api/app/inbound/today", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failure_ids: ids }) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setRecovering(false);
    if (!response || !response.ok) { notify.block(body?.error ?? "Could not recover those transfers"); return; }
    const results = (body?.results ?? []) as Array<{ outcome: string }>;
    const failed = results.filter((result) => result.outcome === "failed").length;
    if (failed) notify.block(`${results.length - failed} recovered, ${failed} could not be. They stay listed.`);
    else notify.done(results.length === 1 ? "Transfer recovered into the inbox" : `${results.length} transfers recovered into the inbox`);
    void loadExtras();
    void load();
  }

  // `inFlight` stops the safety tick from stacking requests when a response is slower than
  // the tick; `latest` drops a response that a newer request (a filter change) has superseded, so
  // a slow answer for the old filter can never overwrite the new one.
  const inFlight = useRef(0);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++latest.current;
    inFlight.current += 1;
    try {
      const params = new URLSearchParams({ status: filters.status });
      if (filters.partnerId) params.set("partner_id", filters.partnerId);
      if (filters.productLine) params.set("product_line", filters.productLine);
      if (filters.state) params.set("state", filters.state);
      if (filters.screeningOutcome) params.set("screening_outcome", filters.screeningOutcome);
      if (filters.claimedBy) params.set("claimed_by", filters.claimedBy);
      const response = await fetch(`/api/app/inbound?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (requestId !== latest.current) return;
      if (!response.ok) { setError(body?.error ?? "Could not load transfer inbox"); return; }
      setError("");
      const nextData = body as Data;
      setData(nextData);
      setOptions((current) => {
        const partners = new Map(current.partners);
        for (const partner of nextData.partners) partners.set(partner.id, partner.name);
        const users = new Map(current.users);
        for (const user of nextData.claimedUsers) users.set(user.id, user.name);
        return { partners, products: new Set([...current.products, ...nextData.products]), states: new Set([...current.states, ...nextData.states]), users };
      });
    } catch {
      // A dropped connection is retried by the next tick; it must not become an unhandled rejection.
    } finally {
      inFlight.current -= 1;
    }
  }, [filters]);

  // The interval synchronizes this client view with the external inbox state; it is intentionally
  // not a derived render calculation.
  // The tick is skipped while a request is still out and while the tab is hidden — realtime below
  // still refreshes on every change, and returning to the tab refreshes at once. The shell's alert
  // feed keeps announcing new transfers to a hidden tab, so nothing is missed.
  // LA-1.15-2: realtime, not polling. The table triggers broadcast floor_changed on every claim,
  // call and handoff, and the inbox re-reads on it (below). The only timer is a slow safety re-read
  // in case a broadcast is missed: every 30 seconds while connected, every 10 while not.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (inFlight.current === 0 && document.visibilityState === "visible") void load(); }, realtime === "connected" ? 30_000 : 10_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, realtime]);

  // "Realtime · Connected" is the channel's own status, not a promise: it says Connected only once
  // the subscription is confirmed, and says so when it drops (the safety re-read then runs every 10 seconds).
  useEffect(() => {
    if (!data?.realtimeTopic) return;
    const supabase = getSupabaseBrowserClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!supabase) { setRealtime("offline"); return; }
    // A burst of broadcasts shares one reload (LA-1 audit: every change used to refetch the inbox).
    const BROADCAST_COALESCE_MS = 1000;
    let pending: number | null = null;
    const reloadSoon = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, BROADCAST_COALESCE_MS);
    };
    let channel: RealtimeChannel | null = supabase.channel(data.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, reloadSoon)
      .subscribe((status) => { setRealtime(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting"); });
    return () => { if (pending !== null) window.clearTimeout(pending); if (channel) void supabase.removeChannel(channel); channel = null; };
  }, [data?.realtimeTopic, load]);

  function change(next: Partial<Filters>) { setFilters((current) => ({ ...current, ...next })); setPage(1); }
  /** "Clear filters" removes every chip, including the status one (that is All transfers), and the search. */
  function clearFilters() { setFilters(CLEARED_FILTERS); setSearch(""); setPage(1); }
  async function refresh() { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }

  // LA-1.10-8 / LA-1.14-9: give a transfer back, or put a dropped call back in the queue. Both ask first.
  async function release(item: Item, action: "unassign" | "requeue") {
    if (!(await confirmAction(releaseDialog(action, { customer: item.customer })))) return;
    setClaiming(item.id);
    const response = await fetch("/api/app/inbound/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, work_item_id: item.id }) });
    const body = await response.json().catch(() => null);
    setClaiming(null);
    if (!response.ok) { notify.block(body?.error ?? "Could not update this transfer"); return; }
    notify.done(action === "requeue" ? `${item.customer} is back in the queue; whoever claims it picks up the verification where it stopped` : `${item.customer} is back in the queue`);
    void load();
  }

  async function claim(id: string) {
    setClaiming(id);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: id }) });
    const body = await response.json().catch(() => null);
    setClaiming(null);
    if (response.status === 409) { notify.block(body?.error ?? "This transfer was already claimed"); void load(); return; }
    if (!response.ok) { notify.block(body?.error ?? "Could not claim this transfer"); return; }
    notify.arrive(claimedMessage(body));
    router.push(callHref(id));
  }

  async function claimNext() {
    setClaimingNext(true);
    const payload: Record<string, string> = {};
    if (filters.partnerId) payload.partner_id = filters.partnerId;
    if (filters.productLine) payload.product_line = filters.productLine;
    if (filters.state) payload.state = filters.state;
    if (filters.screeningOutcome) payload.screening_outcome = filters.screeningOutcome;
    const response = await fetch("/api/app/inbound/claim-next", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    setClaimingNext(false);
    if (!response.ok) { notify.block(body?.error ?? "Could not claim the next transfer"); void load(); return; }
    const workItemId = body?.claim?.work_item_id as string | undefined;
    notify.arrive(claimedMessage(body));
    if (workItemId) router.push(callHref(workItemId));
  }

  async function accept(handoffId: string, workItemId: string) {
    setAccepting(handoffId);
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    setAccepting(null);
    if (!response.ok) { notify.block(body?.error ?? "This handoff is no longer available"); void load(); return; }
    notify.arrive("You have the call. Verification picks up where it was");
    router.push(callHref(workItemId));
  }

  const currentUserId = data?.currentUserId;
  const shown = useMemo(() => {
    const items = [...(data?.items ?? [])].sort((a, b) => groupRank(a) - groupRank(b));
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => [item.customer, item.partnerName, item.productLine, productLineLabel(item.productLine), item.state, item.ownerName ?? "", ageLabel(item.age), signalOf(item).label].some((value) => value.toLowerCase().includes(term)));
  }, [data?.items, search]);
  // Ticked transfers (2026-10-09 saved views): kept across pages; a transfer that leaves the list
  // on a realtime refresh or a filter change drops out of the selection.
  const selection = useRowSelection(shown.map((item) => item.id));

  // Team › All callers (Inbound A, 2026-10-27; was the Queue view at /app/inbound): every transfer
  // today with its filters, Today by partner and lost-transfer recovery. Agents take callers on Inbound.
  const header = (
    <div className="flex flex-col gap-3">
      <Link href="/app/inbound" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" aria-hidden="true" />Inbound</Link>
      <PageHeader
        title="Team"
        actions={<Button type="button" onClick={() => void claimNext()} disabled={readOnly || claimingNext}>{claimingNext ? "Taking…" : "Take the next caller"}</Button>}
      />
      <TeamViews current="all" />
    </div>
  );

  if (!data) {
    if (!error) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {header}
        <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Couldn’t load transfers. {error}<Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing}>Try again</Button></span>} />
      </div>
    );
  }

  const summary = data.summary ?? null;
  const sla = data.sla ?? null;
  const averageTone = !summary || !sla ? undefined : summary.averageWaitSeconds >= sla.escalateSeconds ? "danger" : summary.averageWaitSeconds >= sla.warnSeconds ? "warning" : "good";
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const popoverCount = [filters.status !== "all", filters.productLine, filters.state, filters.screeningOutcome, filters.claimedBy].filter(Boolean).length;
  const partnerName = (id: string) => options.partners.get(id) ?? data.partners.find((partner) => partner.id === id)?.name ?? "Selected partner";
  const userName = (id: string) => (id === "me" ? "Me" : options.users.get(id) ?? "Selected agent");
  const screeningName = (value: string) => SCREENING_FILTER_OPTIONS.find((option) => option.value === value)?.label ?? value;
  const chips: Array<{ label: string; clear: Partial<Filters> }> = [
    ...(filters.partnerId ? [{ label: `Partner: ${partnerName(filters.partnerId)}`, clear: { partnerId: "" } }] : []),
    ...(filters.status !== "all" ? [{ label: `Status: ${STATUS_LABEL[filters.status]}`, clear: { status: "all" as Status } }] : []),
    ...(filters.productLine ? [{ label: `Product: ${productLineLabel(filters.productLine)}`, clear: { productLine: "" } }] : []),
    ...(filters.state ? [{ label: `State: ${filters.state}`, clear: { state: "" } }] : []),
    ...(filters.screeningOutcome ? [{ label: `Screening: ${screeningName(filters.screeningOutcome)}`, clear: { screeningOutcome: "" } }] : []),
    ...(filters.claimedBy ? [{ label: `Claimed by: ${userName(filters.claimedBy)}`, clear: { claimedBy: "" } }] : []),
  ];
  const filtered = chips.length > 0 || search.trim() !== "";
  const selected = data.items.find((item) => item.id === selectedId) ?? null;
  const handoffIds = new Set(data.handoffs.map((handoff) => handoff.workItemId));
  const now = data.fetchedAt ? new Date(data.fetchedAt).getTime() : 0;
  const realtimeText = realtime === "connected" ? "Realtime · Connected" : realtime === "connecting" ? "Realtime · Connecting…" : "Realtime · Disconnected, refreshing every 10 seconds";

  // Saved views (2026-10-09 saved views): the filters and the search as one state. Built-ins are
  // what the filters can already say; "Needs review" is the DNC-hit screening result, the same
  // fact the row's "Needs review" chip shows.
  const viewState: ViewState = { status: filters.status === "all" ? "" : filters.status, partnerId: filters.partnerId, productLine: filters.productLine, state: filters.state, screeningOutcome: filters.screeningOutcome, claimedBy: filters.claimedBy, q: search.trim() };
  const builtInViews: BuiltInView[] = [
    { id: "all", name: "All transfers", state: {} },
    { id: "waiting", name: "Waiting", state: { status: "unclaimed" } },
    { id: "claimed", name: "Claimed", state: { status: "claimed" } },
    { id: "mine", name: "Claimed by me", state: { claimedBy: "me" } },
    { id: "review", name: "Needs review", state: { screeningOutcome: "dnc" }, title: "Screening result: DNC hit" },
  ];
  function applyView(state: ViewState) {
    const text = (key: string) => (typeof state[key] === "string" ? (state[key] as string) : "");
    const status = text("status");
    setFilters({ status: status === "unclaimed" || status === "claimed" ? status : "all", partnerId: text("partnerId"), productLine: text("productLine"), state: text("state"), screeningOutcome: text("screeningOutcome"), claimedBy: text("claimedBy") });
    setSearch(text("q"));
    setPage(1);
  }
  /** Export selected: the table's columns for the ticked transfers, built in the browser. */
  function exportSelected() {
    const chosen = shown.filter((item) => selection.selected.has(item.id));
    downloadCsv("transfers-selected.csv",
      ["Customer", "State", "Received", "Age", "Product", "Partner", "Screening", "Owner", "Wait"],
      chosen.map((item) => {
        const wait = waitOf(item);
        return [item.customer, item.state === "—" ? "" : item.state, item.queuedAt, ageLabel(item.age), productLineLabel(item.productLine), item.partnerName, signalOf(item).label, ownerLabel(item, currentUserId), wait === null ? "" : duration(wait)];
      }));
  }

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      {/* Views on the left, the one action on the right — the same line as the Agent Floor's. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
      <ViewTabs label="Inbound views" tabs={[{ key: "transfers", label: "Callers", count: data.items.length }, { key: "partners", label: "Today by partner", count: extras?.byPartner.length ?? 0 }]} value={tab} onChange={setTab} idPrefix="inbound-tab" controls="inbound-tabpanel" />
      </div>

      <div key={tab} id="inbound-tabpanel" role="tabpanel" aria-labelledby={`inbound-tab-${tab}`} className="flex min-w-0 flex-col gap-6">
      {tab === "partners" && <TodayByPartner extras={extras} search={partnerSearch} onSearch={(value) => { setPartnerSearch(value); setPartnerPage(1); }} page={partnerPage} onPage={setPartnerPage} onRefresh={() => void loadExtras()} canManagePartners={role === "owner"} />}

      {tab === "transfers" && <>
      <StatStrip label="Transfer queue summary">
        {/* What needs doing now (waiting, needs review), who holds the rest, and whether today's
            transfers are reaching an outcome. The wait times live on Waiting: an "average wait" card
            read "—" whenever nobody was waiting, which is most of the day. */}
        <StatTile label="Waiting" value={summary ? summary.waiting : "—"} valueTone={summary && summary.waiting ? averageTone : undefined} footnote={!summary ? "summary unavailable" : summary.waiting ? `longest ${duration(summary.longestWaitSeconds)} · avg ${duration(summary.averageWaitSeconds)}${sla ? ` · target ${target(sla.escalateSeconds)}` : ""}` : sla ? `nothing waiting · target under ${target(sla.escalateSeconds)}` : "nothing waiting"} />
        <StatTile label="Needs review" value={summary ? summary.needsReview : "—"} valueTone={summary && summary.needsReview > 0 ? "danger" : undefined} footnote="screening not clear" />
        <StatTile label="With an agent" value={summary ? summary.claimed : "—"} valueTone={summary && summary.claimedWithoutCall > 0 ? "warning" : undefined} footnote={!summary ? "summary unavailable" : summary.claimedWithoutCall ? `${summary.claimedWithoutCall} with no open call` : "all on a call"} />
        {(() => {
          const today = (extras?.byPartner ?? []).reduce((sum, partner) => ({ sent: sum.sent + partner.sent, completed: sum.completed + partner.completed }), { sent: 0, completed: 0 });
          return <StatTile label="Completed today" value={extras ? today.completed : "—"} valueTone={today.completed ? "good" : undefined} footnote={!extras ? "loading today" : today.sent ? `${Math.round((today.completed / today.sent) * 100)}% of ${today.sent} sent today` : "nothing sent today"} />;
        })()}
      </StatStrip>

      {extras && extras.lost.length > 0 && (
        <section aria-label="Lost transfers" className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-[color-mix(in_srgb,var(--error)_30%,transparent)] bg-[var(--error-surface)] px-4 py-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">
              {extras.lost.length === 1 ? "1 lead was accepted but never reached this inbox" : `${extras.lost.length} leads were accepted but never reached this inbox`}
            </h2>
            <ul className="mt-1 mb-0 list-none space-y-0.5 p-0 text-xs leading-[1.5] text-[var(--body)]">
              {extras.lost.slice(0, 5).map((lost) => (
                <li key={lost.failureId}>
                  <Link href={`/app/leads/${lost.leadId}`} className="font-semibold text-[var(--ink)] hover:underline">{lost.customer}</Link>
                  {" · "}{lost.partnerName ?? "Unknown partner"}{lost.productLine ? ` · ${productLineLabel(lost.productLine)}` : ""} · {clock(lost.failedAt)}
                  {lost.alreadyQueued ? " · already back in the queue" : ""}
                </li>
              ))}
              {extras.lost.length > 5 && <li>and {extras.lost.length - 5} more</li>}
            </ul>
          </div>
          {extras.canRecover && (
            <Button type="button" variant="destructive" disabled={readOnly || recovering} onClick={() => void recoverLost(extras.lost.map((lost) => lost.failureId))}>
              {recovering ? "Recovering…" : extras.lost.length === 1 ? "Recover it" : `Recover all ${extras.lost.length}`}
            </Button>
          )}
        </section>
      )}

      {readOnly && <Callout tone="info" title="Read-only account — claiming is off." />}
      {error && <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Try again to see the latest transfers. {error}<Button type="button" variant="outline" onClick={() => void refresh()} disabled={refreshing}>Try again</Button></span>} />}
      {data.truncated && <Callout tone="warning" title="Over 500 transfers match — narrow the filters to see the rest." />}

      {role !== "assistant" && data.handoffs.length > 0 && (
        <TableCard title="Handoffs waiting for you" action={<StatusChip dot={false} tone="action">{data.handoffs.length} {data.handoffs.length === 1 ? "handoff" : "handoffs"}</StatusChip>}>
          <ul aria-label="Handoffs waiting for you" className="m-0 list-none border-t border-[var(--border)] p-0">
            {data.handoffs.map((handoff) => (
              <li key={handoff.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
                <div className="min-w-[220px] flex-1">
                  <p className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{handoff.customer}</p>
                  <p className="m-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">From {handoff.bufferName} · {productLineLabel(handoff.productLine)} · offer expires {clock(handoff.expiresAt)}</p>
                </div>
                <div className="w-[220px]"><SettingsMeter value={handoff.progressPercentage} max={100} label="Verification" valueLabel={`${handoff.progressPercentage}% complete`} ariaLabel={`Verification ${handoff.progressPercentage}% complete`} /></div>
                <Button type="button" variant="outline" size="sm" onClick={() => void accept(handoff.id, handoff.workItemId)} disabled={readOnly || accepting === handoff.id}>{accepting === handoff.id ? "Opening…" : readOnly ? "Read-only" : "Accept handoff"}</Button>
              </li>
            ))}
          </ul>
        </TableCard>
      )}

      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-stretch">
      {/* The filters open inline under the toolbar (UI-CONSISTENCY §6a), not as a popover over the rows. */}
      <TableCard
        className="min-w-0 flex-1"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void refresh()} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search loaded transfers" />
            <select aria-label="Partner" value={filters.partnerId} onChange={(event) => change({ partnerId: event.target.value })} className={toolbarControl}>
              <option value="">All partners</option>
              {[...options.partners.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <FilterButton open={filtersOpen} controls="inbound-filters" onClick={() => setFiltersOpen((open) => !open)} count={popoverCount} />
            <SavedViews storageKey="inbound.transfers" current={viewState} builtIns={builtInViews} onApply={applyView} />
            {chips.map((chip) => <ToggleChip key={chip.label} onRemove={() => change(chip.clear)}>{chip.label}</ToggleChip>)}
            {filtered && <ClearFiltersButton onClick={clearFilters} />}
          </DataToolbar>
        }
        filters={
          <FilterPanel id="inbound-filters" open={filtersOpen}>
            <FilterField id="inbox-status" label="Show"><select id="inbox-status" className={selectFull} value={filters.status} onChange={(event) => change({ status: event.target.value as Status })}><option value="unclaimed">Waiting</option><option value="claimed">Claimed</option><option value="all">All transfers</option></select></FilterField>
            <FilterField id="inbox-product" label="Product"><select id="inbox-product" className={selectFull} value={filters.productLine} onChange={(event) => change({ productLine: event.target.value })}><option value="">All products</option>{[...options.products].sort().map((product) => <option key={product} value={product}>{productLineLabel(product)}</option>)}</select></FilterField>
            <FilterField id="inbox-state" label="State"><select id="inbox-state" className={selectFull} value={filters.state} onChange={(event) => change({ state: event.target.value })}><option value="">All states</option>{[...options.states].sort().map((value) => <option key={value} value={value}>{value}</option>)}</select></FilterField>
            <FilterField id="inbox-screening" label="Screening"><select id="inbox-screening" className={selectFull} value={filters.screeningOutcome} onChange={(event) => change({ screeningOutcome: event.target.value })}><option value="">Any result</option>{SCREENING_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FilterField>
            <FilterField id="inbox-claimed" label="Claimed by"><select id="inbox-claimed" className={selectFull} value={filters.claimedBy} onChange={(event) => change({ claimedBy: event.target.value })}><option value="">Anyone</option><option value="me">Me</option>{[...options.users.entries()].filter(([id]) => id !== currentUserId).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></FilterField>
          </FilterPanel>
        }
        footer={
          <>
            <Pager
              page={currentPage}
              total={shown.length}
              pageSize={PAGE_SIZE}
              noun="transfers"
              onPage={setPage}
              suffix={<>
                {search.trim() ? `${data.items.length} loaded · ` : ""}{data.truncated ? "first 500 · " : ""}longest wait first
                <span className="ml-3 inline-flex items-center gap-1.5" role="status">
                  <span aria-hidden className={cn("size-1.5 rounded-full", realtime === "connected" ? "bg-[var(--success)]" : realtime === "connecting" ? "bg-[var(--muted)]" : "bg-[var(--warning)]")} />
                  {realtimeText}
                </span>
              </>}
            />
          </>
        }
      >
        <BulkBar
          count={selection.count}
          noun={["transfer", "transfers"]}
          onClear={selection.clear}
          actions={<Button type="button" variant="outline" onClick={exportSelected}><Download aria-hidden="true" />Export selected</Button>}
        />
        {pageRows.length === 0 ? (
          filtered
            ? <NoMatches noun="transfers" onClear={clearFilters} />
            : <EmptyState title="No transfers yet" hint="Transfers appear here when a partner sends one." action={role === "owner" ? <Button asChild variant="outline"><Link href="/app/publishers">Open Partners</Link></Button> : undefined} />
        ) : (
          <table aria-label="Transfer inbox" className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-10")}><SelectAllCheckbox selection={selection} ids={pageRows.map((item) => item.id)} label="Select every transfer on this page" /></th>
                <th scope="col" className={st.th}>Customer</th>
                <th scope="col" className={cn(st.th, "w-[64px]")}>Age</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Product</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Partner</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Screening</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Owner</th>
                <th scope="col" className={cn(st.th, "w-[190px]")}>Wait</th>
                <th scope="col" className={cn(st.th, "w-[92px]")}><span className="sr-only">Claim</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {pageRows.map((item, index) => {
                const group = groupOf(item);
                const groupStart = index === 0 || groupOf(pageRows[index - 1]) !== group;
                const signal = signalOf(item);
                const wait = waitOf(item);
                const urgent = sla && item.status === "unclaimed" && item.waitSeconds >= sla.escalateSeconds;
                const state = rowState(item, data.rowFacts?.[item.id], handoffIds, now);
                return (
                  <Fragment key={item.id}>
                  {groupStart && (
                    <tr aria-hidden="true">
                      <td colSpan={9} className="border-t border-[var(--border)] bg-[var(--surface-alt)]/40 px-4 py-1.5 text-xs leading-[1.5] font-semibold tracking-[0.06em] uppercase text-[var(--muted)]">{GROUP_LABEL[group]}</td>
                    </tr>
                  )}
                  <tr onClick={() => setSelectedId(item.id)} className={cn("m-row cursor-pointer", selectedId === item.id ? "bg-[var(--brand-50)]" : selection.isSelected(item.id) ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]")}>
                    <td className={st.td}><RowCheckbox selection={selection} id={item.id} label={`Select ${item.customer}`} /></td>
                    <td className={st.td}>
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }} className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">{item.customer}</button>
                      <span className="block text-xs leading-[1.5] tabular-nums text-[var(--muted)]">{item.state !== "—" ? `${item.state} · ` : ""}{clock(item.queuedAt)}</span>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{ageLabel(item.age)}</td>
                    <td className={st.td}>{productLineLabel(item.productLine)}</td>
                    <td className={st.td}>{item.partnerName}</td>
                    <td className={st.td}><StatusChip tone={pillTone(PILL_TONE[signal.tone])} dot>{signal.label}</StatusChip></td>
                    <td className={cn(st.td, "whitespace-nowrap")}>
                      {ownerLabel(item, currentUserId)}
                      {state && <span className={cn("block text-xs leading-[1.5] font-semibold tabular-nums", ROW_STATE_INK[state.tone])}>{state.text}</span>}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums", urgent && "font-semibold text-[var(--error-ink)]")}>
                      {item.status === "unclaimed" && sla ? (
                        <span className="flex items-center gap-3">
                          <span className={cn("w-[64px] font-semibold", item.waitSeconds >= sla.escalateSeconds ? "text-[var(--error-ink)]" : item.waitSeconds >= sla.warnSeconds ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>{duration(item.waitSeconds)}</span>
                          <WaitBar seconds={item.waitSeconds} warnSeconds={sla.warnSeconds} escalateSeconds={sla.escalateSeconds} />
                        </span>
                      ) : wait === null ? "—" : duration(wait)}
                    </td>
                    <td className={cn(st.td, "text-right")}>
                      {item.status === "unclaimed" && <Button type="button" onClick={(event) => { event.stopPropagation(); void claim(item.id); }} size="sm" variant={index === 0 && group === "waiting" ? "default" : "outline"} disabled={readOnly || claiming === item.id}>{claiming === item.id ? "Claiming…" : "Claim"}</Button>}
                    </td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <TransferDrawer
        item={selected}
        sla={sla}
        currentUserId={currentUserId}
        isOwner={role === "owner"}
        readOnly={readOnly}
        claiming={claiming}
        onClaim={(id) => void claim(id)}
        onRelease={(item, action) => void release(item, action)}
        onClose={() => setSelectedId("")}
      />
      </div>

      </>}
      </div>
    </div>
  );
}
/**
 * Today by partner, as its own report tab: today's totals across every partner, then one row per
 * partner with what it sent and how much of it reached an outcome. Busiest partners first.
 */
function TodayByPartner({ extras, search, onSearch, page, onPage, onRefresh, canManagePartners }: { extras: Extras | null; search: string; onSearch: (value: string) => void; page: number; onPage: (page: number) => void; onRefresh: () => void; canManagePartners: boolean }) {
  const partners = extras?.byPartner ?? [];
  const term = search.trim().toLowerCase();
  const rows = [...partners]
    .filter((partner) => !term || partner.name.toLowerCase().includes(term))
    .sort((a, b) => b.sent - a.sent || b.completed - a.completed || a.name.localeCompare(b.name));
  const totals = partners.reduce((sum, partner) => ({ sent: sum.sent + partner.sent, completed: sum.completed + partner.completed, dropped: sum.dropped + partner.dropped, flagged: sum.flagged + partner.flagged }), { sent: 0, completed: 0, dropped: 0, flagged: 0 });
  const active = partners.filter((partner) => partner.sent > 0).length;
  const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
  const pages = Math.max(1, Math.ceil(rows.length / PARTNER_PAGE));
  const current = Math.min(Math.max(1, page), pages);
  const shown = rows.slice((current - 1) * PARTNER_PAGE, current * PARTNER_PAGE);
  return (
    <>
      <StatStrip label="Today's transfers by partner">
        <StatTile label="Sent today" value={totals.sent} footnote={`from ${active} of ${partners.length} ${partners.length === 1 ? "partner" : "partners"}`} />
        <StatTile label="Completed" value={totals.completed} valueTone={totals.completed ? "good" : undefined} footnote={totals.sent ? `${rate(totals.completed, totals.sent)} of sent` : "nothing sent yet"} />
        <StatTile label="Dropped" value={totals.dropped} valueTone={totals.dropped ? "warning" : undefined} footnote={totals.sent ? `${rate(totals.dropped, totals.sent)} of sent` : "nothing sent yet"} />
        <StatTile label="Flagged" value={totals.flagged} valueTone={totals.flagged ? "danger" : undefined} footnote="screening not clear" />
      </StatStrip>
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={onRefresh} />}>
            <ToolbarSearch value={search} onChange={onSearch} placeholder="Search partners" />
          </DataToolbar>
        }
        footer={<Pager page={current} total={rows.length} pageSize={PARTNER_PAGE} noun="partners" suffix="busiest first" onPage={onPage} />}
      >
        {!extras ? <SectionLoading rows={5} columns={5} label="Loading today by partner" />
          : rows.length === 0 ? (term ? <NoMatches noun="partners" onClear={() => onSearch("")} /> : <EmptyState title="No partners yet" hint="Add a partner to start receiving transfers." action={canManagePartners ? <Button asChild variant="outline"><Link href="/app/publishers">Open Partners</Link></Button> : undefined} />)
          : (
            <table className={cn(st.table, "min-w-[640px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Partner</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Sent</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Completed</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Dropped</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}><span className="inline-flex items-center justify-end gap-1">Flagged<InfoTip label="About Flagged">Screening was not clear for this transfer.</InfoTip></span></th>
                  <th scope="col" className={cn(st.th, "w-[130px] text-right")}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((partner) => (
                  <tr key={partner.partnerId} className="m-row">
                    <td className={st.td}>
                      <Link href={`/app/publishers/${partner.partnerId}`} className="font-semibold text-[var(--ink)] hover:underline">{partner.name}</Link>
                      {partner.status === "paused" && <span className="ml-2 text-xs text-[var(--warning-ink)]">paused</span>}
                    </td>
                    <td className={cn(st.td, "text-right tabular-nums")}>{partner.sent}</td>
                    <td className={cn(st.td, "text-right tabular-nums")}>{partner.completed}</td>
                    <td className={cn(st.td, "text-right tabular-nums", partner.dropped > 0 && "text-[var(--warning-ink)]")}>{partner.dropped}</td>
                    <td className={cn(st.td, "text-right tabular-nums", partner.flagged > 0 && "font-semibold text-[var(--error-ink)]")}>{partner.flagged}</td>
                    <td className={cn(st.td, "text-right tabular-nums")}>{rate(partner.completed, partner.sent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </TableCard>
    </>
  );
}

function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{label}</label>
      {children}
    </div>
  );
}

/**
 * The row's detail, as a drawer: what the old side panel held (facts, screening, preflight,
 * claimed-by) plus the SLA meter that used to sit on every row, and Claim transfer.
 */
function TransferDrawer({ item, sla, currentUserId, isOwner, readOnly, claiming, onClaim, onRelease, onClose }: { item: Item | null; sla: Sla | null; currentUserId?: string; isOwner: boolean; readOnly: boolean; claiming: string | null; onClaim: (id: string) => void; onRelease: (item: Item, action: "unassign" | "requeue") => void; onClose: () => void }) {
  const signal = item ? signalOf(item) : null;
  const wait = item ? waitOf(item) : null;
  const mine = item ? Boolean(currentUserId && item.ownerUserId === currentUserId) : false;
  const meterTone = !sla || wait === null ? "primary" : wait >= sla.escalateSeconds ? "error" : wait >= sla.warnSeconds ? "warning" : "success";
  // The ordered checks, read when a transfer is opened (lib/transferInbox/screeningLadder.ts).
  const [ladder, setLadder] = useState<{ id: string; value: Ladder | null } | null>(null);
  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!itemId) return;
    let cancelled = false;
    fetch(`/api/app/inbound/screening?work_item_id=${encodeURIComponent(itemId)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()) as Ladder : null))
      .catch(() => null)
      .then((value) => { if (!cancelled) setLadder({ id: itemId, value }); });
    return () => { cancelled = true; };
  }, [itemId]);
  const steps = ladder && ladder.id === itemId ? ladder.value : null;
  return (
    // An overlay on the right edge (DetailPanel), so the inbox table keeps its width under it.
    item && signal ? (
      <DetailPanel
        mode="split"
        splitFrom="xl"
        title={item.customer}
        subtitle={<>{productLineLabel(item.productLine)} · {item.partnerName} · {item.status === "unclaimed" ? `waiting ${duration(item.waitSeconds)}` : isWithAgent(item.status) ? "with an agent" : item.status}</>}
        onClose={onClose}
        bodyClassName="flex flex-col gap-6 px-6 py-5"
        footer={
          <div className="flex w-full flex-wrap gap-2">
            {item.status === "unclaimed" ? (
              <Button type="button" className="w-full" onClick={() => onClaim(item.id)} disabled={readOnly || claiming === item.id} title="Assigns it to you, opens verification and tells the partner.">{claiming === item.id ? "Connecting…" : readOnly ? "Read-only" : "Claim transfer"}</Button>
            ) : (
              <>
                {mine && isWithAgent(item.status) && <Button asChild><Link href={`/app/inbound/${item.id}/verification`}>Resume verification</Link></Button>}
                {item.status === "dropped" && <Button type="button" onClick={() => onRelease(item, "requeue")} disabled={readOnly || claiming === item.id}>{claiming === item.id ? "Putting back…" : "Put back in the queue"}</Button>}
                {/* The agent who has it, or the account owner (return_transfer_to_queue checks the same). */}
                {(mine || isOwner) && isWithAgent(item.status) && item.status !== "handed_pending" && <Button type="button" variant="outline" onClick={() => onRelease(item, "unassign")} disabled={readOnly || claiming === item.id}>Unassign</Button>}
                <Button asChild variant="outline"><Link href={`/app/leads/${item.leadId}`}>Open lead</Link></Button>
              </>
            )}
          </div>
        }
      >
        {wait !== null && (
          sla
            ? <SettingsMeter value={wait} max={sla.escalateSeconds} tone={meterTone} label={item.status === "unclaimed" ? "Wait against the escalation target" : "Waited before it was claimed"} valueLabel={`${duration(wait)} of ${target(sla.escalateSeconds)}`} ariaLabel={`Waited ${duration(wait)} against a ${target(sla.escalateSeconds)} target`} />
            : <p className="m-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">Waited {duration(wait)}. The SLA target could not be read.</p>
        )}

        <section>
          <h3 className={cn(label12, "m-0 mb-3")}>Customer</h3>
          <KeyValues items={[
            { label: "Name", value: item.customer },
            { label: "Age", value: ageLabel(item.age) },
            { label: "State", value: item.state },
            { label: "Product", value: productLineLabel(item.productLine) },
            { label: "Partner", value: item.partnerName },
            { label: "Received", value: clock(item.queuedAt) },
          ]} />
        </section>

        <section>
          <h3 className={cn(label12, "m-0 mb-2")}>Screening</h3>
          <StatusChip tone={pillTone(PILL_TONE[signal.tone])} dot>{signal.label}</StatusChip>
          <p className="mt-2 mb-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{screeningNote(item)}</p>
          {steps && (
            <>
              <ol aria-label="Screening checks in the order they run" className="mt-3 mb-0 list-none p-0">
                {steps.steps.map((step, index) => (
                  <li key={step.key} className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-2 text-sm leading-[1.5] first:border-t-0">
                    <span className={step.state === "match" ? "font-semibold text-[var(--error-ink)]" : step.state === "passed" ? "text-[var(--body)]" : "text-[var(--muted)]"}>{index + 1} · {step.label}</span>
                    {step.state === "match"
                      ? <StatusChip dot={false} tone="danger">Match</StatusChip>
                      : <span className="text-xs text-[var(--muted)]">{step.state === "passed" ? "Clear" : step.state === "not_reached" ? "Not reached" : "Unknown"}</span>}
                  </li>
                ))}
              </ol>
              <p className="mt-2 mb-0 text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{steps.summary}{steps.checkedAt ? ` Checked ${clock(steps.checkedAt)}.` : ""}</p>
            </>
          )}
        </section>

        <SamePersonPrompt compact check={{ ...item.preflight, status: item.preflightStatus }} duplicateFlagged={item.duplicateWarning} />

        <section>
          <h3 className={cn(label12, "m-0 mb-3")}>Claim</h3>
          <KeyValues items={[
            { label: "Claimed by", value: !item.ownerUserId && !item.ownerName ? "Unclaimed" : mine ? "You" : item.ownerName ?? "Another agent" },
            { label: "Claimed at", value: clock(item.claimedAt) },
            ...(item.phaseLabel ? [{ label: "Transfer state", value: item.phaseLabel }] : []),
          ]} />
        </section>
      </DetailPanel>
    ) : null
  );
}
