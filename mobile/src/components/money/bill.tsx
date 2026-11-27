import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { Sheet, SheetField, Toast } from "@/components/leads/sheets";
import { Button, Chip, F, Failed, Header, IOS, Loading, Screen, TextLink } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { approveWithBiometrics } from "./device";
import { billChip, billFacts, dayShort, dayWeek, monthShort } from "./logic";
import { Card, KeyValues, Mini, Pad } from "./parts";
import type { Invoice } from "./types";

/**
 * Board G3c · Vendor bill: a lead bill checked against what actually arrived — leads billed, leads that arrived,
 * returns credited — the difference said in one chip. The web's own bill (GET /api/app/accounting/invoices/<id>,
 * its comparison). Approve books the cost (POST {action: "approve"}) after a fresh fingerprint or Face ID; Dispute
 * marks it disputed with a note (POST {action: "dispute"}). Only a received bill is decided here; a draft is
 * finished, and an approved bill is marked paid, on the computer. "Paid with" is the bill's own payment method and
 * reference; a bill names no bank account ("Truist ••4471") — that needs a column the database does not have.
 */
const PAID: Record<string, string> = { ach: "ACH", card: "Card", cheque: "Cheque", wire: "Wire", other: "Other" };

export function BillScreen({ id }: { id: string }) {
  const p = usePalette();
  const { api } = useSession();
  const answer = useLoad(() => api<{ invoice: Invoice }>(`/api/app/accounting/invoices/${encodeURIComponent(id)}`).then((a) => a.invoice), [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const inv = answer.data;
  // "Nov 1–15" within one month (the board's title), else "1 Oct – 15 Nov".
  const period = inv?.periodStart && inv.periodEnd
    ? inv.periodStart.slice(0, 7) === inv.periodEnd.slice(0, 7) ? `${monthShort(inv.periodStart.slice(0, 7))} ${Number(inv.periodStart.slice(8, 10))}–${Number(inv.periodEnd.slice(8, 10))}` : `${dayShort(inv.periodStart)} – ${dayShort(inv.periodEnd)}`
    : inv?.invoiceNumber ?? "";
  const title = inv ? `${inv.sourceName} · ${period}` : "Vendor bill";

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await api<{ invoice: Invoice }>(`/api/app/accounting/invoices/${encodeURIComponent(id)}`, { method: "POST", body });
      answer.setData(next.invoice);
      setToast(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t save. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    setError(null);
    const check = await approveWithBiometrics("Approve this bill");
    if (!check.ok) { if (check.why) setError(check.why); return; }
    await act({ action: "approve" }, "Bill approved. Its cost is booked.");
  };
  const dispute = async () => {
    if (await act({ action: "dispute", note: note.trim() || null }, "Bill marked disputed.")) setDisputing(false);
  };

  const decidable = inv?.status === "received";
  const footer = decidable ? (
    <View style={{ gap: 10 }}>
      {error ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button testID="bill-dispute" kind="outline" label="Dispute" onPress={() => setDisputing(true)} disabled={busy} style={{ flex: 1 }} />
        <Button write testID="bill-approve" label="Approve" icon="check" busy={busy} onPress={() => void approve()} style={{ flex: 1 }} />
      </View>
    </View>
  ) : undefined;
  const header = <Header title={title} back={IOS ? "Money" : undefined} onBack={router.back} large={false} />;
  const chip = inv ? billChip(inv) : null;
  const facts = inv ? billFacts(inv) : null;

  return (
    <Screen header={header} footer={footer} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !inv ? <Loading rows={3} />
        : answer.error && !inv ? <Failed what="the bill" message={answer.error} onRetry={answer.reload} />
          : inv && chip && facts ? (
            <Pad gap={12}>
              <Card testID="bill-card">
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Mini>Bill</Mini>
                  <Chip tone={chip.tone}>{chip.label}</Chip>
                </View>
                <View style={{ marginTop: 4 }}><MoneyFigure cents={inv.totalCents} size={34} /></View>
              </Card>
              <Card>
                <KeyValues testID="bill-facts" rows={([
                  ["Leads billed", facts.billed],
                  facts.arrived !== null ? ["Leads arrived", facts.arrived] : null,
                  facts.returns !== null ? ["Returns credited", facts.returns] : null,
                  inv.dueDate ? ["Due", dayWeek(inv.dueDate)] : null,
                  inv.paidMethod ? ["Paid with", [PAID[inv.paidMethod] ?? inv.paidMethod, inv.paymentReference].filter(Boolean).join(" · ")] : null,
                ] as ([string, string] | null)[]).filter((r): r is [string, string] => r !== null)} />
              </Card>
              {!decidable ? (
                <View style={{ paddingTop: 6 }}>
                  <TextLink label="Open on the computer" onPress={() => router.push({ pathname: "/computer", params: { path: `/app/vendor-bills/${inv.id}`, title: "This bill", why: inv.status === "draft" ? "A draft bill is finished with its lines beside it." : "Paying and closing a bill are recorded with the bank beside it." } })} />
                </View>
              ) : null}
            </Pad>
          ) : null}
      <Sheet visible={disputing} title="Dispute this bill" onClose={() => setDisputing(false)} testID="bill-dispute-sheet"
        footer={<Button write testID="bill-dispute-send" label="Mark disputed" busy={busy} onPress={() => void dispute()} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Mini>The bill waits as disputed until the vendor answers. Nothing is sent to them from here.</Mini>
          <SheetField testID="bill-dispute-note" label="What’s wrong" value={note} onChangeText={setNote} multiline placeholder="For example: 41 leads were returned and not credited" />
        </View>
      </Sheet>
      <Toast text={toast} onHide={() => setToast(null)} bottom={IOS ? 16 : 96} />
    </Screen>
  );
}
