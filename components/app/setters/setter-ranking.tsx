"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { RebookButton } from "@/components/app/appointment-rebook";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { cn } from "@/lib/utils";
import type { SettersOverview } from "@/lib/setters/overview";
import { NOISE_BELOW_PCT, VERDICT_LABEL, VERDICT_MIN_CLOSED } from "@/lib/setters/dayView";

/**
 * Setters A, "Ranking" (owner pick 2026-10-25, canvas M2 · Calendar, Set4A): who books appointments
 * that show, as one table with each show rate drawn against the target, and the chosen setter's
 * recent bookings on the right — where a no-show is called back or rebooked.
 */
type Setter = SettersOverview["setters"][number];
type Booking = { appointmentId: string; leadId: string; customerName: string; agentUserId: string; startsAtUtc: string; status: string; bookedByUserId?: string | null; rebookedAs?: string | null; redacted?: boolean };

const STATUS_LABEL: Record<string, string> = { booked: "Booked", confirmed: "Confirmed", pending: "Awaiting close-out", showed: "Showed", no_show: "No-show", cancelled: "Cancelled", rescheduled: "Rescheduled" };
const STATUS_TONE: Record<string, StatusTone> = { booked: "action", confirmed: "good", pending: "warning", showed: "good", no_show: "danger", cancelled: "neutral", rescheduled: "neutral" };
const VERDICT_TONE: Record<Setter["verdict"], StatusTone> = { solid: "good", noise: "danger", watch: "warning", too_few: "neutral" };

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

