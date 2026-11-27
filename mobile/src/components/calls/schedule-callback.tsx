import { useEffect, useState } from "react";
import { View } from "react-native";

import { CallbackPicker } from "./callback-picker";
import { SheetModal } from "./parts";
import { remindBefore } from "./reminder";
import { clock, stateName, zonedLocalToUtc, zoneShort } from "./time";
import { Empty, Failed, Loading, Row, SearchBox, T } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { codeLabel, firstName } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { LeadRow } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board C9 as its own sheet, for the Callbacks tab's Schedule button (and anywhere a lead is in hand):
 * pick the lead (GET /api/app/leads?q=, when none is given), read its booking facts
 * (GET /api/app/callbacks?lead_id= — the customer's zone, or why there is none), pick a time in that
 * zone, and book it (POST /api/app/callbacks, which checks the calling window and answers in its own
 * words). "Anyone on the team can take it" hands the new callback to the queue
 * (PATCH /api/app/callbacks {action: "hand_over", to: "queue"}), the web Callbacks page's own action.
 */
type Facts = { lead: { leadId: string; customerName: string; state: string | null; timezone: string | null; timezoneProblem: string | null; open: { id: string; scheduledAtUtc: string } | null } };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const leadName = (l: LeadRow) => text(l.values.full_name) || [text(l.values.first_name), text(l.values.last_name)].filter(Boolean).join(" ") || "Unnamed lead";

export function newIdempotencyKey(): string {
  return `app-cb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ScheduleCallback({ leadId: given, onClose, onSaved }: { leadId?: string | null; onClose: () => void; onSaved: (message: string) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const [leadId, setLeadId] = useState<string | null>(given ?? null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { const h = setTimeout(() => setQ(query.trim()), 350); return () => clearTimeout(h); }, [query]);

  const found = useLoad(() => (!leadId && q.length >= 2 ? api<{ leads: LeadRow[] }>(`/api/app/leads?page=0&q=${encodeURIComponent(q)}`) : Promise.resolve(null)), [leadId, q]);
  const facts = useLoad(() => (leadId ? api<Facts>(`/api/app/callbacks?lead_id=${leadId}`) : Promise.resolve(null)), [leadId]);
  const lead = facts.data && facts.data.lead.leadId === leadId ? facts.data.lead : null;

  async function save(local: string, team: boolean, remind: boolean) {
    if (!lead?.timezone) return;
    setBusy(true); setMessage(null);
    try {
      const answer = await api<{ result: { callback_id?: string } }>("/api/app/callbacks", { method: "POST", body: { lead_id: lead.leadId, callback_local: local, idempotency_key: newIdempotencyKey() } });
      let handed = false;
      if (team && answer.result?.callback_id) {
        try {
          await api("/api/app/callbacks", { method: "PATCH", body: { action: "hand_over", callback_ids: [answer.result.callback_id], to: "queue" } });
          handed = true;
        } catch { /* booked either way; said below */ }
      }
      // C9 "Remind me 5 minutes before": a reminder on this phone, for the time the server booked.
      const at = zonedLocalToUtc(local, lead.timezone);
      const reminded = remind ? await remindBefore(at, lead.customerName, `${clock(at, lead.timezone)} their time (${zoneShort(lead.timezone, at)})`) : false;
      const base = team && !handed ? "Callback saved · not handed to the team" : handed ? "Callback saved for the team" : "Callback saved";
      onSaved(remind && !reminded ? `${base} · no reminder set` : base);
      onClose();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "The callback wasn’t saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const title = lead ? `Call ${firstName(lead.customerName)} back` : "Schedule a callback";
  return (
    <SheetModal visible title={title} onClose={onClose}>
      {!leadId ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <SearchBox testID="schedule-search" value={query} onChangeText={setQuery} placeholder="Name or phone" autoFocus />
          {q.length < 2 ? <T kind="small">Find the lead to call back.</T>
            : found.loading && !found.data ? <Loading rows={2} />
            : found.error ? <Failed message={found.error} onRetry={found.reload} />
            : (found.data?.leads ?? []).length ? (
              <View style={{ marginHorizontal: -16 }}>
                {(found.data?.leads ?? []).slice(0, 20).map((l, i) => (
                  <Row key={l.id} testID={`schedule-lead-${l.id}`} first={i === 0} icon="user" iconTone="plain" title={leadName(l)}
                    meta={[stateName(text(l.values.state) || null), codeLabel(l.product_line)].filter(Boolean).join(" · ")} onPress={() => setLeadId(l.id)} />
                ))}
              </View>
            ) : <Empty icon="search" title="No leads match" />}
        </View>
      ) : facts.error && !lead ? (
        <Failed message={facts.error} onRetry={facts.reload} />
      ) : !lead ? (
        <Loading rows={3} />
      ) : !lead.timezone ? (
        <T>{lead.timezoneProblem ?? "This lead has no time zone yet, so a callback can’t be booked. Add the state first."}</T>
      ) : (
        <View style={{ gap: 10, paddingBottom: 8 }}>
          {message ? <T color={p.bad}>{message}</T> : null}
          <CallbackPicker zone={lead.timezone} state={lead.state} busy={busy} teamOption remindOption onSave={(local, o) => void save(local, o.team, o.remind)} />
        </View>
      )}
    </SheetModal>
  );
}
