"use client";

import { useEffect, useRef } from "react";
import { CheckCheck, FileText, MessageCircle } from "lucide-react";

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
 * conversation: centred, narrower, and unfilled, so it reads as a notice between turns of speech.
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
    <article className="mx-auto w-full max-w-[34rem] rounded-lg border border-border px-3 py-2.5" aria-label="Automatic update">
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="info">Automatic update</StatusChip>
        <span className="text-xs text-muted-foreground">{clockTime(message.createdAt, zone, "12h")} · cannot be edited</span>
      </div>
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

function MessageGroup({ group, name, zone }: { group: Extract<ThreadItem, { kind: "group" }>; name: string; zone: string }) {
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
              <span className="mt-1 flex items-center justify-end gap-1 text-[var(--success-ink)]">
                <CheckCheck className="size-3.5" aria-hidden="true" />
                {/* Only on your own messages: a delivered tick on someone else's message says nothing. */}
                <span className="sr-only">Sent</span>
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
  className,
}: {
  messages: readonly PartnerMessage[];
  /** The signed-in user, so their own messages take the sent side. Null until the channels land. */
  viewerId: string | null;
  nameOf: (userId: string | null) => string;
  zone?: string;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const newest = messages.at(-1)?.id ?? null;

  // Open on the newest message, and follow it as one arrives or is sent — the only place in a
  // conversation anybody wants to start.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newest]);

  const items = buildThread(messages, { viewerId, zone });

  return (
    <div ref={scroller} className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-4", className)} aria-live="polite">
      {items.length === 0 ? (
        <div className="m-auto flex flex-col items-center gap-2 px-4 text-center">
          <MessageCircle className="size-6 text-muted-foreground" aria-hidden="true" />
          <h3 className="m-0 text-card-title font-semibold text-foreground">No messages yet</h3>
          <p className="m-0 text-sm text-muted-foreground">Send the first update to this conversation.</p>
        </div>
      ) : items.map((item) => {
        if (item.kind === "day") return <DaySeparator key={item.key} label={item.label} />;
        if (item.kind === "notice") return <SystemNotice key={item.key} message={item.message} zone={zone} />;
        return <MessageGroup key={item.key} group={item} name={nameOf(item.authorId)} zone={zone} />;
      })}
    </div>
  );
}
