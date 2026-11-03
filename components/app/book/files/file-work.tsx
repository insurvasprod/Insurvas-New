"use client";

import { Fragment, useState } from "react";
import Link from "next/link";

import { BulkResolve, type BulkResolution } from "@/components/app/book/needs-you/bulk-resolve";
import { DecideInPlace } from "@/components/app/book/needs-you/decide-in-place";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { NeedsYouKind } from "@/lib/needsYou/kinds";

/** One kind of decision a file left, with how many of it. */
export type WorkGroup = {
  key: string;
  count: number;
  label: string;
  /** One short line; the full sentence is its tooltip. */
  why: string;
  whyFull: string;
  /** Rows of the file: the rows below, cut to this group, the first one open. */
  startHref?: string;
  /** Not rows (a commission file's money, a status word): listed here, each decided under itself. */
  items?: Array<{ kind: NeedsYouKind; id: string; about: string; why: string }>;
  /** One answer for all of them (a file's "No sale yet": the client is right). */
  bulk?: { ids: string[]; resolution: BulkResolution; noun: string };
  /** Nothing an agent can do (Insurvas maps a status word). */
  waitsOnInsurvas?: boolean;
};

const n = (value: number) => value.toLocaleString("en-US");

/**
 * A file's "Needs you" (round 4, owner 2026-11-02: "in overview … it shouldn't be shown as a table … not see all
 * 407"): what the file waits on, grouped by kind — one line per group with its count, one short reason, and its
 * way through: Start (the rows below, cut to the group, the first decided in place), "Confirm all" when every
 * item of the group takes the same answer, or the group's items listed here when they aren't rows. One primary
 * per line; the list's own link to Needs you sits in the header, last.
 */
export function FileWork({ total, groups, needsHref, canDecide }: { total: number; groups: WorkGroup[]; needsHref: string; canDecide: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length) return null;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-[var(--border)] py-3">
        <CardTitle>Needs you · {n(total)}</CardTitle>
        <CardAction><Button asChild variant="ghost" size="sm"><Link href={needsHref}>Open in Needs you</Link></Button></CardAction>
      </CardHeader>
      <ul className="m-0 list-none p-0">
        {groups.map((group, index) => {
          // One primary on the card: the first group's way through; the rest are outline.
          const lead = index === 0;
          const listing = shown === group.key && group.items;
          return (
            <li key={group.key} className="border-b border-[var(--border)] last:border-b-0">
              <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[72px_minmax(0,1fr)_auto]">
                <span className={cn("text-xl font-bold tabular-nums leading-none", group.waitsOnInsurvas ? "text-[var(--info-ink)]" : "text-[var(--warning-ink)]")}>{n(group.count)}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-foreground">{group.label}</span>
                  <span className="block truncate text-xs text-muted-foreground" title={group.whyFull}>{group.why}</span>
                </span>
                <span className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
                  {group.waitsOnInsurvas ? <span className="text-xs text-muted-foreground">Nothing to do</span> : (
                    <>
                      {group.startHref && <Button asChild size="sm" variant={group.bulk && canDecide ? "outline" : lead ? "default" : "outline"}><Link href={group.startHref} scroll={false}>{group.bulk ? "One by one" : "Start"}</Link></Button>}
                      {group.items && <Button type="button" size="sm" variant={listing || !lead ? "outline" : "default"} aria-expanded={Boolean(listing)} onClick={() => setShown(listing ? null : group.key)}>{listing ? "Hide" : "Start"}</Button>}
                      {group.bulk && canDecide && <BulkResolve ids={group.bulk.ids} resolution={group.bulk.resolution} noun={group.bulk.noun} variant={lead ? "default" : "outline"} />}
                    </>
                  )}
                </span>
              </div>
              {listing && (
                <ul className="m-0 list-none border-t border-[var(--border)] bg-[var(--surface-alt)] p-0">
                  {group.items!.map((item, index, all) => {
                    const key = `${item.kind}:${item.id}`;
                    const isOpen = open === key;
                    const next = all[index + 1] ? `${all[index + 1].kind}:${all[index + 1].id}` : null;
                    return (
                      <Fragment key={key}>
                        <li className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 last:border-b-0">
                          <span className="min-w-0 flex-1 truncate text-sm"><span className="font-semibold text-foreground">{item.about}</span> <span className="text-muted-foreground">· {item.why}</span></span>
                          {canDecide && <Button type="button" size="sm" variant="outline" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)}>{isOpen ? "Close" : "Decide"}</Button>}
                        </li>
                        {isOpen && (
                          <li className="border-b border-[var(--border)] last:border-b-0">
                            <DecideInPlace kind={item.kind} id={item.id} onClose={() => setOpen(null)} inline={{ hasNext: next !== null, onSkip: () => setOpen(next), onDone: (how) => setOpen(how === "next" ? next : null) }} />
                          </li>
                        )}
                      </Fragment>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
