import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, type Href } from "expo-router";

import { Icon } from "@/components/icon";
import { formLines, isoToUsDate, maskUsDate, pruneHidden, usDateToIso, type FormTemplate, type TemplateField } from "@/components/leads/logic";
import { PickerSheet } from "@/components/leads/parts";
import { ChoiceChips, Sheet, SheetField, SelectField } from "@/components/leads/sheets";
import type { PreflightMatch } from "@/components/leads/types";
import { Button, F, IOS } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { leadFact, leadName, phoneLabel } from "@/lib/format";
import { readSecret, writeSecret } from "@/lib/secure";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

type Values = Record<string, unknown>;
/** POST /api/app/leads?check=1: the existing-customer check on the typed answers, before saving. */
export type SaveCheck = { status: string; matches: { leadId: string; openable: boolean; stageName: string | null; ownerName: string | null }[] };

/** The draft kept on the phone (Keystore/Keychain), beside the server's copy, per person. */
const draftKey = (userId: string | null | undefined) => `insurvas.leadDraft.${userId ?? "me"}`;

/** "Earl Johnson, (614) 555-0127, is already a lead in Contacted (Sam Lee)." */
export function duplicateLine(values: Values, match: SaveCheck["matches"][number]): string {
  const name = leadName(values) || "This person";
  const phone = phoneLabel(leadFact(values, "phone", "phone_number", "mobile_phone"));
  const where = match.stageName ? ` in ${match.stageName}${match.ownerName ? ` (${match.ownerName})` : ""}` : match.ownerName ? ` (${match.ownerName})` : "";
  return `${phone ? `${name}, ${phone},` : name} is already a lead${where}.`;
}

function clock(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Board D7 · Add a lead. The fields are the agency's own template for this person (the template
 * GET /api/app/leads sends), shown and hidden by the form's logic. A half-typed lead is kept as a
 * draft on the server (GET/PUT/DELETE /api/app/leads/draft) and on the phone a few seconds after
 * typing stops. Save first runs the existing-customer check on the answers as typed (POST
 * /api/app/leads?check=1, nothing written): a match shows the board's inline warning with "Open
 * existing" and "Save lead". Saving posts the answers (POST /api/app/leads); what is missing or wrong
 * is the server's answer, in its own words. The check then runs on the new lead (POST
 * /api/app/leads/:id/preflight, stored on it), and a match opens Same person? before the lead itself.
 * A role the check is not open to simply saves.
 */
