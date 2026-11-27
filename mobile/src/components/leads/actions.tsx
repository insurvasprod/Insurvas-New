import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";

import type { IconName } from "@/components/icon";
import { leadMenu, releaseConfirmation, RELEASE_TITLE, type MenuKey, type ReleaseAction } from "@/components/leads/logic";
import { PickerSheet } from "@/components/leads/parts";
import { ActionSheet, Dialog, SelectField, SheetField, type SheetAction } from "@/components/leads/sheets";
import type { FullWorkspace, PreflightMatch } from "@/components/leads/types";
import { F } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { codeLabel, firstName, leadFact } from "@/lib/format";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

const LABEL: Record<MenuKey, { label: string; icon: IconName; destructive?: boolean }> = {
  handoff: { label: "Hand off to a licensed agent", icon: "userPlus" },
  nudge: { label: "Nudge the team", icon: "bell" },
  requeue: { label: "Put back in the queue", icon: "undo" },
  end_buffer: { label: "End buffer involvement", icon: "users" },
  reopen: { label: "Reopen in the queue", icon: "history" },
  recheck: { label: "Re-check: existing customer?", icon: "refresh" },
  stage_fix: { label: "Change stage without an outcome", icon: "kanban" },
  copy: { label: "Copy lead ID", icon: "copy" },
  unassign: { label: "Unassign", icon: "x", destructive: true },
};

