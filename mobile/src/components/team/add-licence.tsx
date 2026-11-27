import { useState } from "react";
import { Text, View } from "react-native";

import { STATE_NAMES } from "@/components/calls/time";
import { isoToUsDate, maskUsDate, usDateToIso } from "@/components/leads/logic";
import { PickerSheet } from "@/components/leads/parts";
import { ChoiceChips, SelectField, Sheet } from "@/components/leads/sheets";
import { Button, F, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { usePalette } from "@/theme/use-palette";

const TYPES = [{ key: "resident", label: "Resident" }, { key: "non_resident", label: "Non-resident" }];

/** The body POST /api/app/appointment-vault/licenses takes (its licenseSchema); blanks are the server's placeholders. */
export function licenceBody(input: { state: string | null; type: string | null; number: string; expires: string }): { body: Record<string, unknown> } | { error: string } {
  if (!input.state) return { error: "Choose the state." };
  const expires = input.expires.trim();
  const iso = expires ? usDateToIso(expires) : "";
  if (iso === null) return { error: "Enter the expiry as MM/DD/YYYY." };
  return { body: { state: input.state, license_number: input.number.trim(), expires_at: iso, licence_type: input.type ?? null } };
}

/**
 * Board I7's Add (owner): a state licence as the web's Licences and appointments saves it — state, resident or not,
 * number and expiry (POST /api/app/appointment-vault/licenses, owner only; the server checks it again). The board's
 * photo of the licence has nowhere to be kept yet, so only the details are sent.
 */
export function AddLicenceSheet({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: (text: string) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const [state, setState] = useState<string | null>(null);
  const [type, setType] = useState<string | null>("resident");
  const [number, setNumber] = useState("");
  const [expires, setExpires] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setState(null); setType("resident"); setNumber(""); setExpires(""); setError(null); };
  const save = async () => {
    const built = licenceBody({ state, type, number, expires });
    if ("error" in built) { setError(built.error); return; }
    setBusy(true);
    setError(null);
    try {
      await api("/api/app/appointment-vault/licenses", { method: "POST", body: built.body });
      onSaved(`${STATE_NAMES[state ?? ""] ?? state} licence saved`);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The licence could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet visible={visible && !picking} title="Add a licence" onClose={onClose} testID="add-licence"
        footer={(
          <View style={{ gap: 8 }}>
            {error ? <Text style={{ fontFamily: F.m, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
            <Button write testID="add-licence-save" label={busy ? "Saving…" : "Save licence"} icon="check" onPress={() => void save()} busy={busy} disabled={busy} />
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <SelectField testID="add-licence-state" label="State" value={state ? STATE_NAMES[state] ?? state : null} placeholder="Choose…" onPress={() => setPicking(true)} />
          <ChoiceChips testID="add-licence-type" items={TYPES} value={type} onChange={setType} />
          <Field testID="add-licence-number" label="Licence number" value={number} onChangeText={setNumber} autoCapitalize="characters" placeholder="Optional" />
          <Field testID="add-licence-expires" label="Expires" value={isoToUsDate(expires)} onChangeText={(t) => setExpires(maskUsDate(t))} keyboardType="number-pad" placeholder="MM/DD/YYYY" />
        </View>
      </Sheet>
      <PickerSheet title="State" visible={visible && picking} onClose={() => setPicking(false)} value={state}
        onPick={(k) => { setState(k); setPicking(false); }} items={Object.entries(STATE_NAMES).map(([code, name]) => ({ key: code, label: name, meta: code }))} />
    </>
  );
}
