import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { Fab, Toast } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Field, Group, Header, Loading, Row, Screen, SearchBox } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { displayName, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { checkMark, checkVerdict, consentChip, dayMonth, expiringStates, givenText, licenceLines, ownLicenceLines, phoneDigits, renewalChip, shortId, stateName, vaultAppointments, type CheckVerdict } from "./logic";
import { AddLicenceSheet } from "./add-licence";
import { CheckLine, KeyValues, openTeam } from "./parts";
import type { ConsentAnswer, PreflightAnswer, TeamAnswer, Vault } from "./types";

// ─── I5 · Check a number ──────────────────────────────────────────────────────────────────────
/**
 * Board I5 · Check a number: the TCPA / DNC preflight for any number, before a lead exists — the web's "Check a number
 * before dialing" (POST /api/app/dial/preflight). Every check runs and comes back: the agency's list, the national
 * and state DNC lists through the vendor, the litigator list, the calling window and consent. A refusal (422) or a
 * vendor that could not answer (503) carries the same checks, so the card always shows what was found. The route is
 * the owner's and a producer's (the web's gate); anyone else is told so in the server's words. Nothing here dials.
 */
export function CheckNumberScreen({ back = "Menu" }: { back?: string }) {
  const p = usePalette();
  const { api } = useSession();
  // A shortcut or Siri may hand over the number it heard (digits only, ?number=); the check still waits for the button.
  const { number } = useLocalSearchParams<{ number?: string }>();
  const [phone, setPhone] = useState(() => (typeof number === "string" ? number.replace(/\D/g, "").slice(0, 15) : ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(CheckVerdict & { at: Date; state: string | null; digits: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const digits = phoneDigits(phone);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await api<PreflightAnswer>("/api/app/dial/preflight", { method: "POST", body: { phone } });
      setResult({ ...checkVerdict(answer, 200), at: new Date(), state: answer.state ?? null, digits });
    } catch (e) {
      // A refusal still carries every check the server ran; only an answer without them is an error to show.
      if (e instanceof ApiError && Array.isArray(e.body.checks)) setResult({ ...checkVerdict(e.body as PreflightAnswer, e.status), at: new Date(), state: (e.body.state as string | null) ?? null, digits });
      else setError(e instanceof Error ? e.message : "The number could not be checked.");
    } finally {
      setBusy(false);
    }
  };
  const again = () => { setResult(null); setPhone(""); setError(null); };
  const time = (d: Date) => `${d.getHours() % 12 === 0 ? 12 : d.getHours() % 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`;

  const header = <Header title="Check a number" back={back} onBack={() => router.back()} large />;
  return (
    <Screen header={header} pad>
      <View style={{ gap: 14 }}>
        <Field label="Phone number" value={phone} onChangeText={(t) => { setPhone(t); if (result) setResult(null); }} leadIcon="phone" keyboardType="phone-pad" autoFocus={!result}
          placeholder="(813) 555-0199" error={error} returnKeyType="search" onSubmitEditing={() => { if (digits.length === 10 && !busy) void run(); }} testID="check-phone" />
        {result ? (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: F.s, fontSize: 18, color: p.ink }}>{result.title}</Text>
                <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{[`Checked ${time(result.at)}`, result.state ? stateName(result.state) : null].filter(Boolean).join(" · ")}</Text>
              </View>
              <Chip tone={result.chip.tone}>{result.chip.text}</Chip>
            </View>
            <View style={{ gap: 10, marginTop: 14 }}>
              {result.checks.map((c) => <CheckLine key={c.key} mark={checkMark(c)} title={c.label} detail={[c.result, c.source, c.age && c.age !== "live" ? `${c.age} old` : null].filter(Boolean).join(" · ")} />)}
            </View>
            {result.message ? <Text style={{ marginTop: 12, fontFamily: F.r, fontSize: 13.5, color: p.muted }}>{result.message}</Text> : null}
          </Card>
        ) : null}
        {result ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button kind="outline" icon="file" label="Evidence report" style={{ flex: 1 }}
              onPress={() => openTeam(`/computer?path=${encodeURIComponent(`/app/evidence-report?phone=${result.digits}`)}&title=${encodeURIComponent("Evidence report")}`)} />
            <Button icon="refresh" label="Check another" style={{ flex: 1 }} onPress={again} />
          </View>
        ) : (
          <Button testID="check-run" icon="shield" label="Check this number" busy={busy} disabled={digits.length !== 10} onPress={() => void run()} />
        )}
      </View>
    </Screen>
  );
}

