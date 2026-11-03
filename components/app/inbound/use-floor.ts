"use client";

/**
 * The live Inbound floor, shared by Inbound (the agent's page, step 1 Take a caller) and Team
 * (/app/inbound/team, was /app/floor) since 2026-10-27. One read of /api/app/agent-floor, kept
 * current by the tenant's floor_changed broadcast (LA-1.15-2), your saved status with its
 * heartbeat, and the acts both pages share: take a caller, take over a passed call, ask the team,
 * put a call back in line or end a screener's part.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { releaseDialog } from "@/lib/transferInbox/constants";
import { notify } from "@/lib/notify";
import { confirmAction } from "@/components/ui/confirm-dialog";

export type Availability = "ready" | "on_break" | "off";

export type Lead = {
  id: string;
  leadId: string;
  customer: string;
  age: string;
  state: string;
  partnerName: string;
  productLine: string;
  screeningOutcome: string;
  screeningWarning: string | null;
  duplicateWarning: boolean;
  preflightStatus: string;
  preflight: { matches?: Array<{ partnerName: string | null }> } | null;
  queuedAt: string;
  ownerName: string | null;
  language?: string | null;
  phone?: string | null;
  /** Escalated by the unclaimed-SLA ladder; still unclaimed. */
  escalatedAt?: string | null;
  status?: string;
};

export type Call = Lead & {
  activeCallId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  startedAt: string;
  verificationPercent?: number | null;
  /** The screener (buffer) who handed this call over and is still on it. */
  buffer?: { userId: string; name: string } | null;
};

export type Member = {
  id: string;
  name: string;
  role: string;
  availability: "ready" | "on_break" | "off" | "offline" | "on_call";
  away?: boolean;
  lastSeenAt: string | null;
  statusChangedAt?: string | null;
  call?: { workItemId: string; leadId: string; customer: string; partnerName: string | null; startedAt: string } | null;
  lastCall?: { customer: string; endedAt: string } | null;
  languages?: string[];
  /** A screener still on a call they handed over. */
  supporting?: boolean;
};

export type Handoff = {
  id: string;
  workItemId: string;
  bufferName: string;
  customer: string;
  productLine: string;
  progressPercentage: number;
  expiresAt: string;
  /** Required fields the screener left outstanding; null when unknown. */
  fieldsLeft?: number | null;
};

export type Callback = {
  id: string;
  leadId: string;
  customerName: string;
  customerTime: string;
  customerTimezone: string;
  /** When it is due, in UTC; the date filter compares it with the chosen day. */
  scheduledAtUtc?: string;
  note: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
  productName?: string;
  assigneeName?: string;
};

export type FloorData = {
  waiting: Lead[];
  onCalls: Call[];
  available: Member[];
  members: Member[];
  pendingHandoffs: Handoff[];
  callbacks: Callback[];
  realtimeTopic: string;
  generatedAt: string;
  waitThresholds: { amberSeconds: number; redSeconds: number };
  /** Your saved status; the floor starts from it and never assumes "ready". */
  ownStatus?: Availability;
  closedTransfers?: { thisHour: number | null; previousHour: number | null };
  /** The floor read reached its 500-row cap; the 500 longest-waiting open transfers are shown. */
  truncated?: boolean;
};

/** The safety re-read behind realtime (LA-1.15-2): slow while Live, a little faster while the socket is down. */
const SAFETY_RESYNC_LIVE_MS = 30_000;
const SAFETY_RESYNC_OFFLINE_MS = 10_000;

/**
 * Where a taken caller opens: step 2, Transfer check (owner 2026-10-28; Verification before). The call
 * page's later steps are `?phase=verify|underwriting|finish` (the older `?step=finish` still works).
 */
export const callHref = (workItemId: string, phase?: "check" | "verify" | "underwriting" | "finish") => `/app/inbound/call/${workItemId}${phase && phase !== "check" ? `?phase=${phase}` : ""}`;

export function secondsSince(value: string, now: number) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1000)) : 0;
}

