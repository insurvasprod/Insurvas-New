import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { Mini, SheetModal } from "@/components/calls/parts";
import { Icon } from "@/components/icon";
import { Button, F, Field, Loading, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { agentLine, handoffAgents, handoffQualifier, initials } from "./model";
import type { Floor, HandoffContext } from "./types";

/**
 * Board C4b · Offer a handoff (assistants): the licensed agents the server lets this assistant hand to
 * (GET /api/app/inbound/handoff), each with their line on the floor (GET /api/app/agent-floor), then
 * POST /api/app/inbound/handoff { action: "offer" }. The assistant stays on the call until they accept.
 * The note for them is a lead note that mentions them (POST /api/app/leads/[id]/notes), so it reaches
 * them as a notification and stays on the lead: the offer itself carries no note.
 *
 * The list is the agents licensed in the caller's state (the server's licensedStates), ready ones
 * first, under "Licensed in Georgia for final expense, ready now"; without licences, every agent.
 */
export function HandoffSheet({ customer, workItemId, leadId, checked, total, state, productLine, onClose, onOffered }: { customer: string; workItemId: string; leadId: string; checked: number; total: number; state?: string | null; productLine?: string | null; onClose: () => void; onOffered: (name: string) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const ctx = useLoad(() => api<HandoffContext>(`/api/app/inbound/handoff?work_item_id=${encodeURIComponent(workItemId)}`), [workItemId]);
  // The floor only adds each agent's line; without it the list still works.
  const floor = useLoad(() => api<Floor>("/api/app/agent-floor").catch(() => null), []);
  const [now] = useState(() => Date.now());
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const listed = handoffAgents(ctx.data?.licensedAgents ?? [], ctx.data?.licensedStates, state, floor.data?.members);
  const agents = listed.agents;
  const qualifier = listed.filtered ? handoffQualifier(state, productLine) : null;
  const pick = chosen ?? agents[0]?.id ?? null;
  const target = agents.find((a) => a.id === pick) ?? null;

  async function offer() {
    if (!target) return;
    setBusy(true); setError(null);
    try {
      await api("/api/app/inbound/handoff", { method: "POST", body: { action: "offer", work_item_id: workItemId, target_user_id: target.id } });
      const text = note.trim();
      if (text) {
        await api(`/api/app/leads/${leadId}/notes`, { method: "POST", body: { body: text, visibility: "internal", mentions: [target.id], idempotency_key: `app-handoff-${workItemId}-${target.id}` } })
          .catch((e: unknown) => Alert.alert("Offered, note not saved", e instanceof ApiError ? e.message : "Add the note on the lead."));
      }
      onOffered(target.name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not offered. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible title={`Hand ${customer} to`} onClose={onClose}>
      <View style={{ gap: 12 }}>
        {qualifier ? <Mini>{qualifier}</Mini> : null}
        {ctx.loading && !ctx.data ? <Loading rows={3} /> : null}
        {ctx.error && !ctx.data ? <Text style={{ fontFamily: F.r, fontSize: 15, color: p.bad }}>{ctx.error}</Text> : null}
        {ctx.data && !agents.length ? <Mini>No licensed agent is set up for you to hand to.</Mini> : null}
        {agents.length ? (
          <View style={{ marginHorizontal: -16 }}>
            {agents.map((a, i) => (
              <Row key={a.id} testID={`handoff-agent-${a.id}`} first={i === 0} avatar={initials(a.name)} title={a.name}
                meta={agentLine(floor.data?.members.find((m) => m.id === a.id), now)} selected={a.id === pick} chevron={false}
                chip={a.id === pick ? <Icon name="checkC" size={20} color={p.greenInk} /> : undefined} onPress={() => setChosen(a.id)} />
            ))}
          </View>
        ) : null}
        {target ? <Field testID="handoff-note" label={`Note for ${firstName(target.name)}`} value={note} onChangeText={setNote} multiline /> : null}
        {target ? <Mini>{`${firstName(target.name)} sees ${checked} of ${total} checks done before accepting.`}</Mini> : null}
        {error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
        <Button write testID="handoff-offer" label={target ? `Offer to ${firstName(target.name)}` : "Offer"} icon="userPlus" onPress={() => void offer()} busy={busy} disabled={!target} />
      </View>
    </SheetModal>
  );
}
