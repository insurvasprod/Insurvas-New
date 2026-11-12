import Link from "next/link";

import { LinkRow } from "@/components/app/book/setup/link-row";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { STEP_LABELS, STEP_SLUG, type Step } from "@/lib/retention/cases/ladder";
import { MIN_DECIDED, rateText, type ScoreLine } from "@/lib/retention/cases/scorecard";

/**
 * Retention › Scorecard's tables (round 7, owner pick 5·A / 5·1, 2026-11-10; docs/la4/mockups-r7/retention.html),
 * each in its TableCard filling to the window foot. Server-drawn: every count opens Cases filtered to that person and step (`?step=`, `?owner=`), a person's row
 * opens their own page (`?rep=`), and nothing in a row decides or edits anything.
 */

export const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** Cases, filtered: a step's tab (or Closed) and, when given, one person's or one carrier's cases. */
export function casesHref({ step, owner, carrier, touch }: { step?: Step | "closed"; owner?: string | null; carrier?: string | null; touch?: "unreachable" }): string {
  const q = new URLSearchParams();
  if (step) q.set("step", step === "closed" ? "closed" : STEP_SLUG[step]);
  if (owner) q.set("owner", owner);
  if (carrier) q.set("carrier", carrier);
  if (touch) q.set("touch", touch);
  return q.size ? `/app/retention?${q}` : "/app/retention";
}

/** A count that opens its cases; a zero has nothing to open. */
export function CountLink({ value, href, label }: { value: number; href: string; label: string }) {
  if (!value) return <span>0</span>;
  return <Link href={href} title={label} className="whitespace-nowrap text-foreground underline-offset-2 hover:underline">{value.toLocaleString("en-US")}</Link>;
}

const NUM = "whitespace-nowrap text-right tabular-nums";
const FIRST = "whitespace-nowrap font-medium text-foreground";
const EMPTY = <EmptyState title="No cases in this period" hint="Cases come from the carrier files; they show here as they are worked and closed." />;
const FOOT = <span>Saved means a carrier file proved it; closed without a save counts apart from the rate · under {MIN_DECIDED} decided cases the counts are shown</span>;
const nothing = (l: ScoreLine) => l.open + l.saved + l.lost + l.closedNoSave === 0;

/** Who a person is in Cases' owner filter: "me" for the viewer, their id otherwise; nobody has no filter. */
const ownerParam = (key: string, viewerId: string) => (key === "nobody" ? null : key === viewerId ? "me" : key);

/** The save rate, the row's one chip ("3 of 3 saved" under the floor, a percentage over it); "—" with none decided. */
export function RateChip({ text }: { text: string }) {
  return text === "—" ? <span className="text-muted-foreground">—</span> : <StatusChip>{text}</StatusChip>;
}

/**
 * Reports round 7 (9·1): six columns, so closed without a save and unreachable leave the rows; when either is not
 * zero it is a link on the table's toolbar line ("2 unreachable ›"), opening those cases.
 */
function apartLinks(total: ScoreLine, owner: string | null, unreachable: boolean) {
  const links = [
    unreachable && total.unreachable ? { href: casesHref({ owner, touch: "unreachable" }), text: `${total.unreachable.toLocaleString("en-US")} unreachable ›` } : null,
    total.closedNoSave ? { href: casesHref({ step: "closed", owner }), text: `${total.closedNoSave.toLocaleString("en-US")} closed without a save ›` } : null,
  ].filter((l): l is { href: string; text: string } => !!l);
  if (!links.length) return undefined;
  return (
    <DataToolbar>
      {links.map((l) => <Link key={l.text} href={l.href} className="text-sm text-foreground underline-offset-2 hover:underline">{l.text}</Link>)}
    </DataToolbar>
  );
}

function ScoreHead({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="text-right">Open</th>
        <th className="text-right">Saved</th>
        <th className="text-right">Lost</th>
        <th className="text-right">Premium kept</th>
        <th title={`Saved of saved and lost; under ${MIN_DECIDED} decided cases the counts are shown.`}>Save rate</th>
      </tr>
    </thead>
  );
}

/** The figures of one line, each count a link into Cases (open ones on their step's tab, closed ones on Closed). */
function Figures({ l, step, owner }: { l: ScoreLine; step?: Step; owner: string | null }) {
  return (
    <>
      <td className={NUM}><CountLink value={l.open} href={casesHref({ step, owner })} label="Open them in Cases" /></td>
      <td className={NUM}><CountLink value={l.saved} href={casesHref({ step: "closed", owner })} label="Saved, on Cases › Closed" /></td>
      <td className={NUM}><CountLink value={l.lost} href={casesHref({ step: "closed", owner })} label="Lost, on Cases › Closed" /></td>
      <td className={NUM}>{l.keptCents ? `${money(l.keptCents)}/mo` : <span className="text-muted-foreground">—</span>}</td>
      <td className="whitespace-nowrap"><RateChip text={rateText(l)} /></td>
    </>
  );
}

/** Board 5·A, By person: one row a person, the row opens their page; "Everyone" under a team. */
export function ScorecardPeopleTable({ people, total, names, viewerId, personHref }: { people: ScoreLine[]; total: ScoreLine; names: Record<string, string>; viewerId: string; personHref: (userId: string) => string }) {
  if (nothing(total)) return <TableCard footer={FOOT}>{EMPTY}</TableCard>;
  return (
    <TableCard footer={FOOT} toolbar={apartLinks(total, null, true)}>
    <table className="portal-lead-table w-full text-left text-sm">
      <ScoreHead first="Person" />
      <tbody>
        {people.map((l) => {
          const name = l.key === "nobody" ? "Nobody yet" : names[l.key] ?? "Someone no longer here";
          const owner = ownerParam(l.key, viewerId);
          if (l.key === "nobody") {
            return (
              <tr key={l.key}>
                <td className={FIRST}>{name}</td>
                <Figures l={l} owner={owner} />
              </tr>
            );
          }
          return (
            <LinkRow key={l.key} href={personHref(l.key)}>
              <td className={FIRST}><Link href={personHref(l.key)} className="underline-offset-2 hover:underline">{name}</Link></td>
              <Figures l={l} owner={owner} />
            </LinkRow>
          );
        })}
        {people.length > 1 && (
          <tr>
            <td className={FIRST}>Everyone</td>
            <Figures l={total} owner={null} />
          </tr>
        )}
      </tbody>
    </table>
    </TableCard>
  );
}

/**
 * Board 5·A, By step (everyone), and board 5·1 (one person's steps, `owner` set): a row a step, the four ladder
 * steps then paperwork. A step's name opens its tab in Cases.
 */
export function ScorecardStepTable({ steps, total, owner, unreachable }: { steps: ScoreLine[]; total: ScoreLine; owner: string | null; unreachable: boolean }) {
  if (nothing(total)) return <TableCard footer={FOOT}>{EMPTY}</TableCard>;
  return (
    <TableCard footer={FOOT} toolbar={apartLinks(total, owner, unreachable)}>
    <table className="portal-lead-table w-full text-left text-sm">
      <ScoreHead first="Step" />
      <tbody>
        {steps.map((l) => (
          <tr key={l.key}>
            <td className={FIRST}><Link href={casesHref({ step: l.key as Step, owner })} className="underline-offset-2 hover:underline">{STEP_LABELS[l.key as Step] ?? l.key}</Link></td>
            <Figures l={l} step={l.key as Step} owner={owner} />
          </tr>
        ))}
        <tr>
          <td className={FIRST}>All steps</td>
          <Figures l={total} owner={owner} />
        </tr>
      </tbody>
    </table>
    </TableCard>
  );
}