/** "45s", "2m", "1h 5m"; past two days, "40 days" (an hour count that long hides what it means). */
export function shortDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  if (minutes >= 48 * 60) return `${Math.floor(minutes / 1440)} days`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function useFloor({ readOnly, heartbeat = true }: { readOnly: boolean; heartbeat?: boolean }) {
  const router = useRouter();
  const [floor, setFloor] = useState<FloorData | null>(null);
  const floorRef = useRef<FloorData | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Null until the first read says what you saved. Nothing is sent before that, so opening or
  // reloading the page never turns you "ready" (and never posts partner "agent ready" cards).
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ initial = false }: { initial?: boolean } = {}): Promise<void> => {
    // A change that arrives while a read is out is not dropped: the read runs once more when it lands.
    if (refreshInFlightRef.current) { refreshPendingRef.current = true; return; }
    refreshInFlightRef.current = true;
    refreshPendingRef.current = false;
    if (initial || !floorRef.current) setLoading(true);
    try {
      const response = await fetch("/api/app/agent-floor", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load Inbound.");
      const next = body as FloorData;
      floorRef.current = next;
      setFloor(next);
      setAvailability((current) => current ?? next.ownStatus ?? "off");
      setLastUpdated(next.generatedAt);
      setError("");
      setLoading(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Inbound.");
      setLoading(false);
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current) { refreshPendingRef.current = false; void loadRef.current?.(); }
    }
  }, []);
  useEffect(() => { loadRef.current = load; }, [load]);
  const refresh = useCallback(async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }, [load]);

  useEffect(() => {
    // The initial server-backed snapshot intentionally synchronizes React state from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ initial: true });
  }, [load]);

  useEffect(() => {
    // LA-1.15-2: no polling. Every change to the queue, a call, a handoff, presence or a nudge
    // broadcasts floor_changed (the table triggers of 20260903130000) and the floor re-reads on it,
    // on every open page at once. The only timer left is a slow safety re-read in case a broadcast
    // is missed: every 30 seconds while Live, every 10 while the socket is down, never while the
    // tab is hidden. Coming back to the tab re-reads at once.
    const live = realtimeStatus === "subscribed";
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, live ? SAFETY_RESYNC_LIVE_MS : SAFETY_RESYNC_OFFLINE_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, realtimeStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!floor?.realtimeTopic) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { queueMicrotask(() => setRealtimeStatus("unconfigured")); return; }
    // A burst of changes (a claim touches several tables) is read once: broadcasts arriving within
    // a second share one reload instead of each refetching the whole floor (LA-1 audit).
    const BROADCAST_COALESCE_MS = 1000;
    let pending: number | null = null;
    const reloadSoon = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, BROADCAST_COALESCE_MS);
    };
    const channel = supabase.channel(floor.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, reloadSoon)
      .subscribe((status) => {
        setRealtimeStatus(status.toLowerCase());
        // Anything that changed while the socket was connecting is read once it is up.
        if (status === "SUBSCRIBED") void load();
      });
    return () => { if (pending !== null) window.clearTimeout(pending); void supabase.removeChannel(channel); };
  }, [floor?.realtimeTopic, load]);

  useEffect(() => {
    // The heartbeat re-sends your saved status, so it keeps you present without changing it.
    if (!heartbeat || readOnly || availability === null) return;
    const sendHeartbeat = () => fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presence", status: availability }) }).catch(() => undefined);
    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [availability, readOnly, heartbeat]);

  /** Take a caller: the claim is atomic; someone faster gets a plain refusal and the line re-reads. */
  async function claim(workItemId: string) {
    setSaving(workItemId);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? "Someone else took this caller first."); void load(); return; }
    notify.arrive(body?.chatPosted === false ? "Call taken; the partner update could not be posted" : "Call taken. Verification is ready");
    router.push(callHref(workItemId));
  }

  async function sendNudge(workItemId: string, target: Member | null) {
    const key = target ? `ask:${target.id}` : `nudge:${workItemId}`;
    setSaving(key);
    const response = await fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: workItemId, target_user_id: target?.id ?? null, idempotency_key: crypto.randomUUID() }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? (target ? "Could not ask them to take the caller." : "Could not ask the team.")); return; }
    const nudge = body?.nudge ?? {};
    if (nudge.alreadySent) { notify.done("That request was already sent"); return; }
    if (!nudge.delivered) {
      notify.warn(nudge.recipients === 0 && !target ? "Nobody else here can take callers" : "Recorded, but the alert could not be delivered", { detail: "Nobody was notified. Try again in a moment." });
      return;
    }
    const customer = floorRef.current?.waiting.find((item) => item.id === workItemId)?.customer ?? "the waiting caller";
    notify.done(target ? `Asked ${target.name} to take ${customer}` : `Asked ${nudge.recipients} ${nudge.recipients === 1 ? "teammate" : "teammates"}`, { detail: "It shows in their notifications for ten minutes, unless they have turned these alerts off." });
  }

  /** Take over a call a screener passed to you. */
  async function accept(handoffId: string, workItemId: string) {
    setSaving(`handoff:${handoffId}`);
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? "Could not take over this call."); return; }
    notify.arrive("You have the call. Verification picks up where it was");
    router.push(callHref(body?.handoff?.work_item_id ?? workItemId, "verify"));
  }

  async function release(call: Call, action: "unassign" | "end_buffer", acknowledgeLanguage = false) {
    // Both acts ask first (LA-1.14-9); the language cover prompt below is a second, separate question.
    if (!acknowledgeLanguage && !(await confirmAction(releaseDialog(action, { customer: call.customer, bufferName: call.buffer?.name, agentName: call.agentName })))) return;
    setSaving(`${action}:${call.id}`);
    const response = await fetch("/api/app/inbound/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, work_item_id: call.id, ...(acknowledgeLanguage ? { acknowledge_language: true } : {}) }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (response.status === 409 && body?.code === "language_cover_required" && !acknowledgeLanguage) {
      if (await confirmAction({ title: "Continue without a language match?", description: body.error, confirmLabel: "Continue", cancelLabel: "Go back", destructive: false })) void release(call, action, true);
      return;
    }
    if (!response.ok) { notify.block(body?.error ?? "Could not update this call."); return; }
    notify.done(action === "unassign" ? `${call.customer} is back in line` : `${call.buffer?.name ?? "The screener"} has left the call; ${call.agentName} keeps it`);
    void load();
  }

  const liveLabel = realtimeStatus === "subscribed" ? "Live" : realtimeStatus === "unconfigured" ? "Live paused, refreshing every 10 seconds" : "Connecting";
  const updated = lastUpdated ? `${shortDuration(secondsSince(lastUpdated, now))} ago` : "just now";

  return { floor, loading, error, now, saving, availability, setAvailability, realtimeStatus, liveLabel, updated, refreshing, load, refresh, claim, sendNudge, accept, release };
}
