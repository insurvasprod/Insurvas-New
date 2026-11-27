import { useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeadRecord } from "@/app/lead/[id]";
import { CallSheet } from "@/components/call-sheet";
import { deviceZone } from "@/components/calls/time";
import { complianceChecks, headTicks, type CheckPanel, type CheckState } from "@/components/dialer/checks";
import { productName } from "@/components/inbound/model";
import { Button, Card, Chip, Empty, F } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { SplitView, useSplit } from "./split";

/**
 * Board L6 · the two tabs that get two panes on a tablet: Leads (list, then the lead) and Calls
 * (the dialer's list or the callbacks, then the lead). Both draw the same lead page as the phone
 * opens full screen, so a tablet never shows a second, drifting version of the record.
 */

function Placeholder({ title, body }: { title: string; body: string }) {
  const insets = useSafeAreaInsets();
  return <View testID="split-placeholder" style={{ flex: 1, paddingTop: insets.top + 40 }}><Empty icon="user" title={title} body={body} /></View>;
}

const leadPane = (id: string, close: () => void) => <LeadRecord id={id} onClose={close} />;

/** GET /api/app/dialer/panel, the fields the compact card reads. */
type CardPanel = CheckPanel & { lead: CheckPanel["lead"] & { fullName: string; age?: string | number | null; productCode: string | null }; viewerTimezone?: string | null };

/** Board L6's three chips: the check's short word when it passed, the dialer's own words when it didn't. */
const CARD_TICKS: Record<string, string> = { consent: "Consent", dnc: "DNC", window: "Window" };
const TONE: Record<CheckState, "ok" | "bad" | "neutral"> = { ok: "ok", bad: "bad", open: "neutral" };
export function cardTicks(panel: CheckPanel, now: Date, viewerZone: string): { key: string; label: string; tone: "ok" | "bad" | "neutral" }[] {
  return headTicks(complianceChecks(panel, now, viewerZone))
    .filter((t) => t.key in CARD_TICKS)
    .map((t) => ({ key: t.key, label: t.state === "ok" ? CARD_TICKS[t.key] : t.label, tone: TONE[t.state] }));
}

/** "64 · TX · Term life": only the parts the server sent. */
export function cardMeta(lead: CardPanel["lead"]): string {
  const age = lead.age != null && String(lead.age).trim() ? String(lead.age).trim() : null;
  return [age, lead.state, productName(lead.productCode)].filter(Boolean).join(" · ");
}

/**
 * Board L6 · the dialer's right pane on a tablet: a compact card for the picked lead — name, "64 · TX · term", the
 * Consent / DNC / Window chips and a small Call — from the dialer panel (the same checks the phone's call reads).
 * Call opens the dialer's call (the server's checks and the disclosure, never a raw tel: link). "Full record" shows
 * the lead page itself. A role without the dialer (the panel refuses it) gets the lead page straight away.
 */
export function DialerPane({ id, close }: { id: string; close: () => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const panel = useLoad(() => api<CardPanel>(`/api/app/dialer/panel?lead_id=${id}`), [id]);
  const [full, setFull] = useState(false);
  const [calling, setCalling] = useState(false);
  if (full || (panel.error && !panel.data)) return <LeadRecord id={id} onClose={close} />;
  const data = panel.data;
  const ticks = data ? cardTicks(data, new Date(), data.viewerTimezone ?? deviceZone()) : [];
  return (
    <ScrollView testID="dialer-pane" contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 8, paddingBottom: 24 }}>
      {data ? (
        <Card>
          <Text style={{ fontFamily: F.db, fontSize: 18, color: p.ink }}>{data.lead.fullName}</Text>
          {cardMeta(data.lead) ? <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{cardMeta(data.lead)}</Text> : null}
          {ticks.length ? (
            <View testID="dialer-pane-ticks" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {ticks.map((t) => <Chip key={t.key} tone={t.tone}>{t.label}</Chip>)}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
            <Button testID="dialer-pane-call" label="Call" icon="phone" small onPress={() => setCalling(true)} style={{ alignSelf: "flex-start", paddingHorizontal: 18 }} />
            <Button testID="dialer-pane-full" label="Full record" kind="plain" small onPress={() => setFull(true)} />
          </View>
        </Card>
      ) : null}
      {calling ? <CallSheet leadId={id} visible backLabel="Dialer" onClose={() => setCalling(false)} onSaved={() => { setCalling(false); panel.reload(); }} /> : null}
    </ScrollView>
  );
}

const dialerPane = (id: string, close: () => void) => <DialerPane id={id} close={close} />;

/** Wraps the Leads tab: the list on the left, the lead a row opens on the right. */
export function LeadsSplit({ children }: { children: ReactNode }) {
  return (
    <SplitView testID="leads-split" detail={leadPane} placeholder={<Placeholder title="Pick a lead" body="Its record opens here, beside the list." />}>
      {children}
    </SplitView>
  );
}

/** Wraps the Calls tab: the dialer's queue or the callbacks on the left, the lead's compact card on the right. */
export function CallsSplit({ children }: { children: ReactNode }) {
  return (
    <SplitView testID="calls-split" detail={dialerPane} placeholder={<Placeholder title="Pick someone to call" body="Their lead opens here, with the checks and the Call button." />}>
      {children}
    </SplitView>
  );
}

/**
 * Opens a lead from a list: beside the list on a tablet, as its own page on a phone. A drop-in for
 * `router.push(`/lead/${id}`)` in the Leads tab.
 */
export function useOpenLead(): (id: string) => void {
  const split = useSplit();
  return (id: string) => {
    if (split.wide) split.show(id);
    else router.push(`/lead/${id}` as Href);
  };
}

/**
 * For a row that does something else on a phone (the dialer serves the lead, a callback opens its
 * sheet): on a tablet it also shows the lead on the right. Returns true when it did, so the caller can
 * skip the phone action when the pane is enough.
 */
export function useShowLead(): (leadId: string) => boolean {
  const split = useSplit();
  return (leadId: string) => {
    if (!split.wide) return false;
    split.show(leadId);
    return true;
  };
}

/** Whether this lead is the one open on the right (the list draws its row as selected). */
export function useLeadSelected(): (leadId: string) => boolean {
  const split = useSplit();
  return (leadId: string) => split.wide && split.selected === leadId;
}
