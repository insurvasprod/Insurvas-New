"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, BellRing, Check, CheckCheck, CircleAlert, FileText, Headset, MessageCircle, PhoneCall, PhoneOff, Repeat2, UserCheck, type LucideIcon } from "lucide-react";

import { PersonFace } from "@/components/app/partner-chat/group-members";
import { Button } from "@/components/ui/button";
import { clockTime } from "@/lib/format/dates";
import { productLineLabel } from "@/lib/format/productLine";
import { cardTitle, type PartnerCardType, type PartnerMessage } from "@/lib/partnerChat/cards";
import { buildThread, type ThreadItem } from "@/lib/partnerChat/thread";
import { cn } from "@/lib/utils";

/**
 * The thread, drawn as a conversation.
 *
 * Before this, every message was a full-width block on the same ground: the partner's own messages
 * and the agency's sat in one column with one treatment, so you could not tell at a glance who had
 * said what (owner, 30 Oct). Now a message has a side, consecutive messages from one person share a
 * name and a time, and the days are separated.
 *
 * The shape — runs, days, what a separator says — is decided by `lib/partnerChat/thread.ts` and
 * tested there. This file only draws it.
 */

/** Each side's ground. Both sit on the panel's own card surface, so both read as raised. */
const BUBBLE = {
  mine: "bg-[var(--primary-soft)]",
  theirs: "bg-[var(--surface-alt)]",
} as const;

