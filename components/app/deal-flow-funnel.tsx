"use client";

/**
 * The DealFlow concept board's day funnel, on the Daily deal flow page: what the range's dialing
 * turned into, what the leads cost, who did it, and the day's leak. Every number comes from
 * /api/app/deal-flow/funnel (lib/dealFlow/dialFunnel.ts); a step with no recorded source says so
 * instead of showing a zero.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { AgentLine, DialFunnel } from "@/lib/dealFlow/dialFunnel";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = DialFunnel & { capped: boolean; timeZone: string };

const label12 = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const percent = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const ROLE: Record<string, string> = { owner: "owner", producer: "producer", setter: "setter", assistant: "buffer", bookkeeper: "bookkeeper" };

function AgentRow({ agent }: { agent: AgentLine }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-4 py-2.5 text-[14px] font-semibold text-[var(--ink)]">
        {agent.name}
        {agent.role && agent.role !== "owner" && agent.role !== "producer" && <span className="ml-1.5 font-normal text-[var(--muted)]">{ROLE[agent.role] ?? agent.role}</span>}
      </td>
      <td className="px-3 py-2.5 text-right text-[14px] tabular-nums text-[var(--body)]">{agent.dials}</td>
      <td className="px-3 py-2.5 text-right text-[14px] tabular-nums text-[var(--body)]">{percent(agent.contactRate)}</td>
      {/* A setter cannot open an application, so their column says so rather than showing a zero. */}
      <td className="px-4 py-2.5 text-right text-[14px] tabular-nums text-[var(--body)]">{agent.role === "setter" ? "—" : agent.applications}</td>
    </tr>
  );
}

export function DealFlowFunnel({ from, to, agentId, isToday }: { from: string; to: string; agentId: string; isToday: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from, to });
    if (agentId) params.set("agent_id", agentId);
    fetch(`/api/app/deal-flow/funnel?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) { setError(body?.error ?? "Could not load the day funnel"); return; }
        setError("");
        setData(body as Data);
      })
      .catch(() => { if (!cancelled) setError("Could not load the day funnel"); });
    return () => { cancelled = true; };
  }, [from, to, agentId, reload]);

  const when = isToday ? "today" : from === to ? "that day" : "in this range";

  if (error && !data) {
    return (
      <div role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
        The dial funnel did not load: {error}{" "}
        <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setReload((value) => value + 1)}>Try again</button>
      </div>
    );
  }
  if (!data) {
    return (
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <SectionLoading rows={2} columns={5} label="Loading the dial funnel" />
      </section>
    );
  }

  const served = data.steps[0]?.count ?? 0;
  const leak = data.leak;
  const spendFoot = data.spendCents == null
    ? "no list cost is recorded for the leads served"
    : `of list spent on the ${data.servedWithCost} ${data.servedWithCost === 1 ? "lead" : "leads"} served${data.servedWithCost < served ? ` (${served - data.servedWithCost} with no cost recorded)` : ""}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="dial-funnel-title" className="min-w-0 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="dial-funnel-title" className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Dial funnel</h2>
          <span className="text-[12px] leading-[1.5] text-[var(--muted)]">Distinct leads at each step, {when} · {data.timeZone}</span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          {/* Joined cells, as the stat strip draws figures: one object, not a row of boxes. */}
          <ol className="m-0 grid list-none grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border p-0 sm:grid-cols-5">
            {data.steps.map((step) => (
              <li key={step.key} className="min-w-0 bg-card px-3.5 py-3">
                <span className={label12}>{step.label}</span>
                <span className="mt-1 block text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]">{step.count ?? "—"}</span>
                <span className="mt-0.5 block text-[12px] leading-[1.5] text-[var(--muted)]">
                  {step.key === "quoted" && step.count == null ? "no Quoted stage in your pipelines" : step.key === "applications" ? "opened" : step.toNext == null ? " " : `${percent(step.toNext)} to the next step`}
                </span>
              </li>
            ))}
          </ol>
          <div className="rounded-lg border border-border px-4 py-3">
            <span className={label12}>Annualised premium</span>
            <span className="mt-1 block text-[24px] leading-[1.2] font-semibold tracking-[-0.02em] tabular-nums text-[var(--ink)]">{formatCentsAsCurrency(data.annualisedCents)}</span>
            <span className="mt-0.5 block text-[12px] leading-[1.5] text-[var(--muted)]">
              from {data.deals} {data.deals === 1 ? "deal" : "deals"}{data.unpricedDeals > 0 ? ` · ${data.unpricedDeals} with no premium yet` : ""}
            </span>
            <span className="mt-3 block text-[14px] leading-[1.5] font-semibold tabular-nums text-[var(--ink)]">{data.spendCents == null ? "—" : formatCentsAsCurrency(data.spendCents)}</span>
            <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">{spendFoot}</span>
          </div>
        </div>
        {data.capped && <p className="mt-3 mb-0 text-[12px] leading-[1.5] text-[var(--warning-ink)]">This range is larger than the funnel reads at once, so the counts are a floor. Narrow the dates for exact figures.</p>}
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <TableCard
          className="min-w-0"
          title="By agent"
          action={<Link href="/app/activity?view=scorecard" className="text-xs font-semibold text-[var(--ink)]">Open the scorecard</Link>}
        >
          {data.agents.length === 0 ? (
            <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] text-[var(--muted)]">Nobody was served or dialed a lead {when}.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={cn(label12, "px-4 py-2 text-left")}>Agent</th>
                    <th scope="col" className={cn(label12, "px-3 py-2 text-right")}>Dials</th>
                    <th scope="col" className={cn(label12, "px-3 py-2 text-right")}>Contact</th>
                    <th scope="col" className={cn(label12, "px-4 py-2 text-right")}>Apps</th>
                  </tr>
                </thead>
                <tbody>{data.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}</tbody>
              </table>
            </div>
          )}
        </TableCard>

        <section aria-labelledby="dial-leak-title" className="min-w-0 rounded-lg border border-border bg-card p-5">
          <h2 id="dial-leak-title" className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
            {leak.servedNeverDialed === 0 ? (served === 0 ? "No leads were served" : "Every lead served was dialed") :`${leak.servedNeverDialed} ${leak.servedNeverDialed === 1 ? "lead was" : "leads were"} served and never dialed`}
          </h2>
          <p className="mt-2 mb-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
            {leak.servedNeverDialed === 0
              ? served === 0
                ? `The queue handed out no leads ${when}.`
                : `The queue handed out ${served} ${served === 1 ? "lead" : "leads"} ${when}, and the agent it went to dialed each one.`
              : `${percent(leak.share)} of everything the queue handed out ${when}.${leak.top ? ` ${leak.top.count} of them were ${leak.top.name}'s${leak.top.alsoMostZeroClick ? `, which is also where the most outcomes were logged without a dial (${leak.top.zeroClick})` : ""}.` : ""}`}
          </p>
          <Button asChild variant="outline" className="mt-4"><Link href="/app/activity?view=integrity">Open the call log</Link></Button>
        </section>
      </div>
    </div>
  );
}
