"use client";

import { Fragment, useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, Paperclip, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import type { ChatSearchHit } from "@/lib/partnerChat/cards";
import { cn } from "@/lib/utils";

/**
 * Partner chat search (owner, 2026-10-29). In a conversation: a row under its header finds words in
 * that conversation only, marks them in the thread and steps through them. In the conversation list:
 * the same search box also lists every message, in every conversation the person can open, that holds
 * the words. Both search on the server, so history the thread has not loaded yet is found too.
 */

/** Searches start at two letters; shorter would match nearly everything. */
export const MIN_SEARCH = 2;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with every case-insensitive match of `query` marked. */
export function Highlighted({ text, query }: { text: string; query?: string }) {
  const term = query?.trim();
  if (!term || term.length < MIN_SEARCH) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegExp(term)})`, "gi"));
  return <>{parts.map((part, index) => (index % 2 === 1 ? <mark key={index} className="rounded-sm bg-[var(--warning-surface)] px-px text-foreground">{part}</mark> : <Fragment key={index}>{part}</Fragment>))}</>;
}

/** A line around the first match: about `radius` characters either side, cut at word edges. */
export function searchSnippet(text: string, query: string, radius = 48) {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || flat.length <= radius * 2) return flat;
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + query.length + radius);
  if (start > 0) start = flat.indexOf(" ", start) + 1 || start;
  if (end < flat.length) end = flat.lastIndexOf(" ", end) > at ? flat.lastIndexOf(" ", end) : end;
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/**
 * The search row under a conversation's header. Enter goes to the older match, Shift+Enter to the
 * newer one, Esc closes. `index` counts from the oldest match, so the newest of 12 reads "12 of 12".
 */
export function ThreadSearchBar({ query, onQuery, index, total, truncated, busy, error, onOlder, onNewer, onClose }: {
  query: string; onQuery: (value: string) => void; index: number; total: number; truncated: boolean; busy: boolean; error: string | null; onOlder: () => void; onNewer: () => void; onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const searching = query.trim().length >= MIN_SEARCH;
  const status = !searching ? "" : error ? error : busy && total === 0 ? "" : total === 0 ? "No matches" : `${index + 1} of ${total}${truncated ? "+" : ""}`;
  return (
    <div className="m-swap flex shrink-0 items-center gap-2 border-b border-border px-4 py-2" role="search" aria-label="Search this conversation">
      <label className="relative block min-w-0 flex-1">
        <span className="sr-only">Search this conversation</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); if (event.shiftKey) onNewer(); else onOlder(); }
            else if (event.key === "Escape") { event.preventDefault(); onClose(); }
          }}
          placeholder="Search this conversation"
          className={cn(toolbarControl, "w-full pl-9")}
        />
      </label>
      <span role="status" aria-live="polite" className={cn("inline-flex min-w-16 shrink-0 items-center justify-end gap-1.5 text-xs tabular-nums", error ? "text-[var(--error-ink)]" : "text-[var(--body)]")}>
        {busy && searching && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
        {status}
      </span>
      <Button type="button" variant="ghost" size="icon-sm" disabled={total === 0 || index <= 0} onClick={onOlder} aria-label="Older match" title="Older match (Enter)"><ChevronUp aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={total === 0 || index >= total - 1} onClick={onNewer} aria-label="Newer match" title="Newer match (Shift + Enter)"><ChevronDown aria-hidden="true" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close search" title="Close (Esc)"><X aria-hidden="true" /></Button>
    </div>
  );
}

/**
 * Under the conversation list while its search box holds two letters or more: the messages that hold
 * them, newest first, each naming its conversation. A click opens that conversation at the message.
 */
export function MessageHits({ hits, query, busy, truncated, error, channelName, face, author, time, onOpen }: {
  hits: ChatSearchHit[]; query: string; busy: boolean; truncated: boolean; error: string | null;
  channelName: (channelId: string) => string | null; face: (channelId: string) => React.ReactNode; author: (hit: ChatSearchHit) => string | null; time: (value: string) => string;
  onOpen: (hit: ChatSearchHit) => void;
}) {
  const shown = hits.filter((hit) => channelName(hit.channelId) !== null);
  return (
    <div className="mt-1 border-t border-border pt-2" aria-label="Messages that match">
      <p className="m-0 flex items-center gap-1.5 px-2 pb-1 text-xs font-semibold text-muted-foreground">
        Messages{!busy && !error && <span className="tabular-nums opacity-70">{shown.length}{truncated ? "+" : ""}</span>}
        {busy && <Loader2 className="size-3 animate-spin" aria-hidden="true" />}
      </p>
      {error ? <p role="alert" className="m-0 px-2 py-2 text-xs text-[var(--error-ink)]">{error}</p>
        : !busy && shown.length === 0 ? <p className="m-0 px-2 py-2 text-xs text-muted-foreground">No messages hold “{query.trim()}”.</p>
        : (
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((hit) => {
              const who = author(hit);
              return (
                <li key={hit.messageId}>
                  <button type="button" onClick={() => onOpen(hit)} className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--surface-alt)]">
                    {face(hit.channelId)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{channelName(hit.channelId)}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{time(hit.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs text-[var(--body)]">
                        {who && <span className="font-semibold">{who}: </span>}
                        {hit.fileName
                          ? <span className="inline-flex items-center gap-1"><Paperclip className="size-3 shrink-0" aria-hidden="true" /><Highlighted text={hit.fileName} query={query} /></span>
                          : <Highlighted text={searchSnippet(hit.message, query)} query={query} />}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
