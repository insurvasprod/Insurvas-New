"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Check, CheckCheck, CheckCircle2, FileText, Info, Loader2, MessageCircle, PanelLeftClose, PanelLeftOpen, Paperclip, PhoneOff, Plus, Search, SendHorizontal, Users, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cardTitle, type PartnerMessage } from "@/lib/partnerChat/cards";
import { LEAD_STATE_LABEL, LEAD_STEPS, leadLanes, type LeadLane, type LeadState, type LeadStep } from "@/lib/partnerChat/leadLanes";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/format/dates";

/**
 * Partner chat: a full-height, three-pane chat under the top bar. Conversations on the left, the
 * thread in the middle (automatic updates set apart from typed messages, the composer pinned to the
 * bottom), and the conversation's details on the right, opened from the info button in the thread header.
 * Each pane scrolls on its own, and the list loads more conversations as it is scrolled.
 *
 * Everything the page did before still works — search, unread counts, new direct and team
 * conversations, attachments, realtime refresh and read receipts — plus Archive / Restore for
 * direct and team channels. A partner channel is never archived here: it is where the automatic
 * lead updates land, and the server refuses to post into an archived one.
 */

type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string; othersReadAt: string | null };
type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; partnerId?: string; partnerName?: string; role?: string };
type ChatResponse = { channels: Array<{ channel: Channel; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string; othersReadAt?: string | null }>; directory: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; partner_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> }; partnerFacts?: PartnerFacts[]; viewerId?: string };
type PartnerFacts = { partnerId: string; status: string; transfersToday: number; completedToday: number; droppedToday: number; payout: string | null };

function normalize(data: ChatResponse): { channels: Channel[]; directory: DirectoryUser[]; facts: Record<string, PartnerFacts> } {
  const channels = data.channels.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic, othersReadAt: item.othersReadAt ?? null }));
  const tenantUsers = data.directory.tenantUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.users.email}`, scope: "agent" as const, role: item.role }));
  const partnerUsers = data.directory.partnerUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.partners.name}`, scope: "partner" as const, partnerId: item.partner_id, partnerName: item.partners.name, role: item.role }));
  const facts = Object.fromEntries((data.partnerFacts ?? []).map((item) => [item.partnerId, item]));
  return { channels, facts, directory: [...tenantUsers, ...partnerUsers].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) };
}

function initials(name: string) { return name.split(/\s+/).filter((part) => /^[\p{L}\p{N}]/u.test(part)).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "?").join(""); }
function channelType(channel: Channel) { return channel.channel_type === "partner" ? "Partner" : channel.channel_type === "direct" ? "Direct message" : "Team channel"; }
/** The line under a partner channel: today's transfers and how they ended, or that the partner is paused. */
function factsLine(facts: PartnerFacts | undefined) {
  if (!facts) return null;
  if (facts.status === "paused") return facts.transfersToday ? `Paused · ${facts.transfersToday} today before the pause` : "Paused · no transfers";
  if (facts.status === "offboarded") return "Offboarded · history kept";
  return `${facts.transfersToday} today · ${facts.completedToday} completed · ${facts.droppedToday} dropped`;
}
function channelPreview(channel: Channel) { const last = channel.messages.at(-1); return last ? (last.messageKind === "system_card" ? cardTitle(last) : last.message) : "No messages yet"; }
/** "14:12" today, "Yesterday", else "23 Sep". */
function listTime(value: string) {
  const at = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
}
const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** "Today", "Yesterday", else "Wed 23 Sep" — the divider between days in a thread. */
function dayLabel(value: string) {
  const at = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return "Today";
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return `${at.toLocaleDateString([], { weekday: "short" })} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** A round face: initials, or an icon for a team channel. Partners get the brand tint. */
function Face({ name, kind = "person", scale = "md" }: { name: string; kind?: "person" | "partner" | "group"; scale?: "sm" | "md" | "lg" }) {
  return (
    <span aria-hidden="true" className={cn(
      "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
      scale === "sm" ? "size-7 text-xs" : scale === "lg" ? "size-12 text-base" : "size-8 text-xs",
      kind === "partner" ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]",
    )}>
      {kind === "group" ? <Users className={scale === "lg" ? "size-5" : "size-4"} /> : initials(name) || "?"}
    </span>
  );
}
const faceKind = (channel: Channel) => (channel.channel_type === "partner" ? "partner" : channel.channel_type === "group" ? "group" : "person");

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">{children}</div>;
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "error" }) {
  return (
    <div className="min-w-0 rounded-md bg-[var(--surface-alt)] px-2 py-1.5">
      <div className={cn("text-sm font-semibold tabular-nums", tone === "success" ? "text-[var(--success-ink)]" : tone === "error" ? "text-[var(--error-ink)]" : "text-foreground")}>{value}</div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * An automatic update: one quiet line in the thread — what happened, to whom, and when. It is a
 * record, not a message, so it has no bubble and cannot be edited.
 */
function UpdateRow({ message }: { message: PartnerMessage }) {
  const payload = message.cardPayload;
  // Read-time facts from the server (enrichCards in lib/partnerChat/service.ts); absent on some cards.
  const counts = typeof payload.counts_as_work_completed === "boolean" ? payload.counts_as_work_completed : null;
  const dropped = payload.closes_as === "dropped";
  const minutes = typeof payload.minutes_after_submission === "number" ? payload.minutes_after_submission : null;
  const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
  const client = text(payload.customer);
  const details = [text(payload.product), text(payload.disposition), text(payload.agent) && `by ${text(payload.agent)}`].filter(Boolean).join(" · ");
  const timing = minutes != null ? `${minutes === 0 ? "Under a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`} after submission` : counts != null ? (counts ? "Counts as work completed" : "Does not count as work completed") : null;
  const Icon = dropped ? PhoneOff : counts ? CheckCircle2 : Zap;
  const [open, setOpen] = useState(false);
  const extra = [details, timing].filter(Boolean).join(" · ");
  // One line; a click opens the rest (who, product, timing and the note) under it.
  return (
    <article aria-label="Automatic update">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={open ? "Hide details" : "Show details"} className="flex min-h-8 w-full items-center gap-2 rounded-lg border border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] px-2 py-1 text-left text-sm shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary)_12%,transparent)]">
        <span aria-hidden="true" className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
          dropped ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : counts ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--info-surface)] text-[var(--info-ink)]",
        )}><Icon className="size-3" /></span>
        <span className="shrink-0 font-semibold text-foreground">{dropped && message.cardType === "call_outcome" ? "Call dropped" : cardTitle(message)}</span>
        {client && <span className="shrink-0 text-[var(--body)]">{client}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{open ? "" : extra}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(message.createdAt)}</span>
      </button>
      {open && (
        <div className="mb-1 ml-8 border-l-2 border-border pl-3 text-xs text-muted-foreground">
          {extra && <p className="m-0">{extra}</p>}
          {message.message && <p className="m-0 text-sm text-[var(--body)]">{message.message}</p>}
          <p className="m-0">Automatic update · cannot be edited</p>
        </div>
      )}
    </article>
  );
}

