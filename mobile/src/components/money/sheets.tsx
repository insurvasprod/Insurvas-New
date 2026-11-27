import { useState } from "react";
import { Text, View } from "react-native";

import { MoneyFigure } from "@/components/book/parts";
import { Sheet } from "@/components/leads/sheets";
import { Avatar, Button, Chip, Empty, F, Loading, Row } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { approveWithBiometrics } from "./device";
import { initials, localToday, money, monthName, plural, roundCents, shortMoney, teamPayoutBody, wholeMoney, type TeamDraft } from "./logic";
import { Mini } from "./parts";
import type { PartnerRun, PartnerRunDetail, TodoItem } from "./types";

/**
 * The Money tab's approval sheets. Each names what happens before anything moves, asks for a fresh fingerprint or
 * Face ID, then calls the web's own route — nothing here pays anyone: the agency's own bank or payroll sends the
 * money, as on the web.
 *
 *   G4  Team payouts     POST /api/app/agency/payouts (Team payouts' Confirm and mark paid, the web's defaults; no
 *                        method is named — the board leaves how they are paid to the agency's payroll or bank)
 *   G3b Partner payouts  POST /api/app/accounting/payouts/<run> {action: "publish"} for each draft to review
 *       A monthly bill    POST /api/app/accounting/expenses/<id> {action: "ok"} (books it and stamps it paid today)
 */

/** A sheet's foot: what happens, then the one button. */
function Foot({ note, label, busy, disabled, error, onPress, testID }: { note: string; label: string; busy: boolean; disabled?: boolean; error: string | null; onPress: () => void; testID: string }) {
  const p = usePalette();
  return (
    <View style={{ gap: 12, paddingTop: 4 }}>
      <Mini>{note}</Mini>
      {error ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 13.5, lineHeight: 19, color: p.bad }}>{error}</Text> : null}
      <Button write testID={testID} label={label} icon="check" busy={busy} disabled={disabled} onPress={onPress} />
    </View>
  );
}

function Total({ left, cents }: { left: string; cents: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingBottom: 4 }}>
      <Text style={{ fontFamily: F.r, fontSize: 15, color: p.muted }}>{left}</Text>
      <MoneyFigure cents={roundCents(cents)} size={26} dropZero />
    </View>
  );
}

