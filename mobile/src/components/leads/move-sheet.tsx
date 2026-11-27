import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { planMove, possessive, shortDay, type PipelineContext, type Pronoun } from "@/components/leads/logic";
import { PickerSheet } from "@/components/leads/parts";
import { Sheet, SheetField } from "@/components/leads/sheets";
import { Button, Chip, F } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

type MoveAnswer = { moved: { lead_id: string; from_stage_id: string | null; to_stage_id: string }[]; failed: { lead_id: string; code: string; error: string }[] };

/**
 * Board D6 · Move to a stage. Asked once: the move is recorded as the outcome mapped to that stage
 * (the one named like it, else the first; never one only a call records), through POST
 * /api/app/leads/move, exactly as the web's stage path and board drop do. An optional note is saved
 * after the move as an ordinary team note (POST /api/app/leads/:id/notes). An open callback is kept
 * by a move (only cancelling one closes it), and the sheet says so. From the board (`stages` given)
 * the long-press lands here at once on the next stage, and the target chip picks another.
 */
export function MoveSheet({ visible, leadId, firstName, from, to, source, onClose, onMoved, stages, callback, pronoun = "they" }: {
  visible: boolean; leadId: string; firstName: string; from: { id: string; name: string } | null; to: { id: string; name: string } | null;
  source: "lead_detail" | "board"; onClose: () => void; onMoved: (message: string) => void;
  /** The pipeline's stages, when the target may be changed here (the board's long-press). */
  stages?: { id: string; name: string }[];
  /** The lead's soonest open callback, which the move keeps. */
  callback?: { at: string; timezone: string | null } | null;
  pronoun?: Pronoun;
}) {
  const p = usePalette();
  const { api } = useSession();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const target = chosen ?? to;
  const rules = useLoad(() => (visible ? api<PipelineContext>("/api/app/leads/pipeline-context") : Promise.resolve(null)), [visible]);
  const plan = rules.data && target ? planMove(target, rules.data) : null;
  const pick = plan && "pick" in plan ? plan.pick : null;
  const kept = callback ? shortDay(callback.at, callback.timezone) : null;
  const keptLine = kept ? ` ${possessive(pronoun)[0].toUpperCase()}${possessive(pronoun).slice(1)} callback ${kept === "today" ? "today" : `on ${kept}`} stays.` : "";

  function close() { setNote(""); setError(null); setChosen(null); onClose(); }

  async function move() {
    const to = target;
    if (!pick || !to) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await api<MoveAnswer>("/api/app/leads/move", { method: "POST", body: { lead_ids: [leadId], disposition_key: pick.key, source } });
      if (!answer.moved?.length) { setError(answer.failed?.[0]?.error ?? "Could not move the lead."); return; }
      const body = note.trim();
      // The move stands either way; a note the server refused is said in the toast, not lost quietly.
      const noted = body
        ? await api(`/api/app/leads/${leadId}/notes`, { method: "POST", body: { body, visibility: "internal", idempotency_key: `app-move-${leadId}-${Date.now()}` } }).then(() => true, () => false)
        : true;
      setNote("");
      setChosen(null);
      onMoved(`${firstName} moved from ${from?.name ?? "no stage"} to ${to.name}${noted ? "" : ", but the note was not saved"}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not move the lead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible && Boolean(target)} title={target ? `Move ${firstName} to ${target.name}?` : ""} onClose={close} testID="move-sheet">
      <View style={{ gap: 14, paddingBottom: 6 }}>
        <View style={{ backgroundColor: p.surf2, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {from ? <Chip tone="brand" dot={false}>{from.name}</Chip> : null}
            {from ? <Icon name="chevR" size={16} color={p.muted} /> : null}
            {target && stages?.length ? (
              <Pressable testID="move-target" accessibilityRole="button" accessibilityLabel={`Moving to ${target.name}. Choose another stage`} onPress={() => setPicking(true)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Chip tone="info">{target.name}</Chip>
                <Icon name="chevD" size={16} color={p.muted} />
              </Pressable>
            ) : target ? <Chip tone="info">{target.name}</Chip> : null}
          </View>
          <Text testID="move-explain" style={{ marginTop: 8, fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>
            {rules.loading && !rules.data ? "Reading the stage rules…"
              : rules.error && !rules.data ? rules.error
              : plan && "error" in plan ? plan.error
              : pick ? `Recorded as the outcome “${pick.label}”, by you, now.${keptLine}` : ""}
          </Text>
        </View>
        {pick ? <SheetField testID="move-note" label="Note (optional)" value={note} onChangeText={setNote} placeholder="What should the team know?" /> : null}
        {error ? <Text style={{ fontFamily: F.r, fontSize: 14, color: p.bad }}>{error}</Text> : null}
        <Button write testID="move-confirm" label={target ? `Move to ${target.name}` : "Move"} kind="primary" busy={busy} disabled={!pick} onPress={() => void move()} />
      </View>
      {stages?.length ? (
        <PickerSheet title={`Move ${firstName} to`} visible={picking} onClose={() => setPicking(false)} value={target?.id ?? null}
          onPick={(id) => { const s = stages.find((x) => x.id === id); if (s && s.id !== from?.id) setChosen(s); }}
          items={stages.filter((s) => s.id !== from?.id).map((s) => ({ key: s.id, label: s.name, icon: "kanban" as const }))} />
      ) : null}
    </Sheet>
  );
}