// ─── I5b · Consent proof ──────────────────────────────────────────────────────────────────────
/**
 * Board I5b · Consent proof, the consent locker (GET /api/app/consent?search=&words=1, read only by design; owner,
 * producer, assistant): for a number or a name, the certificate behind it — when it was given, where, the IP, the
 * certificate id, when an unclaimed copy expires — and the words the person agreed to, verbatim as the lead post
 * stored them. Only a claimed certificate is "consent on file": a vendor link alone is said to be one. The board's
 * "Verbal yes on the call" card is not drawn: no call is recorded until a phone provider is connected.
 */
export function ConsentScreen({ back = "Menu" }: { back?: string }) {
  const p = usePalette();
  const { api } = useSession();
  const [needle, setNeedle] = useState("");
  const query = needle.trim();
  const load = useLoad(() => api<ConsentAnswer>(`/api/app/consent?words=1&limit=${query ? 20 : 5}${query ? `&search=${encodeURIComponent(query)}` : ""}`), [query]);
  const header = <Header title="Consent locker" back={back} onBack={() => router.back()} large below={<SearchBox testID="consent-search" value={needle} onChangeText={setNeedle} placeholder="Phone number or name" />} />;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={3} /> : <Failed what="the consent locker" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!load.data.artefacts.length) {
    body = <Empty icon="shield" title={query ? "No certificate found" : "The locker is empty"} body={query ? `No consent certificate matches “${query}”.` : "Certificates arrive with the leads partners and vendors post."} />;
  } else {
    body = (
      <View style={{ gap: 12, paddingHorizontal: 16 }}>
        {!query ? <Text style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted }}>The latest certificates. Search for a number or a name.</Text> : null}
        {load.data.artefacts.map((a) => {
          const chip = consentChip(a.status);
          const rows: [string, ReactNode][] = [
            ["Given", givenText(a.consentTimestamp ?? a.capturedAt)],
            ["Where", a.sourceUrl ?? a.landingPage ?? "Not recorded"],
            ["IP", a.ip ?? "Not recorded"],
            ["Certificate", <Text key="c" style={{ fontFamily: F.mono, fontSize: 14, color: p.ink }}>{shortId(a.certificateId)}</Text>],
          ];
          if (a.claimClosesAt) rows.push(["Expires", expiresText(a.claimClosesAt)]);
          return (
            <Card key={a.id}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: F.s, fontSize: 17, color: p.ink }}>{displayName(a.leadName)}</Text>
                  <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{phoneLabel(a.leadPhone) ?? "No phone on the lead"}</Text>
                </View>
                <Chip tone={chip.tone}>{chip.text}</Chip>
              </View>
              <View style={{ height: 1, backgroundColor: p.line, marginVertical: 12 }} />
              <KeyValues rows={rows} />
              {a.consentText ? (
                <View testID={`consent-words-${a.id}`} style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: p.surf2 }}>
                  <Text selectable style={{ fontFamily: F.r, fontSize: 14, lineHeight: 20, color: p.body }}>{`“${a.consentText.trim()}”`}</Text>
                </View>
              ) : null}
            </Card>
          );
        })}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}

/** "18 Nov 2027" for a claim window still open; "Expired 21 Nov" once it has closed. */
function expiresText(at: string): string {
  const day = at.slice(0, 10);
  return Date.parse(at) < Date.now() ? `Expired ${dayMonth(day)}` : dayMonth(day);
}

// ─── I7 · Licences and appointments ───────────────────────────────────────────────────────────
/**
 * Board I7 · Licences and appointments (GET /api/app/appointment-vault?mine=1; owner, producer): your own licences —
 * the states you are licensed in and when each lapses, as the owner recorded them — and the carriers the agency is
 * appointed with. The owner also sees the team's state licences that lapse inside 60
 * days (GET /api/app/team, owner only) and the agency's own licences, and adds one with the floating Add button
 * (AddLicenceSheet, owner only on the server). The board's camera — a photo of the licence — is not offered: the
 * web keeps no licence documents, so a photo would have nowhere to be stored.
 */
