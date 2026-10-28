"use client";

/**
 * The DealFlow concept board's day funnel, on the Daily deal flow page: what the range's dialing
 * turned into, what the leads cost, who did it, and the day's leak. Every number comes from
 * /api/app/deal-flow/funnel (lib/dealFlow/dialFunnel.ts); a step with no recorded source says so
 * instead of showing a zero.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { DollarSign, FileText, PhoneCall, PhoneOutgoing } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import type { AgentLine, DialFunnel, FunnelStep } from "@/lib/dealFlow/dialFunnel";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = DialFunnel & { capped: boolean; timeZone: string };

const label12 = "text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const percent = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);
const ROLE: Record<string, string> = { owner: "owner", producer: "producer", setter: "setter", assistant: "buffer", bookkeeper: "bookkeeper" };

function AgentRow({ agent }: { agent: AgentLine }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-4 py-2.5 text-sm font-semibold text-[var(--ink)]">
        {agent.name}
        {agent.role && agent.role !== "owner" && agent.role !== "producer" && <span className="ml-1.5 font-normal text-[var(--muted)]">{ROLE[agent.role] ?? agent.role}</span>}
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-[var(--body)]">{agent.dials}</td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-[var(--body)]">{percent(agent.contactRate)}</td>
      {/* A setter cannot open an application, so their column says so rather than showing a zero. */}
      <td className="px-4 py-2.5 text-right text-sm tabular-nums text-[var(--body)]">{agent.role === "setter" ? "—" : agent.applications}</td>
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
      <section className="m-glass overflow-hidden rounded-lg border border-border">
        <SectionLoading rows={2} columns={5} label="Loading the dial funnel" />
      </section>
    );
  }

  const served = data.steps[0]?.count ?? 0;
  const leak = data.leak;

  // Foundation v3 §4a (2026-10-27): the five steps and the money as one row of glossy stat cards.
  // Each card carries the step before it in its footer, so every count and every rate is still on
  // screen: served → dialed on Dialed, dialed → reached on Reached, quoted on Applications.
  const step = (key: FunnelStep["key"]) => data.steps.find((item) => item.key === key) ?? null;
  const servedStep = step("served");
  const dialedStep = step("dialed");
  const reachedStep = step("contacts");
  const quotedStep = step("quoted");
  const appsStep = step("applications");
  const period = `${when} · ${data.timeZone}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="dial-funnel-title" className="flex min-w-0 flex-col gap-3">
        <h2 id="dial-funnel-title" className="sr-only">Dial funnel</h2>
        <StatRow label="Dial funnel, distinct leads at each step">
          <StatCard icon={PhoneOutgoing} label={dialedStep?.label ?? "Dialed"} period={period} value={dialedStep?.count ?? "—"}
            fact={{ label: `Of ${served} ${served === 1 ? "lead" : "leads"} served`, value: percent(servedStep?.toNext ?? null) }} />
          <StatCard icon={PhoneCall} label={reachedStep?.label ?? "Reached"} period={when} value={reachedStep?.count ?? "—"}
            fact={{ label: "Of dials", value: percent(dialedStep?.toNext ?? null) }} />
          <StatCard icon={FileText} label={appsStep?.label ?? "Applications"} period={`opened ${when}`} value={appsStep?.count ?? "—"}
            fact={quotedStep?.count == null ? { label: "No Quoted stage in your pipelines" } : { label: `${quotedStep.count} quoted`, value: `${percent(quotedStep.toNext)} to an app` }} />
          <StatCard icon={DollarSign} label="Annualised premium" period={`${data.deals} ${data.deals === 1 ? "deal" : "deals"}`} value={formatCentsAsCurrency(data.annualisedCents)}
            labelTitle={data.unpricedDeals > 0 ? `${data.unpricedDeals} ${data.unpricedDeals === 1 ? "deal has" : "deals have"} no premium yet.` : undefined}
            fact={data.spendCents == null ? { label: "No list cost recorded for the leads served" } : { label: "List spent", value: formatCentsAsCurrency(data.spendCents) }} />
        </StatRow>
        {data.spendCents != null && data.servedWithCost < served && <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">List spent counts the {data.servedWithCost} {data.servedWithCost === 1 ? "lead" : "leads"} with a cost recorded; {served - data.servedWithCost} served had none.</p>}
        {data.capped && <p className="m-0 text-xs leading-[1.5] text-[var(--warning-ink)]">Narrow the dates for exact counts — these are a floor.</p>}
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PagedTableCard
          total={data.agents.length}
          noun="agents"
          className="min-w-0"
          title="By agent"
          action={<Link href="/app/activity?view=scorecard" className="text-xs font-semibold text-[var(--ink)]">Open the scorecard</Link>}
        >
          {data.agents.length === 0 ? (
            <EmptyState title={`No dials ${when}`} hint="Agents show here once they are served leads." action={<Button asChild variant="outline"><Link href="/app/dialer">Open the dialer</Link></Button>} />
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
                <PagedBody>{data.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}</PagedBody>
              </table>
            </div>
          )}
        </PagedTableCard>

        <section aria-labelledby="dial-leak-title" className={cn("m-glass min-w-0 rounded-lg border border-border p-5", leak.servedNeverDialed > 0 && "border-l-[3px] border-l-[var(--warning)]")}>
          <h2 id="dial-leak-title" className="m-0 text-lg leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
            {leak.servedNeverDialed === 0 ? (served === 0 ? "No leads were served" : "Every lead served was dialed") :`${leak.servedNeverDialed} ${leak.servedNeverDialed === 1 ? "lead was" : "leads were"} served and never dialed`}
          </h2>
          <p className="mt-2 mb-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
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
