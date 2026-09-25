"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Callout, KeyValues, Pill, SearchBox, SettingsMeter, st, type PillTone } from "@/components/app/settings/primitives";
import { PageHeader } from "@/components/ui/page-header";
import { productLineLabel } from "@/lib/format/productLine";
import { sectionForPath } from "@/lib/menu/definition";
import { notify } from "@/lib/notify";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isWithAgent, SCREENING_FILTER_OPTIONS, screeningSignal, type InboxSummary, type ScreeningSignal } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  leadId: string;
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
  preflight: { matches?: Array<{ leadId: string | null; partnerName: string | null; outcome: string | null }> } | null;
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

const DEFAULT_FILTERS: Filters = { status: "unclaimed", partnerId: "", productLine: "", state: "", screeningOutcome: "", claimedBy: "" };
/** "Clear all" removes every chip, including the status one: that is All transfers. */
const CLEARED_FILTERS: Filters = { ...DEFAULT_FILTERS, status: "all" };
const STATUS_LABEL: Record<Status, string> = { unclaimed: "waiting", claimed: "claimed", all: "all" };
const PAGE_SIZE = 25;

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

const PREFLIGHT_LABEL: Record<string, string> = { new_household: "New household", spoken_before: "Spoken to before", already_customer: "Already a customer", not_checked: "Not checked" };

function screeningNote(item: Item) {
  const signal = signalOf(item);
  const previous = item.preflight?.matches?.find((match) => match.partnerName)?.partnerName;
  if (item.screeningWarning) return item.screeningWarning;
  if (signal.key === "needs_review") return "This number is on a do-not-call list. Review it before calling.";
  if (signal.key === "duplicate") return previous ? `Possible duplicate: a previous lead came from ${previous}.` : "Possible duplicate. Review the earlier record before calling.";
  if (signal.key === "clear") return "No do-not-call match.";
  return "Screening has not run for this transfer yet.";
}

/* ── local controls (board sizes: 44px header, 40px bar, 32px pager) ───── */

const BTN = "inline-flex items-center justify-center gap-2 rounded-[8px] border text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-50";
const b = {
  primary44: cn(BTN, "h-11 border-transparent bg-[var(--primary)] px-4 text-[var(--on-primary)] hover:bg-[var(--accent-hover)]"),
  secondary44: cn(BTN, "h-11 border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[var(--ink)] hover:bg-[var(--surface-alt)]"),
  bar40: cn(BTN, "h-10 border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[var(--ink)] hover:bg-[var(--surface-alt)]"),
  pager32: cn(BTN, "h-8 border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[var(--ink)] hover:bg-[var(--surface-alt)]"),
  primaryFull: cn(BTN, "h-11 w-full border-transparent bg-[var(--primary)] px-4 text-[var(--on-primary)] hover:bg-[var(--accent-hover)]"),
};
const select40 = "box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";

function Kpi({ label, value, foot, ink }: { label: string; value: ReactNode; foot: ReactNode; ink?: "warning" | "error" | "success" }) {
  const tone = ink === "warning" ? "text-[var(--warning-ink)]" : ink === "error" ? "text-[var(--error-ink)]" : ink === "success" ? "text-[var(--success-ink)]" : "text-[var(--ink)]";
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4">
      <div className={label12}>{label}</div>
      <div className={cn("text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums", tone)}>{value}</div>
      <div className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{foot}</div>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] py-1 pr-2 pl-3 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--body)]">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove filter ${label}`} className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full border-0 bg-[var(--surface-alt)] text-[var(--body)] hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}

