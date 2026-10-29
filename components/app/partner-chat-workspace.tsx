"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Archive, ArchiveRestore, Check, CheckCheck, Info, Loader2, Lock, LockOpen, MessageCircle, Mic, MicOff, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Paperclip, Pin, PinOff, Plus, Search, SendHorizontal, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { inputControl } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { ComposerFiles, FileTypeTile, kb, MessageAttachments } from "@/components/app/partner-chat/attachments";
import { GroupMembers, PeoplePicker, PersonFace, type DirectoryUser } from "@/components/app/partner-chat/group-members";
import { LeadUpdate } from "@/components/app/partner-chat/lead-update";
import { useDictation } from "@/components/app/dialer/use-dictation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cardTitle, type PartnerMessage } from "@/lib/partnerChat/cards";
import { canManage, canPost, ROLE_HINT, ROLE_LABEL, type ChannelMember, type ChannelRole } from "@/lib/partnerChat/groupRules";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/format/dates";

/**
 * Partner chat (owner, 2026-10-28): conversations on the left, the thread taking the rest, and the
 * conversation's details on the right when asked for. The lead lanes column is gone: each lead
 * update sits in the thread as its own card and opens the lead in full.
 *
 * Kept from before: search, filters, unread counts, read and delivered marks, attachments, realtime
 * refresh, the folding and resizable list. New: each person's own pin, archive and delete; pictures
 * and files previewed in place; groups with members, roles and "can add people".
 */

type ConversationState = { pinnedAt: string | null; archivedAt: string | null; deletedAt: string | null };
type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string; othersReadAt: string | null; members: ChannelMember[]; state: ConversationState };
type ChatResponse = { channels: Array<{ channel: Channel; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string; othersReadAt?: string | null; members?: ChannelMember[]; state?: ConversationState }>; directory: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; partner_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> }; partnerFacts?: PartnerFacts[]; viewerId?: string };
type PartnerFacts = { partnerId: string; status: string; transfersToday: number; completedToday: number; droppedToday: number; payout: string | null };

const NO_STATE: ConversationState = { pinnedAt: null, archivedAt: null, deletedAt: null };

function normalize(data: ChatResponse): { channels: Channel[]; directory: DirectoryUser[]; facts: Record<string, PartnerFacts> } {
  const channels = data.channels.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic, othersReadAt: item.othersReadAt ?? null, members: item.members ?? [], state: item.state ?? NO_STATE }));
  const tenantUsers = data.directory.tenantUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.users.email}`, scope: "agent" as const, role: item.role }));
  const partnerUsers = data.directory.partnerUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.partners.name}`, scope: "partner" as const, partnerId: item.partner_id, partnerName: item.partners.name, role: item.role }));
  const facts = Object.fromEntries((data.partnerFacts ?? []).map((item) => [item.partnerId, item]));
  return { channels, facts, directory: [...tenantUsers, ...partnerUsers].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) };
}

function channelType(channel: Channel) { return channel.channel_type === "partner" ? "Partner" : channel.channel_type === "direct" ? "Direct message" : "Group"; }
/** The partner's day, shown in the details: today's transfers and how they ended, or that the partner is paused. */
function factsLine(facts: PartnerFacts | undefined) {
  if (!facts) return null;
  if (facts.status === "paused") return facts.transfersToday ? `Paused · ${facts.transfersToday} today before the pause` : "Paused · no transfers";
  if (facts.status === "offboarded") return "Offboarded · history kept";
  return `${facts.transfersToday} today · ${facts.completedToday} completed · ${facts.droppedToday} dropped`;
}
function channelPreview(channel: Channel) {
  const last = channel.messages.at(-1);
  if (!last) return "No messages yet";
  if (last.messageKind === "system_card") return `${cardTitle(last)}${typeof last.cardPayload.customer === "string" ? ` · ${last.cardPayload.customer}` : ""}`;
  return last.attachments.length && /^Shared (an|\d+) attachments?$/.test(last.message) ? `Attachment · ${last.attachments[0].fileName}` : last.message;
}
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

