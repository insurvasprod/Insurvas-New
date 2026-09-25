"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CheckCheck, CircleDot, FileText, Info, MessageCircle, Paperclip, Plus, Search, Send, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PartnerMessage } from "@/lib/partnerChat/cards";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { productLineLabel } from "@/lib/format/productLine";
import { composerCountLabel, PARTNER_CHAT_MESSAGE_MAX } from "@/lib/partnerChat/composer";
import { formatSupportPhone, type SupportContact } from "@/lib/partnerSupport/contact";

type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string };
type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; role?: string; partnerName?: string };
type ChatResponse = { channel?: { id: string; name: string; partner_id: string | null; channel_type: Channel["channel_type"]; status: string }; messages?: PartnerMessage[]; unreadCount?: number; realtimeTopic?: string; channels?: Array<{ channel: Channel; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string }>; directory?: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> } };

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "?").join(""); }
function channelTypeLabel(channel: Channel) { return channel.channel_type === "partner" ? "Agent channel" : channel.channel_type === "direct" ? "Direct message" : "Partner team channel"; }
function channelPreview(channel: Channel) { return channel.messages.at(-1)?.message ?? "No messages yet"; }
function formatMessageTime(value: string) { return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

function normalize(body: ChatResponse) {
  const channels = body.channels?.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic })) ?? (body.channel ? [{ ...body.channel, messages: body.messages ?? [], unreadCount: body.unreadCount ?? 0, realtimeTopic: body.realtimeTopic ?? `partner-chat:${body.channel.id}` }] : []);
  const tenantUsers = (body.directory?.tenantUsers ?? []).map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · Licensed agent`, scope: "agent" as const, role: item.role }));
  const partnerUsers = (body.directory?.partnerUsers ?? []).map((item) => ({ id: item.users.id, name: item.users.name, email: item.users.email, label: `${item.users.name} · Partner team`, scope: "partner" as const, role: item.role, partnerName: item.partners.name }));
  return { channels, directory: [...tenantUsers, ...partnerUsers].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) };
}

/**
 * An automatic update, as p-par-messages draws it: tinted and labelled so it can never be taken for
 * a person's message, with the time and "cannot be edited", then the facts. Lead, Product, Event and
 * State; State appears on cards recorded after it was added to the payload.
 */
function SystemCard({ message }: { message: PartnerMessage }) {
  const payload = message.cardPayload;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const product = text(payload.product);
  const fields: Array<[string, string]> = [
    ["Lead", text(payload.customer)],
    ["Product", product && product !== "lead" ? productLineLabel(product) : null],
    ["Event", text(message.message)],
    ["State", text(payload.state)],
    // Added as the card is read (enrichCards in lib/partnerChat/service.ts), from the agency's own flags.
    ["Work", typeof payload.counts_as_work_completed === "boolean" ? (payload.counts_as_work_completed ? "Counts as work completed" : "Does not count as work completed") : null],
    ["Picked up", typeof payload.minutes_after_submission === "number" ? (payload.minutes_after_submission === 0 ? "Under a minute after submission" : `${payload.minutes_after_submission} ${payload.minutes_after_submission === 1 ? "minute" : "minutes"} after submission`) : null],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  return <article className="portal-chat-auto-card" aria-label="Automatic update">
    <div className="portal-chat-auto-head"><span className="portal-status-chip is-info"><span aria-hidden="true" />Automatic update</span><span className="portal-chat-auto-time">{formatMessageTime(message.createdAt)} · cannot be edited</span></div>
    {fields.length > 0 && <dl className="portal-chat-auto-fields">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
  </article>;
}

function MessageAttachments({ message }: { message: PartnerMessage }) {
  if (!message.attachments.length) return null;
  return <ul className="portal-agent-chat-attachments" aria-label="Message attachments">{message.attachments.map((attachment) => <li key={attachment.id}>{attachment.downloadUrl ? <a href={attachment.downloadUrl} target="_blank" rel="noreferrer"><FileText aria-hidden="true" /><span>{attachment.fileName}</span><span className="portal-agent-chat-attachment-size">{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span></a> : <span><FileText aria-hidden="true" />{attachment.fileName} unavailable</span>}</li>)}</ul>;
}

export function PartnerChatPanel({ role }: { role: PartnerRole }) {
  const [data, setData] = useState<{ channels: Channel[]; directory: DirectoryUser[] }>({ channels: [], directory: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  // Mirrors the agent side: "Details" and the pane header control both used to do nothing.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [channelType, setChannelType] = useState<"direct" | "group">("direct");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [channelName, setChannelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [agencySupport, setAgencySupport] = useState<SupportContact | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/partner/chat", { cache: "no-store" });
      const body = await response.json().catch(() => null) as ChatResponse | { error?: string } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error : "Could not load partner chat");
      const next = normalize(body as ChatResponse);
      setAgencyName(typeof (body as { agencyName?: unknown }).agencyName === "string" ? (body as { agencyName: string }).agencyName : null);
      setAgencySupport((body as { agencySupport?: SupportContact }).agencySupport ?? null);
      setData(next);
      setSelectedId((current) => current && next.channels.some((channel) => channel.id === current) ? current : next.channels[0]?.id ?? null);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load partner chat"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const kickoff = window.setTimeout(() => void load(), 0); const fallback = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15000); return () => { window.clearTimeout(kickoff); window.clearInterval(fallback); }; }, [load]);
  // Keyed on strings, not data.channels (a new array every poll), so the 15s poll no longer
  // re-subscribes realtime or re-marks read. Read state still follows the newest message.
  const selectedTopic = data.channels.find((channel) => channel.id === selectedId)?.realtimeTopic ?? null;
  const selectedLatestId = data.channels.find((channel) => channel.id === selectedId)?.messages.at(-1)?.id ?? null;
  useEffect(() => { if (!selectedTopic) return; const supabase = getSupabaseBrowserClient(); let channel: RealtimeChannel | null = null; if (supabase) channel = supabase.channel(selectedTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe(); return () => { if (channel && supabase) void supabase.removeChannel(channel); }; }, [load, selectedTopic]);
  useEffect(() => { if (!selectedId || !selectedTopic) return; void fetch("/api/partner/chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: selectedId }) }); }, [selectedId, selectedTopic, selectedLatestId]);
  // Attachment-only messages need a valid editable body for the shared message contract.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (files.length > 0 && !draft.trim()) setDraft(files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`); }, [files.length, draft]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const filteredChannels = useMemo(() => { const query = search.trim().toLowerCase(); return query ? data.channels.filter((channel) => `${channel.name} ${channelPreview(channel)}`.toLowerCase().includes(query)) : data.channels; }, [data.channels, search]);
  const sharedAttachments = selected?.messages.flatMap((item) => item.attachments) ?? [];
  const relatedLeadCount = new Set(selected?.messages.map((item) => item.workItemId).filter(Boolean)).size;
  const directory = useMemo(() => data.directory.filter((item) => item.id !== undefined), [data.directory]);

  async function createChannel() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/partner/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_channel", channel_type: channelType, name: channelName, user_ids: recipientIds }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not create chat channel"); setChannelName(""); setRecipientIds([]); setNewOpen(false); notify.done(channelType === "direct" ? "Direct message ready" : "Partner team channel created"); await load(); if (body.channel?.id) setSelectedId(body.channel.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create chat channel"); } finally { setBusy(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault(); if (!selected || (!draft.trim() && files.length === 0)) return; setBusy(true); setError(null);
    try { const form = new FormData(); form.set("channel_id", selected.id); form.set("message", draft.trim() || (files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`)); files.forEach((file) => form.append("files", file)); const response = await fetch("/api/partner/chat", { method: "POST", body: form }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Message could not be sent"); setDraft(""); setFiles([]); notify.done("Message sent"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be sent"); } finally { setBusy(false); }
  }

  return <main className="m-stagger portal-agent-chat-page"><PageHeader className="pb-[1.1rem]" eyebrow="Partner workspace" title="Messages" description="Talk to your agent, and see automatic lead updates, in one place." actions={<><Button type="button" onClick={() => setNewOpen(true)}><Plus className="mr-1.5 size-4" aria-hidden="true" />New conversation</Button></>} /><div className="portal-agent-chat-layout" data-details={detailsOpen ? "open" : "closed"}><aside className="portal-agent-chat-conversations" aria-label="Conversations"><div className="portal-agent-chat-conversations-heading"><div><h2>Conversations</h2><p>{loading ? "Loading conversations…" : `${data.channels.length} ${data.channels.length === 1 ? "channel" : "channels"}`} · {role === "partner_admin" ? "admin access" : "partner access"}</p></div><button type="button" onClick={() => setNewOpen(true)} aria-label="New conversation" title="New conversation"><Plus aria-hidden="true" /></button></div><label className="portal-agent-chat-search"><Search aria-hidden="true" /><span className="sr-only">Search conversations</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations…" /></label><button type="button" className="portal-agent-chat-new-button" onClick={() => setNewOpen(true)}><Plus aria-hidden="true" />New conversation</button><div className="portal-agent-chat-list" role="list">{loading && <p className="portal-agent-chat-empty-list">Loading conversations…</p>}{!loading && filteredChannels.length === 0 && <p className="portal-agent-chat-empty-list">No conversations match your search.</p>}{filteredChannels.map((channel) => <button type="button" role="listitem" key={channel.id} className={`portal-agent-chat-conversation ${channel.id === selectedId ? "is-selected" : ""}`} onClick={() => setSelectedId(channel.id)} aria-current={channel.id === selectedId ? "true" : undefined}><span className="portal-agent-chat-avatar">{initials(channel.name)}</span><span className="portal-agent-chat-conversation-copy"><span className="portal-agent-chat-conversation-top"><strong>{channel.name}</strong><time>{channel.messages.at(-1) ? formatMessageTime(channel.messages.at(-1)!.createdAt) : "—"}</time></span><span className="portal-agent-chat-conversation-type">{channelTypeLabel(channel)} · {channel.status === "active" ? "Connected" : "Archived"}</span><span className="portal-agent-chat-conversation-preview">{channelPreview(channel)}</span></span>{channel.unreadCount > 0 && <span className="portal-agent-chat-unread" aria-label={`${channel.unreadCount} unread`}>{channel.unreadCount}</span>}</button>)}</div></aside><section className="portal-agent-chat-main" aria-label="Selected conversation">{newOpen ? <div className="portal-agent-chat-new-panel"><div className="portal-agent-chat-panel-heading"><div><p className="portal-page-eyebrow">Start a channel</p><h2>New conversation</h2><p>Message a licensed agent or coordinate with your own partner team. Participant access is checked server-side.</p></div><button type="button" onClick={() => setNewOpen(false)} aria-label="Close new conversation"><X aria-hidden="true" /></button></div><div className="portal-agent-chat-new-grid"><label><span>Conversation type</span><select value={channelType} onChange={(event) => setChannelType(event.target.value as "direct" | "group")}><option value="direct">Direct message</option><option value="group">Partner team channel</option></select></label><label><span>Channel name <em>optional</em></span><input maxLength={160} value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder={channelType === "direct" ? "Direct message" : "e.g. Partner operations"} /></label><label className="portal-agent-chat-new-full"><span>{channelType === "direct" ? "Recipient" : "Participants"}</span><select multiple value={recipientIds} onChange={(event) => setRecipientIds(Array.from(event.target.selectedOptions, (option) => option.value))}>{directory.map((user) => <option value={user.id} key={user.id}>{user.label}</option>)}</select><small>{recipientIds.length ? directory.filter((user) => recipientIds.includes(user.id)).map((user) => user.name).join(", ") : "Choose at least one person"}</small></label></div><div className="portal-agent-chat-new-actions"><button type="button" className="portal-agent-chat-secondary" onClick={() => setNewOpen(false)}>Cancel</button><button type="button" className="portal-agent-chat-primary" disabled={busy || recipientIds.length === 0} onClick={() => void createChannel()}>{busy ? "Creating…" : channelType === "direct" ? "Start direct message" : "Create team channel"}</button></div></div> : selected ? <><header className="portal-agent-chat-thread-header"><div className="portal-agent-chat-avatar portal-agent-chat-avatar-large">{initials(selected.name)}</div><div className="min-w-0"><h2>{selected.name}</h2><p>{channelTypeLabel(selected)} <span>·</span> {selected.partner_id ? "Your organization" : "Secure workspace"} <span>·</span> <CircleDot aria-hidden="true" /> {selected.status === "active" ? "Connected" : "Archived"}</p></div><div className="portal-agent-chat-thread-actions"><button type="button" className="portal-agent-chat-secondary" aria-expanded={detailsOpen} aria-controls="partner-chat-details" onClick={() => setDetailsOpen((value) => !value)}><Info aria-hidden="true" />Details</button></div></header><div className="portal-agent-chat-messages" aria-live="polite">{selected.messages.length === 0 ? <div className="portal-agent-chat-no-messages"><MessageCircle aria-hidden="true" /><h3>No messages yet</h3><p>Send the first update to this conversation.</p></div> : selected.messages.map((item) => item.messageKind === "system_card" ? <SystemCard key={item.id} message={item} /> : <article className="portal-agent-chat-text-message" key={item.id}><div className="portal-agent-chat-message-meta"><strong>{item.createdBy ? data.directory.find((user) => user.id === item.createdBy)?.name ?? "Workspace member" : "INSURVAS"}</strong><span>{formatMessageTime(item.createdAt)}</span><CheckCheck aria-hidden="true" /></div><p>{item.message}</p><MessageAttachments message={item} /></article>)}</div><form className="portal-agent-chat-composer" onSubmit={send}><textarea aria-label="Message" aria-describedby="partner-chat-composer-help" maxLength={PARTNER_CHAT_MESSAGE_MAX} placeholder={`Write a message to ${selected.name}…`} value={draft} onChange={(event) => setDraft(event.target.value)} /><div className="portal-agent-chat-composer-footer"><label className="portal-agent-chat-attach"><Paperclip aria-hidden="true" /><span>Attach files</span><input className="sr-only" type="file" multiple accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx" onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))} /></label><div className="portal-agent-chat-file-chips">{files.map((file) => <span key={`${file.name}-${file.size}`}><FileText aria-hidden="true" />{file.name}<button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Remove ${file.name}`}><X aria-hidden="true" /></button></span>)}</div><button className="portal-agent-chat-primary portal-agent-chat-send" type="submit" disabled={busy || (!draft.trim() && files.length === 0)}>{busy ? "Sending…" : "Send message"}<Send aria-hidden="true" /></button></div><div className="portal-chat-composer-help" id="partner-chat-composer-help"><span>If sending fails, your message stays in the box.</span><span className="portal-chat-composer-count">{composerCountLabel(draft.length)}</span></div></form></> : <div className="portal-agent-chat-no-selection"><MessageCircle aria-hidden="true" /><h2>Select a conversation</h2><p>Choose an agent channel or start a private partner-team conversation.</p></div>}</section>{detailsOpen && <aside id="partner-chat-details" className="portal-agent-chat-details" aria-label="Conversation details"><div className="portal-agent-chat-details-heading"><h2>Details</h2><button type="button" aria-label="Close conversation details" onClick={() => setDetailsOpen(false)}><Info aria-hidden="true" /></button></div>{selected ? <><section className="portal-agent-chat-detail-section"><p className="portal-agent-chat-detail-label">Channel</p><div className="portal-agent-chat-partner"><span className="portal-agent-chat-avatar portal-agent-chat-avatar-large">{initials(selected.name)}</span><div><strong>{selected.name}</strong><span>{channelTypeLabel(selected)}</span><small><CircleDot aria-hidden="true" />{selected.status === "active" ? "Active" : "Archived"}</small></div></div></section><section className="portal-agent-chat-detail-section"><dl className="portal-chat-detail-grid">{agencyName && <div><dt>Agent</dt><dd>{agencyName}</dd></div>}{agencySupport?.schemaReady && <><div><dt>Support</dt>{agencySupport.email ? <dd>{agencySupport.email}</dd> : <dd className="is-unset">Not set by your agency</dd>}</div><div><dt>Phone</dt>{agencySupport.phone ? <dd>{formatSupportPhone(agencySupport.phone)}</dd> : <dd className="is-unset">Not set by your agency</dd>}</div></>}<div><dt>Related leads</dt><dd>{relatedLeadCount}</dd></div></dl></section><section className="portal-agent-chat-detail-section"><div className="portal-agent-chat-section-heading"><p className="portal-agent-chat-detail-label">Shared files ({sharedAttachments.length})</p><Link href="/partner/pipeline">Open pipeline</Link></div>{sharedAttachments.length > 0 ? <ul className="portal-agent-chat-shared-files">{sharedAttachments.slice(0, 5).map((attachment) => <li key={attachment.id}><FileText aria-hidden="true" /><span>{attachment.fileName}<small>{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</small></span></li>)}</ul> : <p className="portal-agent-chat-detail-muted">No files shared yet.</p>}</section></> : <p className="portal-agent-chat-detail-muted">Select a conversation to see channel details.</p>}<div className="portal-chat-record-note"><strong>An automatic update is a record of fact</strong><p>It is tinted, labelled and cannot be edited — by you or by your agent.</p></div></aside>}</div>{error && <p className="portal-agent-chat-error" role="alert">{error}</p>}</main>;
}