const PILL_TONE: Record<ScreeningSignal["tone"], PillTone> = { error: "error", warning: "warning", success: "success", neutral: "neutral" };

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
  // Filter options seen so far. The server derives them from the rows it returned, so with one
  // partner chosen it would offer only that partner; keeping the union lets the agent switch
  // directly instead of going back through "All partners".
  const [options, setOptions] = useState<{ partners: Map<string, string>; products: Set<string>; states: Set<string>; users: Map<string, string> }>(() => ({ partners: new Map(), products: new Set(), states: new Set(), users: new Map() }));
  const filtersRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [recovering, setRecovering] = useState(false);

  // Lost transfers and today-by-partner change slowly; every 30 seconds, not on the one-second tick.
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

  // `inFlight` stops the one-second tick from stacking requests when a response is slower than
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
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (inFlight.current === 0 && document.visibilityState === "visible") void load(); }, 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  // "Realtime · Connected" is the channel's own status, not a promise: it says Connected only once
  // the subscription is confirmed, and says so when it drops (the one-second tick keeps going).
  useEffect(() => {
    if (!data?.realtimeTopic) return;
    const supabase = getSupabaseBrowserClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!supabase) { setRealtime("offline"); return; }
    let channel: RealtimeChannel | null = supabase.channel(data.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, () => { void load(); })
      .subscribe((status) => { setRealtime(status === "SUBSCRIBED" ? "connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED" ? "offline" : "connecting"); });
    return () => { if (channel) void supabase.removeChannel(channel); channel = null; };
  }, [data?.realtimeTopic, load]);

  // The Filters popover closes on Escape and on a click outside it.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (event: MouseEvent) => { if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) setFiltersOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [filtersOpen]);

  function change(next: Partial<Filters>) { setFilters((current) => ({ ...current, ...next })); setPage(1); }
  function resetFilters() { setFilters(DEFAULT_FILTERS); setSearch(""); setPage(1); }

  async function claim(id: string) {
    setClaiming(id);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: id }) });
    const body = await response.json().catch(() => null);
    setClaiming(null);
    if (response.status === 409) { notify.block(body?.error ?? "This transfer was already claimed"); void load(); return; }
    if (!response.ok) { notify.block(body?.error ?? "Could not claim this transfer"); return; }
    notify.arrive(body?.chatPosted === false ? "Transfer claimed; partner update could not be posted" : "Transfer claimed and call opened");
    router.push(`/app/inbound/${id}/verification`);
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
    notify.arrive(body?.chatPosted === false ? "Transfer claimed; partner update could not be posted" : "Transfer claimed and call opened");
    if (workItemId) router.push(`/app/inbound/${workItemId}/verification`);
  }

  async function accept(handoffId: string, workItemId: string) {
    setAccepting(handoffId);
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    setAccepting(null);
    if (!response.ok) { notify.block(body?.error ?? "This handoff is no longer available"); void load(); return; }
    notify.arrive("Handoff accepted; verification is ready to resume");
    router.push(`/app/inbound/${workItemId}/verification`);
  }

  const currentUserId = data?.currentUserId;
  const shown = useMemo(() => {
    const items = data?.items ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => [item.customer, item.partnerName, item.productLine, productLineLabel(item.productLine), item.state, item.ownerName ?? "", ageLabel(item.age), signalOf(item).label].some((value) => value.toLowerCase().includes(term)));
  }, [data?.items, search]);

  const header = (
    <PageHeader
      eyebrow={sectionForPath("/app/inbound") ?? undefined}
      title="Inbound transfers"
      description="Live transfers with their screening signals, longest waiting first."
      actions={
        <div className="flex gap-3">
          <button type="button" onClick={resetFilters} className={b.secondary44}>Reset filters</button>
          <button type="button" onClick={() => void claimNext()} disabled={readOnly || claimingNext} className={b.primary44}>{claimingNext ? "Claiming…" : "Claim next"}</button>
        </div>
      }
    />
  );

  if (!data) {
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        {header}
        {error
          ? <Callout tone="error" title="The transfer inbox could not be loaded">{error} <button type="button" onClick={() => void load()} className={cn(b.pager32, "ml-2")}>Try again</button></Callout>
          : <p role="status" className="m-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Loading transfer inbox…</p>}
      </div>
    );
  }

  const summary = data.summary ?? null;
  const sla = data.sla ?? null;
  const averageInk = !summary || !sla ? undefined : summary.averageWaitSeconds >= sla.escalateSeconds ? "error" : summary.averageWaitSeconds >= sla.warnSeconds ? "warning" : "success";
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageRows = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const first = shown.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const last = (currentPage - 1) * PAGE_SIZE + pageRows.length;
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
  const selected = data.items.find((item) => item.id === selectedId) ?? null;
  const handoffIds = new Set(data.handoffs.map((handoff) => handoff.workItemId));
  const now = data.fetchedAt ? new Date(data.fetchedAt).getTime() : 0;
  const realtimeText = realtime === "connected" ? "Realtime · Connected" : realtime === "connecting" ? "Realtime · Connecting…" : "Realtime · Disconnected, refreshing every second";

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      <section aria-label="Transfer queue summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Waiting" value={summary ? summary.waiting : "—"} foot={!summary ? "summary unavailable" : summary.waiting ? `longest ${duration(summary.longestWaitSeconds)}` : "nothing waiting"} />
        <Kpi label="Claimed" value={summary ? summary.claimed : "—"} ink="warning" foot={!summary ? "summary unavailable" : `${summary.claimedWithoutCall} with no open call record`} />
        <Kpi label="Needs review" value={summary ? summary.needsReview : "—"} ink={summary && summary.needsReview > 0 ? "error" : undefined} foot="screening" />
        <Kpi label="Average wait" value={summary && summary.waiting ? duration(summary.averageWaitSeconds) : "—"} ink={summary && summary.waiting ? averageInk : undefined} foot={sla ? `target under ${target(sla.escalateSeconds)}` : "SLA target unavailable"} />
      </section>

      {extras && extras.lost.length > 0 && (
        <section aria-label="Lost transfers" className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-[color-mix(in_srgb,var(--error)_30%,transparent)] bg-[var(--error-surface)] px-4 py-3.5 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--error-ink)]">
              {extras.lost.length === 1 ? "1 lead was accepted but never reached this inbox" : `${extras.lost.length} leads were accepted but never reached this inbox`}
            </h2>
            <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
              The partner was told the submission worked and the lead saved, but its place in the queue did not. These are live transfers.
            </p>
            <ul className="mt-2 mb-0 list-none space-y-1 p-0 text-[12px] leading-[1.5] text-[var(--body)]">
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
            <button type="button" disabled={readOnly || recovering} onClick={() => void recoverLost(extras.lost.map((lost) => lost.failureId))} className={cn(BTN, "h-10 shrink-0 border-transparent bg-[var(--error)] px-3.5 text-[var(--on-primary)] hover:opacity-90")}>
              {recovering ? "Recovering…" : extras.lost.length === 1 ? "Recover it" : `Recover all ${extras.lost.length}`}
            </button>
          )}
        </section>
      )}

      {readOnly && <Callout tone="info" title="Read-only access">Your account is read-only. You can review transfers, but claiming a new call is disabled.</Callout>}
      {error && <Callout tone="error" title="The latest refresh failed">{error} <button type="button" onClick={() => void load()} className={cn(b.pager32, "ml-2")}>Try again</button></Callout>}

      {role !== "assistant" && data.handoffs.length > 0 && (
        <section aria-label="Handoffs waiting for you" className="min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
            <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Handoffs waiting for you</span>
            <Pill tone="brand">{data.handoffs.length} {data.handoffs.length === 1 ? "handoff" : "handoffs"}</Pill>
          </div>
          <p className="m-0 px-4 pt-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Continue verification where a buffer assistant left off.</p>
          <ul className="m-0 list-none p-0">
            {data.handoffs.map((handoff) => (
              <li key={handoff.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] px-4 py-3.5 first:border-t-0">
                <div className="min-w-[220px] flex-1">
                  <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{handoff.customer}</p>
                  <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">From {handoff.bufferName} · {productLineLabel(handoff.productLine)} · offer expires {clock(handoff.expiresAt)}</p>
                </div>
                <div className="w-[220px]"><SettingsMeter value={handoff.progressPercentage} max={100} label="Verification" valueLabel={`${handoff.progressPercentage}% complete`} ariaLabel={`Verification ${handoff.progressPercentage}% complete`} /></div>
                <button type="button" onClick={() => void accept(handoff.id, handoff.workItemId)} disabled={readOnly || accepting === handoff.id} className={b.bar40}>{accepting === handoff.id ? "Opening…" : readOnly ? "Read-only" : "Accept handoff"}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The board's control bar: partner, search, the Filters popover (every other filter), Refresh. */}
      {/* relative z-30: the Filters popover must paint above the table below, which the entrance animation lifts into its own layer. */}
      <div className="relative z-30 flex min-w-0 flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="relative inline-flex">
          <select aria-label="Partner" value={filters.partnerId} onChange={(event) => change({ partnerId: event.target.value })} className="h-10 cursor-pointer appearance-none rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pr-9 pl-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
            <option value="">All partners</option>
            {[...options.partners.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute top-3 right-3 size-4 text-[var(--ink)]" />
        </span>
        <SearchBox value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search loaded transfers" label="Search loaded transfers" />
        <div ref={filtersRef} className="relative">
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} aria-haspopup="dialog" aria-expanded={filtersOpen} aria-controls="inbound-filters" className={b.bar40}>
            <SlidersHorizontal aria-hidden className="size-4" />
            Filters
            {popoverCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)]">{popoverCount}</span>}
          </button>
          {filtersOpen && (
            <div id="inbound-filters" role="dialog" aria-label="Filter transfers" className="absolute top-[calc(100%+6px)] left-0 z-20 grid w-[340px] gap-3 rounded-[12px] border border-[var(--border-strong)] bg-[var(--surface)] p-4 shadow-[var(--shadow-overlay)]">
              <FilterField id="inbox-status" label="Show"><select id="inbox-status" className={select40} value={filters.status} onChange={(event) => change({ status: event.target.value as Status })}><option value="unclaimed">Waiting</option><option value="claimed">Claimed</option><option value="all">All transfers</option></select></FilterField>
              <FilterField id="inbox-product" label="Product"><select id="inbox-product" className={select40} value={filters.productLine} onChange={(event) => change({ productLine: event.target.value })}><option value="">All products</option>{[...options.products].sort().map((product) => <option key={product} value={product}>{productLineLabel(product)}</option>)}</select></FilterField>
              <FilterField id="inbox-state" label="State"><select id="inbox-state" className={select40} value={filters.state} onChange={(event) => change({ state: event.target.value })}><option value="">All states</option>{[...options.states].sort().map((value) => <option key={value} value={value}>{value}</option>)}</select></FilterField>
              <FilterField id="inbox-screening" label="Screening"><select id="inbox-screening" className={select40} value={filters.screeningOutcome} onChange={(event) => change({ screeningOutcome: event.target.value })}><option value="">Any result</option>{SCREENING_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></FilterField>
              <FilterField id="inbox-claimed" label="Claimed by"><select id="inbox-claimed" className={select40} value={filters.claimedBy} onChange={(event) => change({ claimedBy: event.target.value })}><option value="">Anyone</option><option value="me">Me</option>{[...options.users.entries()].filter(([id]) => id !== currentUserId).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></FilterField>
              <div className="flex justify-end"><button type="button" onClick={() => setFiltersOpen(false)} className={b.pager32}>Done</button></div>
            </div>
          )}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => void load()} className={b.bar40}>Refresh</button>
      </div>

      <div className="-mt-3 flex min-w-0 flex-wrap items-center gap-2">
        {chips.map((chip) => <Chip key={chip.label} label={chip.label} onRemove={() => change(chip.clear)} />)}
        {chips.length > 0 && <button type="button" onClick={() => { setFilters(CLEARED_FILTERS); setPage(1); }} className="cursor-pointer border-0 bg-transparent p-1 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:underline">Clear all</button>}
        <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{shown.length} of {data.items.length} transfers{data.truncated ? " · newest 500" : ""}</span>
      </div>

      {data.truncated && <Callout tone="warning" title="Only the newest 500 transfers are loaded">Older transfers that match these filters are not shown. Narrow the filters to see them.</Callout>}

      <section aria-label="Transfer inbox" className="flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Customer</th>
                <th scope="col" className={cn(st.th, "w-[64px]")}>Age</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Product</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Partner</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Screening</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Owner</th>
                <th scope="col" className={cn(st.th, "w-[90px]")}>Wait</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {pageRows.length === 0 ? (
                <tr><td colSpan={7} className={cn(st.td, "py-6 text-center text-[var(--muted)]")}>{data.items.length === 0 ? "No transfers match these filters." : "No loaded transfer matches that search."}</td></tr>
              ) : pageRows.map((item) => {
                const signal = signalOf(item);
                const wait = waitOf(item);
                const urgent = sla && item.status === "unclaimed" && item.waitSeconds >= sla.escalateSeconds;
                const state = rowState(item, data.rowFacts?.[item.id], handoffIds, now);
                return (
                  <tr key={item.id} onClick={() => setSelectedId(item.id)} className={cn("m-row cursor-pointer", selectedId === item.id ? "bg-[var(--brand-50)]" : "hover:bg-[var(--surface-alt)]")}>
                    <td className={st.td}>
                      <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(item.id); }} className="cursor-pointer border-0 bg-transparent p-0 text-left text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">{item.customer}</button>
                      <span className="block text-[12px] leading-[1.5] tabular-nums text-[var(--muted)]">{item.state !== "—" ? `${item.state} · ` : ""}{clock(item.queuedAt)}</span>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{ageLabel(item.age)}</td>
                    <td className={st.td}>{productLineLabel(item.productLine)}</td>
                    <td className={st.td}>{item.partnerName}</td>
                    <td className={st.td}><Pill tone={PILL_TONE[signal.tone]} dot>{signal.label}</Pill></td>
                    <td className={cn(st.td, "whitespace-nowrap")}>
                      {ownerLabel(item, currentUserId)}
                      {state && <span className={cn("block text-[12px] leading-[1.5] font-semibold tabular-nums", ROW_STATE_INK[state.tone])}>{state.text}</span>}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums", urgent && "font-semibold text-[var(--error-ink)]")}>{wait === null ? "—" : duration(wait)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3">
          <span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            Showing {first}–{last} of {shown.length} transfers · longest wait first
            <span className="ml-3 inline-flex items-center gap-1.5" role="status">
              <span aria-hidden className={cn("size-1.5 rounded-full", realtime === "connected" ? "bg-[var(--success)]" : realtime === "connecting" ? "bg-[var(--muted)]" : "bg-[var(--warning)]")} />
              {realtimeText}
            </span>
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} className={b.pager32}>Previous</button>
            <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pages} className={b.pager32}>Next</button>
          </span>
        </div>
      </section>

      {extras && extras.byPartner.length > 0 && (
        <section aria-labelledby="inbox-by-partner" className="relative min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3">
            <h2 id="inbox-by-partner" className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">Today by partner</h2>
            <span className="text-[12px] leading-[1.5] text-[var(--muted)]">flagged = screening was not clear</span>
          </div>
          <div className="overflow-x-auto">
            <table className={cn(st.table, "min-w-[520px]")}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Partner</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Sent</th>
                  <th scope="col" className={cn(st.th, "w-[110px] text-right")}>Completed</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Dropped</th>
                  <th scope="col" className={cn(st.th, "w-[90px] text-right")}>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {extras.byPartner.map((partner) => (
                  <tr key={partner.partnerId}>
                    <td className={st.td}>{partner.name}{partner.status === "paused" && <span className="ml-2 text-[12px] text-[var(--warning-ink)]">paused</span>}</td>
                    <td className={cn(st.td, "text-right tabular-nums")}>{partner.sent}</td>
                    <td className={cn(st.td, "text-right tabular-nums")}>{partner.completed}</td>
                    <td className={cn(st.td, "text-right tabular-nums", partner.dropped > 0 && "text-[var(--warning-ink)]")}>{partner.dropped}</td>
                    <td className={cn(st.td, "text-right tabular-nums", partner.flagged > 0 && "font-semibold text-[var(--error-ink)]")}>{partner.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <TransferDrawer
        item={selected}
        sla={sla}
        currentUserId={currentUserId}
        readOnly={readOnly}
        claiming={claiming}
        onClaim={(id) => void claim(id)}
        onClose={() => setSelectedId("")}
      />
    </div>
  );
}

function FilterField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">{label}</label>
      {children}
    </div>
  );
}

/**
 * The row's detail, as a drawer: what the old side panel held (facts, screening, preflight,
 * claimed-by) plus the SLA meter that used to sit on every row, and Claim transfer.
 */
function TransferDrawer({ item, sla, currentUserId, readOnly, claiming, onClaim, onClose }: { item: Item | null; sla: Sla | null; currentUserId?: string; readOnly: boolean; claiming: string | null; onClaim: (id: string) => void; onClose: () => void }) {
  const open = item !== null;
  const signal = item ? signalOf(item) : null;
  const wait = item ? waitOf(item) : null;
  const mine = item ? Boolean(currentUserId && item.ownerUserId === currentUserId) : false;
  const meterTone = !sla || wait === null ? "primary" : wait >= sla.escalateSeconds ? "error" : wait >= sla.warnSeconds ? "warning" : "success";
  const previous = item?.preflight?.matches?.find((match) => match.partnerName)?.partnerName;
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
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <DialogPrimitive.Content className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[440px] flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-overlay)] focus:outline-none">
          {item && signal && (
            <>
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
                <div className="min-w-0">
                  <DialogPrimitive.Title className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{item.customer}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
                    {productLineLabel(item.productLine)} · {item.partnerName} · {item.status === "unclaimed" ? `waiting ${duration(item.waitSeconds)}` : isWithAgent(item.status) ? "with an agent" : item.status}
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close asChild>
                  <button type="button" aria-label="Close transfer details" className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-[var(--muted)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]"><X aria-hidden className="size-4" /></button>
                </DialogPrimitive.Close>
              </div>

              <div className="flex flex-col gap-6 px-6 py-5">
                {wait !== null && (
                  sla
                    ? <SettingsMeter value={wait} max={sla.escalateSeconds} tone={meterTone} label={item.status === "unclaimed" ? "Wait against the escalation target" : "Waited before it was claimed"} valueLabel={`${duration(wait)} of ${target(sla.escalateSeconds)}`} ariaLabel={`Waited ${duration(wait)} against a ${target(sla.escalateSeconds)} target`} />
                    : <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">Waited {duration(wait)}. The SLA target could not be read.</p>
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
                  <Pill tone={PILL_TONE[signal.tone]} dot>{signal.label}</Pill>
                  <p className="mt-2 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{screeningNote(item)}</p>
                  {steps && (
                    <>
                      <ol aria-label="Screening checks in the order they run" className="mt-3 mb-0 list-none p-0">
                        {steps.steps.map((step, index) => (
                          <li key={step.key} className="flex items-center justify-between gap-3 border-t border-[var(--border)] py-2 text-[14px] leading-[1.5] first:border-t-0">
                            <span className={step.state === "match" ? "font-semibold text-[var(--error-ink)]" : step.state === "passed" ? "text-[var(--body)]" : "text-[var(--muted)]"}>{index + 1} · {step.label}</span>
                            {step.state === "match"
                              ? <Pill tone="error">Match</Pill>
                              : <span className="text-[12px] text-[var(--muted)]">{step.state === "passed" ? "Clear" : step.state === "not_reached" ? "Not reached" : "Unknown"}</span>}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{steps.summary}{steps.checkedAt ? ` Checked ${clock(steps.checkedAt)}.` : ""}</p>
                    </>
                  )}
                </section>

                <section>
                  <h3 className={cn(label12, "m-0 mb-2")}>Existing-customer preflight</h3>
                  <p className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{PREFLIGHT_LABEL[item.preflightStatus] ?? item.preflightStatus.replaceAll("_", " ")}</p>
                  {previous && <p className="mt-1 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">Previous lead from {previous}</p>}
                </section>

                <section>
                  <h3 className={cn(label12, "m-0 mb-3")}>Claim</h3>
                  <KeyValues items={[
                    { label: "Claimed by", value: !item.ownerUserId && !item.ownerName ? "Unclaimed" : mine ? "You" : item.ownerName ?? "Another agent" },
                    { label: "Claimed at", value: clock(item.claimedAt) },
                  ]} />
                </section>

                <div className="flex flex-col gap-3">
                  {item.status === "unclaimed" ? (
                    <button type="button" onClick={() => onClaim(item.id)} disabled={readOnly || claiming === item.id} className={b.primaryFull}>{claiming === item.id ? "Connecting…" : readOnly ? "Read-only" : "Claim transfer"}</button>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      {mine && isWithAgent(item.status) && <Link href={`/app/inbound/${item.id}/verification`} className={b.primary44}>Resume verification</Link>}
                      <Link href={`/app/leads/${item.leadId}`} className={b.secondary44}>Open lead</Link>
                    </div>
                  )}
                  <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Claiming assigns it to you, opens verification and tells the partner. Once claimed, it leaves every other agent’s inbox.</p>
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
