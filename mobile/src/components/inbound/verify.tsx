import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { PHONE_PRODUCTS } from "@/components/applications/logic";
import { Mini } from "@/components/calls/parts";
import { Button, Chip, F, Group, Row, Screen, TextLink } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";
import { CorrectSheet } from "./correct-sheet";
import { HandoffSheet } from "./handoff-sheet";
import { callerName, fieldValue, objectPronoun, verifyView } from "./model";
import { GroupTitle, Prog } from "./parts";
import type { PanelField, VerificationPanel } from "./types";

/**
 * Board C4 · Verification (web step 2 of the call, ?phase=verify): field by field, each saved the moment
 * it is tapped (POST /api/app/inbound/verification), so a dropped call loses nothing. Confirmed and
 * corrected fields read differently; the next one to ask is open in the middle. Assistants hand the
 * call to a licensed agent (C4b) instead of finishing it, as on the web.
 *
 * Continue to Application is the web's own doorway (POST /api/app/applications/start with this
 * transfer's work item, the same one the call page's step 3 uses): it opens or resumes the case and
 * the phone's application opens on it. A product the phone does not apply for goes to the phone's
 * product step (app/application/start), which hands that one to the computer.
 */
export function Verification({ panel, onPanel, workItemId, header, canHandoff, onFinish }: { panel: VerificationPanel; onPanel: (p: VerificationPanel) => void; workItemId: string; header: ReactNode; canHandoff: boolean; onFinish: () => void }) {
  const p = usePalette();
  const { api } = useSession();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [correcting, setCorrecting] = useState<PanelField | null>(null);
  const [handing, setHanding] = useState(false);
  const [offeredTo, setOfferedTo] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const view = verifyView(panel, pick);
  const values = panel.lead.values;
  const now = view.now;

  async function confirm(field: PanelField) {
    setBusy(field.field_key); setError(null);
    try {
      const answer = await api<{ panel: VerificationPanel }>("/api/app/inbound/verification", { method: "POST", body: { work_item_id: workItemId, field_key: field.field_key, state: "confirmed" } });
      setPick(null);
      onPanel(answer.panel);
    } catch (e) {
      setError({ key: field.field_key, message: e instanceof ApiError ? e.message : "Not saved. Check your signal and tap Confirm again." });
    } finally {
      setBusy(null);
    }
  }

  async function application() {
    const product = panel.workItem.productLine;
    if (!PHONE_PRODUCTS.has(product)) {
      router.push({ pathname: "/application/start", params: { leadId: panel.workItem.leadId } });
      return;
    }
    setStarting(true); setStartError(null);
    try {
      const answer = await api<{ caseId: string }>("/api/app/applications/start", { method: "POST", body: { work_item_id: workItemId, product_line: product } });
      router.push({ pathname: "/application/[caseId]", params: { caseId: answer.caseId } });
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : "The application didn’t start. Check your signal and try again.");
    } finally {
      setStarting(false);
    }
  }

  const nowValue = now ? fieldValue(now, values) : null;
  const footer = canHandoff ? (
    <Button testID="verify-handoff" label={offeredTo ? `Offered to ${offeredTo} · waiting` : "Hand to a licensed agent"} icon="userPlus" disabled={Boolean(offeredTo)} onPress={() => setHanding(true)} />
  ) : (
    // Board C4: Continue opens step 3, the phone's own application; Skip goes straight to Finish the call.
    <View style={{ gap: 6 }}>
      {startError ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad, textAlign: "center" }}>{startError}</Text> : null}
      <Button write testID="verify-application" label="Continue to Application" busy={starting} disabled={starting} onPress={() => void application()} />
      <View style={{ padding: 6 }}><TextLink label="Skip · finish the call" onPress={onFinish} /></View>
    </View>
  );

  return (
    <Screen header={header} footer={footer}>
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <Text testID="verify-count" style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{`${view.confirmed} of ${view.required} confirmed`}</Text>
          {view.corrected ? <Mini>{`${view.corrected} corrected`}</Mini> : null}
        </View>
        <Prog percent={view.percent} />
      </View>

      {view.done.length ? (
        <Group title="Confirmed">
          {view.done.map((f, i) => (
            <Row key={f.field_key} testID={`verify-done-${f.field_key}`} first={i === 0} icon={f.state === "corrected" ? "pencil" : "check"} iconTone={f.state === "corrected" ? "info" : undefined}
              title={f.label} meta={fieldValue(f, values)} chevron={false} onPress={() => setCorrecting(f)}
              chip={f.state === "corrected" ? <Chip tone="info">Corrected</Chip> : <Chip tone="ok">Confirmed</Chip>} />
          ))}
        </Group>
      ) : null}

      {now ? (
        <>
          <GroupTitle>Now</GroupTitle>
          <View style={{ paddingHorizontal: 16 }}>
            <View testID="verify-now" style={{ backgroundColor: p.surf, borderRadius: 16, borderWidth: 2, borderColor: p.green, paddingVertical: 13, paddingHorizontal: 15 }}>
              <Mini>{now.label}</Mini>
              <Text style={{ fontFamily: F.s, fontSize: 19, color: nowValue ? p.ink : p.muted, marginTop: 2 }}>{nowValue ?? "Not on the lead"}</Text>
              <Mini style={{ marginTop: 4 }}>{nowValue ? `From the partner’s form. Read it back to ${objectPronoun(values)}.` : "Ask for it, then tap Correct to type what they say."}</Mini>
              {error?.key === now.field_key ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad, marginTop: 6 }}>{error.message}</Text> : null}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Button testID="verify-correct" small kind="outline" label="Correct" icon="pencil" onPress={() => setCorrecting(now)} disabled={Boolean(busy)} style={{ flex: 1, alignSelf: "stretch" }} />
                <Button write testID="verify-confirm" small label="Confirm" icon="check" onPress={() => void confirm(now)} busy={busy === now.field_key} disabled={Boolean(busy) || !nowValue} style={{ flex: 1, alignSelf: "stretch" }} />
              </View>
            </View>
          </View>
        </>
      ) : null}

      {view.later.length ? (
        <Group title="Still to check">
          {view.later.map((f, i) => (
            <Row key={f.field_key} testID={`verify-later-${f.field_key}`} first={i === 0} icon="clock" iconTone="plain" title={f.label}
              meta={f.is_required ? "Not asked yet" : "Optional for this product"} chevron={false} onPress={() => setPick(f.field_key)} />
          ))}
        </Group>
      ) : null}

      {correcting ? (
        <CorrectSheet field={correcting} panel={panel} workItemId={workItemId} onClose={() => setCorrecting(null)}
          onSaved={(next) => { setCorrecting(null); setPick(null); onPanel(next); }} />
      ) : null}
      {handing ? (
        <HandoffSheet customer={callerName(values)} workItemId={workItemId} leadId={panel.workItem.leadId} checked={view.checked} total={view.total}
          state={typeof values.state === "string" ? values.state : null} productLine={panel.workItem.productLine}
          onClose={() => setHanding(false)} onOffered={(name) => { setHanding(false); setOfferedTo(name.split(/\s+/)[0] ?? name); }} />
      ) : null}
    </Screen>
  );
}