/** Each lead's progress bar: one segment per step, coloured as the thread colours its update. */
const STEP_TONE: Record<LeadStep, string> = { new_lead: "bg-[var(--info)]", connected: "bg-[var(--primary)]", transferred: "bg-[var(--cat-2)]", outcome: "bg-[var(--primary)]" };
const STATE_TONE: Record<LeadState, string> = { waiting: "text-[var(--info-ink)]", live: "text-[var(--accent-ink)]", won: "text-[var(--success-ink)]", dropped: "text-[var(--error-ink)]", closed: "text-muted-foreground" };

/**
 * The partner's leads (owner pick B, 2026-10-27): one card per lead built from the channel's automatic
 * updates — its progress, where it is now, and on click the steps that got it there.
 */
function LeadLanesPane({ lanes, facts, name, onCollapse }: { lanes: LeadLane[]; facts: PartnerFacts | undefined; name: string; onCollapse: () => void }) {
  const today = new Date().toDateString();
  const todays = lanes.filter((lane) => new Date(lane.lastAt).toDateString() === today);
  // A quiet day opens on every lead rather than on an empty list.
  const [showAll, setShowAll] = useState(() => todays.length === 0);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = showAll ? lanes : todays;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">{name} · Leads {showAll ? "" : "today"}</h2>
          <button type="button" onClick={onCollapse} aria-label="Collapse the leads" title="Collapse" className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground"><PanelLeftClose className="size-4" aria-hidden="true" /></button>
        </div>
        {facts && (
          <p className="m-0 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span><strong className="text-base font-semibold text-foreground tabular-nums">{facts.transfersToday}</strong> transfers</span>
            <span><strong className="text-base font-semibold text-[var(--success-ink)] tabular-nums">{facts.completedToday}</strong> completed</span>
            <span><strong className="text-base font-semibold text-[var(--error-ink)] tabular-nums">{facts.droppedToday}</strong> dropped</span>
          </p>
        )}
        {lanes.length > todays.length && (
          <div className="flex gap-0.5 rounded-md bg-[var(--surface-alt)] p-0.5" role="group" aria-label="Which leads">
            {([[false, `Today · ${todays.length}`], [true, `All · ${lanes.length}`]] as const).map(([all, label]) => (
              <button key={label} type="button" aria-pressed={showAll === all} onClick={() => setShowAll(all)} className={cn("inline-flex h-7 flex-1 items-center justify-center rounded px-2 text-xs font-semibold", showAll === all ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {shown.length === 0 ? (
          <p className="m-0 px-2 py-3 text-sm text-muted-foreground">{lanes.length ? "No leads today. Earlier ones are under All." : "No leads yet. Each lead this partner sends appears here as it moves."}</p>
        ) : shown.map((lane) => {
          const open = openId === lane.workItemId;
          return (
            <article key={lane.workItemId} className={cn("rounded-xl border transition-colors", open ? "border-[color-mix(in_srgb,var(--primary)_50%,transparent)] bg-[var(--primary-soft)]" : "border-border bg-[var(--surface-alt)] hover:border-[var(--border-strong)]")}>
              <button type="button" onClick={() => setOpenId(open ? null : lane.workItemId)} aria-expanded={open} className="flex w-full flex-col gap-2 p-3 text-left">
                <span className="flex items-baseline justify-between gap-2"><strong className="truncate text-sm font-semibold text-foreground">{lane.customer ?? "Lead"}</strong><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{listTime(lane.lastAt)}</span></span>
                <span className="grid grid-cols-4 gap-1" aria-hidden="true">
                  {LEAD_STEPS.map((step) => <span key={step} className={cn("h-1.5 rounded-full", lane.reached[step] ? (step === "outcome" && lane.state === "dropped" ? "bg-[var(--error)]" : STEP_TONE[step]) : "bg-[var(--surface-alt)]")} />)}
                </span>
                <span className="flex items-baseline justify-between gap-2 text-xs"><span className={cn("font-semibold", STATE_TONE[lane.state])}>{lane.latest.cardType === "call_dropped" ? "Call dropped" : cardTitle(lane.latest)}</span><span className="text-muted-foreground">{LEAD_STATE_LABEL[lane.state]}</span></span>
              </button>
              {open && (
                <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-border px-3 py-2.5">
                  {lane.steps.map((step) => {
                    const payload = step.cardPayload;
                    const detail = [payload.product, payload.disposition, payload.agent && `by ${String(payload.agent)}`].filter((value) => typeof value === "string" && value).join(" · ");
                    return <li key={step.id} className="flex gap-2 text-xs leading-snug"><span className="w-11 shrink-0 tabular-nums text-muted-foreground">{clock(step.createdAt)}</span><span><strong className="font-semibold text-foreground">{step.cardType === "call_dropped" ? "Call dropped" : cardTitle(step)}</strong>{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}</span></li>;
                  })}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}

/** A column folded to a slim rail: its name on its side, a badge, and the way back open. */
function CollapsedRail({ label, badge, onExpand }: { label: string; badge?: number; onExpand: () => void }) {
  return (
    <button type="button" onClick={onExpand} aria-label={`Show ${label.toLowerCase()}`} title={`Show ${label.toLowerCase()}`} className="m-glass hidden min-h-0 flex-col items-center gap-3 rounded-xl border border-border py-3 text-muted-foreground hover:text-foreground md:flex">
      <PanelLeftOpen className="size-4" aria-hidden="true" />
      {badge ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-xs font-semibold text-[var(--primary-foreground)]">{badge}</span> : null}
      <span className="text-xs font-semibold tracking-[0.04em] uppercase [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}

/** Drag to resize the column on its left; the arrow keys nudge it. */
function ResizeHandle({ label, width, min, max, onWidth }: { label: string; width: number; min: number; max: number; onWidth: (width: number) => void }) {
  function start(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const from = event.clientX;
    const base = width;
    const move = (e: PointerEvent) => onWidth(Math.min(max, Math.max(min, base + e.clientX - from)));
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={start}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onWidth(Math.min(max, Math.max(min, width + (event.key === "ArrowRight" ? 16 : -16)))); } }}
      className="group absolute top-0 -right-[9px] z-10 hidden h-full w-3 cursor-col-resize items-center justify-center md:flex"
    >
      <span className="h-12 w-1 rounded-full bg-transparent transition-colors group-hover:bg-[var(--primary)] group-focus-visible:bg-[var(--primary)]" />
    </div>
  );
}

type ChatLayout = { listWidth: number; leadsWidth: number; listCollapsed: boolean; leadsCollapsed: boolean };
const DEFAULT_LAYOUT: ChatLayout = { listWidth: 290, leadsWidth: 320, listCollapsed: false, leadsCollapsed: false };
const LAYOUT_KEY = "insurvas.partnerChat.layout";

/** Conversation filters above the list. */
type ListFilter = "all" | "partner" | "direct" | "group" | "unread";
const LIST_FILTERS: Array<[ListFilter, string]> = [["all", "All"], ["unread", "Unread"], ["partner", "Partners"], ["direct", "Direct"], ["group", "Team"]];
const matchesFilter = (channel: Channel, filter: ListFilter) => filter === "all" || (filter === "unread" ? channel.unreadCount > 0 : channel.channel_type === filter);

/** Messages from one person within this many minutes share a single name line. */
const GROUP_MINUTES = 5;

/** The list shows this many conversations, and this many more each time it is scrolled to the end. */
const CONVERSATION_STEP = 20;

/** Active conversations first, newest message first; a conversation with no messages sorts after any with one. */
function byActivity(channels: Channel[]) {
  const lastAt = (channel: Channel) => { const last = channel.messages.at(-1); return last ? new Date(last.createdAt).getTime() : 0; };
  return [...channels].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || lastAt(b) - lastAt(a) || a.name.localeCompare(b.name));
}

/**
 * `partnerId`: only that partner's channels. `openPartnerId`: every conversation, opened on that
 * partner's latest one (the partner record's Message button, 2026-10-25).
 */
export function AgentPartnerChatWorkspace({ partnerId, openPartnerId, recordLinks = false }: { partnerId?: string; openPartnerId?: string; recordLinks?: boolean } = {}) {
  const [data, setData] = useState<{ channels: Channel[]; directory: DirectoryUser[]; facts: Record<string, PartnerFacts> }>({ channels: [], directory: [], facts: {} });
  const [loaded, setLoaded] = useState(false);
  // The signed-in person, from the server: their own messages sit on the right of the thread.
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [newType, setNewType] = useState<"direct" | "group">("direct");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  // The thread can show everything, only typed messages, or only the automatic updates.
  const [threadView, setThreadView] = useState<"all" | "messages" | "updates">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/partner-chat", { cache: "no-store" });
    const body = await response.json().catch(() => null) as ChatResponse | { error?: string } | null;
    if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load partner chat");
    const all = normalize(body as ChatResponse);
    const next = partnerId ? { ...all, channels: all.channels.filter((channel) => channel.partner_id === partnerId) } : all;
    setData(next); setViewerId((body as ChatResponse).viewerId ?? null); setLoaded(true);
    // Open on the conversation with the latest activity, not whichever happens to sort first: an empty
    // channel on top made the whole screen look blank.
    setSelectedId((current) => current && next.channels.some((channel) => channel.id === current) ? current : byActivity(openPartnerId ? next.channels.filter((channel) => channel.partner_id === openPartnerId) : [])[0]?.id ?? byActivity(next.channels)[0]?.id ?? null);
    return next;
  }, [partnerId, openPartnerId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((reason: unknown) => { setLoaded(true); setError(reason instanceof Error ? reason.message : "Could not load partner chat"); }); }, 0); return () => window.clearTimeout(timer); }, [load]);
  // Give attachment-only messages a valid, editable message body so the shared API can persist them.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (files.length > 0 && !draft.trim()) setDraft(files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`); }, [files.length, draft]);
  // Live: a broadcast on the selected channel reloads it, and opening a channel marks it read.
  useEffect(() => { const selected = data.channels.find((channel) => channel.id === selectedId); if (!selected) return; const supabase = getSupabaseBrowserClient(); let channel: RealtimeChannel | null = null; if (supabase) channel = supabase.channel(selected.realtimeTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe(); void fetch("/api/app/partner-chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: selected.id }) }); return () => { if (channel && supabase) void supabase.removeChannel(channel); }; }, [data.channels, load, selectedId]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const messageCount = selected?.messages.length ?? 0;
  // A thread opens at its newest message, and follows new ones as they arrive.
  useEffect(() => { const node = threadRef.current; if (node) node.scrollTop = node.scrollHeight; }, [selectedId, messageCount, newConversationOpen, threadView]);
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const filteredChannels = useMemo(() => { const query = conversationSearch.trim().toLowerCase(); return byActivity(data.channels).filter((channel) => matchesFilter(channel, listFilter) && (!query || `${channel.name} ${channelPreview(channel)}`.toLowerCase().includes(query))); }, [conversationSearch, data.channels, listFilter]);
  const [visibleCount, setVisibleCount] = useState(CONVERSATION_STEP);
  const visibleChannels = filteredChannels.slice(0, visibleCount);
  const moreToShow = filteredChannels.length > visibleCount;
  // Scrolling near the end of the list loads the next conversations; a list too short to scroll
  // keeps filling until it does. The short pause lets the loading row be seen.
  const [listNode, setListNode] = useState<HTMLDivElement | null>(null);
  const loadTimer = useRef(0);
  const loadMoreNearEnd = useCallback((node: HTMLDivElement) => {
    if (!moreToShow || loadTimer.current || node.scrollHeight - node.scrollTop - node.clientHeight > 120) return;
    loadTimer.current = window.setTimeout(() => { loadTimer.current = 0; setVisibleCount((count) => count + CONVERSATION_STEP); }, 250);
  }, [moreToShow]);
  useEffect(() => { if (listNode) loadMoreNearEnd(listNode); }, [listNode, loadMoreNearEnd, visibleCount]);
  useEffect(() => () => window.clearTimeout(loadTimer.current), []);
  const resetList = () => { setVisibleCount(CONVERSATION_STEP); listNode?.scrollTo({ top: 0 }); };
  const updateCount = selected?.messages.filter((item) => item.messageKind === "system_card").length ?? 0;
  const shownMessages = (selected?.messages ?? []).filter((item) => threadView === "all" || (threadView === "updates") === (item.messageKind === "system_card"));
  // The details pane is closed until asked for: the thread gets the room.
  // Esc closes it: DetailPanel's own handler (2026-10-09 detail panel).
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Owner pick B (2026-10-27): the conversations and the partner's leads each fold to a rail, and each
  // column's width can be dragged. Kept per browser; a blocked storage just starts from the defaults.
  const [layout, setLayout] = useState<ChatLayout>(DEFAULT_LAYOUT);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const saved = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<ChatLayout> | null; if (saved) setLayout((current) => ({ ...current, ...saved })); } catch { /* defaults */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const updateLayout = (patch: Partial<ChatLayout>) => setLayout((current) => {
    const next = { ...current, ...patch };
    try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  const lanes = selected?.channel_type === "partner" ? leadLanes(selected.messages) : [];
  const showLeads = selected?.channel_type === "partner";
  const unreadTotal = data.channels.reduce((sum, channel) => sum + channel.unreadCount, 0);
  const columns = [
    layout.listCollapsed ? "52px" : `${layout.listWidth}px`,
    ...(showLeads ? [layout.leadsCollapsed ? "52px" : `${layout.leadsWidth}px`] : []),
    "minmax(0,1fr)",
  ].join(" ");
  // From xl the details are a column of their own; narrower, they open over the thread.
  const columnsXl = detailsOpen && selected ? `${columns} 300px` : columns;
  const selectedUsers = useMemo(() => data.directory.filter((user) => recipientIds.includes(user.id)), [data.directory, recipientIds]);
  // Mirrors the server rule: one agency channel may hold people from one partner at most.
  const mixedPartners = new Set(selectedUsers.filter((user) => user.scope === "partner").map((user) => user.partnerId)).size > 1;
  const selectedFacts = selected?.channel_type === "partner" && selected.partner_id ? data.facts[selected.partner_id] : undefined;
  const partnerMembers = selected?.partner_id ? data.directory.filter((user) => user.partnerId === selected.partner_id) : [];
  const sharedAttachments = selected?.messages.flatMap((item) => item.attachments) ?? [];
  const linkedLeads = new Set(selected?.messages.map((item) => item.workItemId).filter(Boolean)).size;
  const archived = selected?.status !== "active";
  const author = (id: string | null) => (id ? data.directory.find((user) => user.id === id) : undefined);

  async function createChannel() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/app/partner-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_channel", channel_type: newType, name: channelName, user_ids: recipientIds }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not create chat channel"); setChannelName(""); setRecipientIds([]); setNewConversationOpen(false); notify.done(newType === "direct" ? "Direct message ready" : "Team channel created"); await load(); setSelectedId(body.channel.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create chat channel"); } finally { setBusy(false); }
  }
  async function send() {
    if (!selected || (!draft.trim() && files.length === 0)) return; setBusy(true); setError(null);
    try { const form = new FormData(); form.set("channel_id", selected.id); form.set("message", draft.trim() || (files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`)); files.forEach((file) => form.append("files", file)); const response = await fetch("/api/app/partner-chat", { method: "POST", body: form }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Message could not be sent"); setDraft(""); setFiles([]); notify.done("Message sent"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be sent"); } finally { setBusy(false); }
  }
  async function setArchived(next: boolean) {
    if (!selected) return; setBusy(true); setError(null);
    try { const response = await fetch("/api/app/partner-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: next ? "archive_channel" : "restore_channel", channel_id: selected.id }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not change the channel"); notify.done(next ? "Channel archived" : "Channel restored"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change the channel"); } finally { setBusy(false); }
  }

  const field = cn(toolbarControl, "w-full");
  const filterCount = (filter: ListFilter) => data.channels.filter((channel) => matchesFilter(channel, filter)).length;

  return (
    /* The chat fills the viewport under the top bar and the page itself never scrolls: each pane
       scrolls on its own. The heights subtract the shell's padding (sm:p-6, lg:pt-6 lg:pb-8). Below
       md the shell's own menu header stacks over the bar, so the page scrolls and the panes get
       fixed heights instead. */
    <div className="m-stagger flex min-w-0 flex-col gap-4 md:h-[calc(100dvh-var(--top-bar-h)-48px)] lg:h-[calc(100dvh-var(--top-bar-h)-56px)]">
      <PageHeader
        title="Partner chat"
        actions={<Button type="button" onClick={() => setNewConversationOpen(true)}><Plus aria-hidden="true" />New conversation</Button>}
      />
      {error && <p role="alert" className="m-0 rounded-md border border-[var(--error)]/40 bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* Columns: conversations, the partner's leads (partner channels only), the thread, then details from xl.
          Widths come from the layout, so the grid template is set inline from md up. */}
      <div className="relative grid min-h-0 flex-1 gap-3.5 md:[grid-template-columns:var(--chat-cols)] xl:[grid-template-columns:var(--chat-cols-xl)]" style={{ "--chat-cols": columns, "--chat-cols-xl": columnsXl } as React.CSSProperties}>
        {/* Conversations */}
        {layout.listCollapsed ? <CollapsedRail label="Conversations" badge={unreadTotal} onExpand={() => updateLayout({ listCollapsed: false })} /> : (
        <section className="m-glass relative rounded-xl border border-border flex max-h-80 min-h-0 min-w-0 flex-col md:max-h-none" aria-label="Conversations">
          <ResizeHandle label="conversations" width={layout.listWidth} min={220} max={440} onWidth={(listWidth) => updateLayout({ listWidth })} />
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-3 pt-3 pb-2.5">
            <div className="flex items-center gap-2">
              <h2 className="m-0 flex-1 text-xs font-semibold tracking-[0.04em] text-muted-foreground uppercase">Conversations</h2>
              <button type="button" onClick={() => updateLayout({ listCollapsed: true })} aria-label="Collapse the conversations" title="Collapse" className="hidden size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground md:inline-flex"><PanelLeftClose className="size-4" aria-hidden="true" /></button>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search conversations</span>
              <input type="search" value={conversationSearch} onChange={(event) => { setConversationSearch(event.target.value); resetList(); }} placeholder="Search conversations" className={cn(toolbarControl, "w-full pl-9")} />
            </label>
            <div className="flex gap-0.5 rounded-md bg-[var(--surface-alt)] p-0.5" role="group" aria-label="Show conversations">
              {LIST_FILTERS.map(([value, label]) => {
                const count = filterCount(value);
                if (value !== "all" && count === 0) return null;
                const on = listFilter === value;
                return (
                  <button key={value} type="button" aria-pressed={on} aria-label={`${label}: ${count}`} title={`${label} · ${count} ${count === 1 ? "conversation" : "conversations"}`} onClick={() => { setListFilter(value); resetList(); }} className={cn("inline-flex h-7 min-w-0 flex-1 items-center justify-center rounded px-1 text-xs font-semibold transition-colors", on ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div ref={setListNode} onScroll={(event) => loadMoreNearEnd(event.currentTarget)} className="min-h-0 flex-1 overflow-y-auto p-1">
            {!loaded ? <SectionLoading rows={6} columns={2} label="Loading conversations" /> : filteredChannels.length === 0 ? (data.channels.length
              ? <NoMatches noun="conversations" onClear={() => { setConversationSearch(""); setListFilter("all"); resetList(); }} />
              : <EmptyState title="No conversations yet" hint="Message a partner or your team." action={<Button type="button" variant="outline" onClick={() => setNewConversationOpen(true)}><Plus aria-hidden="true" />New conversation</Button>} />) : visibleChannels.map((channel) => {
              const active = channel.id === selectedId;
              const last = channel.messages.at(-1);
              const unread = channel.unreadCount > 0;
              return (
                <button type="button" key={channel.id} onClick={() => { setSelectedId(channel.id); setNewConversationOpen(false); }} aria-current={active ? "true" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors", active ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]", channel.status !== "active" && "opacity-70")}>
                  <Face name={channel.name} kind={faceKind(channel)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>{channel.name}</span>
                      <span className={cn("shrink-0 text-xs tabular-nums", unread ? "font-semibold text-[var(--accent-ink)]" : "text-muted-foreground")}>{last ? listTime(last.createdAt) : ""}</span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", unread ? "text-[var(--body)]" : "text-muted-foreground")}>{channel.status === "active" ? "" : "Archived · "}{channelPreview(channel)}</span>
                      {unread && <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-xs font-semibold leading-none text-[var(--primary-foreground)]" aria-label={`${channel.unreadCount} unread`}>{channel.unreadCount}</span>}
                    </span>
                  </span>
                </button>
              );
            })}
            {loaded && moreToShow && (
              <div role="status" className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />Loading more conversations…
              </div>
            )}
            {loaded && !moreToShow && filteredChannels.length > CONVERSATION_STEP && (
              <p className="m-0 py-3 text-center text-xs text-muted-foreground">All {filteredChannels.length} conversations shown</p>
            )}
          </div>
        </section>
        )}

        {/* The partner's leads: a partner channel only (direct and team conversations carry no lead updates). */}
        {showLeads && selected && (layout.leadsCollapsed
          ? <CollapsedRail label="Leads" badge={lanes.filter((lane) => lane.state === "waiting" || lane.state === "live").length} onExpand={() => updateLayout({ leadsCollapsed: false })} />
          : (
            <section className="m-glass relative rounded-xl border border-border flex max-h-96 min-h-0 min-w-0 flex-col md:max-h-none" aria-label="Leads">
              <ResizeHandle label="leads" width={layout.leadsWidth} min={240} max={480} onWidth={(leadsWidth) => updateLayout({ leadsWidth })} />
              <LeadLanesPane key={selected.id} lanes={lanes} facts={selectedFacts} name={selected.name} onCollapse={() => updateLayout({ leadsCollapsed: true })} />
            </section>
          ))}

        {/* Thread: the messages scroll, the composer stays at the bottom of the pane. */}
        <section className="m-glass rounded-xl border border-border flex h-[70dvh] min-h-0 min-w-0 flex-col overflow-hidden md:h-auto" aria-label="Selected conversation">
          {newConversationOpen ? (
            <>
              <div className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold">New conversation</h2>
                <button type="button" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Conversation type<select value={newType} onChange={(event) => setNewType(event.target.value as "direct" | "group")} className={cn(field, "mt-1.5 font-normal")}><option value="direct">Direct message</option><option value="group">Team channel</option></select></label>
                  <label className="text-sm font-semibold">Channel name <span className="font-normal text-muted-foreground">optional</span><input maxLength={160} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder={newType === "direct" ? "Direct message" : "e.g. Morning transfers"} className={cn(field, "mt-1.5 font-normal")} /></label>
                </div>
                <label className="text-sm font-semibold">{newType === "direct" ? "Recipient" : "Participants"}
                  <select multiple value={recipientIds} onChange={(event) => setRecipientIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="mt-1.5 min-h-40 w-full rounded-md border border-input bg-background p-2 text-sm font-normal">
                    {data.directory.map((user) => <option value={user.id} key={user.id}>{user.label}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">{selectedUsers.length ? selectedUsers.map((user) => user.name).join(", ") : "Choose at least one person"}</span>
                </label>
                {mixedPartners && <p role="alert" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">Start a separate conversation for each partner — these people belong to different ones.</p>}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setNewConversationOpen(false)}>Cancel</Button>
                  <Button type="button" disabled={busy || recipientIds.length === 0 || mixedPartners} onClick={() => void createChannel()}>{busy ? "Creating…" : newType === "direct" ? "Start direct message" : "Create team channel"}</Button>
                </div>
              </div>
            </>
          ) : selected ? (
            <>
              <div className="flex min-h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 py-1.5">
                <Face name={selected.name} kind={faceKind(selected)} scale="sm" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold leading-tight">{selected.name}</h2>
                  <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    <span className={cn("size-1.5 shrink-0 rounded-full", archived ? "bg-[var(--muted-foreground)]" : selectedFacts?.status === "paused" ? "bg-[var(--warning)]" : "bg-[var(--success)]")} aria-hidden="true" />
                    {[archived ? "Archived" : selectedFacts?.status === "paused" ? "Partner paused" : "Active", channelType(selected), selectedFacts?.payout].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 rounded-md bg-[var(--surface-alt)] p-0.5" role="group" aria-label="Show in this conversation">
                  {([["all", "All", selected.messages.length], ["messages", "Messages", selected.messages.length - updateCount], ["updates", "Updates", updateCount]] as const).map(([value, label, count]) => (
                    <button key={value} type="button" aria-pressed={threadView === value} onClick={() => setThreadView(value)} title={value === "updates" ? "Automatic lead and call updates" : value === "messages" ? "Messages people wrote" : "Everything"} className={cn("inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold transition-colors", threadView === value ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "text-muted-foreground hover:text-foreground")}>
                      {label}<span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
                {/* A partner channel is never archived here: the automatic lead updates land in it. */}
                {selected.channel_type !== "partner" && (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void setArchived(!archived)}>{archived ? "Restore" : "Archive"}</Button>
                )}
                <Button type="button" variant={detailsOpen ? "secondary" : "ghost"} size="icon" aria-pressed={detailsOpen} aria-controls="partner-chat-details" aria-label={detailsOpen ? "Hide conversation details" : "Show conversation details"} title="Conversation details" onClick={() => setDetailsOpen((open) => !open)}>
                  <Info aria-hidden="true" />
                </Button>
              </div>
              <div ref={threadRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-3" aria-live="polite">
                {shownMessages.length === 0 ? (
                  <div className="m-auto text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />{selected.messages.length === 0 ? "No messages yet. Send the first one." : threadView === "updates" ? "No automatic updates yet." : "Only automatic updates so far."}</div>
                ) : shownMessages.map((item, index) => {
                  const previous = shownMessages[index - 1];
                  const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
                  const divider = newDay && (
                    <div className="sticky top-0 z-10 flex justify-center pt-2 pb-1" role="separator" aria-label={dayLabel(item.createdAt)}>
                      <span className="rounded-full border border-border bg-card px-2.5 text-xs font-semibold leading-5 text-muted-foreground">{dayLabel(item.createdAt)}</span>
                    </div>
                  );
                  if (item.messageKind === "system_card") return <div key={item.id}>{divider}<UpdateRow message={item} /></div>;
                  // Consecutive messages from one person a few minutes apart share one name line.
                  const continued = !newDay && previous?.messageKind !== "system_card" && previous?.createdBy === item.createdBy
                    && new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_MINUTES * 60_000;
                  const person = author(item.createdBy);
                  const name = person?.name ?? "Team member";
                  const attachments = item.attachments.length > 0 && (
                    <div className={cn("mt-1.5 flex flex-wrap gap-2", item.createdBy === viewerId && "justify-end")}>
                      {item.attachments.map((attachment) => attachment.downloadUrl
                        ? <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs hover:bg-[var(--surface-alt)]"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate font-semibold text-foreground">{attachment.fileName}</span><span className="shrink-0 text-muted-foreground">{kb(attachment.sizeBytes)}</span></a>
                        : <span key={attachment.id} className="inline-flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"><FileText className="size-4" aria-hidden="true" />{attachment.fileName} unavailable</span>)}
                    </div>
                  );
                  // The viewer's own messages: on the right, tinted, no face — the thread reads as a conversation.
                  if (viewerId && item.createdBy === viewerId) {
                    // Delivered once stored; Read once anyone else in the conversation has opened it since.
                    // Shown under the last of a run of my messages, as one line for the run.
                    const next = shownMessages[index + 1];
                    const lastOfRun = !next || next.createdBy !== viewerId || next.messageKind === "system_card";
                    const read = Boolean(selected.othersReadAt && new Date(selected.othersReadAt).getTime() >= new Date(item.createdAt).getTime());
                    return (
                      <div key={item.id}>
                        {divider}
                        <div className={cn("group flex flex-col items-end pl-12", continued ? "mt-0.5" : "mt-2")}>
                          {!continued && <span className="mb-0.5 text-xs tabular-nums text-muted-foreground">You · {clock(item.createdAt)}</span>}
                          <div className="flex max-w-full items-end gap-2">
                            {continued && <span className="shrink-0 pb-1 text-xs tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">{clock(item.createdAt)}</span>}
                            <p className="m-0 max-w-[560px] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-[var(--primary-soft)] px-3 py-1.5 text-sm leading-normal text-foreground">{item.message}</p>
                          </div>
                          {attachments}
                          {lastOfRun && (
                            <span className={cn("mt-0.5 inline-flex items-center gap-1 text-xs", read ? "text-[var(--accent-ink)]" : "text-muted-foreground")} title={read ? `Read ${listTime(selected.othersReadAt as string)}` : "Delivered, not read yet"}>
                              {read ? <CheckCheck className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}{read ? "Read" : "Delivered"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={item.id}>
                      {divider}
                      <div className={cn("group flex gap-2.5", continued ? "mt-0.5" : "mt-2")}>
                        {continued
                          ? <span className="w-7 shrink-0 pt-0.5 text-right text-xs tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">{clock(item.createdAt)}</span>
                          : <Face name={name} kind={person?.scope === "partner" ? "partner" : "person"} scale="sm" />}
                        <div className="min-w-0 flex-1">
                          {!continued && (
                            <div className="flex items-baseline gap-2">
                              <span className="text-sm font-semibold text-foreground">{name}</span>
                              <span className="text-xs text-muted-foreground">{person?.partnerName ?? (person ? "Your team" : "")}</span>
                              <span className="text-xs tabular-nums text-muted-foreground">{clock(item.createdAt)}</span>
                            </div>
                          )}
                          <p className="m-0 max-w-[640px] whitespace-pre-wrap break-words text-sm leading-normal text-[var(--body)]">{item.message}</p>
                          {attachments}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <form className="shrink-0 px-3 pt-1 pb-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                <div className={cn("rounded-lg border border-input bg-background transition-shadow focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-soft)]", archived && "bg-[var(--surface-alt)]")}>
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
                      {files.map((file) => <span key={`${file.name}-${file.size}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--surface-alt)] px-2 py-1 text-xs"><FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="truncate">{file.name}</span><span className="text-muted-foreground">{kb(file.size)}</span><button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Remove ${file.name}`} className="text-muted-foreground hover:text-foreground"><X className="size-3" /></button></span>)}
                    </div>
                  )}
                  <div className="flex items-center gap-1 p-1">
                    <label className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground", archived && "pointer-events-none opacity-50")} title="Attach up to three files">
                      <Paperclip className="size-4" aria-hidden="true" /><span className="sr-only">Attach files</span>
                      <input className="sr-only" type="file" multiple disabled={archived} accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx" onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))} />
                    </label>
                    <input aria-label="Write a message" maxLength={2000} placeholder={archived ? "This channel is archived — restore it to write" : `Message ${selected.name}`} value={draft} disabled={archived} onChange={(event) => setDraft(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" />
                    {draft.length > 1800 && <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{draft.length}/2,000</span>}
                    <Button type="submit" size="icon" disabled={busy || archived || !draft.trim()} aria-label={busy ? "Sending" : "Send message"} title="Send"><SendHorizontal aria-hidden="true" /></Button>
                  </div>
                </div>
              </form>
            </>
          ) : loaded ? (
            <div className="m-auto p-10 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />Choose a conversation, or start a new one.</div>
          ) : (
            <SectionLoading rows={6} columns={3} label="Loading the conversation" />
          )}
        </section>

        {/* Conversation details */}
        {/* Opened from the info button in the thread header. From xl it is a third column (split);
            narrower, it opens over the thread from the right (overlay). */}
        {detailsOpen && selected && (
          <DetailPanel
            mode="split"
            splitFrom="xl"
            id="partner-chat-details"
            title="Details"
            onClose={() => setDetailsOpen(false)}
            bodyClassName="flex flex-col"
            className="xl:m-glass xl:w-auto xl:min-w-0 xl:rounded-xl xl:shadow-none"
          >
              <div className="flex items-start gap-2.5 border-b border-border px-4 py-3">
                <Face name={selected.name} kind={faceKind(selected)} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="m-0 break-words text-sm font-semibold leading-snug">{selected.name}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="rounded-full bg-[var(--surface-alt)] px-2 text-xs font-semibold leading-5 text-[var(--body)]">{channelType(selected)}</span>
                    {archived && <span className="rounded-full bg-[var(--surface-alt)] px-2 text-xs font-semibold leading-5 text-muted-foreground">Archived</span>}
                    {selectedFacts && selectedFacts.status !== "active" && <span className="rounded-full bg-[var(--warning-surface)] px-2 text-xs font-semibold leading-5 text-[var(--warning-ink)]">{factsLine(selectedFacts)}</span>}
                    {selectedFacts?.payout && <span className="text-xs text-muted-foreground">{selectedFacts.payout}</span>}
                  </div>
                  {/* The partner's own record, on its Chat tab, for someone who may open partner records (2026-10-25). */}
                  {recordLinks && !partnerId && selected.channel_type === "partner" && selected.partner_id && (
                    <Link href={`/app/publishers/${selected.partner_id}`} className="mt-1 inline-block text-xs font-semibold text-[var(--accent-ink)] hover:underline">Open the partner record</Link>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-4 p-4">
                {selectedFacts && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Today</SectionLabel>
                    <div className="grid grid-cols-3 gap-1">
                      <Tile label="Transfers" value={selectedFacts.transfersToday} />
                      <Tile label="Completed" value={selectedFacts.completedToday} tone={selectedFacts.completedToday ? "success" : undefined} />
                      <Tile label="Dropped" value={selectedFacts.droppedToday} tone={selectedFacts.droppedToday ? "error" : undefined} />
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <SectionLabel>Conversation</SectionLabel>
                  <div className="grid grid-cols-2 gap-1">
                    <Tile label="Linked leads" value={linkedLeads} />
                    <Tile label="Messages" value={selected.messages.length} />
                  </div>
                </div>
                {partnerMembers.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Partner members · {partnerMembers.length}</SectionLabel>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {partnerMembers.slice(0, 6).map((user) => (
                        <li key={user.id} className="flex items-center gap-2.5">
                          <Face name={user.name} kind="partner" scale="sm" />
                          <span className="min-w-0 flex-1 truncate text-sm">{user.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{user.role === "partner_admin" ? "Admin" : "User"}</span>
                        </li>
                      ))}
                    </ul>
                    {partnerMembers.length > 6 && <p className="m-0 text-xs text-muted-foreground">and {partnerMembers.length - 6} more</p>}
                  </div>
                )}
                {sharedAttachments.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Shared files · {sharedAttachments.length}</SectionLabel>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {sharedAttachments.slice(0, 5).map((attachment) => {
                        const body = <><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{attachment.fileName}</span><span className="shrink-0 text-xs text-muted-foreground">{kb(attachment.sizeBytes)}</span></>;
                        return (
                          <li key={attachment.id}>
                            {attachment.downloadUrl
                              ? <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-alt)]">{body}</a>
                              : <span className="flex items-center gap-2 py-1 text-sm text-muted-foreground">{body}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
          </DetailPanel>
        )}
      </div>
    </div>
  );
}
