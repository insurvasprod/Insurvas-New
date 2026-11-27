import { View } from "react-native";
import { router } from "expo-router";

import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { dayMonth, lineTitle, money } from "./format";
import { FigureTile, MoneyFigure, TilePair } from "./parts";
import type { CarrierPolicy, ExpectedLine, PolicyAnswer, Split } from "./types";

/**
 * Board F2b · Commission ledger: one policy's commission, line by line as the carrier statements posted it
 * (advance, as-earned months, chargebacks, reversals), oldest first as the web's Money tab lists them, then the lines
 * still to come (the rest of the first year, marked Expected, and each renewal year, "—" when no rate prices it), and
 * the Split: the writing agent's pay-plan share of the advance and the agency's override. Read-only: posting and
 * corrections happen on the computer. The same answer as the policy page (GET /api/app/policy-book). Paid to date is
 * the ledger's net received; Still at risk is the unearned advance the carrier could take back.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 2027". */
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "75%", "12.5%". */
export const pct = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;
/** "JR": the board's avatar initials for a person. */
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");

/** A posted line's meta, as drawn: "AMAM statement · 14 Mar" (the carrier's name: no short code on the server). */
export function postedMeta(line: CarrierPolicy["money"]["lines"][number], carrierName: string): string {
  return [
    `${carrierName} statement`,
    line.date ? dayMonth(line.date) : null,
    line.upline ? "to the upline" : null,
    line.held ? "held: its statement doesn’t add up" : null,
  ].filter(Boolean).join(" · ");
}

/**
 * When the first as-earned month's statement is due: the advance's own statement day, as many months on as the advance
 * covered (board "AMAM statement · 14 Dec": advanced 9 months on 14 Mar, month 10 comes with December's statement).
 * Null without the advance's date and length.
 */
export function asEarnedDue(lines: readonly CarrierPolicy["money"]["lines"][number][]): string | null {
  const advance = lines.find((l) => l.type === "advance" && !l.upline && l.date && l.monthsAdvanced);
  if (!advance?.date || !advance.monthsAdvanced) return null;
  const [y, m, d] = advance.date.slice(0, 10).split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + advance.monthsAdvanced + 1, 0)).getUTCDate();
  const due = new Date(Date.UTC(y, m - 1 + advance.monthsAdvanced, Math.min(d, last)));
  return due.toISOString().slice(0, 10);
}

/** A line still to come: "Expected" beside the rest of the first year, dated as drawn; a renewal says when it starts. */
export function expectedMeta(line: ExpectedLine, carrierName: string, dueOn: string | null = null): string {
  if (line.kind === "renewal") return line.startsOn ? `Starts ${monthYear(line.startsOn)}` : "Starts at the policy’s anniversary";
  return dueOn ? `${carrierName} statement · ${dayMonth(dueOn)}` : `${carrierName} statement · not posted yet`;
}

export function LedgerScreen({ carrierId, policyNumber }: { carrierId: string; policyNumber: string }) {
  const { api } = useSession();
  const answer = useLoad(() => api<PolicyAnswer>(`/api/app/policy-book?carrierId=${encodeURIComponent(carrierId)}&policyNumber=${encodeURIComponent(policyNumber)}`), [carrierId, policyNumber]);
  const policy = answer.data?.policy;
  const carrier = policy?.kind === "policy" ? policy : null;
  const m = carrier?.money;
  const sub = policy ? `${policy.title} · ${policy.policyNumber}` : undefined;
  const expected = carrier?.expected ?? [];

  const header = <Header back={IOS ? "Policy" : undefined} onBack={router.back} large title="Commission" sub={sub} />;
  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !policy ? <Loading rows={4} />
        : answer.error && !policy ? <Failed what="the commission" message={answer.error} onRetry={answer.reload} />
          : !carrier || !m ? <Empty icon="receipt" title="No commission lines yet" body="This sale waits for its carrier’s file; its commission arrives with the statements after it." />
            : !m.available ? <Empty icon="receipt" title="The commission ledger isn’t ready yet" body="It needs a database update. The web says which one." />
              : (
                <>
                  <View style={{ paddingHorizontal: 16 }}>
                    <TilePair>
                      <FigureTile testID="ledger-paid" label="Paid to date">{m.paidToDateCents !== null ? <MoneyFigure cents={m.paidToDateCents} /> : "—"}</FigureTile>
                      <FigureTile testID="ledger-risk" label="Still at risk" detail={m.atRiskCents && carrier.clawbackMonths ? `Until month ${carrier.clawbackMonths}` : m.atRiskCents === 0 ? "Nothing left to take back" : null}>
                        {m.atRiskCents !== null ? <MoneyFigure cents={m.atRiskCents} /> : "—"}
                      </FigureTile>
                    </TilePair>
                  </View>
                  {m.lines.length || expected.length ? (
                    <Group title="Posted lines">
                      {m.lines.map((line, i) => (
                        <Row key={line.id} testID={`ledger-line-${line.id}`} first={i === 0} chevron={false}
                          title={lineTitle(line)} meta={postedMeta(line, carrier.carrierName)} right={money(line.amountCents)} />
                      ))}
                      {expected.map((line, i) => (
                        <Row key={line.key} testID={`ledger-expected-${line.key}`} first={!m.lines.length && i === 0} chevron={false}
                          title={line.label} meta={expectedMeta(line, carrier.carrierName, asEarnedDue(m.lines))}
                          chip={line.kind === "as_earned" ? <Chip tone="info">Expected</Chip> : undefined}
                          right={line.amountCents === null ? "—" : money(line.amountCents)} />
                      ))}
                    </Group>
                  ) : <Empty icon="receipt" title="No commission lines yet" body="Lines arrive with the carrier’s commission statements." />}
                  {carrier.split ? <SplitGroup split={carrier.split} /> : null}
                </>
              )}
    </Screen>
  );
}

/** Split: the writing agent (initials) and the agency's override (a building); a producer never sees the agency's amount. */
function SplitGroup({ split }: { split: Split }) {
  return (
    <Group title="Split">
      <Row testID="ledger-split-agent" first avatar={initials(split.agentName)} chevron={false} title={split.agentName} meta={`${pct(split.agentPctBp)} of advance`} right={money(split.agentCents)} />
      <Row testID="ledger-split-agency" icon="building" chevron={false} title="Agency override" meta={pct(split.agencyPctBp)} right={split.agencyCents === null ? "Not shown" : money(split.agencyCents)} />
    </Group>
  );
}
