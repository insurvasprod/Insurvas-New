import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Empty, Field } from "@/components/ui";
import { ApiError } from "@/lib/api";

import { BIOMETRIC_WORD, confirmItsYou } from "./biometric";
import { StepFrame } from "./frame";
import { ErrorLine, MiniLine, Question } from "./parts";
import { PrivacyCover, usePrivacyCover } from "./privacy-cover";
import type { StepProps } from "./step-props";

type Secret = "routing" | "account";
const FIELD_KEY: Record<Secret, "pay.routing_number" | "pay.account_number"> = { routing: "pay.routing_number", account: "pay.account_number" };
/** Kept on the access record with every reveal (lib/applications/revealReason.ts asks why). */
export const REVEAL_REASON = "Shown on the phone after the agent confirmed it was them";
/** How long a revealed number stays on screen before it is masked again. */
const SHOWN_FOR_MS = 30_000;

/**
 * Board E2c · where the draft comes from: Bank, Routing number, Account number, the lock line, Account
 * holder. Bank numbers are typed once and then only ever come back masked (`•••• 4471`); the eye shows
 * one again after Face ID / the fingerprint (the platform's own prompt: "Show bank details", "Confirm
 * it's you", Cancel), and the server writes the access record (who, which field, why) before it sends
 * the value. A number left blank keeps the one on file. Leaving the app covers the screen and masks a
 * revealed number again. Saves with PUT …/payment (the account type already on file is kept, checking
 * when there is none), then goes on to the draft date.
 */
export function BankDetails({ props, onSaved }: { props: StepProps; onSaved: () => void }) {
  const pay = props.attempt.payment;
  const [bank, setBank] = useState(pay?.bankName ?? "");
  const [holder, setHolder] = useState(pay?.nameOnAccount ?? "");
  /** What is being typed; undefined shows what is on file (masked, or revealed for a moment). */
  const [typing, setTyping] = useState<Partial<Record<Secret, string>>>({});
  const [shown, setShown] = useState<Partial<Record<Secret, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hide = useCallback(() => setShown({}), []);
  const away = usePrivacyCover(hide);
  // A revealed number masks itself again after a short while, or when the screen goes.
  const anyShown = Boolean(shown.routing || shown.account);
  useEffect(() => {
    if (!anyShown) return;
    const t = setTimeout(() => setShown({}), SHOWN_FOR_MS);
    return () => clearTimeout(t);
  }, [anyShown]);
  const line = { left: `Payment · ${props.index + 1} of ${props.total}`, right: props.carrier, total: props.total, current: props.index };

  if (pay && pay.method !== "ach") {
    // A card or direct bill has fields the board does not draw on the phone; it is changed on the web.
    return (
      <StepFrame back={props.firstName} onBack={props.leave} line={line} bar={<Button label="Pick the draft date" onPress={onSaved} />}>
        <Empty icon="creditCard" title="This one isn’t a bank draft" body="The payment on file is by card or bill. Change it on a computer, or go on to the draft date." />
      </StepFrame>
    );
  }

  const onFile = (k: Secret) => (k === "routing" ? pay?.routing : pay?.account);
  const valueOf = (k: Secret) => typing[k] ?? shown[k] ?? onFile(k)?.masked ?? "";

  async function reveal(k: Secret) {
    setError(null);
    const check = await confirmItsYou("Show bank details");
    if (!check.ok) { if (check.why) setError(check.why); return; }
    try {
      const value = await props.actions.reveal(FIELD_KEY[k], REVEAL_REASON);
      setShown((s) => ({ ...s, [k]: value }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The number could not be shown.");
    }
  }

  async function save() {
    const routing = typing.routing?.replace(/\D/g, "");
    const account = typing.account?.replace(/\D/g, "");
    if (routing !== undefined && routing && routing.length !== 9) { setError("A routing number has 9 digits."); return; }
    if (account !== undefined && account && (account.length < 4 || account.length > 17)) { setError("An account number has 4 to 17 digits."); return; }
    if (!onFile("routing")?.hasValue && !routing) { setError("Type the routing number."); return; }
    if (!onFile("account")?.hasValue && !account) { setError("Type the account number."); return; }
    setBusy(true);
    setError(null);
    try {
      await props.actions.savePayment({
        method: "ach", bank_name: bank.trim() || null, account_type: pay?.accountType ?? "checking", name_on_account: holder.trim() || null,
        ...(routing ? { routing } : {}), ...(account ? { account } : {}),
      });
      setTyping({});
      onSaved();
    } catch (e) {
      // Banking details given once are never dropped: they stay typed on screen.
      setError(e instanceof ApiError ? e.message : "Not saved. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const secretField = (k: Secret, label: string) => {
    const has = Boolean(onFile(k)?.hasValue);
    return (
      <Field testID={`app-bank-${k}`} label={label} value={valueOf(k)} keyboardType="number-pad" autoComplete="off" autoCorrect={false} secureTextEntry={false}
        // A tap on a masked number starts a new one; leaving it empty keeps the one on file.
        onFocus={() => { if (typing[k] === undefined && has) setTyping((t) => ({ ...t, [k]: "" })); }}
        onBlur={() => { if (typing[k] === "") setTyping((t) => ({ ...t, [k]: undefined })); }}
        onChangeText={(t) => setTyping((s) => ({ ...s, [k]: t }))}
        trailIcon={has && typing[k] === undefined ? "eye" : undefined} trailLabel={`Show the ${label.toLowerCase()}`} onTrail={() => void reveal(k)} />
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <StepFrame testID="app-bank" back={props.firstName} onBack={props.leave} line={line}
        // One move on: the step saves here. (The board draws the screen under the biometric sheet, with no bar.)
        bar={<Button write testID="app-bank-save" label="Next" busy={busy} onPress={() => void save()} />}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 14 }}>
          <Question bold>Where should the draft come from?</Question>
          <Field testID="app-bank-name" label="Bank" value={bank} onChangeText={setBank} autoCapitalize="words" />
          {secretField("routing", "Routing number")}
          {secretField("account", "Account number")}
          <MiniLine icon="lock">{`Hidden after entry · showing again needs ${BIOMETRIC_WORD}`}</MiniLine>
          <Field testID="app-bank-holder" label="Account holder" value={holder} onChangeText={setHolder} autoCapitalize="words" />
          <ErrorLine text={error} testID="app-bank-error" />
        </View>
      </StepFrame>
      <PrivacyCover visible={away} />
    </View>
  );
}
