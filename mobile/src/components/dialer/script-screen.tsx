import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Empty, F, Failed, Field, Header, Loading, T, type HeaderAction } from "@/components/ui";
import { Mini, Seg } from "@/components/calls/parts";
import { ApiError } from "@/lib/api";
import { ago, codeLabel, firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Note } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C7d · Script and rebuttals, during the call. The script and the rebuttals are the ones the
 * dialer panel resolved for this lead (GET /api/app/dialer/panel: script.sections with the lead's
 * variables filled, rebuttals in the agency's order); Notes are the lead's own
 * (GET /api/app/leads/:id/notes), read only when the tab is opened.
 *
 * The pencil edits the script as written (the panel's `scriptSource`: its placeholders, not this lead's
 * words) and saves a new version (PUT /api/app/dialer/scripts), which applies from the next lead, so
 * this call and every past one keep the version they used. Owners and producers only; the server also
 * refuses a narrow session inside an agency, in its own words.
 */
export type ScriptData = { version: number; sections: Record<string, unknown>; id?: string | null; campaignId?: string | null; productCode?: string | null };
export type ScriptSource = { sections: Record<string, string>; updatedBy: string | null; updatedAt: string | null };
export type Rebuttal = { id: string; label: string; body: string };
type Tab = "script" | "rebuttals" | "notes";

const SECTION_ORDER = ["opening", "qualifying_questions", "transition_to_quote", "close"];
const AUTHOR_ROLES = ["owner", "producer"];

/** The script's sections in reading order, each as a heading and its words; empty ones are left out. */
export function scriptSections(sections: Record<string, unknown>): { key: string; title: string; body: string }[] {
  const keys = [...SECTION_ORDER.filter((k) => k in sections), ...Object.keys(sections).filter((k) => !SECTION_ORDER.includes(k))];
  return keys
    .map((k) => ({ key: k, title: codeLabel(k) ?? k, body: typeof sections[k] === "string" ? (sections[k] as string).trim() : "" }))
    .filter((s) => s.body);
}

/** "Script v12 · updated by Dana 14 Nov": the version, and who published it when the server says. */
export function scriptFooter(version: number, source: ScriptSource | null | undefined): string {
  if (!version) return "The default script · your agency hasn’t published one";
  const when = source?.updatedAt && Number.isFinite(Date.parse(source.updatedAt))
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(source.updatedAt))
    : null;
  const who = source?.updatedBy ? firstName(source.updatedBy) : null;
  const by = who || when ? ` · updated${who ? ` by ${who}` : ""}${when ? ` ${when}` : ""}` : "";
  return `Script v${version}${by}`;
}

export function ScriptScreen({ leadId, script, source, rebuttals, onBack, initial = "rebuttals" }: {
  leadId: string; script: ScriptData; source?: ScriptSource | null; rebuttals: Rebuttal[]; onBack: () => void; initial?: Tab;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const parts = scriptSections(script.sections);
  // A saved template can be edited; the built-in default has no stored words to start from.
  const canEdit = Boolean(source && script.productCode && AUTHOR_ROLES.includes(me?.role ?? ""));
  const actions: HeaderAction[] = canEdit ? [{ icon: "pencil", label: "Edit script", onPress: () => setEditing(true) }] : [];
  const footer = saved ? `Saved as v${saved} · applies from your next lead` : scriptFooter(script.version, source);

  if (editing && source && script.productCode) {
    return <EditScript source={source} productCode={script.productCode} campaignId={script.campaignId ?? null} onBack={() => setEditing(false)} onSaved={(v) => { setSaved(v); setEditing(false); }} />;
  }

  return (
    <View testID="script-screen" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Header title="Script" back="Back" onBack={onBack} large={false} actions={actions}
        belowFull={<View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Seg items={[{ key: "script", label: "Script" }, { key: "rebuttals", label: "Rebuttals" }, { key: "notes", label: "Notes" }]} value={tab} onChange={(k) => setTab(k as Tab)} /></View>} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 + insets.bottom, gap: 14 }}>
        {tab === "script" ? (
          <>
            {parts.map((s) => (
              <Card key={s.key}>
                <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{s.title}</Text>
                <Text selectable style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{s.body}</Text>
              </Card>
            ))}
            <Mini>{footer}</Mini>
          </>
        ) : null}
        {tab === "rebuttals" ? (
          <>
            {rebuttals.map((r) => (
              <Card key={r.id}>
                <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{`“${r.label.replace(/[.?!]$/, "")}.”`}</Text>
                <Text selectable style={{ marginTop: 6, fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{r.body}</Text>
              </Card>
            ))}
            {!rebuttals.length ? <Empty icon="msg" title="No rebuttals yet" /> : null}
            {script.version || saved ? <Mini>{footer}</Mini> : null}
          </>
        ) : null}
        {tab === "notes" ? <Notes leadId={leadId} /> : null}
      </ScrollView>
    </View>
  );
}

const FIELDS: { key: string; label: string }[] = [
  { key: "opening", label: "Opening" }, { key: "qualifying_questions", label: "Qualifying questions" },
  { key: "transition_to_quote", label: "Transition to quote" }, { key: "close", label: "Close" },
];

/** The pencil: the four sections as written, saved as the next version (PUT /api/app/dialer/scripts). */
function EditScript({ source, productCode, campaignId, onBack, onSaved }: { source: ScriptSource; productCode: string; campaignId: string | null; onBack: () => void; onSaved: (version: number) => void }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api } = useSession();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, source.sections[f.key] ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = FIELDS.every((f) => draft[f.key]?.trim());

  async function save() {
    setBusy(true); setError(null);
    try {
      const answer = await api<{ script: { version: number } }>("/api/app/dialer/scripts", { method: "PUT", body: { campaign_id: campaignId, product_code: productCode, sections: Object.fromEntries(FIELDS.map((f) => [f.key, draft[f.key].trim()])) } });
      onSaved(Number(answer.script.version));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The script wasn’t saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View testID="script-edit" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.canvas, paddingTop: insets.top }}>
      <Header title="Edit script" back="Script" onBack={onBack} large={false} />
      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 + insets.bottom, gap: 14 }}>
        {FIELDS.map((f) => (
          <Field key={f.key} testID={`script-field-${f.key}`} label={f.label} value={draft[f.key]} multiline onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        ))}
        <Mini>Saving makes a new version. It applies from the next lead; this call and past ones keep theirs.</Mini>
        {error ? <T color={p.bad}>{error}</T> : null}
        <Button write testID="script-save" label="Save new version" onPress={() => void save()} busy={busy} disabled={!ready || busy} />
      </ScrollView>
    </View>
  );
}

function Notes({ leadId }: { leadId: string }) {
  const p = usePalette();
  const { api } = useSession();
  const notes = useLoad(() => api<{ notes: Note[] }>(`/api/app/leads/${leadId}/notes`), [leadId]);
  if (notes.loading && !notes.data) return <Loading rows={2} />;
  if (notes.error && !notes.data) return <Failed message={notes.error} onRetry={notes.reload} />;
  const list = (notes.data?.notes ?? []).filter((n) => n.body);
  if (!list.length) return <Empty icon="note" title="No notes on this lead" />;
  return (
    <>
      {list.map((n) => (
        <Card key={n.id}>
          <Text selectable style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>{n.body}</Text>
          <Mini style={{ marginTop: 6 }}>{`${n.author.name} · ${ago(n.createdAt)}`}</Mini>
        </Card>
      ))}
    </>
  );
}