// ─── G4 · Approve team payouts ─────────────────────────────────────────────────────────────────
export function TeamPayoutsSheet({ visible, month, drafts, recoveryPctBp, onClose, onDone }: {
  visible: boolean; month: string; drafts: TeamDraft[]; recoveryPctBp: number; onClose: () => void; onDone: (text: string) => void;
}) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = drafts.reduce((s, d) => s + d.payCents, 0);
  const approve = async () => {
    setError(null);
    const check = await approveWithBiometrics(`Approve ${monthName(month)} team payouts`);
    if (!check.ok) { if (check.why) setError(check.why); return; }
    setBusy(true);
    try {
      await api("/api/app/agency/payouts", { method: "POST", body: teamPayoutBody(month, drafts, { method: "", paidOn: localToday() }, recoveryPctBp) });
      onDone(`${monthName(month)} is approved: ${plural(drafts.length, "person", "people")}, ${money(total)}. Each has a private statement.`);
    } catch (e) {
      setError(`That didn’t save. ${monthName(month)} is not marked paid; try again. (${e instanceof Error ? e.message : "No answer"})`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title={`${monthName(month)} team payouts`} onClose={onClose} testID="team-payouts-sheet"
      footer={<Foot testID="team-approve" note="Each person gets a private statement when you approve. Payment itself goes out from your payroll or bank." label={`Approve ${money(total)}`} busy={busy} disabled={!drafts.length} error={error} onPress={() => void approve()} />}>
      <Total left={`${plural(drafts.length, "person", "people")} · by each pay plan`} cents={total} />
      <View style={{ marginHorizontal: -16 }}>
        {drafts.map((d, i) => (
          <Row key={d.person.producerUserId} testID={`team-row-${d.person.producerUserId}`} first={i === 0} lead={<Avatar initials={initials(d.person.displayName)} />} title={d.person.displayName} meta={d.why} right={money(d.payCents)} chevron={false} />
        ))}
      </View>
    </Sheet>
  );
}

// ─── G3b · Partner payouts ─────────────────────────────────────────────────────────────────────
/** What one unit of a partner's deal is called on the board ("41 sold", "12 transfers"). */
const UNIT: Record<string, string> = { sale: "sold", transfer: "transfers", lead: "leads", submitted_application: "applications", issued_policy: "issued" };

/**
 * "41 sold × $95 · 12 transfers × $35": a run's lines in one line, by its deal (board G3b). A run that is only money
 * taken back reads "Clawback: 1 returned lead", as drawn beside its "Returned" chip (the server's clawback is a sold
 * lead whose policy charged back, so the partner gives the lead's pay back).
 */
export function dealLine(lines: PartnerRunDetail["lines"]): string {
  const live = lines.filter((l) => l.amountCents !== 0);
  const back = live.filter((l) => l.itemType === "clawback");
  if (back.length && back.length === live.length) {
    const n = back.reduce((s, l) => s + l.count, 0);
    return `Clawback: ${plural(n, "returned lead", "returned leads")}`;
  }
  return live.map((l) => (l.itemType === "clawback" ? `Clawback ${shortMoney(l.amountCents)}` : l.rateCents !== null ? `${l.count} ${UNIT[l.itemType] ?? l.label.toLowerCase()} × ${shortMoney(l.rateCents)}` : `${l.label} ${shortMoney(l.amountCents)}`)).join(" · ");
}

/** "November partner payouts" when every run is for one month, else "Partner payouts". */
export function partnerTitle(runs: { periodEnd: string }[]): string {
  const months = [...new Set(runs.map((r) => r.periodEnd.slice(0, 7)))];
  return months.length === 1 && /^\d{4}-\d{2}$/.test(months[0]) ? `${monthName(months[0])} partner payouts` : "Partner payouts";
}

export function PartnerPayoutsSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useLoad(async () => {
    if (!visible) return null;
    const { runs } = await api<{ runs: PartnerRun[] }>("/api/app/accounting/payouts");
    // Partner payouts' To review: a $0 draft is nothing to review (2026-11-09).
    const drafts = runs.filter((r) => r.status === "draft" && r.netCents !== 0);
    return Promise.all(drafts.map((r) => api<{ run: PartnerRunDetail }>(`/api/app/accounting/payouts/${r.id}`).then((d) => d.run)));
  }, [visible]);
  const runs = answer.data ?? [];
  const total = runs.reduce((s, r) => s + r.netCents, 0);
  const approve = async () => {
    setError(null);
    const check = await approveWithBiometrics("Approve partner payouts");
    if (!check.ok) { if (check.why) setError(check.why); return; }
    setBusy(true);
    let done = 0;
    try {
      // One at a time, so a refusal names the partner and the ones already published stay published.
      for (const r of runs) {
        await api(`/api/app/accounting/payouts/${r.id}`, { method: "POST", body: { action: "publish" } });
        done += 1;
      }
      onDone(`${plural(done, "partner payout", "partner payouts")} approved, ${money(total)}. Each partner sees it in their portal.`);
    } catch (e) {
      const who = runs[done]?.partnerName ?? "a partner";
      setError(`${done ? `${plural(done, "payout was", "payouts were")} approved. ` : ""}${who}’s didn’t go through: ${e instanceof Error ? e.message : "no answer"}`);
      answer.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} title={partnerTitle(runs)} onClose={onClose} testID="partner-payouts-sheet"
      footer={runs.length ? <Foot testID="partner-approve" note="Each partner sees their statement in their portal when you approve." label={`Approve ${money(total)}`} busy={busy} error={error} onPress={() => void approve()} /> : null}>
      {answer.loading && !answer.data ? <Loading rows={2} />
        : answer.error && !answer.data ? <Empty icon="refresh" tone="bad" title="We couldn’t load the payouts" body={answer.error} />
          : !runs.length ? <Empty icon="handshake" title="Nothing to review" body="Partner payout drafts appear here when a period closes." />
            : (
              <>
                <Total left={plural(runs.length, "partner", "partners")} cents={total} />
                <View style={{ marginHorizontal: -16 }}>
                  {runs.map((r, i) => {
                    const back = r.lines.some((l) => l.itemType === "clawback" && l.amountCents !== 0);
                    return (
                      <Row key={r.id} testID={`partner-row-${r.id}`} first={i === 0} icon="handshake" title={r.partnerName} meta={dealLine(r.lines) || null}
                        chip={back ? <Chip tone="warn">Returned</Chip> : undefined} right={wholeMoney(r.netCents)} chevron={false} />
                    );
                  })}
                </View>
              </>
            )}
    </Sheet>
  );
}

// ─── A monthly bill to OK (G3's expense row) ───────────────────────────────────────────────────
export function ExpenseOkSheet({ item, onClose, onDone }: { item: TodoItem | null; onClose: () => void; onDone: (text: string) => void }) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = item?.key.replace(/^exp-/, "") ?? "";
  const ok = async () => {
    if (!item) return;
    setError(null);
    const check = await approveWithBiometrics("OK this bill");
    if (!check.ok) { if (check.why) setError(check.why); return; }
    setBusy(true);
    try {
      await api(`/api/app/accounting/expenses/${id}`, { method: "POST", body: { action: "ok" } });
      onDone("Booked and marked paid today.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={Boolean(item)} title={item?.what ?? ""} onClose={onClose} testID="expense-ok-sheet"
      footer={<Foot testID="expense-ok" note="It is booked and stamped paid today. The money itself goes out as it always does." label={item?.amountCents ? `OK ${money(item.amountCents)}` : "OK it"} busy={busy} error={error} onPress={() => void ok()} />}>
      <Total left={item?.detail ?? ""} cents={item?.amountCents ?? 0} />
    </Sheet>
  );
}