/** "Today", "Yesterday", else "Wed 23 Sep" — the divider between days in a thread. */
function dayLabel(value: string) {
  const at = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return "Today";
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  return `${at.toLocaleDateString([], { weekday: "short" })} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
}

/** Links in a message are links: http(s) addresses open in a new tab. */
function MessageText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g);
  return <>{parts.map((part, index) => (index % 2 === 1 ? <a key={index} href={part} target="_blank" rel="noreferrer noopener" className="break-all text-[var(--accent-ink)] underline underline-offset-2">{part}</a> : <Fragment key={index}>{part}</Fragment>))}</>;
}

/** A round face: initials, or an icon for a group. Partners get the brand tint. */
function Face({ channel, scale = "md" }: { channel: Channel; scale?: "sm" | "md" | "lg" }) {
  if (channel.channel_type !== "group") return <span className={scale === "lg" ? "[&>span]:size-12 [&>span]:text-base" : undefined}><PersonFace name={channel.name} partner={channel.channel_type === "partner"} scale={scale === "sm" ? "sm" : "md"} /></span>;
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[var(--body)]", scale === "sm" ? "size-7" : scale === "lg" ? "size-12" : "size-8")}>
      <Users className={scale === "lg" ? "size-5" : "size-4"} />
    </span>
  );
}

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

/** The list folded to a slim rail: its name on its side, the unread badge, and the way back open. */
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

type ChatLayout = { listWidth: number; listCollapsed: boolean };
const DEFAULT_LAYOUT: ChatLayout = { listWidth: 320, listCollapsed: false };
const LAYOUT_KEY = "insurvas.partnerChat.layout";

/** Conversation filters above the list. Archived holds what each person archived; every other filter leaves it out. */
type ListFilter = "all" | "partner" | "direct" | "group" | "unread" | "archived";
const LIST_FILTERS: Array<[ListFilter, string]> = [["all", "All"], ["unread", "Unread"], ["partner", "Partners"], ["direct", "Direct"], ["group", "Groups"], ["archived", "Archived"]];
const matchesFilter = (channel: Channel, filter: ListFilter) => {
  if (filter === "archived") return Boolean(channel.state.archivedAt);
  if (channel.state.archivedAt) return false;
  return filter === "all" || (filter === "unread" ? channel.unreadCount > 0 : channel.channel_type === filter);
};

/** Messages from one person within this many minutes share a single name line. */
const GROUP_MINUTES = 5;

/** The list shows this many conversations, and this many more each time it is scrolled to the end. */
const CONVERSATION_STEP = 20;

/** Pinned first (newest pin on top), then the newest activity; a closed conversation sorts after the open ones. */
function byActivity(channels: Channel[]) {
  const lastAt = (channel: Channel) => { const last = channel.messages.at(-1); return last ? new Date(last.createdAt).getTime() : 0; };
  const pinAt = (channel: Channel) => (channel.state.pinnedAt ? new Date(channel.state.pinnedAt).getTime() : 0);
  return [...channels].sort((a, b) => Number(Boolean(b.state.pinnedAt)) - Number(Boolean(a.state.pinnedAt)) || pinAt(b) - pinAt(a) || Number(a.status !== "active") - Number(b.status !== "active") || lastAt(b) - lastAt(a) || a.name.localeCompare(b.name));
}

const ROLE_CHOICES: ChannelRole[] = ["admin", "member", "viewer"];

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
  const [newRoles, setNewRoles] = useState<Record<string, ChannelRole>>({});
  const [channelName, setChannelName] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  // The thread can show everything, only typed messages, or only the automatic updates.
  const [threadView, setThreadView] = useState<"all" | "messages" | "updates">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Dictation (owner, 2026-10-28): the dialer's speech-to-text, adding what is said to the message;
  // nothing is sent until Send.
  const dictation = useDictation(useCallback((text: string) => {
    if (text) setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text));
  }, []));

  const load = useCallback(async () => {
    const response = await fetch("/api/app/partner-chat", { cache: "no-store" });
    const body = await response.json().catch(() => null) as ChatResponse | { error?: string } | null;
    if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load partner chat");
    const all = normalize(body as ChatResponse);
    const next = partnerId ? { ...all, channels: all.channels.filter((channel) => channel.partner_id === partnerId) } : all;
    setData(next); setViewerId((body as ChatResponse).viewerId ?? null); setLoaded(true);
    // Open on the conversation with the latest activity, not whichever happens to sort first: an empty
    // channel on top made the whole screen look blank. Archived conversations are not opened unasked.
    const open = next.channels.filter((channel) => !channel.state.archivedAt);
    setSelectedId((current) => current && next.channels.some((channel) => channel.id === current) ? current : byActivity(openPartnerId ? open.filter((channel) => channel.partner_id === openPartnerId) : [])[0]?.id ?? byActivity(open)[0]?.id ?? null);
    return next;
  }, [partnerId, openPartnerId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((reason: unknown) => { setLoaded(true); setError(reason instanceof Error ? reason.message : "Could not load partner chat"); }); }, 0); return () => window.clearTimeout(timer); }, [load]);
  // Live: a broadcast on the selected channel reloads it, and opening a channel marks it read.
  useEffect(() => { const selected = data.channels.find((channel) => channel.id === selectedId); if (!selected) return; const supabase = getSupabaseBrowserClient(); let channel: RealtimeChannel | null = null; if (supabase) channel = supabase.channel(selected.realtimeTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe(); void fetch("/api/app/partner-chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: selected.id }) }); return () => { if (channel && supabase) void supabase.removeChannel(channel); }; }, [data.channels, load, selectedId]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const stopDictation = dictation.stop;
  useEffect(() => () => stopDictation(), [selectedId, stopDictation]);
  const messageCount = selected?.messages.length ?? 0;
  // A thread opens at its newest message, and follows new ones as they arrive.
  useEffect(() => { const node = threadRef.current; if (node) node.scrollTop = node.scrollHeight; }, [selectedId, messageCount, newConversationOpen, threadView]);
  // The composer grows with what is written, up to about six lines.
  useEffect(() => { const node = composerRef.current; if (!node) return; node.style.height = "auto"; node.style.height = `${Math.min(node.scrollHeight, 160)}px`; }, [draft, selectedId]);
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
  // The details pane is closed until asked for: the thread gets the room. Esc closes it (DetailPanel).
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The list folds to a rail and its width can be dragged (owner, 2026-10-27). Kept per browser; a
  // blocked storage just starts from the defaults.
  const [layout, setLayout] = useState<ChatLayout>(DEFAULT_LAYOUT);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { const saved = JSON.parse(window.localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<ChatLayout> | null; if (saved) setLayout((current) => ({ ...current, ...(typeof saved.listWidth === "number" ? { listWidth: saved.listWidth } : {}), ...(typeof saved.listCollapsed === "boolean" ? { listCollapsed: saved.listCollapsed } : {}) })); } catch { /* defaults */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const updateLayout = (patch: Partial<ChatLayout>) => setLayout((current) => {
    const next = { ...current, ...patch };
    try { window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  const unreadTotal = data.channels.reduce((sum, channel) => sum + (channel.state.archivedAt ? 0 : channel.unreadCount), 0);
  const columns = [layout.listCollapsed ? "52px" : `${layout.listWidth}px`, "minmax(0,1fr)"].join(" ");
  // From xl the details are a column of their own; narrower, they open over the thread.
  const columnsXl = detailsOpen && selected ? `${columns} 320px` : columns;
  const people = useMemo(() => data.directory.filter((user) => user.id !== viewerId), [data.directory, viewerId]);
  const selectedUsers = useMemo(() => data.directory.filter((user) => recipientIds.includes(user.id)), [data.directory, recipientIds]);
  // Mirrors the server rule: one agency channel may hold people from one partner at most.
  const mixedPartners = new Set(selectedUsers.filter((user) => user.scope === "partner").map((user) => user.partnerId)).size > 1;
  const selectedFacts = selected?.channel_type === "partner" && selected.partner_id ? data.facts[selected.partner_id] : undefined;
  const partnerMembers = selected?.partner_id && selected.channel_type === "partner" ? data.directory.filter((user) => user.partnerId === selected.partner_id) : [];
  const sharedAttachments = selected?.messages.flatMap((item) => item.attachments) ?? [];
  const linkedLeads = new Set(selected?.messages.map((item) => item.workItemId).filter(Boolean)).size;
  const closed = selected?.status !== "active";
  const me = selected?.members.find((member) => member.userId === viewerId);
  // A read-only member of a group sees the thread but not the composer.
  const readOnly = selected?.channel_type === "group" && Boolean(me) && !canPost(me);
  const author = (id: string | null) => (id ? data.directory.find((user) => user.id === id) : undefined);

  function patchChannel(id: string, patch: (channel: Channel) => Channel) {
    setData((current) => ({ ...current, channels: current.channels.map((channel) => (channel.id === id ? patch(channel) : channel)) }));
  }
  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/app/partner-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => null) as { error?: string; channel?: { id: string } } | null;
    if (!response.ok) throw new Error(result?.error ?? "Something went wrong");
    return result;
  }
  /** A group change: run it, say so, and reload the conversation. False when it was refused. */
  async function groupAction(body: Record<string, unknown>, done: string) {
    try { await post(body); notify.done(done); await load(); return true; } catch (reason) { notify.block(reason instanceof Error ? reason.message : "Could not change the group"); return false; }
  }

  async function createChannel() {
    setBusy(true); setError(null);
    try {
      const body = await post({ action: "create_channel", channel_type: newType, name: channelName, user_ids: recipientIds });
      const id = body?.channel?.id as string;
      // Anyone given a role other than member gets it now; the maker is the owner.
      if (newType === "group") await Promise.all(recipientIds.filter((userId) => (newRoles[userId] ?? "member") !== "member").map((userId) => post({ action: "set_member", channel_id: id, user_id: userId, role: newRoles[userId], can_add_members: false }).catch(() => null)));
      setChannelName(""); setRecipientIds([]); setNewRoles({}); setNewConversationOpen(false);
      notify.done(newType === "direct" ? "Direct message ready" : "Group created");
      await load(); setSelectedId(id); setListFilter("all");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the conversation"); } finally { setBusy(false); }
  }
  async function send() {
    if (!selected || (!draft.trim() && files.length === 0)) return; dictation.stop(); setBusy(true); setError(null);
    try { const form = new FormData(); form.set("channel_id", selected.id); form.set("message", draft.trim() || (files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`)); files.forEach((file) => form.append("files", file)); const response = await fetch("/api/app/partner-chat", { method: "POST", body: form }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Message could not be sent"); setDraft(""); setFiles([]); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be sent"); } finally { setBusy(false); }
  }
  /** Close or reopen a conversation for everyone (a group's owner and admins). */
  async function setClosed(next: boolean) {
    if (!selected) return; setBusy(true); setError(null);
    try { await post({ action: next ? "archive_channel" : "restore_channel", channel_id: selected.id }); notify.done(next ? "Conversation closed" : "Conversation reopened"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change the conversation"); } finally { setBusy(false); }
  }
  /** This person's pin, archive or delete: shown at once, undone if the server refuses. */
  async function setState(channel: Channel, change: { pinned?: boolean; archived?: boolean; deleted?: true }) {
    if (change.deleted) {
      const ok = await confirmAction({ title: `Delete “${channel.name}”?`, description: "It leaves your list and its messages are hidden for you. Everyone else keeps it. A new message brings it back.", confirmLabel: "Delete conversation", cancelLabel: "Keep" });
      if (!ok) return;
    }
    const now = new Date().toISOString();
    const before = channel.state;
    if (change.deleted) setData((current) => ({ ...current, channels: current.channels.filter((item) => item.id !== channel.id) }));
    else patchChannel(channel.id, (item) => ({ ...item, state: { ...item.state, ...(change.pinned !== undefined ? { pinnedAt: change.pinned ? now : null } : {}), ...(change.archived !== undefined ? { archivedAt: change.archived ? now : null } : {}) } }));
    if ((change.deleted || change.archived) && selectedId === channel.id) { setSelectedId(null); setDetailsOpen(false); }
    try {
      await post({ action: "conversation_state", channel_id: channel.id, ...change });
      notify.done(change.deleted ? "Conversation deleted" : change.archived === true ? "Archived" : change.archived === false ? "Moved back to your conversations" : change.pinned ? "Pinned" : "Unpinned", change.archived === true || change.pinned !== undefined ? { action: { label: "Undo", onClick: () => { void setState({ ...channel, state: { ...before } }, change.archived === true ? { archived: false } : { pinned: !change.pinned }); } } } : undefined);
    } catch (reason) {
      notify.block(reason instanceof Error ? reason.message : "Could not change the conversation");
      await load();
    }
  }
  /** Pin, archive and delete, in the list's row menu and the thread header's. */
  const stateItems = (channel: Channel) => (
    <>
      <DropdownMenuItem onSelect={() => { void setState(channel, { pinned: !channel.state.pinnedAt }); }}>{channel.state.pinnedAt ? <><PinOff aria-hidden="true" />Unpin</> : <><Pin aria-hidden="true" />Pin to top</>}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { void setState(channel, { archived: !channel.state.archivedAt }); }}>{channel.state.archivedAt ? <><ArchiveRestore aria-hidden="true" />Unarchive</> : <><Archive aria-hidden="true" />Archive</>}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => { void setState(channel, { deleted: true }); }}><Trash2 aria-hidden="true" />Delete</DropdownMenuItem>
    </>
  );

  const filterCount = (filter: ListFilter) => data.channels.filter((channel) => matchesFilter(channel, filter)).length;
  const pinnedCount = visibleChannels.filter((channel) => channel.state.pinnedAt).length;

  return (
    /* The chat fills the viewport under the top bar and the page itself never scrolls: each pane
       scrolls on its own. The heights subtract the shell's padding (sm:p-6, lg:pt-6 lg:pb-8). Below
       md the shell's own menu header stacks over the bar, so the page scrolls and the panes get
       fixed heights instead. */
    <div className="m-stagger flex min-w-0 flex-col gap-4 md:h-[calc(100dvh-var(--top-bar-h)-48px)] lg:h-[calc(100dvh-var(--top-bar-h)-56px)]">
      <PageHeader title="Partner chat" />
      {error && <p role="alert" className="m-0 rounded-md border border-[var(--error)]/40 bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* Columns: conversations, the thread, then details from xl. Widths come from the layout. */}
      <div className="relative grid min-h-0 flex-1 gap-3.5 md:[grid-template-columns:var(--chat-cols)] xl:[grid-template-columns:var(--chat-cols-xl)]" style={{ "--chat-cols": columns, "--chat-cols-xl": columnsXl } as React.CSSProperties}>
        {/* Conversations */}
        {layout.listCollapsed ? <CollapsedRail label="Conversations" badge={unreadTotal} onExpand={() => updateLayout({ listCollapsed: false })} /> : (
        <section className="m-glass relative flex max-h-96 min-h-0 min-w-0 flex-col rounded-xl border border-border md:max-h-none" aria-label="Conversations">
          <ResizeHandle label="conversations" width={layout.listWidth} min={240} max={460} onWidth={(listWidth) => updateLayout({ listWidth })} />
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-3 pt-3 pb-2.5">
            <div className="flex items-center gap-1.5">
              <h2 className="m-0 flex-1 text-card-title text-foreground">Conversations</h2>
              <Button type="button" size="sm" onClick={() => { setNewConversationOpen(true); setDetailsOpen(false); }} aria-label="New conversation" title="New conversation"><Plus aria-hidden="true" />New</Button>
              <button type="button" onClick={() => updateLayout({ listCollapsed: true })} aria-label="Collapse the conversations" title="Collapse" className="hidden size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground md:inline-flex"><PanelLeftClose className="size-4" aria-hidden="true" /></button>
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search conversations</span>
              <input type="search" value={conversationSearch} onChange={(event) => { setConversationSearch(event.target.value); resetList(); }} placeholder="Search conversations" className={cn(toolbarControl, "w-full pl-9")} />
            </label>
            <div className="-mx-0.5 flex flex-wrap gap-1" role="group" aria-label="Show conversations">
              {LIST_FILTERS.map(([value, label]) => {
                const count = filterCount(value);
                if (value !== "all" && value !== listFilter && count === 0) return null;
                const on = listFilter === value;
                return (
                  <button key={value} type="button" aria-pressed={on} onClick={() => { setListFilter(value); resetList(); }} className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors", on ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground")}>
                    {label}{value !== "all" && <span className="tabular-nums opacity-70">{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div ref={setListNode} onScroll={(event) => loadMoreNearEnd(event.currentTarget)} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {!loaded ? <SectionLoading rows={6} columns={2} label="Loading conversations" /> : filteredChannels.length === 0 ? (listFilter === "archived" && !conversationSearch
              ? <p className="m-0 px-3 py-8 text-center text-sm text-muted-foreground">Nothing archived. Archive a conversation from its menu to tidy your list.</p>
              : data.channels.length
              ? <NoMatches noun="conversations" onClear={() => { setConversationSearch(""); setListFilter("all"); resetList(); }} />
              : <EmptyState title="No conversations yet" hint="Message a partner or your team." action={<Button type="button" variant="outline" onClick={() => setNewConversationOpen(true)}><Plus aria-hidden="true" />New conversation</Button>} />) : visibleChannels.map((channel, index) => {
              const active = channel.id === selectedId;
              const last = channel.messages.at(-1);
              const unread = channel.unreadCount > 0;
              const pinned = Boolean(channel.state.pinnedAt);
              return (
                <Fragment key={channel.id}>
                  {pinnedCount > 0 && index === 0 && <p className="m-0 px-2 pt-1 pb-1 text-xs font-semibold text-muted-foreground">Pinned</p>}
                  {pinnedCount > 0 && index === pinnedCount && <p className="m-0 mt-1 border-t border-border px-2 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">All conversations</p>}
                  <div className={cn("group/row relative flex items-center rounded-lg transition-colors", active ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]")}>
                    <button type="button" onClick={() => { setSelectedId(channel.id); setNewConversationOpen(false); }} aria-current={active ? "true" : undefined} className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left", channel.status !== "active" && "opacity-70")}>
                      <Face channel={channel} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("flex min-w-0 items-center gap-1 text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>
                            <span className="truncate">{channel.name}</span>
                            {pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                          </span>
                          <span className={cn("shrink-0 text-xs tabular-nums transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0", unread ? "font-semibold text-[var(--accent-ink)]" : "text-muted-foreground")}>{last ? listTime(last.createdAt) : ""}</span>
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className={cn("truncate text-xs", unread ? "text-[var(--body)]" : "text-muted-foreground")}>{channel.status === "active" ? "" : "Closed · "}{channelPreview(channel)}</span>
                          {unread && <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-1 text-xs font-semibold leading-none text-[var(--primary-foreground)]" aria-label={`${channel.unreadCount} unread`}>{channel.unreadCount}</span>}
                        </span>
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label={`Options for ${channel.name}`} className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-card hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100">
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">{stateItems(channel)}</DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Fragment>
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

        {/* Thread: the messages scroll, the composer stays at the bottom of the pane. */}
        <section className="m-glass flex h-[70dvh] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border md:h-auto" aria-label="Selected conversation">
          {newConversationOpen ? (
            <>
              <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
                <h2 className="m-0 text-card-title text-foreground">New conversation</h2>
                <Button type="button" variant="ghost" size="icon" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation"><X aria-hidden="true" /></Button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 p-5">
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Conversation type">
                    {([["direct", "Direct message", "One other person.", MessageCircle], ["group", "Group", "Several people, with roles you set.", Users]] as const).map(([value, label, hint, Icon]) => (
                      <button key={value} type="button" role="radio" aria-checked={newType === value} onClick={() => { setNewType(value); setRecipientIds((ids) => (value === "direct" ? ids.slice(0, 1) : ids)); }} className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors", newType === value ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border hover:bg-[var(--surface-alt)]")}>
                        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-[var(--accent-ink)]"><Icon className="size-4" aria-hidden="true" /></span>
                        <span><span className="block text-sm font-semibold text-foreground">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                      </button>
                    ))}
                  </div>
                  {newType === "group" && (
                    <label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Group name
                      <input maxLength={160} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="e.g. Morning transfers" className={cn(inputControl, "font-normal")} />
                    </label>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-label text-[var(--body)]">{newType === "direct" ? "Who to message" : "People"}</span>
                    <PeoplePicker people={people} selected={recipientIds} onChange={setRecipientIds} single={newType === "direct"} />
                  </div>
                  {newType === "group" && selectedUsers.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-label text-[var(--body)]">Roles <span className="font-normal text-muted-foreground">· you are the owner</span></span>
                      <ul className="m-0 flex list-none flex-col gap-1 rounded-xl border border-border p-1.5">
                        {selectedUsers.map((user) => (
                          <li key={user.id} className="flex items-center gap-2.5 px-1 py-0.5">
                            <PersonFace name={user.name} partner={user.scope === "partner"} scale="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm">{user.name}</span>
                            <select aria-label={`${user.name}'s role`} value={newRoles[user.id] ?? "member"} onChange={(event) => setNewRoles((roles) => ({ ...roles, [user.id]: event.target.value as ChannelRole }))} title={ROLE_HINT[newRoles[user.id] ?? "member"]} className={cn(toolbarControl, "h-8 w-32")}>
                              {ROLE_CHOICES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
                            </select>
                          </li>
                        ))}
                      </ul>
                      <p className="m-0 text-xs text-muted-foreground">Admins add and remove people and change roles. Read only people can read but not write. You can change these later in the group&apos;s details.</p>
                    </div>
                  )}
                  {mixedPartners && <p role="alert" className="m-0 rounded-md bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">Start a separate conversation for each partner — these people belong to different ones.</p>}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setNewConversationOpen(false)}>Cancel</Button>
                    <Button type="button" disabled={busy || recipientIds.length === 0 || mixedPartners} onClick={() => void createChannel()}>{busy ? "Creating…" : newType === "direct" ? "Start conversation" : `Create group${recipientIds.length ? ` · ${recipientIds.length + 1} people` : ""}`}</Button>
                  </div>
                </div>
              </div>
            </>
          ) : selected ? (
            <>
              <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4 py-2">
                <Face channel={selected} />
                <div className="min-w-[96px] flex-1">
                  <h2 className="m-0 truncate text-card-title text-foreground" title={selected.name}>{selected.name}</h2>
                </div>
                {selected.channel_type === "group" && selected.members.length > 0 && !detailsOpen && (
                  <button type="button" onClick={() => setDetailsOpen(true)} className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground sm:inline-flex" title="Members">
                    <span className="flex -space-x-1.5">{selected.members.slice(0, 3).map((member) => <span key={member.userId} className="rounded-full ring-2 ring-[var(--surface)]"><PersonFace name={author(member.userId)?.name ?? "?"} partner={author(member.userId)?.scope === "partner"} scale="sm" /></span>)}</span>
                    {selected.members.length}
                  </button>
                )}
                <div className={cn("hidden shrink-0 items-center gap-0.5 rounded-md bg-[var(--surface-alt)] p-0.5 sm:flex", detailsOpen && "sm:hidden 2xl:flex")} role="group" aria-label="Show in this conversation">
                  {([["all", "All", selected.messages.length], ["messages", "Messages", selected.messages.length - updateCount], ["updates", "Updates", updateCount]] as const).map(([value, label, count]) => (
                    <button key={value} type="button" aria-pressed={threadView === value} onClick={() => setThreadView(value)} title={value === "updates" ? "Automatic lead and call updates" : value === "messages" ? "Messages people wrote" : "Everything"} className={cn("inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-semibold transition-colors", threadView === value ? "bg-card text-foreground shadow-[0_1px_2px_rgba(16,20,26,.08)]" : "text-muted-foreground hover:text-foreground")}>
                      {label}<span className="tabular-nums opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Conversation options" title="More"><MoreHorizontal aria-hidden="true" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {stateItems(selected)}
                    {/* Closing stops writing for everyone: a group's owner and admins, and reopening a direct closed before. */}
                    {((selected.channel_type === "group" && canManage(me)) || (selected.channel_type === "direct" && closed)) && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={busy} onSelect={() => { void setClosed(!closed); }}>{closed ? <><LockOpen aria-hidden="true" />Reopen for everyone</> : <><Lock aria-hidden="true" />Close for everyone</>}</DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" variant={detailsOpen ? "secondary" : "ghost"} size="icon" aria-pressed={detailsOpen} aria-controls="partner-chat-details" aria-label={detailsOpen ? "Hide conversation details" : "Show conversation details"} title="Details" onClick={() => setDetailsOpen((open) => !open)}>
                  <Info aria-hidden="true" />
                </Button>
              </div>
              <div ref={threadRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4 sm:px-4" aria-live="polite">
                <div className="flex w-full flex-1 flex-col">
                {shownMessages.length === 0 ? (
                  <div className="m-auto text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />{selected.messages.length === 0 ? "No messages yet. Send the first one." : threadView === "updates" ? "No automatic updates yet." : "Only automatic updates so far."}</div>
                ) : shownMessages.map((item, index) => {
                  const previous = shownMessages[index - 1];
                  const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(item.createdAt).toDateString();
                  const divider = newDay && (
                    <div className="sticky top-0 z-10 flex justify-center pt-3 pb-2" role="separator" aria-label={dayLabel(item.createdAt)}>
                      <span className="rounded-full border border-border bg-card px-3 text-xs font-semibold leading-6 text-muted-foreground shadow-[var(--shadow-rest)]">{dayLabel(item.createdAt)}</span>
                    </div>
                  );
                  if (item.messageKind === "system_card") return <div key={item.id}>{divider}<LeadUpdate message={item} thread={selected.messages} /></div>;
                  // "Ana added Ben": a line about the group itself, set apart in the middle.
                  if (item.cardPayload.membership === true) return <div key={item.id}>{divider}<p className="m-0 my-2 text-center text-xs text-muted-foreground">{item.message} · {clock(item.createdAt)}</p></div>;
                  // Consecutive messages from one person a few minutes apart share one name line.
                  const continued = !newDay && previous?.messageKind !== "system_card" && previous?.cardPayload.membership !== true && previous?.createdBy === item.createdBy
                    && new Date(item.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_MINUTES * 60_000;
                  const person = author(item.createdBy);
                  const name = person?.name ?? "Team member";
                  const attachmentOnly = item.attachments.length > 0 && /^Shared (an|\d+) attachments?$/.test(item.message);
                  const mine = Boolean(viewerId && item.createdBy === viewerId);
                  // The viewer's own messages: on the right, in the brand tint, no face.
                  if (mine) {
                    // Delivered once stored; Read once anyone else in the conversation has opened it since.
                    // Shown under the last of a run of my messages, as one line for the run.
                    const next = shownMessages[index + 1];
                    const lastOfRun = !next || next.createdBy !== viewerId || next.messageKind === "system_card";
                    const read = Boolean(selected.othersReadAt && new Date(selected.othersReadAt).getTime() >= new Date(item.createdAt).getTime());
                    return (
                      <div key={item.id}>
                        {divider}
                        <div className={cn("group flex flex-col items-end pl-10", continued ? "mt-1" : "mt-4")}>
                          {!continued && <span className="mb-1 text-xs tabular-nums text-muted-foreground">You · {clock(item.createdAt)}</span>}
                          {!attachmentOnly && (
                            <div className="flex max-w-full items-end gap-2">
                              {continued && <span className="shrink-0 pb-1.5 text-xs tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">{clock(item.createdAt)}</span>}
                              <p className="m-0 max-w-[min(100%,820px)] rounded-2xl rounded-br-md bg-[var(--primary-soft)] px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground"><MessageText text={item.message} /></p>
                            </div>
                          )}
                          <MessageAttachments attachments={item.attachments} mine />
                          {lastOfRun && (
                            <span className={cn("mt-1 inline-flex items-center gap-1 text-xs", read ? "text-[var(--accent-ink)]" : "text-muted-foreground")} title={read ? `Read ${listTime(selected.othersReadAt as string)}` : "Delivered, not read yet"}>
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
                      <div className={cn("group flex gap-3 pr-10", continued ? "mt-1" : "mt-4")}>
                        {continued
                          ? <span className="w-8 shrink-0 pt-2 text-right text-xs tabular-nums text-muted-foreground opacity-0 group-hover:opacity-100">{clock(item.createdAt)}</span>
                          : <span className="pt-5"><PersonFace name={name} partner={person?.scope === "partner"} /></span>}
                        <div className="flex min-w-0 flex-1 flex-col items-start">
                          {!continued && (
                            <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold whitespace-nowrap text-foreground">{name}</span>
                              {person?.partnerName ? <StatusChip tone="info" dot={false}>{person.partnerName}</StatusChip> : null}
                              <span className="text-xs tabular-nums text-muted-foreground">{clock(item.createdAt)}</span>
                            </div>
                          )}
                          {!attachmentOnly && <p className="m-0 max-w-[min(100%,820px)] rounded-2xl rounded-tl-md border border-border bg-card px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground"><MessageText text={item.message} /></p>}
                          <MessageAttachments attachments={item.attachments} mine={false} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              </div>
              {readOnly ? (
                <p className="m-0 shrink-0 border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">You can read this group. Ask an admin if you need to write in it.</p>
              ) : (
              <form className="shrink-0 px-3 pt-1 pb-3 sm:px-4" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                <div className={cn("rounded-xl border border-input bg-background transition-shadow focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-soft)]", closed && "bg-[var(--surface-alt)]", dictation.listening && "border-[var(--error)]")}>
                  <ComposerFiles files={files} onRemove={(file) => setFiles((current) => current.filter((item) => item !== file))} />
                  <div className="flex items-end gap-1 p-1.5">
                    <label className={cn("inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-alt)] hover:text-foreground", closed && "pointer-events-none opacity-50")} title="Attach up to three files: pictures, PDF, Word, Excel or text">
                      <Paperclip className="size-4" aria-hidden="true" /><span className="sr-only">Attach files</span>
                      <input className="sr-only" type="file" multiple disabled={closed} accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx" onChange={(event) => { setFiles((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 3)); event.target.value = ""; }} />
                    </label>
                    <textarea
                      ref={composerRef}
                      aria-label="Write a message"
                      rows={1}
                      maxLength={2000}
                      placeholder={closed ? "This conversation is closed — reopen it to write" : dictation.listening ? "Listening… speak your message" : `Message ${selected.name}`}
                      value={draft}
                      disabled={closed}
                      onChange={(event) => setDraft(event.target.value)}
                      // Enter sends; Shift+Enter starts a new line.
                      onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}
                      className="min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-normal outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                    />
                    {draft.length > 1800 && <span className="shrink-0 self-center px-1 text-xs tabular-nums text-muted-foreground">{draft.length}/2,000</span>}
                    {dictation.supported && (
                      <Button type="button" size="icon" variant={dictation.listening ? "destructive" : "ghost"} disabled={closed || dictation.transcribing} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictating" : "Dictate a message"} title={dictation.listening ? "Stop dictating" : "Dictate: say the message instead of typing it"} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}>
                        {dictation.transcribing ? <Loader2 className="animate-spin" aria-hidden="true" /> : dictation.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                      </Button>
                    )}
                    <Button type="submit" size="icon" disabled={busy || closed || (!draft.trim() && files.length === 0)} aria-label={busy ? "Sending" : "Send message"} title="Send (Enter)"><SendHorizontal aria-hidden="true" /></Button>
                  </div>
                </div>
                {dictation.listening ? (
                  <p role="status" aria-live="polite" className="m-0 mt-1.5 flex items-center gap-2 text-xs text-[var(--body)]">
                    <span className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--error)]" aria-hidden="true" />
                    {dictation.engine === "device"
                      ? <span className="tabular-nums">Recording {Math.floor(dictation.seconds / 60)}:{String(dictation.seconds % 60).padStart(2, "0")} · press the microphone again to write it</span>
                      : dictation.heard ? <span className="truncate italic">{dictation.heard}</span> : "Listening… say your message, then press Send."}
                  </p>
                ) : dictation.transcribing ? (
                  <p role="status" className="m-0 mt-1.5 text-xs text-[var(--body)]">{dictation.download !== null && dictation.download < 100 ? `Getting the speech model ready, the first time only · ${dictation.download}%` : "Writing what you said…"}</p>
                ) : dictation.problem ? (
                  <p role="alert" className="m-0 mt-1.5 text-xs text-[var(--error-ink)]">{dictation.problem}</p>
                ) : (
                  <p className="m-0 mt-1.5 hidden text-xs text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line{dictation.supported ? " · the microphone dictates" : ""}</p>
                )}
              </form>
              )}
            </>
          ) : loaded ? (
            <div className="m-auto p-10 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />Choose a conversation, or start a new one.</div>
          ) : (
            <SectionLoading rows={6} columns={3} label="Loading the conversation" />
          )}
        </section>

        {/* Conversation details: from xl a column of its own (split); narrower, over the thread (overlay). */}
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
              <div className="flex items-start gap-3 border-b border-border px-4 py-4">
                <Face channel={selected} scale="lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <p className="m-0 break-words text-card-title text-foreground">{selected.name}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusChip dot={false}>{channelType(selected)}</StatusChip>
                    {closed && <StatusChip dot={false}>Closed</StatusChip>}
                    {selected.state.archivedAt && <StatusChip dot={false}>Archived</StatusChip>}
                    {me && <StatusChip tone={me.role === "owner" || me.role === "admin" ? "action" : "neutral"} dot={false}>You · {ROLE_LABEL[me.role]}</StatusChip>}
                    {selectedFacts && selectedFacts.status !== "active" && <StatusChip tone="warning">{factsLine(selectedFacts)}</StatusChip>}
                  </div>
                  {selectedFacts?.payout && <span className="text-xs text-muted-foreground">{selectedFacts.payout}</span>}
                  {/* The partner's own record, on its Chat tab, for someone who may open partner records (2026-10-25). */}
                  {recordLinks && !partnerId && selected.channel_type === "partner" && selected.partner_id && (
                    <Link href={`/app/publishers/${selected.partner_id}`} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">Open the partner record</Link>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-5 p-4">
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
                {selected.channel_type === "group" && (
                  <GroupMembers channelId={selected.id} channelName={selected.name} members={selected.members} directory={data.directory} viewerId={viewerId} closed={closed} act={groupAction} />
                )}
                {selected.channel_type === "direct" && selected.members.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>People</SectionLabel>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {selected.members.map((member) => { const user = author(member.userId); return (
                        <li key={member.userId} className="flex items-center gap-2.5"><PersonFace name={user?.name ?? "?"} partner={user?.scope === "partner"} scale="sm" /><span className="min-w-0 flex-1 truncate text-sm">{user?.name ?? "Former teammate"}{member.userId === viewerId && <span className="text-muted-foreground"> (you)</span>}</span></li>
                      ); })}
                    </ul>
                  </div>
                )}
                {partnerMembers.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <SectionLabel>Partner members · {partnerMembers.length}</SectionLabel>
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {partnerMembers.slice(0, 6).map((user) => (
                        <li key={user.id} className="flex items-center gap-2.5">
                          <PersonFace name={user.name} partner scale="sm" />
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
                      {sharedAttachments.slice(-6).reverse().map((attachment) => {
                        const body = <><FileTypeTile contentType={attachment.contentType} name={attachment.fileName} scale="sm" /><span className="min-w-0 flex-1 truncate">{attachment.fileName}</span><span className="shrink-0 text-xs text-muted-foreground">{kb(attachment.sizeBytes)}</span></>;
                        return (
                          <li key={attachment.id}>
                            {attachment.downloadUrl
                              ? <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-alt)]">{body}</a>
                              : <span className="flex items-center gap-2.5 py-1 text-sm text-muted-foreground">{body}</span>}
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
