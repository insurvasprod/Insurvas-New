"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { ArrowLeft, Building2, CircleDot, FileText, Info, MessageCircle, Plus, Search, User, Users } from "lucide-react";
import { notify } from "@/lib/notify";

import { MultiPicker } from "@/components/app/multi-picker";
import { ChatThread } from "@/components/partner/chat-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChatComposer } from "@/components/ui/chat-composer";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { Segmented } from "@/components/ui/view-tabs";
import { clockTime, viewerTimeZone } from "@/lib/format/dates";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PartnerMessage } from "@/lib/partnerChat/cards";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { composerCountLabel, PARTNER_CHAT_MESSAGE_MAX } from "@/lib/partnerChat/composer";
import { formatSupportPhone, type SupportContact } from "@/lib/partnerSupport/contact";
import { cn } from "@/lib/utils";

/**
 * Messages: conversations beside a thread, and nothing else on screen.
 *
 * It used to be three panels at once — conversations, thread, and a details column that was mostly
 * "Not set by your agency" — on 127 hand-rolled `.portal-agent-chat-*` rules (§9). Details is
 * reference, not something read while typing, so it is a `Sheet` opened from the thread's header
 * (§11), the page is built from the shared kit, and on a phone it is one pane at a time: the list,
 * then the conversation, with a way back.
 */

/** Below this the frame stops shrinking and the page scrolls instead — a laptop in a short window. */
const MIN_FRAME_PX = 416;

type Channel = { id: string; name: string; channel_type: "partner" | "direct" | "group"; partner_id: string | null; status: string; unreadCount: number; messages: PartnerMessage[]; realtimeTopic: string };
type DirectoryUser = { id: string; name: string; email: string; label: string; scope: "agent" | "partner"; role?: string; partnerName?: string };
type ChatResponse = { viewerId?: string | null; channel?: { id: string; name: string; partner_id: string | null; channel_type: Channel["channel_type"]; status: string }; messages?: PartnerMessage[]; unreadCount?: number; realtimeTopic?: string; channels?: Array<{ channel: Channel; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string }>; directory?: { tenantUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string } }>; partnerUsers: Array<{ user_id: string; role?: string; users: { id: string; name: string; email: string; status: string }; partners: { name: string } }> } };

function channelTypeLabel(channel: Channel) { return channel.channel_type === "partner" ? "Agent channel" : channel.channel_type === "direct" ? "Direct message" : "Partner team channel"; }
function channelPreview(channel: Channel) { return channel.messages.at(-1)?.message ?? "No messages yet"; }

/**
 * §10 reserves avatars for staff users with a photo. A channel is not a person, and initials in a
 * circle said nothing about it — so a glyph says what kind of conversation it is instead.
 */
function ChannelIcon({ channel, large = false }: { channel: Channel; large?: boolean }) {
  const Glyph = channel.channel_type === "direct" ? User : channel.channel_type === "group" ? Users : Building2;
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-md bg-[var(--surface-alt)] text-muted-foreground", large ? "size-10" : "size-9")}>
      <Glyph className={large ? "size-5" : "size-[18px]"} aria-hidden="true" />
      <span className="sr-only">{channelTypeLabel(channel)}</span>
    </span>
  );
}

function Pair({ label, value, unset }: { label: string; value: string | null; unset?: string }) {
  if (!value && !unset) return null;
  return (
    <>
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className={cn("m-0 min-w-0 break-words", value ? "font-medium text-foreground" : "text-muted-foreground")}>{value ?? unset}</dd>
    </>
  );
}

