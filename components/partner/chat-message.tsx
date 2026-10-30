"use client";

import { useEffect, useRef } from "react";
import { Check, CheckCheck, FileText, Info, MessageCircle } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { clockTime } from "@/lib/format/dates";
import { productLineLabel } from "@/lib/format/productLine";
import type { PartnerMessage } from "@/lib/partnerChat/cards";
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

/**
 * An automatic update. It keeps every fact it carried — a partner relies on these to know what the
 * agency did with a lead — but it is no longer a full-width tinted panel competing with the
 * conversation: left aligned with the other incoming content, so its system origin is clear without
 * making it look like a message written by the agent or partner.
 */
function SystemNotice({ message, zone }: { message: PartnerMessage; zone: string }) {
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

  return (
    <article className="mr-auto flex w-full max-w-[34rem] gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-alt)] px-3 py-2.5 sm:px-4" aria-label="Automatic update">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[var(--info-surface)] text-[var(--info-ink)]" aria-hidden="true">
        <Info className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="info">Automatic update</StatusChip>
          <span className="text-xs text-muted-foreground">{clockTime(message.createdAt, zone, "12h")}</span>
        </div>
        <p className="sr-only">This update was created by the system and cannot be edited.</p>
        {fields.length > 0 && (
          <dl className="m-0 mt-2 grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="min-w-0 text-xs leading-5 text-muted-foreground">{label}</dt>
                <dd className="m-0 min-w-0 break-words leading-5 text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-badge border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function MessageGroup({ group, name, zone, othersReadAt }: { group: Extract<ThreadItem, { kind: "group" }>; name: string; zone: string; othersReadAt: string | null }) {
  const mine = group.side === "mine";
  const first = group.messages[0]!;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", mine ? "items-end" : "items-start")}>
      <p className={cn("m-0 flex max-w-full items-baseline gap-1.5 px-1 text-xs text-muted-foreground", mine && "flex-row-reverse")}>
        <span className="min-w-0 truncate font-medium text-foreground">{mine ? "You" : name}</span>
        <time dateTime={first.createdAt} className="shrink-0">{clockTime(first.createdAt, zone, "12h")}</time>
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
          <div
            key={message.id}
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
        );
      })}
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
}: {
  messages: readonly PartnerMessage[];
  /** The signed-in user, so their own messages take the sent side. Null until the channels land. */
  viewerId: string | null;
  nameOf: (userId: string | null) => string;
  zone?: string;
  /** Latest read cursor from another member of this conversation. */
  othersReadAt?: string | null;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
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

    const onScroll = () => { atNewest.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 24; };
    element.addEventListener("scroll", onScroll, { passive: true });

    // The box can change height after that first line runs — the pane grows into the page on the
    // first paint, and on a phone the thread is display:none behind the conversation list until one
    // is opened. Both leave the reader at the oldest message unless the bottom is taken again.
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0 && atNewest.current) toBottom(); });
    observer.observe(element);
    return () => { element.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, [newest, newestIsMine]);

  const items = buildThread(messages, { viewerId, zone });

  return (
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
          <h3 className="m-0 text-card-title font-semibold text-foreground">No messages yet</h3>
          <p className="m-0 text-sm text-muted-foreground">Send the first update to this conversation.</p>
        </div>
      ) : items.map((item) => {
        if (item.kind === "day") return <DaySeparator key={item.key} label={item.label} />;
        if (item.kind === "notice") return <SystemNotice key={item.key} message={item.message} zone={zone} />;
        return <MessageGroup key={item.key} group={item} name={nameOf(item.authorId)} zone={zone} othersReadAt={othersReadAt} />;
      })}
    </div>
  );
}
