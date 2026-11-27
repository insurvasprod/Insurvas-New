import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { initialsOf } from "@/components/menu/pages";
import { ProfilePhoto } from "@/components/menu/profile-photo";
import { LoadState } from "@/components/states/states";
import { F, Field, Header, IOS, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { joinName, splitName } from "@/lib/answer-state";
import { AGENCY_ZONE, LANGUAGES, languageWord, ZONES, zoneLabel } from "@/lib/profile-options";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board J3b · Edit profile. Only what PATCH /api/app/profile takes from the person (name, phone, their
 * own time zone) and their languages (PUT /api/app/profile/languages, the same value routing pairs
 * callers by). The server keeps one name; First and Last are joined back with a space. The time zone
 * changes how times show for this person only — calling hours still follow the customer's state.
 */
type Profile = { name: string; email: string; phone: string | null; displayTimezone: string | null };
type Draft = { first: string; last: string; phone: string; zone: string; languages: string[] };

export default function EditProfile() {
  const p = usePalette();
  const { api, reloadMe } = useSession();
  const profile = useLoad(() => api<{ profile: Profile; agencyTimezone?: string | null }>("/api/app/profile"), []);
  const langs = useLoad(() => api<{ languages: string[]; available: boolean }>("/api/app/profile/languages").catch(() => ({ languages: [], available: false })), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sheet, setSheet] = useState<"zone" | "languages" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = profile.data?.profile;
  // Board J3b: "Eastern · New York" — no zone of your own reads as the agency's, named.
  const agencyZone = profile.data?.agencyTimezone ?? null;
  const zoneWords = (zone: string) => (zone ? zoneLabel(zone) : agencyZone ? zoneLabel(agencyZone) : zoneLabel(null));
  const savedLangs = (langs.data?.languages ?? []).map(languageWord);
  // Both answers first, so a draft never starts from languages that had not arrived yet.
  const base: Draft | null = saved && langs.data ? { ...splitName(saved.name), phone: saved.phone ?? "", zone: saved.displayTimezone ?? AGENCY_ZONE, languages: savedLangs } : null;
  const d = draft ?? base;
  const set = (patch: Partial<Draft>) => { if (d) setDraft({ ...d, ...patch }); };

  async function save() {
    if (!d || !saved || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/app/profile", { method: "PATCH", body: { name: joinName(d.first, d.last), phone: d.phone.trim() || null, displayTimezone: d.zone || null } });
      if (langs.data?.available && d.languages.join("|") !== savedLangs.join("|")) {
        await api("/api/app/profile/languages", { method: "PUT", body: { languages: d.languages } });
      }
      await reloadMe().catch(() => undefined);
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const saveAction = IOS
    ? { key: "save", node: (
      <Pressable testID="profile-save" accessibilityRole="button" accessibilityLabel="Save" disabled={!d || busy} onPress={() => void save()} hitSlop={8}>
        {busy ? <ActivityIndicator color={p.greenInk} /> : <Text style={{ fontFamily: F.s, fontSize: 17, color: p.greenInk }}>Save</Text>}
      </Pressable>
    ) }
    : { icon: "check" as const, label: "Save", onPress: () => void save() };

  const picker = (label: string, value: string, open: () => void, testID: string) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={open}>
      <View pointerEvents="none"><Field label={label} value={value} editable={false} trailIcon="chevD" /></View>
    </Pressable>
  );

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: p.canvas }}>
      <Screen header={<Header title="Profile" back="Settings" onBack={router.back} large={false} actions={[saveAction]} />}>
        <LoadState loading={profile.loading || langs.loading} hasData={Boolean(d)} error={profile.error} errorCode={profile.errorCode} onRetry={profile.reload} what="your profile" />
        {d && saved ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 14 }}>
            <ProfilePhoto initials={initialsOf(joinName(d.first, d.last) || saved.email)} size={64} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}><Field testID="profile-first" label="First name" value={d.first} onChangeText={(t) => set({ first: t })} autoComplete="given-name" textContentType="givenName" /></View>
              <View style={{ flex: 1 }}><Field testID="profile-last" label="Last name" value={d.last} onChangeText={(t) => set({ last: t })} autoComplete="family-name" textContentType="familyName" /></View>
            </View>
            <Field testID="profile-phone" label="Work phone" leadIcon="phone" value={d.phone} onChangeText={(t) => set({ phone: t })} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />
            {picker("Time zone", zoneWords(d.zone), () => setSheet("zone"), "profile-zone")}
            {langs.data?.available ? picker("Languages", d.languages.join(", ") || "None yet", () => setSheet("languages"), "profile-languages") : null}
            {error ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
          </View>
        ) : null}
      </Screen>
      {d ? (
        <>
          <ChoiceSheet visible={sheet === "zone"} title="Time zone" selected={[d.zone]} onClose={() => setSheet(null)} onPick={(key) => set({ zone: key })}
            options={[{ key: AGENCY_ZONE, label: agencyZone ? `The agency’s · ${zoneLabel(agencyZone)}` : zoneLabel(null) }, ...(d.zone && !ZONES.some((z) => z.key === d.zone) ? [{ key: d.zone, label: zoneLabel(d.zone) }] : []), ...ZONES]} />
          <ChoiceSheet visible={sheet === "languages"} title="Languages" multi selected={d.languages} onClose={() => setSheet(null)}
            onPick={(key) => set({ languages: d.languages.includes(key) ? d.languages.filter((l) => l !== key) : [...d.languages, key] })}
            options={[...LANGUAGES, ...d.languages.filter((l) => !LANGUAGES.includes(l))].map((l) => ({ key: l, label: l }))} />
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}