export function LicencesScreen({ back = "Menu" }: { back?: string }) {
  const { api, me } = useSession();
  const owner = me?.role === "owner" && me.memberRole !== "manager";
  const myId = me?.user.id ?? null;
  const load = useLoad(async () => {
    const [vault, team] = await Promise.all([api<Vault>("/api/app/appointment-vault?mine=1"), owner ? api<TeamAnswer>("/api/app/team").catch(() => null) : null]);
    return { vault, team };
  }, [owner]);
  // Board I7: the owner adds a licence here (the Add button); anyone else manages them on the computer.
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const header = <Header title="Licences" back={back} onBack={() => router.back()} large
    actions={owner ? [{ icon: "plus", label: "Add a licence", onPress: () => setAdding(true) }] : [{ icon: "laptop", label: "Manage licences on the computer", onPress: () => openTeam(`/computer?path=${encodeURIComponent("/app/appointments")}&title=${encodeURIComponent("Licences and appointments")}`) }]} />;
  const extras = owner ? (
    <>
      <Fab testID="licences-add" label="Add" icon="plus" onPress={() => setAdding(true)} />
      <AddLicenceSheet visible={adding} onClose={() => setAdding(false)} onSaved={(text) => { setAdding(false); setToast(text); load.reload(); }} />
      <Toast text={toast} onHide={() => setToast(null)} />
    </>
  ) : null;
  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={6} /> : <Failed what="the licences" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else {
    const own = ownLicenceLines(load.data.vault.mine ?? []);
    const agency = owner ? licenceLines(load.data.vault) : [];
    const appointed = vaultAppointments(load.data.vault);
    const team = (load.data.team?.members ?? []).filter((m) => m.id !== myId).flatMap((m) => expiringStates(m.licensedStateExpiries).map((l) => ({ ...l, name: displayName(m.name), id: m.id })))
      .sort((a, b) => a.on.localeCompare(b.on));
    body = !own.length && !agency.length && !appointed.length && !team.length ? (
      <Empty icon="badge" title="No licences on file" body={owner ? "Add a licence with the Add button." : "Your licences are recorded by the agency owner."} />
    ) : (
      <View>
        {own.length ? (
          <Group title="Licences">
            {own.map((l, i) => <Row key={l.key} first={i === 0} icon="badge" iconTone={l.chip.tone === "bad" ? "warn" : undefined} title={l.title} meta={l.meta} chip={<Chip tone={l.chip.tone}>{l.chip.text}</Chip>} chevron={false} />)}
          </Group>
        ) : null}
        {appointed.length ? (
          <Group title="Appointed with">
            {appointed.map((a, i) => <Row key={a.key} first={i === 0} icon="landmark" title={a.title} meta={a.meta} chip={<Chip tone={a.chip.tone}>{a.chip.text}</Chip>} chevron={false} />)}
          </Group>
        ) : null}
        {team.length ? (
          <Group title="Team · renewing soon">
            {team.map((l, i) => <Row key={`${l.id}:${l.state}`} first={i === 0} icon="badge" title={l.name} meta={`${stateName(l.state)} licence`} chip={<Chip tone={renewalChip(l.on).tone}>{renewalChip(l.on).text}</Chip>} onPress={() => openTeam(`/team/${l.id}`)} />)}
          </Group>
        ) : null}
        {agency.length ? (
          <Group title="Agency licences">
            {agency.map((l, i) => <Row key={l.key} first={i === 0} icon="badge" iconTone={l.chip.tone === "bad" ? "warn" : undefined} title={l.title} meta={l.meta} chip={<Chip tone={l.chip.tone}>{l.chip.text}</Chip>} chevron={false} />)}
          </Group>
        ) : null}
      </View>
    );
  }
  // The Add button and the toast float over the list (outside the scroll view), as on the board.
  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      {extras}
    </View>
  );
}
