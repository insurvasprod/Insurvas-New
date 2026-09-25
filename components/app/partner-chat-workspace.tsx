"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/lib/notify";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { FileText, MessageCircle, Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { sectionForPath } from "@/lib/menu/definition";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cardTitle, type PartnerMessage } from "@/lib/partnerChat/cards";
import { cn } from "@/lib/utils";
import { MONTHS } from "@/lib/format/dates";

/**
 * Partner chat, as the board draws it: conversations on the left, the thread in the middle with
 * automatic updates set apart from typed messages, and the channel's facts on the right.
 *
 * Everything the page did before still works — search, unread counts, new direct and team
 * conversations, attachments, realtime refresh and read receipts — plus Archive / Restore for
 * direct and team channels. A partner channel is never archived here: it is where the automatic
 * lead updates land, and the server refuses to post into an archived one.
 */

type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string };
type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; partnerId?: string; partnerName?: string; role?: string };
type ChatResponse = { channels: Array<{ channel: Channel; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string }>; directory: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; partner_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> }; partnerFacts?: PartnerFacts[] };
type PartnerFacts = { partnerId: string; status: string; transfersToday: number; completedToday: number; droppedToday: number; payout: string | null };

function normalize(data: ChatResponse): { channels: Channel[]; directory: DirectoryUser[]; facts: Record<string, PartnerFacts> } {
  const channels = data.channels.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic }));
  const tenantUsers = data.directory.tenantUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.users.email}`, scope: "agent" as const, role: item.role }));
  const partnerUsers = data.directory.partnerUsers.map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · ${item.partners.name}`, scope: "partner" as const, partnerId: item.partner_id, partnerName: item.partners.name, role: item.role }));
  const facts = Object.fromEntries((data.partnerFacts ?? []).map((item) => [item.partnerId, item]));
  return { channels, facts, directory: [...tenantUsers, ...partnerUsers].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) };
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "?").join(""); }
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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

function BarHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
      <h2 className="truncate text-sm font-semibold leading-normal tracking-[-0.02em]">{title}</h2>
      {children && <span className="flex shrink-0 items-center gap-2.5">{children}</span>}
    </div>
  );
}

