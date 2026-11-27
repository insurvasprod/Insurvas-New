import { useMemo } from "react";
import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { dayMonth, possessive, verificationRows, type Pronoun } from "@/components/leads/logic";
import { CardTitle, Timeline } from "@/components/leads/parts";
import type { FullWorkspace } from "@/components/leads/types";
import { Card, Chip, Empty, F, Failed, Group, Loading, Row } from "@/components/ui";
import { codeLabel, firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Note } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sat" within the week, else "23 Nov". */
export function dayWord(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = (now - d.getTime()) / 86_400_000;
  if (days >= 0 && days < 6) return WEEKDAYS[d.getDay()];
  return dayMonth(iso);
}
/** "Mon 30 Nov". */
function dayDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${WEEKDAYS[d.getDay()]} ${dayMonth(iso)}`;
}

// ─── D3b · Conversation ────────────────────────────────────────────────────────────────────────
type PartnerLine = { id: string; body: string; title: string | null; system: boolean; author: string | null; fromPartner: boolean; createdAt: string };
type Entry = { id: string; at: string; kind: "them" | "me" | "card"; body: string; title?: string | null; meta: string };

/**
 * What was said about this lead with the partner who sent it (GET /api/app/leads/:id/conversation:
 * the partner's replies and the automatic cards, owner and producer only, as on the web) and the
 * team's notes, oldest first. Nothing here texts the client: a message to the partner is a note
 * shared to their channel (LA-1.21), posted from the composer the lead page draws.
 */
export function ConversationTab({ w, notes }: { w: FullWorkspace; notes: Note[] }) {
  const p = usePalette();
  const { api, me } = useSession();
  const readsPartner = Boolean(w.partner) && (me?.role === "owner" || me?.role === "producer");
  const lines = useLoad(() => (readsPartner ? api<{ messages: PartnerLine[] }>(`/api/app/leads/${w.lead.id}/conversation`) : Promise.resolve({ messages: [] })), [w.lead.id, readsPartner]);
  const partner = w.partner?.name ?? null;

  const entries = useMemo<Entry[]>(() => {
    const fromNotes = notes.filter((n) => n.body).map((n) => ({
      id: `note:${n.id}`, at: n.createdAt, kind: "me" as const, body: n.body ?? "",
      meta: [n.author.name, n.visibility === "shared" && partner ? `shared with ${partner}` : n.visibility === "shared" ? null : "team only", dayWord(n.createdAt)].filter(Boolean).join(" · "),
    }));
    const fromPartner = (lines.data?.messages ?? []).map((m) => m.system
      ? { id: `pm:${m.id}`, at: m.createdAt, kind: "card" as const, body: m.body, title: m.title, meta: dayWord(m.createdAt) }
      : { id: `pm:${m.id}`, at: m.createdAt, kind: m.fromPartner ? ("them" as const) : ("me" as const), body: m.body, meta: [m.author ?? "Someone", m.fromPartner ? partner : null, dayWord(m.createdAt)].filter(Boolean).join(" · ") });
    return [...fromNotes, ...fromPartner].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [notes, lines.data, partner]);

  if (lines.loading && !lines.data) return <Loading rows={3} />;
  if (!entries.length) {
    return <Empty icon="msgs" title="No conversation yet" body={partner ? `Notes you share reach ${partner}; their replies land here.` : "Notes about this lead land here."} />;
  }
  return (
    <View testID="lead-conversation" style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      {partner ? <Text style={{ textAlign: "center", marginTop: 4, marginBottom: 8, fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`${partner} · about ${firstName(nameOf(w))}`}</Text> : null}
      {entries.map((e) => e.kind === "card" ? (
        <Card key={e.id} style={{ marginVertical: 10 }}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Icon name="msgs" size={18} color={p.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>{e.title ?? "Update"}</Text>
              <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{[e.body, e.meta].filter(Boolean).join(" · ")}</Text>
            </View>
          </View>
        </Card>
      ) : (
        <View key={e.id}>
          <View style={[{ maxWidth: "78%", paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18, marginVertical: 3 },
            e.kind === "me" ? { alignSelf: "flex-end", backgroundColor: p.green, borderBottomRightRadius: 6 } : { alignSelf: "flex-start", backgroundColor: p.surf2, borderBottomLeftRadius: 6 }]}>
            <Text style={{ fontFamily: F.r, fontSize: 15.5, lineHeight: 21, color: e.kind === "me" ? p.onGreen : p.ink }}>{e.body}</Text>
          </View>
          <Text style={{ fontFamily: F.r, fontSize: 12, color: p.muted, marginTop: 2, marginHorizontal: 4, marginBottom: 8, textAlign: e.kind === "me" ? "right" : "left" }}>{e.meta}</Text>
        </View>
      ))}
    </View>
  );
}

function nameOf(w: FullWorkspace): string {
  const v = w.lead.values;
  return [v.full_name, v.name, [v.first_name, v.last_name].filter(Boolean).join(" ")].find((x): x is string => typeof x === "string" && x.trim() !== "") ?? "";
}

// ─── D3c · Nurture ─────────────────────────────────────────────────────────────────────────────
type Ladder = { attempt: number; delay: string; preferred: string | null };
type RecordAnswer = {
  /** The campaign whose cadence it runs on (2026-11-26; absent from an older server). */
  campaignName?: string | null;
  attempts: { id: string; number: number | null; at: string; outcome: string | null }[];
  nurture: { leadState: string; attemptsMade: number; ceiling: number; nextDialAfter: string | null; nextPreferredSlot: string | null; recycleCount: number; openCallbackAt: string | null; cadenceSource: "campaign" | "agency" | "default"; ladder: Ladder[] };
};
const PREFERRED: Record<string, string> = { opposite_half: "Opposite half of the day", morning: "Morning", evening: "Evening", early_morning: "Early morning", late_morning: "Late morning", afternoon: "Afternoon", early_evening: "Early evening", late_evening: "Late evening", weekend: "Weekend" };
const SOURCE: Record<RecordAnswer["nurture"]["cadenceSource"], string> = { campaign: "This lead’s campaign cadence", agency: "Your agency’s cadence", default: "The default cadence" };

/**
 * Where the cadence has this lead (GET /api/app/leads/:id/record, the rules the scheduler itself
 * uses): the next touch and whose queue it goes back to, then the plan, titled with the cadence it
 * runs on, every rung of the ladder — done ones in green, the rest still to come. The cadence's
 * touches are calls only (the scheduler dials; it sends no email and has no "back to the pool"
 * step), and pausing or ending one lead's cadence is not something the server offers yet, so
 * neither is drawn here.
 */
export function NurtureTab({ leadId, owner, pronoun = "they" }: { leadId: string; owner?: string | null; pronoun?: Pronoun }) {
  const p = usePalette();
  const { api } = useSession();
  const rec = useLoad(() => api<RecordAnswer>(`/api/app/leads/${leadId}/record`), [leadId]);
  if (rec.loading && !rec.data) return <Loading rows={3} />;
  if (rec.error && !rec.data) return <Failed message={rec.error} onRetry={rec.reload} />;
  const r = rec.data;
  if (!r) return null;
  const n = r.nurture;
  const finished = n.leadState === "exhausted" || n.leadState === "closed" || n.attemptsMade >= n.ceiling;
  const chip = n.leadState === "nurture" ? "In nurture" : n.leadState === "closed" ? "Closed" : finished ? "Cadence finished" : "Not in nurture";
  const next = finished ? "No more dials" : n.openCallbackAt ? `Callback · ${dayDate(n.openCallbackAt)}` : n.nextDialAfter ? `Call · ${dayDate(n.nextDialAfter)}` : "Call · when next served";
  const slot = n.nextPreferredSlot ? (PREFERRED[n.nextPreferredSlot] ?? codeLabel(n.nextPreferredSlot) ?? "").toLowerCase() : null;
  const queue = owner ? `Goes back in ${firstName(owner)}’s queue` : null;
  const nextLine = finished ? (n.leadState === "closed" ? "A final outcome ended the cadence" : `All ${n.ceiling} dials used`)
    : n.openCallbackAt ? "The callback is served ahead of every cadence retry"
    : queue ? `${queue}${slot ? `, ${slot} ${possessive(pronoun)} time` : ""}`
    : slot ? `${slot[0].toUpperCase()}${slot.slice(1)} ${possessive(pronoun)} time` : `${n.attemptsMade} of ${n.ceiling} dials used`;
  const planTitle = `${r.campaignName ? `“${r.campaignName}”` : SOURCE[n.cadenceSource]} · ${n.ladder.length} ${n.ladder.length === 1 ? "call" : "calls"}`;
  const placed = new Map<number, { at: string; outcome: string | null }>();
  for (const a of [...r.attempts].reverse()) if (a.number !== null && !placed.has(a.number)) placed.set(a.number, a);

  return (
    <View testID="lead-nurture" style={{ paddingHorizontal: 16, marginTop: 14, gap: 12 }}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Next touch</Text>
            <Text style={{ fontFamily: F.s, fontSize: 18, lineHeight: 24, color: p.ink }}>{next}</Text>
            <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{nextLine}</Text>
          </View>
          {!finished && n.ceiling > 0 ? <Chip tone="info">{`Step ${Math.min(n.attemptsMade + 1, n.ceiling)} of ${n.ceiling}`}</Chip> : <Chip tone="neutral">{chip}</Chip>}
        </View>
      </Card>
      <Card>
        <CardTitle>{planTitle}</CardTitle>
        <View style={{ marginTop: 10 }}>
          <Timeline items={n.ladder.map((rung) => {
            const used = placed.get(rung.attempt);
            const done = Boolean(used) || rung.attempt <= n.attemptsMade;
            const meta = used ? [`Done ${dayDate(used.at)}`, used.outcome ? codeLabel(used.outcome) : null].filter(Boolean).join(" · ")
              : done ? "Done before this record"
              : finished ? "Not used"
              : rung.attempt === n.attemptsMade + 1 ? (n.nextDialAfter ? `After ${dayDate(n.nextDialAfter)}` : "When next served")
              : `${rung.delay} after call ${rung.attempt - 1}`;
            return { id: String(rung.attempt), title: `Call · attempt ${rung.attempt}${rung.preferred ? ` · ${(PREFERRED[rung.preferred] ?? codeLabel(rung.preferred) ?? "").toLowerCase()}` : ""}`, meta, muted: !done };
          })} />
        </View>
      </Card>
    </View>
  );
}

// ─── D3d · Verification ────────────────────────────────────────────────────────────────────────
/**
 * Each field's state from the lead's verification session (GET /api/app/leads/:id `verification`):
 * confirmed, corrected (was → now) or outstanding. Read-only; corrections happen on the call.
 */
export function VerificationTab({ w }: { w: FullWorkspace }) {
  const v = w.verification;
  if (!v) return <Empty icon="shield" title="Not verified yet" body="Verification starts on the call, when the lead is claimed." />;
  const fields = [...(w.template?.fields ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const labels = new Map(fields.map((f) => [f.field_key, f.label]));
  const rows = verificationRows(v.fields, labels, w.lead.values, { partner: Boolean(w.partner), order: fields.map((f) => f.field_key), types: new Map(fields.map((f) => [f.field_key, f.type])) });
  const done = rows.filter((r) => r.state !== "outstanding").length;
  const when = dayMonth(v.session.completed_at ?? v.session.started_at);
  // "Checked on 23 Nov by Ava Kim · 10 of 12" (board D3d); the name is who ran the verification.
  const by = w.verifierName ? ` by ${w.verifierName}` : "";
  const title = `${v.session.completed_at ? "Checked on" : "Started"} ${when}${by} · ${done} of ${rows.length}`;
  return (
    <View testID="lead-verification">
      <Group title={title}>
        {rows.map((r, i) => (
          <Row key={r.key} first={i === 0} testID={`verify-${r.key}`}
            icon={r.state === "confirmed" ? "check" : r.state === "corrected" ? "pencil" : "clock"}
            iconTone={r.state === "corrected" ? "info" : r.state === "outstanding" ? "plain" : undefined}
            title={r.label} meta={r.meta} chevron={false}
            chip={<Chip tone={r.state === "confirmed" ? "ok" : r.state === "corrected" ? "info" : "warn"}>{r.state === "confirmed" ? "Confirmed" : r.state === "corrected" ? "Corrected" : "Outstanding"}</Chip>} />
        ))}
      </Group>
    </View>
  );
}
