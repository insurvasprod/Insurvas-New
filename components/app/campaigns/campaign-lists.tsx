"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, cardInset } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/** One list as GET /api/app/campaigns/<id>/lists returns it (lib/campaigns/lists.ts). */
export type CampaignListRow = { id: string; fileName: string; importedAt: string | null; rows: number | null; leads: number; left: number; dialed: number; noState: number; costCents: number | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(iso: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
const n = (value: number) => value.toLocaleString("en-US");
const fixLink = "text-xs font-semibold whitespace-nowrap text-[var(--accent-ink)] hover:underline";

/** A list's one health word and the one next step, each problem a link to where it is fixed. */
function health(campaignId: string, list: CampaignListRow): { chip: ReactNode; next: ReactNode } {
  const open = <Button asChild variant="outline" size="sm"><Link href={`/app/campaigns/${campaignId}/lists/${list.id}`} onClick={(event) => event.stopPropagation()}>Open</Link></Button>;
  if (list.leads === 0) return { chip: <StatusChip tone="neutral">Empty</StatusChip>, next: open };
  if (list.left === 0) return { chip: <StatusChip tone="neutral">Used up</StatusChip>, next: <Link href="/app/nurture" className={fixLink} onClick={(event) => event.stopPropagation()}>Recycle →</Link> };
  if (list.dialed === 0) return { chip: <StatusChip tone="info">Not called yet</StatusChip>, next: open };
  return { chip: <StatusChip tone="good">Working</StatusChip>, next: open };
}

/**
 * Source › a campaign's lists (board LirF1): one row per import — its file and date, a health word,
 * how much is left, and the one next step. A row opens the list's leads.
 */
export function CampaignLists({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [lists, setLists] = useState<CampaignListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/app/campaigns/${campaignId}/lists`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { lists?: CampaignListRow[]; error?: string } | null;
        if (!response.ok) throw new Error(body?.error ?? "Could not load this campaign's lists");
        setLists(body?.lists ?? []);
        setError(null);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this campaign's lists"); });
    return () => controller.abort();
  }, [campaignId, attempt]);

  const noState = (lists ?? []).reduce((sum, list) => ({ leads: sum.leads + list.noState, lists: sum.lists + (list.noState > 0 ? 1 : 0) }), { leads: 0, lists: 0 });
  return (
    <Card id="lists" aria-label="Lists" className="min-w-0 gap-2 p-3">
      <span className="px-1 pt-1 text-xs font-semibold tracking-[0.06em] text-[var(--ink)] uppercase">{lists ? `${n(lists.length)} list${lists.length === 1 ? "" : "s"}` : "Lists"}</span>
      {/* A problem many lists share is said once, with its fix (critique 2026-10-30), not on every row. */}
      {noState.leads > 0 && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--warning-surface)] px-3.5 py-2.5 text-sm text-[var(--ink)]">
        <span className="min-w-0 flex-1"><strong className="font-semibold">{n(noState.leads)}</strong> {noState.leads === 1 ? "lead has" : "leads have"} no state{noState.lists > 1 ? ` across ${n(noState.lists)} lists` : ""}, so {noState.leads === 1 ? "it can't" : "they can't"} be called yet.</span>
        <Link href={`/app/duplicates?tab=missing&missing=state&campaign=${campaignId}`} className={fixLink}>Fill in states →</Link>
      </div>}
      {error ? <ErrorState title="Lists did not load" detail={error} action={<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>} />
        : lists === null ? <div className="h-16 animate-pulse rounded-lg bg-[var(--surface-alt)]" aria-label="Loading lists" />
        : lists.length === 0 ? <EmptyState title="No list yet" hint="Import this campaign's first list." />
        : <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {lists.map((list) => {
            const { chip, next } = health(campaignId, list);
            const used = list.leads > 0 ? Math.round((100 * (list.leads - list.left)) / list.leads) : 0;
            const sub = [shortDay(list.importedAt), list.rows !== null ? `${n(list.rows)} rows` : `${n(list.leads)} leads`].filter(Boolean).join(" · ");
            return <li key={list.id}>
              <div
                className={cn(cardInset, "grid cursor-pointer grid-cols-1 items-center gap-3 px-3.5 py-3 transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--primary)_55%,transparent)] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1fr)_170px]")}
                onClick={() => router.push(`/app/campaigns/${campaignId}/lists/${list.id}`)}
              >
                <span className="flex min-w-0 flex-col">
                  <Link href={`/app/campaigns/${campaignId}/lists/${list.id}`} onClick={(event) => event.stopPropagation()} className="truncate text-sm font-semibold text-[var(--ink)] hover:underline">{list.fileName}</Link>
                  <span className="text-xs text-[var(--ink)]">{sub}</span>
                </span>
                <span>{chip}</span>
                <span className="flex flex-col gap-1">
                  <Meter value={used} tone="good" label={`${used}% used`} />
                  <span className="text-xs text-[var(--ink)] tabular-nums">{n(list.left)} left to call</span>
                </span>
                <span className="justify-self-start md:justify-self-end">{next}</span>
              </div>
            </li>;
          })}
        </ul>}
    </Card>
  );
}