export function AddLeadSheet({ visible, onClose, template, onCreated }: { visible: boolean; onClose: () => void; template: FormTemplate | null; onCreated: () => void }) {
  const p = usePalette();
  const { api, me } = useSession();
  const userId = me?.user.id ?? null;
  const [values, setValues] = useState<Values>({});
  /** The check's answer and the answers it was run on; a change since then checks again. */
  const [checked, setChecked] = useState<{ for: string; result: SaveCheck } | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [draftAt, setDraftAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picking, setPicking] = useState<TemplateField | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The kept draft comes back when the sheet opens.
  // The server's copy first; the phone's own when the server has none (or cannot be reached).
  const restore = useEffectEvent(async () => {
    try {
      const answer = await api<{ draft: { payload?: Values; updated_at?: string } | null }>("/api/app/leads/draft");
      if (answer.draft?.payload && typeof answer.draft.payload === "object" && Object.keys(answer.draft.payload).length) {
        setValues(answer.draft.payload);
        if (answer.draft.updated_at) setDraftAt(new Date(answer.draft.updated_at));
        return;
      }
    } catch { /* fall back to the phone's copy */ }
    try {
      const local = await readSecret(draftKey(userId));
      const kept = local ? JSON.parse(local) as { payload?: Values; at?: string } : null;
      if (kept?.payload && typeof kept.payload === "object" && Object.keys(kept.payload).length) {
        setValues(kept.payload);
        if (kept.at) setDraftAt(new Date(kept.at));
      }
    } catch { /* a draft that cannot be read starts a new one */ }
  });
  useEffect(() => { if (visible) void Promise.resolve().then(() => restore()); }, [visible]);

  // Saved three seconds after typing stops.
  const saveDraft = useEffectEvent(async () => {
    const at = new Date();
    const local = writeSecret(draftKey(userId), JSON.stringify({ payload: values, at: at.toISOString() })).then(() => true, () => false);
    const server = api("/api/app/leads/draft", { method: "PUT", body: { payload: values } }).then(() => true, () => false);
    const [onPhone, onServer] = await Promise.all([local, server]);
    if (onPhone || onServer) { setDraftAt(at); setDirty(false); }
  });
  useEffect(() => {
    if (!visible || !dirty) return;
    const t = setTimeout(() => void saveDraft(), 3000);
    return () => clearTimeout(t);
  }, [visible, dirty, values]);

  if (!template) return null;
  const tpl = template;

  function change(key: string, value: unknown) {
    setValues((cur) => pruneHidden(tpl.form_definition, { ...cur, [key]: value }));
    setDirty(true);
    setError(null);
  }

  const answers = () => pruneHidden(tpl.form_definition, values);
  const dupe = checked && checked.for === JSON.stringify(answers()) ? checked.result.matches[0] ?? null : null;

  /** Save: the duplicate check first (once per set of answers); a match waits for "Save lead" again. */
  async function save() {
    const body = answers();
    const key = JSON.stringify(body);
    if (!checked || checked.for !== key) {
      setBusy(true);
      setError(null);
      const result = await api<SaveCheck>("/api/app/leads?check=1", { method: "POST", body: { values: body } }).catch(() => null);
      setBusy(false);
      if (result) {
        setChecked({ for: key, result });
        if (result.matches?.length) return;
      }
    }
    await create(body);
  }

  function openExisting() {
    if (!dupe?.openable) return;
    const id = dupe.leadId;
    onClose();
    router.push(`/lead/${id}` as Href);
  }

  async function create(body: Values) {
    setBusy(true);
    setError(null);
    try {
      const answer = await api<{ lead: { id: string } }>("/api/app/leads", { method: "POST", body: { values: body } });
      const id = answer.lead.id;
      // The duplicate check on the new lead runs while the sheet still shows Save as busy, so the
      // sheet closes straight onto the lead (or Same person?), never onto the old list. A role the
      // check is not open to simply opens the lead.
      const [check] = await Promise.all([
        api<{ result: { matches: PreflightMatch[] } }>(`/api/app/leads/${id}/preflight`, { method: "POST" }).catch(() => null),
        api("/api/app/leads/draft", { method: "DELETE" }).catch(() => undefined),
        writeSecret(draftKey(userId), null).catch(() => undefined),
      ]);
      const match = check?.result.matches?.some((m) => m.leadId && m.leadId !== id && m.sourceType !== "contact");
      setValues({}); setDates({}); setDraftAt(null); setDirty(false); setChecked(null);
      onCreated();
      onClose();
      router.push((match ? `/lead/same-person/${id}` : `/lead/${id}`) as Href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the lead.");
    } finally {
      setBusy(false);
    }
  }

  function input(field: TemplateField) {
    const label = field.label;
    const v = values[field.field_key];
    const id = `new-lead-${field.field_key}`;
    switch (field.type) {
      case "boolean":
        return <SelectField testID={id} label={label} value={v === true ? "Yes" : v === false ? "No" : null} onPress={() => setPicking(field)} />;
      case "single_select":
        return <SelectField testID={id} label={label} value={typeof v === "string" && v ? v : null} onPress={() => setPicking(field)} />;
      case "multi_select":
        return (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: F.m, fontSize: IOS ? 13.5 : 12, color: p.muted }}>{label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {field.options.map((o) => {
                const list = Array.isArray(v) ? (v as string[]) : [];
                const on = list.includes(o);
                return <ChoiceChips key={o} items={[{ key: o, label: o }]} value={on ? o : null} onChange={() => change(field.field_key, on ? list.filter((x) => x !== o) : [...list, o])} />;
              })}
            </View>
          </View>
        );
      case "date":
        return (
          <SheetField testID={id} label={label} placeholder="MM/DD/YYYY" keyboardType="number-pad" maxLength={10} value={dates[field.field_key] ?? isoToUsDate(v)}
            onChangeText={(raw) => { const t = maskUsDate(raw); setDates((d) => ({ ...d, [field.field_key]: t })); change(field.field_key, t.trim() ? usDateToIso(t) ?? t.trim() : undefined); }} />
        );
      case "currency":
        return <SheetField testID={id} label={label} keyboardType="decimal-pad" leadIcon="dollar" value={typeof v === "number" ? String(v / 100) : ""}
          onChangeText={(t) => change(field.field_key, t.trim() === "" ? undefined : Math.round(Number(t) * 100))} />;
      case "number":
        return <SheetField testID={id} label={label} keyboardType="numeric" value={v === undefined ? "" : String(v)}
          onChangeText={(t) => change(field.field_key, t.trim() === "" ? undefined : Number(t))} />;
      default: {
        const phone = field.type === "phone" || ["phone", "phone_number"].includes(field.field_key);
        return <SheetField testID={id} label={label} value={v === undefined ? "" : String(v)} leadIcon={phone ? "phone" : undefined} multiline={field.type === "long_text"}
          placeholder={field.validation?.placeholder} autoCapitalize={field.type === "email" ? "none" : "words"}
          keyboardType={phone ? "phone-pad" : field.type === "email" ? "email-address" : field.type === "ssn" || field.type.startsWith("bank") ? "number-pad" : "default"}
          onChangeText={(t) => change(field.field_key, t === "" ? undefined : t)} />;
      }
    }
  }

  const lines = formLines(tpl, values);

  return (
    <Sheet visible={visible} full title="New lead" onClose={onClose} testID="add-lead"
      footer={
        // Kept under the form, not in it: what the server refused shows wherever the form is scrolled.
        <View style={{ gap: 10 }}>
          {error ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Icon name="alert" size={18} color={p.bad} />
              <Text testID="add-lead-error" accessibilityRole="alert" style={{ flex: 1, fontFamily: F.r, fontSize: 14, color: p.bad }}>{error}</Text>
            </View>
          ) : null}
          {dupe ? (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Icon name="alert" size={18} color={p.warn} />
              <Text testID="add-lead-duplicate" accessibilityRole="alert" style={{ flex: 1, fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.warn }}>{duplicateLine(values, dupe)}</Text>
            </View>
          ) : null}
          {dupe ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              {dupe.openable ? <View style={{ flex: 1 }}><Button testID="add-lead-open-existing" label="Open existing" kind="outline" onPress={openExisting} /></View> : null}
              <View style={{ flex: 1 }}><Button write testID="add-lead-save" label="Save lead" kind="primary" busy={busy} onPress={() => void create(answers())} /></View>
            </View>
          ) : <Button write testID="add-lead-save" label="Save lead" kind="primary" busy={busy} onPress={() => void save()} />}
        </View>
      }
      right={<Pressable accessibilityRole="button" accessibilityLabel="Save" onPress={() => void (dupe ? create(answers()) : save())} disabled={busy} hitSlop={8}><Text style={{ fontFamily: F.s, fontSize: 16, color: p.greenInk }}>Save</Text></Pressable>}>
      <View style={{ gap: 16, paddingTop: 4, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {draftAt ? <Icon name="check" size={14} color={p.muted} /> : null}
          <Text testID="draft-status" style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{draftAt ? `Draft saved · ${clock(draftAt)}` : `${tpl.product_name} form · kept as a draft while you type`}</Text>
        </View>
        {lines.map((line) => (
          <View key={line.map((x) => x.field.field_key).join("+")} style={line.length > 1 ? { flexDirection: "row", gap: 10 } : null}>
            {line.map(({ field }) => <View key={field.field_key} style={line.length > 1 ? { flex: 1 } : null}>{input(field)}</View>)}
          </View>
        ))}
      </View>
      <PickerSheet title={picking?.label ?? ""} visible={Boolean(picking)} onClose={() => setPicking(null)}
        value={picking ? (picking.type === "boolean" ? (values[picking.field_key] === true ? "true" : values[picking.field_key] === false ? "false" : null) : (values[picking.field_key] as string | undefined) ?? null) : null}
        onPick={(k) => { if (picking) change(picking.field_key, picking.type === "boolean" ? k === "true" : k); }}
        items={picking?.type === "boolean" ? [{ key: "true", label: "Yes" }, { key: "false", label: "No" }] : (picking?.options ?? []).map((o) => ({ key: o, label: o }))} />
    </Sheet>
  );
}