/** An automatic update: tinted, labelled and not editable — a record, not a message. */
function SystemCard({ message }: { message: PartnerMessage }) {
  const payload = message.cardPayload;
  // Read-time facts from the server (enrichCards in lib/partnerChat/service.ts); absent on some cards.
  const counts = typeof payload.counts_as_work_completed === "boolean" ? payload.counts_as_work_completed : null;
  const dropped = payload.closes_as === "dropped";
  const minutes = typeof payload.minutes_after_submission === "number" ? payload.minutes_after_submission : null;
  const fields = ([["Client", payload.customer], ["Product", payload.product], ["Outcome", payload.disposition], ["By", payload.agent]] as Array<[string, unknown]>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0);
  return (
    <article className="rounded-lg border border-[var(--info)] bg-[var(--info-surface)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--info-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--info-ink)]"><span className="size-1.5 rounded-full bg-[var(--info)]" aria-hidden="true" />Automatic update</span>
        <span className="text-xs text-muted-foreground">{clock(message.createdAt)} · cannot be edited</span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label="Event">{dropped && message.cardType === "call_outcome" ? "Call dropped" : cardTitle(message)}</Fact>
        {fields.map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}
      </div>
      {message.message && <p className="mt-2.5 text-sm text-[var(--body)]">{message.message}</p>}
      {(counts != null || minutes != null) && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {minutes != null ? `${minutes === 0 ? "Under a minute" : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`} after submission` : counts ? "Counts as work completed" : "Does not count as work completed"}
        </p>
      )}
    </article>
  );
}

export function AgentPartnerChatWorkspace() {
  const [data, setData] = useState<{ channels: Channel[]; directory: DirectoryUser[]; facts: Record<string, PartnerFacts> }>({ channels: [], directory: [], facts: {} });
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [newType, setNewType] = useState<"direct" | "group">("direct");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [newConversationOpen, setNewConversationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/app/partner-chat", { cache: "no-store" });
    const body = await response.json().catch(() => null) as ChatResponse | { error?: string } | null;
    if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load partner chat");
    const next = normalize(body as ChatResponse); setData(next); setLoaded(true); setSelectedId((current) => current && next.channels.some((channel) => channel.id === current) ? current : next.channels[0]?.id ?? null); return next;
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((reason: unknown) => { setLoaded(true); setError(reason instanceof Error ? reason.message : "Could not load partner chat"); }); }, 0); return () => window.clearTimeout(timer); }, [load]);
  // Give attachment-only messages a valid, editable message body so the shared API can persist them.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (files.length > 0 && !draft.trim()) setDraft(files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`); }, [files.length, draft]);
  // Live: a broadcast on the selected channel reloads it, and opening a channel marks it read.
  useEffect(() => { const selected = data.channels.find((channel) => channel.id === selectedId); if (!selected) return; const supabase = getSupabaseBrowserClient(); let channel: RealtimeChannel | null = null; if (supabase) channel = supabase.channel(selected.realtimeTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe(); void fetch("/api/app/partner-chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: selected.id }) }); return () => { if (channel && supabase) void supabase.removeChannel(channel); }; }, [data.channels, load, selectedId]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const messageCount = selected?.messages.length ?? 0;
  // A thread opens at its newest message, and follows new ones as they arrive.
  useEffect(() => { const node = threadRef.current; if (node) node.scrollTop = node.scrollHeight; }, [selectedId, messageCount, newConversationOpen]);
  const filteredChannels = useMemo(() => { const query = conversationSearch.trim().toLowerCase(); return query ? data.channels.filter((channel) => `${channel.name} ${channelPreview(channel)}`.toLowerCase().includes(query)) : data.channels; }, [conversationSearch, data.channels]);
  const selectedUsers = useMemo(() => data.directory.filter((user) => recipientIds.includes(user.id)), [data.directory, recipientIds]);
  // Mirrors the server rule: one agency channel may hold people from one partner at most.
  const mixedPartners = new Set(selectedUsers.filter((user) => user.scope === "partner").map((user) => user.partnerId)).size > 1;
  const selectedFacts = selected?.channel_type === "partner" && selected.partner_id ? data.facts[selected.partner_id] : undefined;
  const partnerMembers = useMemo(() => data.directory.filter((user) => selected?.partner_id && user.partnerId === selected.partner_id), [data.directory, selected]);
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

  const field = "h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm";

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={sectionForPath("/app/partner-chat") ?? undefined}
        title="Partner chat"
        description="One partner-only channel carrying conversation and automatic lead updates."
        actions={<Button type="button" className="h-11 px-4" onClick={() => setNewConversationOpen(true)}>New conversation</Button>}
      />

      <div className="flex flex-col gap-5 xl:min-h-[640px] xl:flex-row">
        {/* Conversations */}
        <section className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)] xl:w-[280px]" aria-label="Conversations">
          <BarHeader title="Conversations"><span className="text-xs text-muted-foreground">{data.channels.length}</span></BarHeader>
          <label className="relative flex items-center border-b border-border px-3 py-2">
            <Search className="pointer-events-none absolute left-5 size-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Search conversations</span>
            <input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-2 text-sm" />
          </label>
          <div className="max-h-[520px] overflow-y-auto xl:max-h-none xl:flex-1">
            {!loaded ? <p className="px-4 py-6 text-sm text-muted-foreground">Loading conversations…</p> : filteredChannels.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">{data.channels.length ? "No conversation matches that." : "No conversations yet."}</p> : filteredChannels.map((channel) => {
              const active = channel.id === selectedId;
              const last = channel.messages.at(-1);
              return (
                <button type="button" key={channel.id} onClick={() => { setSelectedId(channel.id); setNewConversationOpen(false); }} aria-current={active ? "true" : undefined} className={cn("block w-full border-t border-border px-3.5 py-3 text-left first:border-t-0", active ? "bg-[var(--soft-orange-surface)] shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-[var(--surface-alt)]")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">{channel.name}</span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {channel.unreadCount > 0 && <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--primary)] px-1 text-[11px] font-semibold text-[var(--primary-foreground)]" aria-label={`${channel.unreadCount} unread`}>{channel.unreadCount}</span>}
                      <span className="text-xs text-muted-foreground">{last ? listTime(last.createdAt) : "—"}</span>
                    </span>
                  </span>
                  <span className="mt-[3px] block truncate text-xs text-muted-foreground">{channel.status === "active" ? "" : "Archived · "}{channelPreview(channel)}</span>
                  {channel.channel_type === "partner" && channel.partner_id && factsLine(data.facts[channel.partner_id]) && <span className="mt-0.5 block truncate text-xs tabular-nums text-[var(--body)]">{factsLine(data.facts[channel.partner_id])}</span>}
                </button>
              );
            })}
          </div>
        </section>

        {/* Thread */}
        <section className="flex min-h-[520px] min-w-0 flex-grow flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]" aria-label="Selected conversation">
          {newConversationOpen ? (
            <>
              <BarHeader title="New conversation"><button type="button" onClick={() => setNewConversationOpen(false)} aria-label="Close new conversation" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="size-4" /></button></BarHeader>
              <div className="flex flex-col gap-4 p-5">
                <p className="text-sm text-muted-foreground">Choose a partner user, an agent or a team member. Access is checked on the server.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold">Conversation type<select value={newType} onChange={(event) => setNewType(event.target.value as "direct" | "group")} className={cn(field, "mt-1.5 font-normal")}><option value="direct">Direct message</option><option value="group">Team channel</option></select></label>
                  <label className="text-sm font-semibold">Channel name <span className="font-normal text-muted-foreground">optional</span><input maxLength={160} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder={newType === "direct" ? "Direct message" : "e.g. Morning transfers"} className={cn(field, "mt-1.5 font-normal")} /></label>
                </div>
                <label className="text-sm font-semibold">{newType === "direct" ? "Recipient" : "Participants"}
                  <select multiple value={recipientIds} onChange={(event) => setRecipientIds(Array.from(event.target.selectedOptions, (option) => option.value))} className="mt-1.5 min-h-40 w-full rounded-lg border border-[var(--border-strong)] bg-card p-2 text-sm font-normal">
                    {data.directory.map((user) => <option value={user.id} key={user.id}>{user.label}</option>)}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">{selectedUsers.length ? selectedUsers.map((user) => user.name).join(", ") : "Choose at least one person"}</span>
                </label>
                {mixedPartners && <p role="alert" className="m-0 rounded-lg bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">These people belong to different partners. Partners never see each other&rsquo;s messages, so start a separate conversation for each partner.</p>}
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" className="h-10 border-[var(--border-strong)] px-4" onClick={() => setNewConversationOpen(false)}>Cancel</Button>
                  <Button type="button" className="h-10 px-4" disabled={busy || recipientIds.length === 0 || mixedPartners} onClick={() => void createChannel()}>{busy ? "Creating…" : newType === "direct" ? "Start direct message" : "Create team channel"}</Button>
                </div>
              </div>
            </>
          ) : selected ? (
            <>
              <BarHeader title={selected.name}>
                <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold", archived ? "bg-[var(--surface-alt)] text-[var(--body)]" : "bg-[var(--success-surface)] text-[var(--success-ink)]")}>
                  <span className={cn("size-1.5 rounded-full", archived ? "bg-[var(--muted-foreground)]" : "bg-[var(--success)]")} aria-hidden="true" />{archived ? "Archived" : "Active"}
                </span>
                {selectedFacts?.payout && <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">{selectedFacts.payout}</span>}
                {selectedFacts?.status === "paused" && <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--warning-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--warning-ink)]">Partner paused</span>}
                {selected.channel_type !== "partner" && (
                  <Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-4" disabled={busy} onClick={() => void setArchived(!archived)}>{archived ? "Restore" : "Archive"}</Button>
                )}
              </BarHeader>
              <div ref={threadRef} className="flex max-h-[560px] min-h-0 flex-grow flex-col gap-[18px] overflow-y-auto p-5" aria-live="polite">
                {selected.messages.length === 0 ? (
                  <div className="m-auto text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />No messages yet. Send the first one.</div>
                ) : selected.messages.map((item) => {
                  if (item.messageKind === "system_card") return <SystemCard key={item.id} message={item} />;
                  const person = author(item.createdBy);
                  const name = person?.name ?? "Team member";
                  return (
                    <div key={item.id} className="flex gap-2.5">
                      <span className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold">{initials(name)}</span>
                      <span className="min-w-0">
                        <span className="block text-xs text-muted-foreground">{[name, person?.partnerName ?? (person ? "your team" : null), clock(item.createdAt)].filter(Boolean).join(" · ")}</span>
                        <span className="mt-1.5 block max-w-[520px] whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-alt)] px-3.5 py-2.5 text-sm text-[var(--body)]">{item.message}</span>
                        {item.attachments.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-2">
                            {item.attachments.map((attachment) => attachment.downloadUrl
                              ? <a key={attachment.id} href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-alt)]"><FileText className="size-3.5" aria-hidden="true" />{attachment.fileName} · {kb(attachment.sizeBytes)}</a>
                              : <span key={attachment.id} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground"><FileText className="size-3.5" aria-hidden="true" />{attachment.fileName} unavailable</span>)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <form className="flex flex-col gap-2 border-t border-border bg-[var(--canvas)] px-5 py-3.5" onSubmit={(event) => { event.preventDefault(); void send(); }}>
                <div className="flex gap-3">
                  <input aria-label="Write a message" maxLength={2000} placeholder={archived ? "This channel is archived — restore it to write" : "Write a message"} value={draft} disabled={archived} onChange={(event) => setDraft(event.target.value)} className="h-11 min-w-0 flex-grow rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-base disabled:opacity-60" />
                  <label className={cn("inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-semibold", archived && "pointer-events-none opacity-60")} title="Attach up to three files">
                    <Paperclip className="size-4" aria-hidden="true" /><span className="sr-only">Attach files</span>
                    <input className="sr-only" type="file" multiple disabled={archived} accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx" onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))} />
                  </label>
                  <Button type="submit" className="h-11 shrink-0 px-4" disabled={busy || archived || !draft.trim()}>{busy ? "Sending…" : "Send"}</Button>
                </div>
                {(files.length > 0 || draft.length > 1800) && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {files.map((file) => <span key={`${file.name}-${file.size}`} className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5"><FileText className="size-3" aria-hidden="true" />{file.name}<button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Remove ${file.name}`}><X className="size-3" /></button></span>)}
                    {draft.length > 1800 && <span className="ml-auto tabular-nums">{draft.length}/2,000</span>}
                  </div>
                )}
              </form>
            </>
          ) : (
            <div className="m-auto p-10 text-center text-sm text-muted-foreground"><MessageCircle className="mx-auto mb-2 size-6" aria-hidden="true" />{loaded ? "Choose a conversation, or start a new one." : "Loading…"}</div>
          )}
        </section>

        {/* Channel facts */}
        <div className="flex w-full shrink-0 flex-col gap-4 xl:w-[300px]">
          <section className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Channel</h2>
            {selected ? (
              <>
                <div className="mt-3.5 grid grid-cols-2 gap-x-6 gap-y-4">
                  <Fact label={selected.channel_type === "partner" ? "Partner" : "Channel"}>{selected.name}</Fact>
                  <Fact label="Type">{channelType(selected)}</Fact>
                  <Fact label="Linked leads">{linkedLeads}</Fact>
                  <Fact label="Messages">{selected.messages.length}</Fact>
                </div>
                {partnerMembers.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Partner members ({partnerMembers.length})</div>
                    <ul className="mt-2 space-y-1.5 text-sm">{partnerMembers.slice(0, 6).map((user) => <li key={user.id} className="flex justify-between gap-2"><span className="truncate">{user.name}</span><span className="shrink-0 text-xs text-muted-foreground">{user.role === "partner_admin" ? "Admin" : "User"}</span></li>)}</ul>
                  </div>
                )}
                {sharedAttachments.length > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Shared files ({sharedAttachments.length})</div>
                    <ul className="mt-2 space-y-1.5 text-sm">{sharedAttachments.slice(0, 5).map((attachment) => <li key={attachment.id} className="flex justify-between gap-2"><span className="truncate">{attachment.fileName}</span><span className="shrink-0 text-xs text-muted-foreground">{kb(attachment.sizeBytes)}</span></li>)}</ul>
                  </div>
                )}
                {selected.channel_type === "partner" && <p className="mt-4 text-xs text-muted-foreground">A partner channel carries the automatic lead updates, so it follows the partner and is never archived from here.</p>}
              </>
            ) : <p className="mt-3 text-sm text-muted-foreground">Choose a conversation to see its details.</p>}
          </section>
          <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
            <p className="font-semibold text-[var(--warning-ink)]">An automatic update is a record of fact</p>
            <p className="mt-1.5 text-[var(--body)]">It is tinted, labelled and cannot be edited. A system event styled as a typed message destroys the audit value.</p>
          </div>
        </div>
      </div>
      {error && <p className="text-sm font-semibold text-[var(--error-ink)]" role="alert">{error}</p>}
    </div>
  );
}