function MessageAttachments({ message }: { message: PartnerMessage }) {
  if (!message.attachments.length) return null;
  return (
    <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0" aria-label="Message attachments">
      {message.attachments.map((attachment) => {
        const size = `${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB`;
        const body = (
          <>
            <FileText className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{attachment.fileName}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{size}</span>
          </>
        );
        return (
          <li key={attachment.id} className="min-w-0">
            {attachment.downloadUrl
              ? <a href={attachment.downloadUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 rounded-badge border border-border bg-card px-2 py-1.5 text-xs text-foreground no-underline hover:border-[var(--border-strong)]">{body}</a>
              : <span className="flex min-w-0 items-center gap-1.5 rounded-badge border border-border px-2 py-1.5 text-xs text-muted-foreground">{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** What each kind of automatic update looks like: a round icon, in the colour of what happened. */
const CARD_LOOK: Record<PartnerCardType, { icon: LucideIcon; tone: string }> = {
  new_lead: { icon: BellRing, tone: "bg-[var(--primary-soft)] text-[var(--accent-ink)]" },
  connected: { icon: PhoneCall, tone: "bg-[var(--info-surface)] text-[var(--info-ink)]" },
  transferred: { icon: Repeat2, tone: "bg-[var(--info-surface)] text-[var(--info-ink)]" },
  call_dropped: { icon: PhoneOff, tone: "bg-[var(--warning-surface)] text-[var(--warning-ink)]" },
  agent_ready: { icon: Headset, tone: "bg-[var(--primary-soft)] text-[var(--accent-ink)]" },
  call_outcome: { icon: UserCheck, tone: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  nobody_claimed: { icon: CircleAlert, tone: "bg-[var(--warning-surface)] text-[var(--warning-ink)]" },
};

/**
 * An automatic update (owner pick A, 2026-11-04): the headline says what happened, one line says
 * which lead, and only the facts that mean something become pills. It used to be a table of six
 * grey rows, one of which ("Event") repeated the lead and the product a second time. Every fact is
 * still here; none of it is a form. It stays left with the other incoming content, so its system
 * origin is clear without looking like something the agent or the partner wrote.
 */
function SystemNotice({ message, zone }: { message: PartnerMessage; zone: string }) {
  const payload = message.cardPayload;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const product = text(payload.product);
  const lead = [text(payload.customer), product && product !== "lead" ? productLineLabel(product) : null, text(payload.state)].filter(Boolean).join(" · ");
  const look = CARD_LOOK[message.cardType ?? "new_lead"] ?? CARD_LOOK.new_lead;
  const Glyph = look.icon;
  // The event text repeats the lead and product on a new-lead card; on the others it carries the detail.
  const detail = message.cardType === "new_lead" ? null : text(message.message);
  const countsAsWork = typeof payload.counts_as_work_completed === "boolean" ? payload.counts_as_work_completed : null;
  const minutes = typeof payload.minutes_after_submission === "number" ? payload.minutes_after_submission : null;
  const pickedUp = minutes === null ? null : minutes === 0 ? "picked up in under a minute" : `picked up in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  return (
    <article className="mr-auto flex w-full max-w-[32rem] gap-3 rounded-lg border border-border bg-[var(--surface-alt)] px-3 py-3 sm:px-4" aria-label="Automatic update">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", look.tone)} aria-hidden="true">
        <Glyph className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="m-0 min-w-0 truncate text-sm font-semibold text-foreground">{cardTitle(message)}</h3>
          <time dateTime={message.createdAt} className="shrink-0 text-xs text-[var(--body)]">{clockTime(message.createdAt, zone, "12h")}</time>
        </div>
        <p className="sr-only">This update was created by the system and cannot be edited.</p>
        {lead && <p className="m-0 mt-0.5 break-words text-sm text-[var(--body)]">{lead}</p>}
        {detail && <p className="m-0 mt-1 break-words text-sm text-foreground">{detail}</p>}
        {(countsAsWork !== null || pickedUp) && (
          <p className="m-0 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--body)]">
            {countsAsWork !== null && <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-medium", countsAsWork ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface)] text-[var(--body)] ring-1 ring-border")}>{countsAsWork ? "Counts as work" : "Not counted as work"}</span>}
            {pickedUp && <span>{pickedUp}</span>}
          </p>
        )}
      </div>
    </article>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label={label}>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="text-xs font-medium text-[var(--body)]">{label}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function UnreadLine() {
  return (
    <div className="flex items-center gap-3 py-1" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-[var(--primary)]" aria-hidden="true" />
      <span className="text-xs font-semibold text-[var(--accent-ink)]">New messages</span>
      <span className="h-px flex-1 bg-[var(--primary)]" aria-hidden="true" />
    </div>
  );
}

function MessageGroup({ group, name, zone, othersReadAt }: { group: Extract<ThreadItem, { kind: "group" }>; name: string; zone: string; othersReadAt: string | null }) {
  const mine = group.side === "mine";
  const first = group.messages[0]!;
  return (
    <div className={cn("flex min-w-0 items-end gap-2", mine ? "justify-end" : "justify-start")}>
      {!mine && <span className="mb-0.5 self-end"><PersonFace name={name} scale="sm" /></span>}
      <div className={cn("flex min-w-0 flex-col gap-1", mine ? "items-end" : "items-start")}>
        <p className={cn("m-0 flex max-w-full items-baseline gap-1.5 px-1 text-xs text-muted-foreground", mine && "flex-row-reverse")}>
          <span className="min-w-0 truncate font-medium text-foreground">{mine ? "You" : name}</span>
          <time dateTime={first.createdAt} className="shrink-0 sm:hidden">{clockTime(first.createdAt, zone, "12h")}</time>
        </p>
        {group.messages.map((message, index) => {
          const last = index === group.messages.length - 1;
          const seen = Boolean(
            mine &&
            last &&
            othersReadAt &&
            new Date(othersReadAt).getTime() >= new Date(message.createdAt).getTime(),
          );
          return (
            <div key={message.id} className={cn("group/message flex min-w-0 max-w-full items-center gap-2", mine && "flex-row-reverse")}>
              <div
                className={cn(
                  "min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm leading-5 text-foreground sm:max-w-[34rem]",
                  BUBBLE[group.side],
                  // A small corner on the side the message came from: a tail, without drawing one.
                  last && (mine ? "rounded-br-sm" : "rounded-bl-sm"),
                )}
              >
                <p className="m-0 whitespace-pre-wrap break-words">{message.message}</p>
                <MessageAttachments message={message} />
                {mine && last && (
                  <span
                    className={cn("mt-1 flex items-center justify-end gap-1 text-xs", seen ? "text-[var(--info-ink)]" : "text-muted-foreground")}
                    title={seen ? `Seen by a conversation member ${clockTime(othersReadAt as string, zone, "12h")}` : "Sent · waiting to be seen"}
                    aria-label={seen ? "Seen by a conversation member" : "Sent, not seen yet"}
                  >
                    {seen ? <CheckCheck className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
                    {seen ? "Seen" : "Sent"}
                  </span>
                )}
              </div>
              {/* The time of this message, there when you point at it and out of the way when you do not. */}
              <time dateTime={message.createdAt} className="hidden shrink-0 text-xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 sm:block">{clockTime(message.createdAt, zone, "12h")}</time>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  viewerId,
  nameOf,
  zone = "UTC",
  othersReadAt = null,
  className,
  emptyTitle = "No messages yet",
  emptyHint = "Send the first update to this conversation.",
  unreadCount = 0,
}: {
  messages: readonly PartnerMessage[];
  /** The signed-in user, so their own messages take the sent side. Null until the channels land. */
  viewerId: string | null;
  nameOf: (userId: string | null) => string;
  zone?: string;
  /** Latest read cursor from another member of this conversation. */
  othersReadAt?: string | null;
  className?: string;
  emptyTitle?: string;
  emptyHint?: string;
  /** How many incoming messages were unread when the conversation opened: the line goes before the first of them. */
  unreadCount?: number;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Scrolled up away from the newest message: the "Jump to latest" button shows. */
  const [away, setAway] = useState(false);
  /** Whether the reader is at the newest message. Starts true: that is where a thread opens. */
  const atNewest = useRef(true);
  const newestMessage = messages.at(-1) ?? null;
  const newest = newestMessage?.id ?? null;
  const newestIsMine = Boolean(viewerId && newestMessage?.createdBy === viewerId);

  // Open on the newest message, and stay with it — but only while the reader is already there. Your
  // own message always wins: you pressed send, you should see it land.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const toBottom = () => { element.scrollTop = element.scrollHeight; };
    if (newestIsMine || atNewest.current) toBottom();

    const onScroll = () => {
      atNewest.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
      setAway(!atNewest.current);
    };
    element.addEventListener("scroll", onScroll, { passive: true });

    // The box can change height after that first line runs — the pane grows into the page on the
    // first paint, and on a phone the thread is display:none behind the conversation list until one
    // is opened. Both leave the reader at the oldest message unless the bottom is taken again.
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0 && atNewest.current) toBottom(); });
    observer.observe(element);
    return () => { element.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, [newest, newestIsMine]);

  const items = buildThread(messages, { viewerId, zone });
  // The first of the messages that were unread when this opened (the newest N from other people).
  const firstUnreadId = (() => {
    if (unreadCount <= 0) return null;
    let seen = 0;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].createdBy !== viewerId || messages[index].messageKind === "system_card") seen += 1;
      if (seen === unreadCount) return messages[index].id;
    }
    return null;
  })();
  const jumpToLatest = () => { const element = scroller.current; if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }); };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
    <div
      ref={scroller}
      // Focusable, because a region that scrolls has to be reachable by someone who has no mouse;
      // "log" is what a thread of messages is, and it carries the live announcement with it.
      tabIndex={0}
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)] sm:px-4", className)}
    >
      {items.length === 0 ? (
        <div className="m-auto flex flex-col items-center gap-2 px-4 text-center">
          <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
          <h3 className="m-0 text-card-title font-semibold text-foreground">{emptyTitle}</h3>
          <p className="m-0 text-sm text-muted-foreground">{emptyHint}</p>
        </div>
      ) : items.map((item) => {
        if (item.kind === "day") return <DaySeparator key={item.key} label={item.label} />;
        const line = firstUnreadId && (item.kind === "notice" ? item.message.id === firstUnreadId : item.messages.some((message) => message.id === firstUnreadId));
        const body = item.kind === "notice"
          ? <SystemNotice key={item.key} message={item.message} zone={zone} />
          : <MessageGroup key={item.key} group={item} name={nameOf(item.authorId)} zone={zone} othersReadAt={othersReadAt} />;
        return line ? <div key={item.key} className="flex flex-col gap-2"><UnreadLine />{body}</div> : body;
      })}
    </div>
    {away && (
      <Button type="button" size="sm" variant="secondary" className="absolute bottom-3 right-4 shadow-[var(--shadow-rest)]" onClick={jumpToLatest}>
        <ArrowDown aria-hidden="true" />Latest
      </Button>
    )}
    </div>
  );
}