function normalize(body: ChatResponse) {
  const channels = body.channels?.map((item) => ({ ...item.channel, messages: item.messages, unreadCount: item.unreadCount, realtimeTopic: item.realtimeTopic })) ?? (body.channel ? [{ ...body.channel, messages: body.messages ?? [], unreadCount: body.unreadCount ?? 0, realtimeTopic: body.realtimeTopic ?? `partner-chat:${body.channel.id}` }] : []);
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

export function PartnerChatPanel({ role, sample }: { role: PartnerRole; sample?: PartnerChatSample }) {
  const [data, setData] = useState<{ channels: Channel[]; directory: DirectoryUser[] }>(sample ? { channels: sample.channels, directory: sample.directory } : { channels: [], directory: [] });
  const [selectedId, setSelectedId] = useState<string | null>(sample?.channels[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState("");
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
  useEffect(() => { if (sampled || !selectedId || !selectedTopic) return; void fetch("/api/partner/chat", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: selectedId }) }); }, [sampled, selectedId, selectedTopic, selectedLatestId]);
  // Attachment-only messages need a valid editable body for the shared message contract.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (files.length > 0 && !draft.trim()) setDraft(files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`); }, [files.length, draft]);

  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const filteredChannels = useMemo(() => { const query = search.trim().toLowerCase(); return query ? data.channels.filter((channel) => `${channel.name} ${channelPreview(channel)}`.toLowerCase().includes(query)) : data.channels; }, [data.channels, search]);
  const sharedAttachments = selected?.messages.flatMap((item) => item.attachments) ?? [];
  const relatedLeadCount = new Set(selected?.messages.map((item) => item.workItemId).filter(Boolean)).size;
  const directory = useMemo(() => data.directory.filter((item) => item.id !== undefined), [data.directory]);

  // The thread runs client-side after the channels land, so the viewer's own zone is readable here
  // (lib/format/dates: never during a server render).
  const zone = viewerTimeZone();
  const nameOf = useCallback(
    (userId: string | null) => (userId ? data.directory.find((user) => user.id === userId)?.name ?? "Workspace member" : "INSURVAS"),
    [data.directory]);

  // The frame runs from where it sits to the page's own bottom margin. The gutter is read from the
  // first ancestor that has one, so it follows the shell's p-4 / sm:p-6 / lg:p-8 without repeating
  // those numbers here — and a header that wraps on a narrow window moves the top, not the margin.
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      let gutter = 0;
      for (let node = frame.parentElement; node; node = node.parentElement) {
        const padding = Number.parseFloat(getComputedStyle(node).paddingBottom) || 0;
        if (padding > 0) { gutter = padding; break; }
      }
      const top = frame.getBoundingClientRect().top;
      setFrameHeight(Math.max(MIN_FRAME_PX, Math.round(window.innerHeight - top - gutter)));
    };
    fit();
    window.addEventListener("resize", fit);
    const observer = new ResizeObserver(fit);
    if (frame.parentElement) observer.observe(frame.parentElement);
    return () => { window.removeEventListener("resize", fit); observer.disconnect(); };
  }, []);

  function openConversation(id: string) { setSelectedId(id); setThreadOnPhone(true); setDetailsOpen(false); }

  async function createChannel() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/partner/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_channel", channel_type: channelType, name: channelName, user_ids: recipientIds }) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Could not create chat channel"); setChannelName(""); setRecipientIds([]); setNewOpen(false); notify.done(channelType === "direct" ? "Direct message ready" : "Partner team channel created"); await load(); if (body.channel?.id) openConversation(body.channel.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create chat channel"); } finally { setBusy(false); }
  }

  // The composer owns the form and its default; this just sends.
  async function send() {
    if (!selected || (!draft.trim() && files.length === 0)) return; setBusy(true); setError(null);
    try { const form = new FormData(); form.set("channel_id", selected.id); form.set("message", draft.trim() || (files.length === 1 ? "Shared an attachment" : `Shared ${files.length} attachments`)); files.forEach((file) => form.append("files", file)); const response = await fetch("/api/partner/chat", { method: "POST", body: form }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.error ?? "Message could not be sent"); setDraft(""); setFiles([]); notify.done("Message sent"); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Message could not be sent"); } finally { setBusy(false); }
  }

  return (
    <main className="m-stagger mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col">
      <PageHeader
        className="pb-[1.1rem]"
        title="Messages"
        description="Chat with your agent and your team."
        visible
        infoDescription
        actions={<Button type="button" onClick={() => setNewOpen(true)}><Plus aria-hidden="true" />New conversation</Button>}
      />

      {/* It reaches the page's bottom margin exactly — measured, not guessed from the viewport with
          a fixed subtraction, which is what left a band of empty page under it (owner, 30 Oct). */}
      <Card ref={frameRef} style={frameHeight ? { height: frameHeight } : undefined} className="min-h-[26rem] flex-row gap-0 overflow-hidden p-0 py-0">
        {/* Conversations. On a phone this is the page until one is opened. */}
        <aside
          className={cn("flex w-full min-w-0 flex-col md:w-[16rem] md:shrink-0 md:border-r md:border-border lg:w-[17rem]", threadOnPhone && "hidden md:flex")}
          aria-label="Conversations"
        >
          <div className="flex items-start justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
            <div className="min-w-0">
              <h2 className="m-0 text-card-title font-semibold text-foreground">Conversations</h2>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                {loading ? "" : `${data.channels.length} ${data.channels.length === 1 ? "channel" : "channels"} · `}
                {role === "partner_admin" ? "admin access" : "partner access"}
              </p>
            </div>
            <Button type="button" variant="secondary" size="icon-sm" onClick={() => setNewOpen(true)} aria-label="New conversation">
              <Plus aria-hidden="true" />
            </Button>
          </div>

          <div className="relative px-3 py-2.5 sm:px-4">
            <Search className="pointer-events-none absolute left-[1.4rem] top-1/2 size-4 -translate-y-1/2 text-muted-foreground sm:left-[1.65rem]" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
              className={cn(control, "mt-0 pl-9")}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" role="list">
            {loading && <div className="px-3 sm:px-4"><SectionLoading rows={5} columns={2} label="Loading conversations" /></div>}
            {!loading && filteredChannels.length === 0 && <p className="m-0 px-4 py-6 text-center text-sm text-muted-foreground">No conversations match your search.</p>}
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
                  className={cn(
                    "flex w-full min-w-0 items-start gap-3 border-b border-l-[3px] border-b-border border-l-transparent px-3 py-3 text-left transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)] motion-reduce:transition-none sm:px-4",
                    current && "border-l-[var(--primary)] bg-[var(--primary-soft)]",
                  )}
                >
                  <ChannelIcon channel={channel} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{channel.name}</span>
                      <time className="shrink-0 text-xs text-muted-foreground">{newest ? clockTime(newest.createdAt, zone, "12h") : "—"}</time>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{channelTypeLabel(channel)} · {channel.status === "active" ? "Connected" : "Archived"}</span>
                    <span className="truncate text-xs text-muted-foreground">{channelPreview(channel)}</span>
                  </span>
                  {channel.unreadCount > 0 && (
                    <span className="grid size-5 shrink-0 place-items-center self-center rounded-badge bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]" aria-label={`${channel.unreadCount} unread`}>
                      {channel.unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* The conversation. On a phone it is the page once one is open. */}
        <section className={cn("flex min-w-0 flex-1 flex-col", !threadOnPhone && "hidden md:flex")} aria-label="Selected conversation">
          {selected ? (
            <>
              <header className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-4">
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
                      <CircleDot className="size-3 text-[var(--success-ink)]" aria-hidden="true" />
                      {selected.status === "active" ? "Connected" : "Archived"}
                    </span>
                  </p>
                </div>
                <Button type="button" variant="secondary" size="sm" aria-expanded={detailsOpen} aria-controls="partner-chat-details" onClick={() => setDetailsOpen(true)}>
                  <Info aria-hidden="true" />
                  <span className="hidden sm:inline">Details</span>
                </Button>
              </header>

              <ChatThread messages={selected.messages} viewerId={viewerId} nameOf={nameOf} zone={zone} />

              <ChatComposer
                value={draft}
                onChange={setDraft}
                onSubmit={() => void send()}
                files={files}
                onFilesChange={setFiles}
                busy={busy}
                placeholder={`Write a message to ${selected.name}…`}
                maxLength={PARTNER_CHAT_MESSAGE_MAX}
                countLabel={composerCountLabel}
                accept="image/jpeg,image/png,image/gif,application/pdf,text/plain,.docx,.xlsx"
                className="mx-3 mb-3 sm:mx-4 sm:mb-4"
              />
            </>
          ) : (
            <div className="m-auto flex flex-col items-center gap-2 px-4 py-8 text-center">
              <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
              <h2 className="m-0 text-card-title font-semibold text-foreground">Select a conversation</h2>
              <p className="m-0 text-sm text-muted-foreground">Choose an agent channel or start a private partner-team conversation.</p>
            </div>
          )}
        </section>
      </Card>

      {error && <p role="alert" className="mt-3 rounded-md border border-border bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">{error}</p>}

      {detailsOpen && selected && (
        <Sheet
          id="partner-chat-details"
          title="Conversation details"
          subtitle={selected.name}
          onClose={() => setDetailsOpen(false)}
          closeLabel="Close conversation details"
          footer={<Button asChild variant="secondary" className="w-full"><Link href="/partner/pipeline">Open pipeline</Link></Button>}
        >
          <dl className="m-0 grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
            <Pair label="Channel" value={channelTypeLabel(selected)} />
            <Pair label="Status" value={selected.status === "active" ? "Active" : "Archived"} />
            <Pair label="Your agency" value={agencyName} />
            {agencySupport?.schemaReady && (
              <>
                <Pair label="Support email" value={agencySupport.email} unset="Not set by your agency" />
                <Pair label="Support phone" value={agencySupport.phone ? formatSupportPhone(agencySupport.phone) : null} unset="Not set by your agency" />
              </>
            )}
            <Pair label="Related leads" value={String(relatedLeadCount)} />
          </dl>

          <section className="min-w-0 border-t border-border pt-4">
            <h3 className="m-0 text-card-title font-semibold text-foreground">Shared files ({sharedAttachments.length})</h3>
            {sharedAttachments.length > 0 ? (
              <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {sharedAttachments.slice(0, 8).map((attachment) => (
                  <li key={attachment.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 truncate text-foreground">{attachment.fileName}</span>
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-2 text-sm text-muted-foreground">No files shared yet.</p>
            )}
          </section>
        </Sheet>
      )}

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
