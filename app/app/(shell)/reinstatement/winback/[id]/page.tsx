import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { scopeFor } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { BAND_LABELS, CATEGORY_LABELS, SOURCE_LABELS } from "@/lib/retention/winback";
import { loadWinback, WINBACK_PENDING_MESSAGE, type WinbackRow } from "@/lib/retention/winbackStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Await, RecordTitle, RetentionPage, retentionTrail } from "@/components/app/retention/retention-page";
import {
  chanceWhy, clientName, coverText, isWinbackView, money, paidText, phoneText, policyHref, whenToCall, winbackClientHref, winbackList, winbackStage,
  winbackViewHref, winbackViewLabel, type WinbackStage, type WinbackView,
} from "@/components/app/retention/winback-stages";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { IntentLink } from "@/components/ui/nav-pending";

type ClientTab = "why" | "had" | "history";
const TABS: ClientTab[] = ["why", "had", "history"];

/** Where a client stands; a stage that is a problem names it in the tile's one chip (good ones get none). */
const STAGE_TEXT: Record<WinbackStage, { label: string; chip?: string }> = {
  released: { label: "On the Win-back list" },
  blocked: { label: "Couldn't go on the list", chip: "Stuck" },
  soon: { label: "Callable within 30 days" },
  resting: { label: "Cooling off" },
  never: { label: "Never call", chip: "Do not call" },
};

/** What happened, oldest first, from the candidate's own dates. */
function historyOf(r: WinbackRow, today: string): Array<{ day: string | null; what: string; detail: string | null }> {
  const lines: Array<{ day: string | null; what: string; detail: string | null }> = [
    { day: r.lapsedOn, what: "The policy lapsed", detail: `${r.carrierName} ${r.policyNumber}, past the carrier's reinstatement window` },
    { day: null, what: `Why: ${CATEGORY_LABELS[r.category]}`, detail: `${SOURCE_LABELS[r.source]}${r.detail && r.source !== "none" ? `: ${r.detail}` : ""}${r.inferred ? " (inferred, not said)" : ""}` },
  ];
  if (r.band === "never") lines.push({ day: null, what: "Never to be called", detail: "do-not-call or deceased" });
  else if (r.eligibleFrom) lines.push({ day: r.eligibleFrom, what: r.eligibleFrom <= today ? "The cooling-off ended" : "The cooling-off ends", detail: null });
  if (r.releasedAt) lines.push({ day: r.releasedAt.slice(0, 10), what: "Put on the Win-back list", detail: "a new lead, scrubbed before anyone dials" });
  if (r.blockedReason) lines.push({ day: null, what: "Couldn't go on the list", detail: r.blockedReason });
  return lines;
}

/**
 * Retention › Win-back › a former client (round 7, owner pick 3·1 A, 2026-11-10). The title is the client's name
 * alone; Why it ended · What they had · History are its tabs (?tab=); ‹ › name the neighbouring clients in the order
 * of the tab they came from (?show=). A strip of figures, each a link. The call is made from the Win-back lead list
 * in the dialer, where its gates (calling window, do-not-call, attempts) apply: Open the lead is the primary once the
 * client is on the list. A stuck client's page leads with why. Read-only; the same gates and scope as the list.
 */