function when(iso: string) {
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** The show rate as a bar, with a tick at the target. */
function RateBar({ pct, target }: { pct: number | null; target: number }) {
  if (pct === null) return <span className="text-sm text-muted-foreground">—</span>;
  const good = pct >= target;
  return (
    <span className="flex items-center gap-3">
      <span className="relative h-1.5 flex-1 rounded-full bg-[var(--surface-alt)]" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", good ? "bg-[var(--primary)]" : "bg-[var(--warning)]")} style={{ width: `${Math.min(100, pct)}%` }} />
        <span className="absolute -inset-y-1 w-0.5 bg-[var(--body)] opacity-60" style={{ left: `${target}%` }} />
      </span>
      <strong className={cn("w-12 text-right text-sm tabular-nums", good ? "text-[var(--accent-ink)]" : "text-[var(--warning-ink)]")}>{pct.toFixed(0)}%</strong>
    </span>
  );
}

function SetterPanel({ setter, onClose }: { setter: Setter; onClose: () => void }) {
  const [bookings, setBookings] = useState<{ userId: string; rows: Booking[] | null; error: string }>({ userId: "", rows: null, error: "" });
  const [onlyNoShows, setOnlyNoShows] = useState(false);
  const [reload, setReload] = useState(0);
  const closed = setter.showed + setter.noShow;
  const first = setter.name.split(/\s+/)[0];

  useEffect(() => {
    const controller = new AbortController();
    const to = Date.now() + 86_400_000;
    const from = to - 31 * 86_400_000;
    void fetch(`/api/app/calendar?from=${encodeURIComponent(new Date(from).toISOString())}&to=${encodeURIComponent(new Date(to).toISOString())}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not load the bookings");
        const rows = ((body?.appointments ?? []) as Booking[]).filter((row) => row.bookedByUserId === setter.userId && !row.redacted).sort((a, b) => b.startsAtUtc.localeCompare(a.startsAtUtc));
        setBookings({ userId: setter.userId, rows, error: "" });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setBookings({ userId: setter.userId, rows: [], error: error instanceof Error ? error.message : "Could not load the bookings" }); });
    return () => controller.abort();
  }, [setter.userId, reload]);

  const rows = bookings.userId === setter.userId ? bookings.rows : null;
  const shown = rows ? (onlyNoShows ? rows.filter((row) => row.status === "no_show") : rows).slice(0, 12) : null;
  const weak = setter.verdict === "noise" || setter.verdict === "watch";
  return (
    <DetailPanel
      mode="split"
      splitFrom="xl"
      title={setter.name}
      subtitle={[setter.place, "last 30 days"].filter(Boolean).join(" · ")}
      status={<StatusChip tone={VERDICT_TONE[setter.verdict]} dot>{VERDICT_LABEL[setter.verdict]}</StatusChip>}
      onClose={onClose}
      bodyClassName="flex flex-col gap-4 p-4"
      // Stays in view while the page scrolls; long content scrolls inside it.
      className="xl:sticky xl:top-[calc(var(--top-bar-h)+16px)] xl:max-h-[calc(100dvh-var(--top-bar-h)-32px)]"
    >
      <p className={cn("m-0 rounded-xl px-4 py-3 text-sm", weak ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
        {closed === 0
          ? <>Nothing closed out yet: {setter.booked} booked, none past their time.</>
          : <><strong className="font-semibold">{setter.noShow} of {closed}</strong> closed-out {closed === 1 ? "booking" : "bookings"} didn&rsquo;t show. {setter.sold} sold from {setter.showed} that showed.</>}
      </p>
      {setter.noShow > 0 && (
        <Button type="button" className="w-full" variant={onlyNoShows ? "outline" : "default"} onClick={() => setOnlyNoShows((value) => !value)}>
          {onlyNoShows ? "Show every booking" : `Review ${first}’s no-shows`}
        </Button>
      )}
      <dl className="m-0 grid grid-cols-3 gap-3">
        {([["Dials", setter.dials.toLocaleString()], ["Contacts", setter.contacts.toLocaleString()], ["Booked", setter.booked]] as const).map(([label, value]) => (
          <div key={label}><dt className="text-xs font-semibold text-muted-foreground">{label}</dt><dd className="m-0 text-sm font-semibold tabular-nums">{value}</dd></div>
        ))}
      </dl>
      <section className="flex flex-col gap-1" aria-label={onlyNoShows ? "No-shows" : "Last bookings"}>
        <h3 className="m-0 text-xs font-semibold text-muted-foreground">{onlyNoShows ? "No-shows" : "Last bookings"}</h3>
        {bookings.error && bookings.userId === setter.userId && <p className="m-0 text-sm text-muted-foreground">{bookings.error}</p>}
        {shown === null ? <p className="m-0 text-sm text-muted-foreground" role="status">Loading bookings…</p>
          : shown.length === 0 ? <p className="m-0 text-sm text-muted-foreground">{onlyNoShows ? "No no-shows in the last 30 days." : "No bookings into calendars you can see in the last 30 days."}</p>
          : (
            <ul className="m-0 list-none p-0">
              {shown.map((row) => (
                <li key={row.appointmentId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border py-2.5 first:border-t-0">
                  <span className="min-w-0 flex-1">
                    <Link href={`/app/leads/${row.leadId}`} className="block truncate text-sm font-semibold text-[var(--ink)] hover:underline">{row.customerName}</Link>
                    <span className="block text-xs text-muted-foreground">{when(row.startsAtUtc)}</span>
                  </span>
                  <StatusChip tone={STATUS_TONE[row.status] ?? "neutral"}>{STATUS_LABEL[row.status] ?? row.status}</StatusChip>
                  {row.status === "no_show" && (
                    <span className="flex w-full justify-end gap-2">
                      {/* Decided 2026-09-25: the dialer opens on this lead and checks the calling window when it dials. */}
                      <Button asChild size="sm" variant="outline"><Link href={`/app/dialer?lead=${row.leadId}`}>Call now</Link></Button>
                      {row.rebookedAs ? <span className="self-center text-xs text-muted-foreground">Rebooked</span> : <RebookButton appointmentId={row.appointmentId} agentUserId={row.agentUserId} customerName={row.customerName} onRebooked={() => setReload((value) => value + 1)} />}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>
      <Button asChild variant="outline" size="sm" className="self-start"><Link href="/app/calendar">All appointments</Link></Button>
    </DetailPanel>
  );
}

export function SetterRanking({ setters, target, scope }: { setters: Setter[]; target: number; scope: SettersOverview["scorecardScope"] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 57);
  const paged = paginate(setters, page, pageSize);
  const open = setters.find((row) => row.userId === openId) ?? null;
  const exportCsv = () => downloadCsv("setters-30-days.csv",
    ["Setter", "Location", "Dials", "Contacts", "Booked", "Shown", "No-show", "Show rate %", "Sold", "Verdict"],
    setters.map((row) => [row.name, row.place ?? "", row.dials, row.contacts, row.booked, row.showed, row.noShow, row.showRatePct === null ? "" : row.showRatePct.toFixed(1), row.sold, VERDICT_LABEL[row.verdict]]));
  const th = "px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground";
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <TableCard
        className="min-w-0 flex-1"
        title="Who books appointments that show"
        description={`Last 30 days · ${scope === "calendar" ? "setters who booked into your calendar" : "every setter in the agency"} · line = ${target}% target`}
        action={<Button type="button" variant="outline" size="sm" disabled={setters.length === 0} onClick={exportCsv}><Download aria-hidden="true" />Export</Button>}
        footer={setters.length ? <Pager page={paged.current} total={setters.length} noun={setters.length === 1 ? "setter" : "setters"} pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {setters.length === 0 ? <EmptyState title="No setter activity" hint="No dials or bookings in the last 30 days." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead><tr className="border-b border-border">
                <th scope="col" className={th}>Setter</th>
                <th scope="col" className={`${th} text-right`}>Dials</th>
                <th scope="col" className={`${th} text-right`}>Contacts</th>
                <th scope="col" className={`${th} text-right`}>Booked</th>
                <th scope="col" className={`${th} text-right`}>Showed</th>
                <th scope="col" className={`${th} text-right`}>Sold</th>
                <th scope="col" className={`${th} w-[26%]`}>Show rate</th>
                <th scope="col" className={th}><span className="inline-flex items-center gap-1">Verdict<InfoTip label="About the verdict" side="left">Booking noise: a show rate under {NOISE_BELOW_PCT}% over at least {VERDICT_MIN_CLOSED} closed-out appointments. Appointments waiting to be closed out never count against a setter.</InfoTip></span></th>
              </tr></thead>
              <tbody>
                {paged.rows.map((row) => {
                  const on = row.userId === openId;
                  return (
                    <tr key={row.userId} onClick={() => setOpenId(on ? null : row.userId)} className={cn("m-row cursor-pointer border-b border-border last:border-b-0", on && "bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]")}>
                      <td className="px-4 py-3">
                        <button type="button" aria-pressed={on} onClick={(event) => { event.stopPropagation(); setOpenId(on ? null : row.userId); }} className="flex items-center gap-3 text-left">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-bold text-[var(--accent-ink)]">{initials(row.name)}</span>
                          <span className="min-w-0"><span className="block truncate font-semibold text-[var(--ink)]">{row.name}</span>{row.place && <span className="block truncate text-xs text-muted-foreground">{row.place}</span>}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.dials.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.contacts.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.booked}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.showed}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.sold}</td>
                      <td className="px-4 py-3"><RateBar pct={row.showRatePct} target={target} /></td>
                      <td className="px-4 py-3"><StatusChip tone={VERDICT_TONE[row.verdict]} dot>{VERDICT_LABEL[row.verdict]}</StatusChip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </TableCard>
      {open && <SetterPanel key={open.userId} setter={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