/** A native confirm, resolved with the person's answer. */
function ask(title: string, message: string, confirm: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Keep it", style: "cancel", onPress: () => resolve(false) },
      { text: confirm, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Board D5 · Lead · more actions, and D5b · Hand off a lead. The web ⋯ menu: each item only when the
 * server's `actions` for this person allow it, each write through the web's own route, the release
 * ones confirmed first with the web's wording. The stage change without an outcome is the owner's
 * data fix (PATCH /api/app/leads/:id), labelled for what it is and confirmed.
 */
export function LeadMenu({ visible, onClose, w, onDone }: { visible: boolean; onClose: () => void; w: FullWorkspace; onDone: (message: string | null) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const [handoff, setHandoff] = useState(false);
  const [agent, setAgent] = useState<string | null>(null);
  const [pickingAgent, setPickingAgent] = useState(false);
  const [pickingStage, setPickingStage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  const values = w.lead.values;
  const name = [values.full_name, values.name, [values.first_name, values.last_name].filter(Boolean).join(" ")].find((v): v is string => typeof v === "string" && v.trim() !== "") ?? "this lead";
  const agents = w.licensedAgents ?? [];
  const chosen = agents.find((a) => a.id === agent) ?? agents[0] ?? null;
  // "Jordan Reyes · licensed in GA" when Team & access records the agent's licence in the lead's state.
  const state = (leadFact(values, "state", "state_code") ?? "").trim().toUpperCase();
  const agentLine = (a: { id: string; name: string; role: string }) => {
    const licensed = state && (w.licensedStates?.[a.id] ?? []).includes(state);
    return `${a.name} · ${licensed ? `licensed in ${state}` : codeLabel(a.role) ?? a.role}`;
  };

  async function run(label: string, path: string, body: unknown, success: string) {
    try {
      await api(path, { method: "POST", body });
      onDone(success);
    } catch (e) {
      Alert.alert(label, e instanceof ApiError ? e.message : "The action could not be completed.");
    }
  }

  async function release(kind: ReleaseAction, acknowledgeLanguage = false) {
    if (!w.queue) return;
    if (!acknowledgeLanguage) {
      const words = releaseConfirmation(kind, { customer: name, bufferName: w.transfer?.buffer?.name, agentName: w.owner?.name });
      if (!(await ask(RELEASE_TITLE[kind].title, words, RELEASE_TITLE[kind].confirm, kind === "unassign"))) return;
    }
    try {
      await api("/api/app/inbound/release", { method: "POST", body: { action: kind, work_item_id: w.queue.id, ...(acknowledgeLanguage ? { acknowledge_language: true } : {}) } });
      onDone(kind === "unassign" ? "Transfer back in the queue" : kind === "requeue" ? "Back in the queue; the next claim resumes the verification" : "Buffer involvement ended; the licensed agent keeps the call");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.code === "language_cover_required" && !acknowledgeLanguage) {
        if (await ask("Continue without a language match?", e.message, "Continue")) void release(kind, true);
        return;
      }
      Alert.alert(RELEASE_TITLE[kind].title, e instanceof ApiError ? e.message : "The action could not be completed.");
    }
  }

  async function recheck() {
    try {
      const answer = await api<{ result: { status: string; matches: PreflightMatch[] } }>(`/api/app/leads/${w.lead.id}/preflight`, { method: "POST" });
      const leads = (answer.result.matches ?? []).filter((m) => m.leadId && m.sourceType !== "contact");
      if (leads.length) { onDone(null); router.push(`/lead/same-person/${w.lead.id}` as Href); return; }
      onDone(answer.result.status === "new_household" ? "Checked: no earlier lead or customer matches" : `Checked: ${codeLabel(answer.result.status)?.toLowerCase() ?? "done"}`);
    } catch (e) {
      Alert.alert("Existing-customer check", e instanceof ApiError ? e.message : "Could not re-check this lead.");
    }
  }

  async function stageFix(stageId: string) {
    const target = w.stages.find((s) => s.id === stageId);
    if (!target || stageId === w.stage?.id) return;
    const ok = await ask("Change stage without an outcome?", `For correcting a record: ${name} goes to ${target.name} and no outcome is recorded. A move on the stage path records the outcome instead.`, "Change stage");
    if (!ok) return;
    try {
      await api(`/api/app/leads/${w.lead.id}`, { method: "PATCH", body: { values: w.lead.values, stage_id: stageId } });
      onDone(`Stage changed to ${target.name}`);
    } catch (e) {
      Alert.alert("Stage not changed", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  async function offer() {
    if (!w.queue || !chosen) { setHandoffError("Choose a licensed agent before offering the handoff."); return; }
    setBusy(true);
    setHandoffError(null);
    try {
      await api("/api/app/inbound/handoff", { method: "POST", body: { action: "offer", work_item_id: w.queue.id, target_user_id: chosen.id } });
      // The handoff route takes no reason; the why is kept on the lead as a team note, said in the toast if it was refused.
      const reason = why.trim();
      const noted = reason
        ? await api(`/api/app/leads/${w.lead.id}/notes`, { method: "POST", body: { body: `Handoff to ${chosen.name}: ${reason}`, visibility: "internal", idempotency_key: `app-handoff-${w.lead.id}-${Date.now()}` } }).then(() => true, () => false)
        : true;
      setHandoff(false);
      setWhy("");
      onDone(`Handoff offered to ${chosen.name}${noted ? "" : ", but the reason was not saved"}`);
    } catch (e) {
      setHandoffError(e instanceof ApiError ? e.message : "The handoff was not offered.");
    } finally {
      setBusy(false);
    }
  }

  const handlers: Record<MenuKey, () => void> = {
    handoff: () => { setHandoffError(null); setHandoff(true); },
    nudge: () => { if (w.queue) void run("Nudge the team", "/api/app/agent-floor", { action: "nudge", work_item_id: w.queue.id }, "Team nudged"); },
    requeue: () => void release("requeue"),
    end_buffer: () => void release("end_buffer"),
    reopen: () => void run("Reopen in the queue", `/api/app/leads/${w.lead.id}/reopen`, undefined, "Lead reopened in the queue"),
    recheck: () => void recheck(),
    stage_fix: () => setPickingStage(true),
    copy: () => { void Clipboard.setStringAsync(w.lead.id).then(() => onDone("Lead ID copied"), () => Alert.alert("Copy lead ID", "The lead ID could not be copied.")); },
    unassign: () => void release("unassign"),
  };
  const items: SheetAction[] = leadMenu({ readOnly: w.readOnly, queue: w.queue, stage: w.stage, actions: w.actions }).map((key) => ({ key, ...LABEL[key], onPress: handlers[key] }));

  return (
    <>
      <ActionSheet visible={visible} title={name} actions={items} onClose={onClose} />
      <Dialog visible={handoff} title={`Hand ${firstName(name)} to another agent?`} onClose={() => setHandoff(false)}
        actions={[
          { label: "Hand off", kind: "bold", onPress: () => void offer(), disabled: busy || !chosen, testID: "handoff-confirm" },
          { label: "Keep it", onPress: () => setHandoff(false) },
        ]}>
        <View style={{ gap: 12, marginTop: 6 }}>
          <SelectField testID="handoff-agent" label="Agent" value={chosen ? agentLine(chosen) : null} placeholder="No licensed agent is available" disabled={agents.length < 2} onPress={() => setPickingAgent(true)} />
          <SheetField testID="handoff-why" label="Why" value={why} onChangeText={setWhy} placeholder="What should they know?" />
          {handoffError ? <Text style={{ fontFamily: F.r, fontSize: 14, color: p.bad, textAlign: "left" }}>{handoffError}</Text> : null}
        </View>
      </Dialog>
      <PickerSheet title="Licensed agent" visible={pickingAgent} onClose={() => setPickingAgent(false)} value={chosen?.id ?? null} onPick={setAgent}
        items={agents.map((a) => ({ key: a.id, label: a.name, meta: agentLine(a).slice(a.name.length + 3) }))} />
      <PickerSheet title="Change stage without an outcome" visible={pickingStage} onClose={() => setPickingStage(false)} value={w.stage?.id ?? null} onPick={(id) => { setTimeout(() => void stageFix(id), 400); }}
        items={w.stages.map((s) => ({ key: s.id, label: s.name, icon: "kanban" as const }))} />
    </>
  );
}
