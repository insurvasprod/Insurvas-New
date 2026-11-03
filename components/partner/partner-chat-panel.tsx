"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, CircleDot, FileText, Info, Loader2, MessageCircle, Mic, MicOff, MoreHorizontal, Plus, Search, Users, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { ComposerFiles } from "@/components/app/partner-chat/attachments";
import { PersonFace } from "@/components/app/partner-chat/group-members";
import { useDictation } from "@/components/app/dialer/use-dictation";
import { MultiPicker } from "@/components/app/multi-picker";
import { ChatThread } from "@/components/partner/chat-message";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { control, Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { clockTime, viewerTimeZone } from "@/lib/format/dates";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PartnerMessage } from "@/lib/partnerChat/cards";
import { composerCountLabel, PARTNER_CHAT_MESSAGE_MAX } from "@/lib/partnerChat/composer";
import { formatSupportPhone, type SupportContact } from "@/lib/partnerSupport/contact";
import { cn } from "@/lib/utils";

/**
 * Messages: conversations beside a thread, and nothing else on screen.
 *
 * The conversation list, thread controls, message groups and composer follow the agent Partner Chat
 * layout. Publisher-specific endpoints and membership rules still supply the data and actions.
 * On a phone it is one pane at a time: the list, then the conversation, with a way back.
 */

/** Below this the frame stops shrinking and the page scrolls instead — a laptop in a short window. */

type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string; othersReadAt?: string | null };
type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; role?: string; partnerName?: string };
type ChatResponse = { viewerId?: string | null; channel?: { id: string; name: string; partner_id: string | null; channel_type: Channel["channel_type"]; status: string }; messages?: PartnerMessage[]; unreadCount?: number; realtimeTopic?: string; channels?: Array<{ channel: { id: string; name: string; partner_id: string | null; channel_type: Channel["channel_type"]; status: string }; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string; othersReadAt?: string | null }>; directory?: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> } };
type PartnerListFilter = "all" | "unread" | "agent" | "team";

function channelTypeLabel(channel: Channel) { return channel.channel_type === "partner" ? "Agent channel" : channel.channel_type === "direct" ? "Direct message" : "Partner team channel"; }
function channelPreview(channel: Channel) { return channel.messages.at(-1)?.message ?? "No messages yet"; }

/**
 * §10 reserves avatars for staff users with a photo. A channel is not a person, and initials in a
 * circle said nothing about it — so a glyph says what kind of conversation it is instead.
 */
function ChannelIcon({ channel, large = false }: { channel: Channel; large?: boolean }) {
  if (channel.channel_type !== "group") return <span className={large ? "[&>span]:size-12 [&>span]:text-base" : undefined}><PersonFace name={channel.name} partner={channel.channel_type === "partner"} scale={large ? "md" : "sm"} /></span>;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-[var(--surface-alt)] text-muted-foreground", large ? "size-12" : "size-8")}>
      <Users className={large ? "size-5" : "size-4"} aria-hidden="true" />
      <span className="sr-only">{channelTypeLabel(channel)}</span>
    </span>
  );
}

function Pair({ label, value, unset }: { label: string; value: string | null; unset?: string }) {
  if (!value && !unset) return null;
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <dt className="min-w-0 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 min-w-0 break-words text-right", value ? "font-medium text-foreground" : "text-muted-foreground")}>{value ?? unset}</dd>
    </div>
  );
}

function normalize(body: ChatResponse) {
  const channels = body.channels?.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic, othersReadAt: item.othersReadAt ?? null })) ?? (body.channel ? [{ ...body.channel, messages: body.messages ?? [], unreadCount: body.unreadCount ?? 0, realtimeTopic: body.realtimeTopic ?? `partner-chat:${body.channel.id}`, othersReadAt: null }] : []);
  const tenantUsers = (body.directory?.tenantUsers ?? []).map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · Licensed agent`, scope: "agent" as const, role: item.role }));
  const partnerUsers = (body.directory?.partnerUsers ?? []).map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · Partner team`, scope: "partner" as const, role: item.role, partnerName: item.partners.name }));
  return { channels, directory: [...tenantUsers, ...partnerUsers].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) };
}

/**
 * What `/design/messages` hands the panel instead of a database. A partner's own page never passes
 * it; with it set, the panel reads nothing and writes nothing, so the preview cannot touch a live
 * channel (lib/partnerChat/fixtures.ts).
 */
