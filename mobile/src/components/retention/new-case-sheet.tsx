import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Sheet, SheetField } from "@/components/leads/sheets";
import { Button, F, Row } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

import { PERSON_REASONS, openingNote } from "./logic";
import { ChoiceTiles } from "./parts";
import type { PolicyMatch } from "./types";

const policyText = (m: PolicyMatch) => [m.clientName, m.policyNumber, m.carrierName].filter(Boolean).join(" · ");

/**
 * Board F3d · Open a retention case, when the client calls first. Find the policy by name, phone or policy
 * number (GET /api/app/retention/servicing/policies, the web's New case search), pick why, say what they said,
 * and POST /api/app/retention/cases {action: "open"}. The case lands in Paperwork until a person closes it or a
 * file settles it, as on the web.
 *
 * The board's five reasons are offered (Changed banks, Can't afford it, Moved, Wants to cancel, Beneficiary change).
 * The server opens a person's case for three reasons only, so each is filed under the nearest (logic.ts
 * PERSON_REASONS) and its own words lead the note. `initial`: the policy, when opened from that policy's page (F2).
 */
export function NewCaseSheet({ visible, onClose, onOpened, initial = null }: { visible: boolean; onClose: () => void; onOpened: (id: string) => void; initial?: PolicyMatch | null }) {
  const p = usePalette();
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PolicyMatch | null>(initial);
  const [found, setFound] = useState<{ q: string; policies: PolicyMatch[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  // Search a moment after typing stops; state is only set when the answer comes back, never in the effect itself.
  useEffect(() => {
    if (picked || q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      api<{ policies: PolicyMatch[] }>(`/api/app/retention/servicing/policies?q=${encodeURIComponent(q)}`)
        .then((a) => { if (live) { setFound({ q, policies: a.policies }); setSearchError(null); } })
        .catch((e) => { if (live) setSearchError(e instanceof ApiError ? e.message : "The policies could not be searched."); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q, picked, api]);

  const results = !picked && q.length >= 2 && found?.q === q ? found.policies : null;

  async function open() {
    if (!picked) { setError("Choose the policy."); return; }
    if (!reason) { setError("Choose why."); return; }
    setBusy(true); setError(null);
    try {
      const filed = PERSON_REASONS.find((r) => r.key === reason);
      if (!filed) { setError("Choose why."); return; }
      const answer = await api<{ id: string }>("/api/app/retention/cases", { method: "POST", body: { action: "open", carrier_id: picked.carrierId, policy_number: picked.policyNumber, reason: filed.reason, note: openingNote(reason, note) } });
      onOpened(answer.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The case could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={visible} title="New case" onClose={onClose} testID="new-case">
      <View style={{ gap: 14 }}>
        <SheetField testID="new-case-policy" label="Policy" leadIcon="search" value={picked ? policyText(picked) : query} multiline={Boolean(picked)}
          placeholder="Client name, phone or policy number" autoCorrect={false}
          onChangeText={(t) => { setPicked(null); setQuery(t); setError(null); }} />
        {searchError ? <Text style={{ fontFamily: F.r, fontSize: 14, color: p.bad }}>{searchError}</Text> : null}
        {results ? (
          results.length ? (
            <View style={{ marginHorizontal: -16 }}>
              {results.slice(0, 6).map((m, i) => (
                <Row key={`${m.carrierId}|${m.policyNumber}`} first={i === 0} icon="file" title={m.clientName ?? "No client linked"} meta={`${m.carrierName} · ${m.policyNumber}`}
                  onPress={() => { setPicked(m); setError(null); }} testID={`new-case-match-${m.policyNumber}`} />
              ))}
            </View>
          ) : <Text style={{ fontFamily: F.r, fontSize: 14, color: p.muted }}>{`Nothing in your book matches “${q}”.`}</Text>
        ) : null}
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>Reason</Text>
        <ChoiceTiles testID="new-case-reason" items={PERSON_REASONS} value={reason} onPick={(k) => { setReason(k); setError(null); }} disabled={busy} />
        <SheetField testID="new-case-note" label="What they said" value={note} onChangeText={setNote} multiline maxLength={2000} />
        {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 14, color: p.bad }}>{error}</Text> : null}
        <Button write testID="new-case-open" label="Open case" onPress={() => void open()} busy={busy} disabled={!picked || !reason} />
      </View>
    </Sheet>
  );
}
