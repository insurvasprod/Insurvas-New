import { useState } from "react";
import { Text, View } from "react-native";

import { SelectField } from "@/components/calendar/parts";
import { Mini, SheetModal } from "@/components/calls/parts";
import { Button, F, Field, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";
import { compoundFields, correctionValue, inputText, shownValue } from "./model";
import { ChoiceChip } from "./parts";
import type { PanelField, VerificationPanel } from "./types";

/**
 * Board C5 · Correct a field: a sheet over Verification. Save sends POST /api/app/inbound/verification
 * { state: "corrected", value } at once; the server validates the value against the template, records
 * who corrected it and when, and answers with the panel.
 *
 * A compound detail (the beneficiary's name, relationship and share, kept as sibling fields on the
 * template) is corrected together, as drawn: one input per part, a choice as a dropdown, and Save sends
 * each changed part as its own correction, in template order.
 */
type Draft = { text: string; picked: string[] };

function startDraft(field: PanelField, panel: VerificationPanel): Draft {
  const masked = (panel.sensitiveKeys ?? []).includes(field.field_key);
  const current = field.state === "corrected" && field.new_value != null ? field.new_value : panel.lead.values[field.field_key];
  return {
    text: inputText(field.type, current, masked),
    picked: current == null || current === "" ? [] : Array.isArray(current) ? current.map(String) : [String(current)],
  };
}

const isChoice = (f: PanelField) => f.type === "single_select" || f.type === "boolean" || f.type === "multi_select";
const optionsOf = (f: PanelField) => (f.type === "boolean" ? [{ key: "true", label: "Yes" }, { key: "false", label: "No" }] : f.options.map((o) => ({ key: o, label: o })));
const keyboardOf = (f: PanelField) => (f.type === "number" || f.type === "currency" || f.type === "ssn" || f.type === "bank_account" || f.type === "bank_routing" ? "decimal-pad" : f.type === "phone" ? "phone-pad" : f.type === "email" ? "email-address" : "default");
const lower = (s: string) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;

export function CorrectSheet({ field, panel, workItemId, onClose, onSaved }: { field: PanelField; panel: VerificationPanel; workItemId: string; onClose: () => void; onSaved: (panel: VerificationPanel) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const group = compoundFields(panel, field);
  const parts = group?.fields ?? [field];
  const [first] = useState<Record<string, Draft>>(() => Object.fromEntries(parts.map((f) => [f.field_key, startDraft(f, panel)])));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(first);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sent = parts.map((f) => shownValue(f, f.old_value ?? panel.lead.values[f.field_key])).filter(Boolean).join(" · ");
  const set = (key: string, next: Partial<Draft>) => setDrafts((d) => ({ ...d, [key]: { ...d[key], ...next } }));
  const valueOf = (f: PanelField) => {
    const d = drafts[f.field_key];
    return isChoice(f) ? correctionValue(f.type, f.type === "multi_select" ? d.picked : d.picked[0] ?? "") : correctionValue(f.type, d.text);
  };
  const filled = (f: PanelField) => (isChoice(f) ? drafts[f.field_key].picked.length > 0 : drafts[f.field_key].text.trim().length > 0);
  const changed = (f: PanelField) => JSON.stringify(drafts[f.field_key]) !== JSON.stringify(first[f.field_key]);
  // One field: Save when it has a value. Several: Save the parts that changed and have a value.
  const toSave = group ? parts.filter((f) => changed(f) && filled(f)) : filled(field) ? [field] : [];

  async function save() {
    setBusy(true); setError(null);
    let latest: VerificationPanel | null = null;
    try {
      for (const f of toSave) {
        const answer = await api<{ panel: VerificationPanel }>("/api/app/inbound/verification", { method: "POST", body: { work_item_id: workItemId, field_key: f.field_key, state: "corrected", value: valueOf(f) } });
        latest = answer.panel;
      }
      if (latest) onSaved(latest);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Not saved. Check your signal and tap Save again.");
      // What was saved before the failure stays saved: show it.
      if (latest) onSaved(latest);
    } finally {
      setBusy(false);
    }
  }

  function input(f: PanelField, autoFocus: boolean) {
    const d = drafts[f.field_key];
    const masked = (panel.sensitiveKeys ?? []).includes(f.field_key);
    if (f.type === "multi_select" || (!group && isChoice(f))) {
      return (
        <View key={f.field_key} style={{ gap: 8 }}>
          <Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.muted }}>{f.label}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {optionsOf(f).map((o) => (
              <ChoiceChip key={o.key} testID={`correct-option-${o.key}`} label={o.label} on={d.picked.includes(o.key)}
                onPress={() => set(f.field_key, { picked: f.type === "multi_select" ? (d.picked.includes(o.key) ? d.picked.filter((x) => x !== o.key) : [...d.picked, o.key]) : [o.key] })} />
            ))}
          </View>
        </View>
      );
    }
    if (isChoice(f)) {
      // The board's dropdown (a .fld with a chevron) for a single choice inside a compound detail.
      const shown = optionsOf(f).find((o) => o.key === d.picked[0])?.label ?? "Choose";
      return (
        <View key={f.field_key} style={{ gap: 4 }}>
          <SelectField testID={`correct-select-${f.field_key}`} label={f.label} value={shown} open={open === f.field_key} onPress={() => setOpen((o) => (o === f.field_key ? null : f.field_key))} />
          {open === f.field_key ? (
            <View style={{ marginHorizontal: -16 }}>
              {optionsOf(f).map((o, i) => (
                <Row key={o.key} testID={`correct-option-${o.key}`} first={i === 0} title={o.label} selected={d.picked[0] === o.key} chevron={false}
                  onPress={() => { set(f.field_key, { picked: [o.key] }); setOpen(null); }} />
              ))}
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <Field key={f.field_key} testID={group ? `correct-input-${f.field_key}` : "correct-input"} label={f.label} value={d.text} onChangeText={(t) => set(f.field_key, { text: t })} autoFocus={autoFocus} keyboardType={keyboardOf(f)}
        multiline={f.type === "long_text"} autoCapitalize={f.type === "email" ? "none" : "sentences"} autoCorrect={false}
        placeholder={f.type === "date" ? "YYYY-MM-DD" : masked ? "Type the full value" : undefined}
        error={!group ? error : undefined} hint={f.type === "currency" ? "In dollars" : undefined} />
    );
  }

  return (
    <SheetModal visible title={`Correct the ${lower(group?.label ?? field.label)}`} onClose={onClose}>
      <View style={{ gap: 16, paddingTop: 6 }}>
        {sent ? <Mini>Partner sent: <Text style={{ fontFamily: F.r, color: p.ink }}>{sent}</Text></Mini> : null}
        {parts.map((f, i) => input(f, i === 0))}
        {(group || isChoice(field)) && error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
        <Mini>Saved the moment you tap Save. If the call drops, it’s still here.</Mini>
        <Button write testID="correct-save" label="Save correction" onPress={() => void save()} busy={busy} disabled={!toSave.length || busy} />
      </View>
    </SheetModal>
  );
}