export default async function WinbackClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; show?: string }> }) {
  const guard = await guardPage("winback");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Win-back" description="Former clients worth winning back, once the cooling-off has passed." />;
  if (!actAsPage(guard, ["owner", "producer"])) return <RoleGateNotice featureLabel="Win-back" detail="Win-back calls are the owner's and the producers'." />;
  const [{ id }, { tab: askedTab, show }] = await Promise.all([params, searchParams]);
  if (!isRecordUuid(id)) notFound();
  const tab: ClientTab = TABS.includes(askedTab as ClientTab) ? (askedTab as ClientTab) : "why";
  // Frame first (UI-CONSISTENCY §7a): the trail, the tabs and the step draw at once and the name waits in a
  // title-shaped placeholder. The read starts here; the name, the History count, ‹ ›, the strip and the tab wait on it.
  const read = scopeFor(guard.context).then((scope) => {
    const viewer = { tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role, scope };
    return loadWinback(viewer, { release: false });
  });
  const asked: WinbackView | null = isWinbackView(show) && show !== "claims" ? show : null;

  /** The client and where they sit, from the read; null while the feature is not switched on. */
  const clientOf = (data: Awaited<typeof read>): Client | null => {
    if (!data.available) return null;
    const r = data.rows.find((row) => row.id === id);
    if (!r) notFound();
    const today = data.today;
    const stage = winbackStage(r, today);
    // ‹ ›: the tab they came from, when they are in it; else All (or their own tab, for Never call).
    const fromList = (v: WinbackView) => winbackList(data.rows, v, today);
    const view: WinbackView = asked && fromList(asked).some((x) => x.id === r.id) ? asked : stage === "never" ? "never" : "open";
    const list = fromList(view);
    const at = list.findIndex((x) => x.id === r.id);
    return {
      r, today, stage, view,
      name: clientName(r),
      previous: at > 0 ? list[at - 1] : null,
      next: at >= 0 && at < list.length - 1 ? list[at + 1] : null,
      history: historyOf(r, today),
      policy: policyHref(r.carrierId, r.policyNumber),
      leadHref: r.leadId ? `/app/leads/${r.leadId}` : null,
    };
  };
  // Before the read, the tabs link with the list the person came from (`?show=`), as the page's own address does.
  const tabsOf = (client: Client | null) => {
    const view = client?.view ?? asked ?? "open";
    return (
      <ViewTabs
        label={client ? `${client.name}, former client` : "Former client"}
        value={tab}
        tabs={[
          { key: "why" as const, label: "Why it ended", href: winbackClientHref(id, view, "why") },
          { key: "had" as const, label: "What they had", href: winbackClientHref(id, view, "had") },
          { key: "history" as const, label: "History", ...(client ? { count: client.history.length } : {}), href: winbackClientHref(id, view, "history") },
        ]}
      />
    );
  };
  const actionsOf = ({ view, stage, previous, next, policy, leadHref }: Client) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      {previous && <IntentLink transitionTypes={["nav-back"]} href={winbackClientHref(previous.id, view, tab)} className={buttonVariants({ variant: "outline" })} title={`Previous client: ${clientName(previous)}`}><ChevronLeft aria-hidden="true" />{clientName(previous)}</IntentLink>}
      {next && <IntentLink transitionTypes={["nav-forward"]} href={winbackClientHref(next.id, view, tab)} className={buttonVariants({ variant: "outline" })} title={`Next client: ${clientName(next)}`}>{clientName(next)}<ChevronRight aria-hidden="true" /></IntentLink>}
      {stage === "released" && leadHref && <Button asChild><Link href={leadHref}>Open the lead</Link></Button>}
      {/* Never call is not offered: the win-back API has no way to set it yet (only resolve_claim). */}
      <MoreMenu items={[{ label: "Open the policy", href: policy }]} />
    </span>
  );

  const stripOf = ({ r, today, stage, view, name, policy, leadHref }: Client) => {
    const when = whenToCall(r, today);
    const stageText = STAGE_TEXT[stage];
    return (
        <StatStrip label={`${name} at a glance`}>
          {/* Plain strip (owner 2026-11-11): a tile that is a problem says so in one chip in its footnote. */}
          <StatTile label="Where they are" valueSize="text" value={stageText.label} href={winbackViewHref(stage)} footnote={stageText.chip ? <StatusChip tone="danger" title={when.sub ?? when.line}>{stageText.chip}</StatusChip> : when.sub ?? when.line} />
          <StatTile label="Phone" valueSize="text" value={r.phone ? phoneText(r.phone) : "No phone on file"} href={leadHref ?? undefined} footnote={r.phone ? [r.age !== null ? String(r.age) : null, r.state].filter(Boolean).join(" · ") || "age and state not known" : <StatusChip tone="warning">Can&apos;t be dialled</StatusChip>} />
          <StatTile label="Lapsed" valueSize="text" value={fileDay(r.lapsedOn)} href={policy} footnote="past reinstatement" />
          <StatTile label="Premium" valueSize="text" value={`${money(r.premiumCents)}/mo`} href={policy} footnote={coverText(r.faceCents) ?? "cover not known"} />
          <StatTile label="Chance" valueSize="text" value={BAND_LABELS[r.band]} href={winbackClientHref(r.id, view, "had")} footnote={chanceWhy(r)} />
        </StatStrip>
    );
  };
  const tabOf = ({ r, today, stage, history, policy }: Client) => {
    // What to say follows why it ended: never "a payment failed" when the files don't say so.
    const month = fileDay(r.lapsedOn).replace(/\s\d+,/, "");
    const script = r.category === "affordability"
      ? `Your ${r.carrierName} policy ended when the payments got hard. Prices and plans change: shall we look at something that fits your budget now?`
      : r.category === "mechanical" || r.category === "administrative"
        ? `Your ${r.carrierName} policy ended in ${month} because a payment didn't go through. We can still get you covered, often at a similar price.`
        : `I saw your cover with ${r.carrierName} ended in ${month}. A lot has changed since; can I take two minutes to see if there's something that suits you now?`;
    const when = whenToCall(r, today);
    return (
      <>
        {tab === "why" && (
          // Grows to the foot of the screen (owner 2026-11-06: "fill the full height, no gaps").
          <div className="grid gap-4 lg:flex-1 xl:grid-cols-2">
            <section className={`${cardSurface} flex flex-col gap-2 p-5`} aria-label="Why it ended">
              <h2 className="m-0 text-base font-semibold text-foreground">Why it ended</h2>
              {stage === "blocked" && (
                // A stuck client leads with why (board 3·1): it is what stands between them and a call.
                <p className="m-0 text-sm font-semibold text-[var(--error-ink)]">Couldn&apos;t go on the list: {r.blockedReason}</p>
              )}
              <p className="m-0 text-sm text-muted-foreground"><span className="font-semibold text-foreground">{CATEGORY_LABELS[r.category]}.</span> {SOURCE_LABELS[r.source].charAt(0).toUpperCase() + SOURCE_LABELS[r.source].slice(1)}{r.detail && r.source !== "none" ? `: ${r.detail}` : ""}{r.inferred ? " (inferred, never said)" : ""}.</p>
            </section>
            <section className={`${cardSurface} flex flex-col gap-3 p-5`} aria-label="What to say">
              <h2 className="m-0 text-base font-semibold text-foreground">What to say</h2>
              {stage === "never"
                ? <p className="m-0 text-sm text-muted-foreground">Nothing: this client is never called.</p>
                : <p className="m-0 text-sm text-foreground">&ldquo;{script}&rdquo;</p>}
              <p className="m-0 text-xs text-muted-foreground">The call is made from the Win-back list, where the calling window and do-not-call checks apply.</p>
            </section>
          </div>
        )}

        {tab === "had" && (
          <section className={`${cardSurface} flex flex-col gap-2 p-5 lg:flex-1`} aria-label="What they had">
            <FactTable rows={[
              ["Policy", <Link key="p" href={policy} className="font-semibold text-foreground hover:underline">{r.carrierName} {r.policyNumber}</Link>],
              ["Premium", `${money(r.premiumCents)}/mo`],
              ["Cover", coverText(r.faceCents)?.replace(" cover", "") ?? "—"],
              ["Paid", paidText(r.monthsPaid)?.replace(" paid", "") ?? "—"],
              ["Lapsed", fileDay(r.lapsedOn)],
              ["Chance", `${BAND_LABELS[r.band]}: ${chanceWhy(r)}`],
              ["When to call", when.sub ? `${when.line}, ${when.sub}` : when.line],
            ]} />
          </section>
        )}

        {tab === "history" && (
          <TableCard>
            <table className="portal-lead-table w-full text-left text-sm">
              <thead><tr><th className="w-[160px]">When</th><th>What happened</th><th>Detail</th></tr></thead>
              <tbody>
                {history.map((line) => (
                  <tr key={line.what}>
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{line.day ? fileDay(line.day) : "—"}</td>
                    <td className="whitespace-nowrap">{line.what}</td>
                    {/* One line per row (owner 2026-11-11): the detail is its own column, its whole text the tooltip. */}
                    <td>{line.detail ? <span className="block max-w-[520px] truncate" title={line.detail}>{line.detail}</span> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </>
    );
  };

  return (
    <RetentionPage
      step="reinstatement"
      title={<RecordTitle read={read} name={(data) => clientOf(data)?.name ?? "Win-back"} />}
      tabs={<Suspense fallback={tabsOf(null)}><Await read={read}>{(data) => tabsOf(clientOf(data))}</Await></Suspense>}
      actions={<Suspense fallback={null}><Await read={read}>{(data) => { const client = clientOf(data); return client ? actionsOf(client) : null; }}</Await></Suspense>}
      breadcrumbs={retentionTrail("reinstatement", "Former client", asked ? { label: winbackViewLabel(asked), href: winbackViewHref(asked) } : undefined)}
    >
      <StreamSection shape="strip">
        <Await read={read}>
          {(data) => { const client = clientOf(data); return client ? stripOf(client) : <TableCard><EmptyState title="Not switched on yet" hint={WINBACK_PENDING_MESSAGE} /></TableCard>; }}
        </Await>
      </StreamSection>
      <StreamSection shape={tab === "history" ? "table" : "cards"}>
        <Await read={read}>{(data) => { const client = clientOf(data); return client ? tabOf(client) : null; }}</Await>
      </StreamSection>
    </RetentionPage>
  );
}

type Client = {
  r: WinbackRow; today: string; stage: WinbackStage; view: WinbackView; name: string;
  previous: WinbackRow | null; next: WinbackRow | null; history: ReturnType<typeof historyOf>; policy: string; leadHref: string | null;
};
