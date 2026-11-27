import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { Mini } from "@/components/calls/parts";
import { Button, Card, F, Screen } from "@/components/ui";
import { ago, codeLabel, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { callerLine, callerName, checkTicks, contactFacts, historyLine, partnerQuote } from "./model";
import { H4, Hr, KV, TickRow } from "./parts";
import type { CallerExtras, Screening, VerificationPanel } from "./types";

/**
 * Board C3 · Caller profile (web step 2, ?phase=check): who is on the line, the checks the server
 * already ran as ticks, and the partner's own words with where and when they came from (partner ·
 * campaign, "2 min ago · first call with us"). Read-only; the details are checked on the next step,
 * so the partner's other fields are not listed here (Verification reads each one back). The phone
 * number is plain text you can select, never a tel: link.
 */
export function CallerProfile({ panel, workItemId, header, onNext }: { panel: VerificationPanel; workItemId: string; header: ReactNode; onNext: () => void }) {
  const p = usePalette();
  const { api } = useSession();
  const q = encodeURIComponent(workItemId);
  // Both are extras: the step works without them (the web's TransferCheck does the same).
  const caller = useLoad(() => api<CallerExtras>(`/api/app/inbound/caller?work_item_id=${q}`), [workItemId]);
  const screening = useLoad(() => api<Screening>(`/api/app/inbound/screening?work_item_id=${q}`), [workItemId]);
  const [now] = useState(() => Date.now());

  const values = panel.lead.values;
  const facts = contactFacts(values);
  const product = panel.template.product_name || codeLabel(panel.workItem.productLine) || null;
  const partner = panel.context?.partnerName ?? null;
  const ticks = checkTicks(screening.data, panel.preflight, now, caller.data);
  const quote = partnerQuote(panel)?.value ?? caller.data?.partnerNote ?? null;
  const [copied, setCopied] = useState(false);
  const history = historyLine(caller.data?.calls, caller.data?.transfers);
  const campaign = caller.data?.campaign ?? null;
  const sent = caller.data?.sentAt ? ago(caller.data.sentAt, now) : null;
  const footer = [partner, sent, history ? history.charAt(0).toLowerCase() + history.slice(1) : null].filter(Boolean).join(" · ");

  const rows = [
    // The number is text with Copy beside it, never a tel: link: the call is on the agency's line.
    facts.phone ? { label: "Phone", value: (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 }}>
        <Text numberOfLines={1} selectable style={{ flexShrink: 1, fontFamily: F.r, fontSize: 15, color: p.ink, fontVariant: ["tabular-nums"] }}>{phoneLabel(facts.phone) ?? facts.phone}</Text>
        <Pressable testID="caller-copy-phone" accessibilityRole="button" accessibilityLabel="Copy the phone number" hitSlop={8}
          onPress={() => { void Clipboard.setStringAsync(facts.phone ?? "").then(() => { setCopied(true); }).catch(() => undefined); }}>
          <Text style={{ fontFamily: F.s, fontSize: 15, color: p.greenInk }}>{copied ? "Copied" : "Copy"}</Text>
        </Pressable>
      </View>
    ) } : null,
    facts.email ? { label: "Email", value: facts.email } : null,
    facts.language ? { label: "Language", value: facts.language } : null,
    product ? { label: "Product", value: product } : null,
    partner || campaign ? { label: "From", value: [partner, campaign].filter(Boolean).join(" · ") } : null,
  ].filter(Boolean) as { label: string; value: ReactNode }[];

  return (
    <Screen header={header} footer={<Button testID="call-next-verify" label="Next: Verification" onPress={onNext} />}>
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        <Card>
          <Text style={{ fontFamily: F.db, fontSize: 26, lineHeight: 31, letterSpacing: -0.52, color: p.ink }}>{callerName(values)}</Text>
          {callerLine(values) ? <Text style={{ fontFamily: F.r, fontSize: 16, lineHeight: 22, color: p.muted }}>{callerLine(values)}</Text> : null}
          {rows.length ? <><Hr /><KV rows={rows} /></> : null}
        </Card>

        {ticks.length ? (
          <Card>
            <H4>Checks</H4>
            <View style={{ gap: 10, marginTop: 10 }}>
              {ticks.map((t) => <TickRow key={t.key} tick={t} />)}
            </View>
          </Card>
        ) : null}

        {quote || footer ? (
          <Card>
            <H4>From the partner</H4>
            {quote ? <Text testID="caller-partner-quote" style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{`“${quote}”`}</Text> : null}
            {footer ? <Mini style={{ marginTop: 6 }}>{footer}</Mini> : null}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