export type PartnerChatSample = { viewerId: string | null; channels: Channel[]; directory: DirectoryUser[]; agencyName: string | null; agencySupport: SupportContact | null };

export function PartnerChatPanel({ sample }: { sample?: PartnerChatSample }) {
  const [data, setData] = useState<{ channels: Channel[]; directory: DirectoryUser[] }>(sample ? { channels: sample.channels, directory: sample.directory } : { channels: [], directory: [] });
  const [selectedId, setSelectedId] = useState<string | null>(sample?.channels[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<PartnerListFilter>("all");
  const [threadView, setThreadView] = useState<"all" | "messages" | "updates">("all");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearch, setThreadSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Phones show one pane at a time. Above md both are on screen and this is ignored.
  const [threadOnPhone, setThreadOnPhone] = useState(false);
  const [channelType, setChannelType] = useState<"direct" | "group">("direct");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!sample);
  // Who "you" is in the thread. It comes from the session via the channels read, never a parameter.
  const [viewerId, setViewerId] = useState<string | null>(sample?.viewerId ?? null);
  const [agencyName, setAgencyName] = useState<string | null>(sample?.agencyName ?? null);
  const [agencySupport, setAgencySupport] = useState<SupportContact | null>(sample?.agencySupport ?? null);
  const [error, setError] = useState<string | null>(null);
  const lastReadMark = useRef("");
  const dictation = useDictation((text) => setDraft((current) => `${current}${current.trim() ? " " : ""}${text}`));

  // One boolean, so the effects below read as "the preview does nothing" rather than repeating the prop.
  const sampled = Boolean(sample);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/partner/chat", { cache: "no-store" });
      const body = await response.json().catch(() => null) as ChatResponse | { error?: string } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load partner chat");
      const next = normalize(body as ChatResponse);
      setViewerId(typeof (body as { viewerId?: unknown }).viewerId === "string" ? (body as { viewerId: string }).viewerId : null);
      setAgencyName(typeof (body as { agencyName?: unknown }).agencyName === "string" ? (body as { agencyName: string }).agencyName : null);
      setAgencySupport((body as { agencySupport?: SupportContact }).agencySupport ?? null);
      setData(next);
      setSelectedId((current) => current && next.channels.some((channel) => channel.id === current) ? current : next.channels[0]?.id ?? null);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load partner chat"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (sampled) return; const kickoff = window.setTimeout(() => void load(), 0); const fallback = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000); return () => { window.clearTimeout(kickoff); window.clearInterval(fallback); }; }, [load, sampled]);
  // Keyed on strings, not data.channels (a new array every poll), so the 15s poll no longer
  // re-subscribes realtime or re-marks read. Read state still follows the newest message.
  const selectedTopic = data.channels.find((channel) => channel.id === selectedId)?.realtimeTopic ?? null;
  const selectedLatestId = data.channels.find((channel) => channel.id === selectedId)?.messages.at(-1)?.id ?? null;
  useEffect(() => { if (sampled || !selectedTopic) return; const supabase = getSupabaseBrowserClient(); let channel: RealtimeChannel | null = null; if (supabase) channel = supabase.channel(selectedTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe(); return () => { if (channel && supabase) void supabase.removeChannel(channel); }; }, [load, sampled, selectedTopic]);
  useEffect(() => {
    if (sampled || !selectedId || !selectedTopic) return;
    const markRead = () => {
      const threadVisible = window.matchMedia("(min-width: 768px)").matches || threadOnPhone;
      if (document.visibilityState !== "visible" || !threadVisible) return;
      const key = `${selectedId}:${selectedLatestId ?? ""}`;
      if (lastReadMark.current === key) return;
      lastReadMark.current = key;
      void fetch("/api/partner/chat", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: selectedId }),
      }).then((response) => {
        if (!response.ok && lastReadMark.current === key) {
          lastReadMark.current = "";
          void load();
        }
      }).catch(() => {
        if (lastReadMark.current === key) {
          lastReadMark.current = "";
          void load();
        }
      });
    };
    markRead();
    window.addEventListener("resize", markRead);
    document.addEventListener("visibilitychange", markRead);
    return () => {
      window.removeEventListener("resize", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [load, sampled, selectedId, selectedLatestId, selectedTopic, threadOnPhone]);
  // Attachment-only messages need a valid editable body for the shared message contract.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (files.length > 0 && !draft.trim()) setDraft(files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`); }, [files.length, draft]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const filteredChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.channels.filter((channel) => {
      const matchesList = listFilter === "all"
        || (listFilter === "unread" && channel.unreadCount > 0)
        || (listFilter === "agent" && channel.channel_type === "partner")
        || (listFilter === "team" && channel.channel_type !== "partner");
      return matchesList && (!query || `${channel.name} ${channelPreview(channel)}`.toLowerCase().includes(query));
    });
  }, [data.channels, listFilter, search]);
  const filterCount = (filter: PartnerListFilter) => data.channels.filter((channel) => filter === "all"
    || (filter === "unread" && channel.unreadCount > 0)
    || (filter === "agent" && channel.channel_type === "partner")
    || (filter === "team" && channel.channel_type !== "partner")).length;
  const messageCount = selected?.messages.filter((message) => message.messageKind !== "system_card").length ?? 0;
  const updateCount = (selected?.messages.length ?? 0) - messageCount;
  const shownMessages = useMemo(() => selected?.messages.filter((message) => {
    const matchesView = threadView === "all" || (threadView === "updates") === (message.messageKind === "system_card");
    return matchesView && (!threadSearch.trim() || `${message.message} ${message.cardPayload.customer ?? ""}`.toLowerCase().includes(threadSearch.trim().toLowerCase()));
  }) ?? [], [selected, threadSearch, threadView]);
  const sharedAttachments = selected?.messages.flatMap((item) => item.attachments) ?? [];
  const relatedLeadCount = new Set(selected?.messages.map((item) => item.workItemId).filter(Boolean)).size;
  const directory = useMemo(() => data.directory.filter((item) => item.id !== undefined), [data.directory]);

  // The thread runs client-side after the channels land, so the viewer's own zone is readable here
  // (lib/format/dates: never during a server render).
  const zone = viewerTimeZone();
  const nameOf = useCallback(
    (userId: string | null) => (userId ? data.directory.find((user) => user.id === userId)?.name ?? "Workspace member" : "INSURVAS"),
    [data.directory]);

  function openConversation(id: string) {
    setSelectedId(id);
    setThreadOnPhone(true);
    setDetailsOpen(false);
    setThreadSearchOpen(false);
    setThreadSearch("");
    setData((current) => ({
      ...current,
      channels: current.channels.map((channel) =>
        channel.id === id ? { ...channel, unreadCount: 0 } : channel,
      ),
    }));
  }

  async function createChannel() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/partner/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_channel", channel_type: channelType, name: channelName, user_ids: recipientIds }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not create chat channel"); setChannelName(""); setRecipientIds([]); setNewOpen(false); notify.done(channelType === "direct" ? "Direct message ready" : "Partner team channel created"); await load(); if (body.channel?.id) openConversation(body.channel.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create chat channel"); } finally { setBusy(false); }
  }

  // The composer owns the form and its default; this just sends.
  async function send() {
    if (!selected || (!draft.trim() && files.length === 0)) return; dictation.stop(); setBusy(true); setError(null);
    try { const form = new FormData(); form.set("channel_id", selected.id); form.set("message", draft.trim() || (files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`)); files.forEach((file) => form.append("files", file)); const response = await fetch("/api/partner/chat", { method: "POST", body: form }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Message could not be sent"); setDraft(""); setFiles([]); notify.done("Message sent"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be sent"); } finally { setBusy(false); }
  }

  return (
    <main className="m-stagger flex w-full min-w-0 flex-col gap-4 md:h-[calc(100dvh-var(--top-bar-h)-48px)] lg:h-[calc(100dvh-var(--top-bar-h)-56px)]">
      <PageHeader
        title="Messages"
        description="Chat with your agent and your team."
        visible
        infoDescription
      />

      {error && <p role="alert" className="m-0 mb-3 rounded-md border border-border bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* Keep the same three-pane rhythm as the agent Partner Chat: conversations, thread, details. */}
      <div
        // Keep the thread comfortable when details are open. The publisher shell has a wider
        // navigation rail than the agent shell, so use the same 320px details column while giving
        // the conversation list a little less room; the message header then keeps its title and
        // controls on one line, as it does in Partner Chat.
        style={{ "--partner-chat-cols-xl": detailsOpen && selected ? "minmax(15rem, 16rem) minmax(0, 1fr) 20rem" : "minmax(15rem, 20rem) minmax(0, 1fr)" } as React.CSSProperties}
        className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-3.5 md:[grid-template-columns:minmax(15rem,20rem)_minmax(0,1fr)] xl:[grid-template-columns:var(--partner-chat-cols-xl)]"
      >
        {/* Conversations. On a phone this is the page until one is opened. */}
        <aside
          className={cn("m-glass relative flex max-h-96 min-h-0 min-w-0 flex-col rounded-xl border border-border md:max-h-none", threadOnPhone && "hidden md:flex")}
          aria-label="Conversations"
        >
          <div className="flex shrink-0 flex-col gap-2.5 border-b border-border px-3 pt-3 pb-2.5">
            <div className="flex items-center gap-1.5">
              <h2 className="m-0 flex-1 text-card-title text-foreground">Conversations</h2>
              <Button type="button" size="sm" onClick={() => setNewOpen(true)} aria-label="New conversation" title="New conversation"><Plus aria-hidden="true" />New</Button>
            </div>

            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Search conversations</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className={cn(control, "mt-0 w-full pl-9")} />
            </label>

            <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none]" role="radiogroup" aria-label="Show conversations">
              {([ ["all", "All"], ["unread", "Unread"], ["agent", "Agent"], ["team", "Team"] ] as const).map(([value, label]) => {
                const count = filterCount(value);
                if (value !== "all" && value !== listFilter && count === 0) return null;
                return <ToggleChip key={value} role="radio" selected={listFilter === value} count={value === "all" ? undefined : count} onClick={() => setListFilter(value)}>{label}</ToggleChip>;
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="list">
            {loading && <SectionLoading rows={6} columns={2} label="Loading conversations" />}
            {!loading && filteredChannels.length === 0 && <p className="m-0 px-3 py-8 text-center text-sm text-muted-foreground">{data.channels.length ? "No conversations match these filters." : "No conversations yet. Start a conversation with your agent or team."}</p>}
            {filteredChannels.map((channel) => {
              const newest = channel.messages.at(-1);
              const current = channel.id === selectedId;
              return (
                <button
                  type="button"
                  role="listitem"
                  key={channel.id}
                  onClick={() => openConversation(channel.id)}
                  aria-current={current ? "true" : undefined}
                  className={cn("group/row relative flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]", current && "bg-[var(--primary-soft)]", channel.status !== "active" && "opacity-70")}
                >
                  <ChannelIcon channel={channel} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm text-foreground", channel.unreadCount > 0 ? "font-semibold" : "font-medium")}>{channel.name}</span>
                      <time className={cn("shrink-0 text-xs tabular-nums", channel.unreadCount > 0 ? "font-semibold text-[var(--accent-ink)]" : "text-muted-foreground")}>{newest ? clockTime(newest.createdAt, zone, "12h") : ""}</time>
                    </span>
                    <span className={cn("mt-0.5 block truncate text-xs", channel.unreadCount > 0 ? "text-[var(--body)]" : "text-muted-foreground")}>{channelPreview(channel)}</span>
                  </span>
                  {channel.unreadCount > 0 && (
                    <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[var(--primary)] px-1 text-xs font-semibold leading-none text-[var(--primary-foreground)]" aria-label={`${channel.unreadCount} unread`}>
                      {channel.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* The conversation. On a phone it is the page once one is open. */}
        <section className={cn("m-glass flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border", !threadOnPhone && "hidden md:flex")} aria-label="Selected conversation">
          {selected ? (
            <>
              <header className="flex min-h-14 min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 py-2 sm:gap-3 sm:px-4">
                <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to conversations" onClick={() => setThreadOnPhone(false)}>
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <ChannelIcon channel={selected} large />
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 truncate text-card-title font-semibold text-foreground">{selected.name}</h2>
                  <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="truncate">{channelTypeLabel(selected)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex shrink-0 items-center gap-1">
                      <CircleDot className={cn("size-3", selected.status === "active" ? "text-[var(--success-ink)]" : "text-muted-foreground")} aria-hidden="true" />
                      {selected.status === "active" ? "Connected" : "Archived"}
                    </span>
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-1 sm:flex" role="radiogroup" aria-label="Show in this conversation">
                  {([ ["all", "All", selected.messages.length], ["messages", "Messages", messageCount], ["updates", "Updates", updateCount] ] as const).map(([value, label, count]) => (
                    <ToggleChip key={value} role="radio" selected={threadView === value} count={count} onClick={() => setThreadView(value)} className="h-8 px-2.5 text-xs">{label}</ToggleChip>
                  ))}
                </div>
                <Button type="button" variant={threadSearchOpen ? "secondary" : "ghost"} size="icon" aria-pressed={threadSearchOpen} aria-label={threadSearchOpen ? "Close message search" : "Search this conversation"} title="Search this conversation" onClick={() => { setThreadSearchOpen((open) => !open); setThreadSearch(""); }}>
                  {threadSearchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="Conversation options" title="More"><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void load()}>Refresh conversations</DropdownMenuItem>
                    <DropdownMenuItem asChild><Link href="/partner/pipeline">Open lead pipeline</Link></DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button type="button" variant={detailsOpen ? "secondary" : "ghost"} size="icon" aria-expanded={detailsOpen} aria-controls="partner-chat-details" aria-label={detailsOpen ? "Hide conversation details" : "Show conversation details"} title="Details" onClick={() => setDetailsOpen((open) => !open)}>
                  <Info aria-hidden="true" />
                </Button>
              </header>

              {threadSearchOpen && <div className="shrink-0 border-b border-border px-3 py-2 sm:px-4"><label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><span className="sr-only">Search messages in this conversation</span><input type="search" autoFocus value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="Search messages" className={cn(control, "mt-0 w-full pl-9")} /></label></div>}

              <ChatThread messages={shownMessages} viewerId={viewerId} nameOf={nameOf} zone={zone} othersReadAt={selected.othersReadAt} emptyTitle={selected.messages.length ? "No messages match" : "No messages yet"} emptyHint={selected.messages.length ? "Try another tab or clear your search." : "Send the first update to this conversation."} />

              <div className="shrink-0 px-3 pt-1 pb-3 sm:px-4">
                <ComposerFiles files={files} onRemove={(file) => setFiles((current) => current.filter((item) => item !== file))} />
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSubmit={() => { void send(); }}
                  files={files}
                  onFilesChange={setFiles}
                  busy={busy}
                  placeholder={dictation.listening ? "Listening… speak your message" : `Message ${selected.name}`}
                  maxLength={PARTNER_CHAT_MESSAGE_MAX}
                  accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx"
                  maxFiles={3}
                  countLabel={composerCountLabel}
                  className="rounded-xl border border-input bg-background p-1.5 transition-shadow focus-within:border-[var(--primary)] focus-within:shadow-[0_0_0_3px_var(--primary-soft)]"
                  trailingControl={dictation.supported ? <Button type="button" size="icon" variant={dictation.listening ? "destructive" : "ghost"} disabled={dictation.transcribing} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictating" : "Dictate a message"} title={dictation.listening ? "Stop dictating" : "Dictate a message"} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}>{dictation.transcribing ? <Loader2 className="animate-spin" aria-hidden="true" /> : dictation.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}</Button> : undefined}
                />
                {dictation.listening ? <p role="status" aria-live="polite" className="m-0 mt-1.5 text-xs text-[var(--body)]">{dictation.engine === "device" ? `Recording ${Math.floor(dictation.seconds / 60)}:${String(dictation.seconds % 60).padStart(2, "0")} · press the microphone again to write it` : dictation.heard || "Listening… say your message, then press Send."}</p> : dictation.transcribing ? <p role="status" className="m-0 mt-1.5 text-xs text-[var(--body)]">{dictation.download !== null && dictation.download < 100 ? `Getting the speech model ready · ${dictation.download}%` : "Writing what you said…"}</p> : dictation.problem ? <p role="alert" className="m-0 mt-1.5 text-xs text-[var(--error-ink)]">{dictation.problem}</p> : <p className="m-0 mt-1.5 hidden text-xs text-muted-foreground sm:block">Enter to send · Shift + Enter for a new line{dictation.supported ? " · the microphone dictates" : ""}</p>}
              </div>
            </>
          ) : (
            <div className="m-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
              <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
              <h2 className="m-0 text-card-title font-semibold text-foreground">Select a conversation</h2>
              <p className="m-0 text-sm text-muted-foreground">Choose an agent channel or start a private partner-team conversation.</p>
            </div>
          )}
        </section>
        {detailsOpen && selected && (
          <DetailPanel mode="split" splitFrom="xl" id="partner-chat-details" title="Conversation details" subtitle={selected.name} status={<StatusChip tone={selected.status === "active" ? "good" : "neutral"}>{selected.status === "active" ? "Active" : "Archived"}</StatusChip>} onClose={() => setDetailsOpen(false)} closeLabel="Close conversation details" footer={<Button asChild variant="secondary" className="w-full"><Link href="/partner/pipeline">Open pipeline</Link></Button>} bodyClassName="flex flex-col gap-5 p-4" className="xl:m-glass xl:w-auto xl:min-w-0 xl:rounded-xl xl:shadow-none">
            <section aria-labelledby="partner-chat-details-conversation">
              <h3 id="partner-chat-details-conversation" className="m-0 text-card-title font-semibold text-foreground">Conversation</h3>
              <dl className="m-0 mt-2 divide-y divide-border rounded-lg border border-border px-3"><Pair label="Channel" value={channelTypeLabel(selected)} /><Pair label="Your agency" value={agencyName} /><Pair label="Related leads" value={String(relatedLeadCount)} /></dl>
            </section>
            {agencySupport?.schemaReady && <section aria-labelledby="partner-chat-details-support"><h3 id="partner-chat-details-support" className="m-0 text-card-title font-semibold text-foreground">Agency support</h3>{agencySupport.email || agencySupport.phone ? <dl className="m-0 mt-2 divide-y divide-border rounded-lg border border-border px-3"><Pair label="Email" value={agencySupport.email} /><Pair label="Phone" value={agencySupport.phone ? formatSupportPhone(agencySupport.phone) : null} /></dl> : <p className="m-0 mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">Your agency hasn&rsquo;t added support contact details yet.</p>}</section>}
            <section className="min-w-0" aria-labelledby="partner-chat-details-files"><div className="flex items-center justify-between gap-3"><h3 id="partner-chat-details-files" className="m-0 text-card-title font-semibold text-foreground">Shared files</h3><StatusChip tone="neutral" dot={false}>{sharedAttachments.length}</StatusChip></div>{sharedAttachments.length ? <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">{sharedAttachments.slice(0, 8).map((attachment) => <li key={attachment.id} className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 truncate text-foreground">{attachment.fileName}</span><span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span></li>)}</ul> : <div className="mt-2 flex items-start gap-3 rounded-lg border border-dashed border-border px-3 py-3"><FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><div><p className="m-0 text-sm font-medium text-foreground">No shared files yet</p><p className="m-0 mt-0.5 text-xs leading-relaxed text-muted-foreground">Files attached to messages in this conversation will appear here.</p></div></div>}</section>
          </DetailPanel>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>A direct message reaches one person; a team channel is for your own organisation.</DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="min-w-0">
              <span className="text-label text-[var(--body)]">Conversation type</span>
              <div className="mt-1.5">
                <Segmented
                  label="Conversation type"
                  value={channelType}
                  onChange={(next) => setChannelType(next)}
                  // Short enough for the track to fit a 375-wide dialog; the line above says what each one means.
                  options={[{ key: "direct" as const, label: "Direct message" }, { key: "group" as const, label: "Team channel" }]}
                />
              </div>
            </div>
            <Field label="Channel name" hint="Optional — a direct message is named after the person.">
              <input
                maxLength={160}
                value={channelName}
                onChange={(event) => setChannelName(event.target.value)}
                placeholder={channelType === "direct" ? "Direct message" : "e.g. Partner operations"}
                className={control}
              />
            </Field>
            <Field label={channelType === "direct" ? "Recipient" : "Participants"} hint={recipientIds.length ? directory.filter((user) => recipientIds.includes(user.id)).map((user) => user.name).join(", ") : "Choose at least one person"}>
              <div className="mt-1.5">
                <MultiPicker
                  label={channelType === "direct" ? "Recipient" : "Participants"}
                  placeholder="Choose people"
                  value={recipientIds}
                  onChange={setRecipientIds}
                  options={directory.map((user) => ({ value: user.id, label: user.label }))}
                />
              </div>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy || recipientIds.length === 0} onClick={() => void createChannel()}>
              {busy ? "Creating…" : channelType === "direct" ? "Start direct message" : "Create team channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
