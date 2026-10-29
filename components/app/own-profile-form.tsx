"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Advanced, FieldRow, FormSection, FormSections } from "@/components/app/settings/patterns";
import { Callout, DraftActions, Field, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { WORKSPACE_TIMEZONES } from "@/lib/agencyProfile/types";
import { notify } from "@/lib/notify";
import { LANGUAGE_CODES, languageKey, languageName } from "@/lib/transferInbox/constants";
import { AVATAR_TYPES, avatarFileProblem } from "@/lib/users/avatarRules";
import { LICENCE_NUMBER_MAX, OWN_NAME_MAX, OWN_PHONE_MAX, type OwnProfile } from "@/lib/users/ownProfile";

/**
 * Settings › My profile › About you (settings redesign R4, 2026-10-29). One draft and one save bar for
 * the whole tab: name, phone, licence numbers, the languages you speak and your time zone. It was two
 * forms with two Save buttons (the profile, then the languages).
 *
 * Email is shown, not edited: it is the sign-in, changed under Signing in with its own confirmation.
 * Licensed states are shown, not edited: the owner records them on Team & access; the person fills in
 * the numbers. The photo saves on its own the moment a file is chosen (choosing is the decision).
 */

/** The languages callers most often ask for, in the words the database reads (languageKey). */
const COMMON_LANGUAGES = Object.values(LANGUAGE_CODES);

/** Time zones in words; the stored value stays the IANA name. */
const ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern (New York)",
  "America/Chicago": "Central (Chicago)",
  "America/Denver": "Mountain (Denver)",
  "America/Phoenix": "Arizona (Phoenix)",
  "America/Los_Angeles": "Pacific (Los Angeles)",
  "America/Anchorage": "Alaska (Anchorage)",
  "Pacific/Honolulu": "Hawaii (Honolulu)",
  "America/Puerto_Rico": "Atlantic (Puerto Rico)",
};
const zoneName = (zone: string) => ZONE_NAMES[zone] ?? zone.replace(/_/g, " ");

/** A US number in the form people read it; anything else as it was typed. */
function readablePhone(value: string | null) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 && /^\+?1?[\d ().-]+$/.test(value) ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : value;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value));

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** The photo (or the initials), Upload and Remove. Saves straight away. */
function ProfilePicture({ name, version, onChange }: { name: string; version: string | null; onChange: (version: string | null) => void }) {
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function upload(file: File) {
    const refused = avatarFileProblem(file);
    if (refused) { setProblem(refused); return; }
    setBusy("upload");
    setProblem(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/app/profile/avatar", { method: "POST", body: form });
      const result = (await response.json().catch(() => null)) as { avatar?: { version: string }; error?: string } | null;
      if (!response.ok || !result?.avatar) { setProblem(result?.error ?? "Your picture could not be saved."); return; }
      onChange(result.avatar.version);
      notify.done("Profile picture updated");
    } catch {
      setProblem("Your picture could not be uploaded. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("remove");
    setProblem(null);
    try {
      const response = await fetch("/api/app/profile/avatar", { method: "DELETE" });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) { setProblem(result?.error ?? "Your picture could not be removed."); return; }
      onChange(null);
      notify.done("Profile picture removed");
    } catch {
      setProblem("Your picture could not be removed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-base font-semibold text-[var(--accent-ink)]">
        {version
          // eslint-disable-next-line @next/next/no-img-element -- a session-bound redirect to a signed URL; next/image cannot optimise it
          ? <img src={`/api/app/profile/avatar?v=${encodeURIComponent(version)}`} alt="Your profile picture" className="size-full object-cover" />
          : <span aria-hidden="true">{initialsOf(name)}</span>}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" disabled={busy !== null}>
            <label className="cursor-pointer">
              <Upload aria-hidden="true" />
              {busy === "upload" ? "Uploading…" : version ? "Change photo" : "Upload photo"}
              <input
                type="file"
                accept={AVATAR_TYPES.join(",")}
                className="sr-only"
                disabled={busy !== null}
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }}
              />
            </label>
          </Button>
          {version && <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void remove()}>{busy === "remove" ? "Removing…" : "Remove"}</Button>}
        </div>
        {problem
          ? <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{problem}</p>
          : <p className="m-0 text-xs text-[var(--muted)]">JPG, PNG or WebP, up to 2 MB. Saved as soon as you choose it.</p>}
      </div>
    </div>
  );
}

type Languages = { saved: string[]; available: boolean } | { error: string } | null;

export function OwnProfileForm({ initial }: { initial: OwnProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(readablePhone(initial.phone));
  const [npn, setNpn] = useState(initial.npn ?? "");
  const [numbers, setNumbers] = useState<Record<string, string>>(initial.licenceNumbers);
  const [timezone, setTimezone] = useState(initial.displayTimezone ?? "");
  const [languages, setLanguages] = useState<Languages>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile/languages", { cache: "no-store" }).then(async (response) => {
      const body = (await response.json().catch(() => null)) as { languages?: string[]; available?: boolean; error?: string } | null;
      if (!live) return;
      if (!response.ok) { setLanguages({ error: body?.error ?? "Your languages could not be loaded." }); return; }
      const keys = (body?.languages ?? []).map((value) => languageKey(value) ?? value);
      setLanguages({ saved: keys, available: body?.available !== false });
      setPicked(keys);
    });
    return () => { live = false; };
  }, []);

  const states = useMemo(() => profile.licensedStates ?? [], [profile.licensedStates]);
  const savedLanguages = languages && "saved" in languages ? languages.saved : null;
  const languagesOpen = languages !== null && "saved" in languages && languages.available;

  // What changed, field by field: the save bar says how many, and Save sends only what changed.
  const changes = useMemo(() => {
    const list: string[] = [];
    if (name.trim() !== profile.name) list.push("name");
    if (phone.trim() !== readablePhone(profile.phone)) list.push("phone");
    if ((timezone || null) !== profile.displayTimezone) list.push("timezone");
    if (profile.licenceNumbersReady) {
      if ((npn.trim() || null) !== profile.npn) list.push("npn");
      for (const state of states) if ((numbers[state] ?? "").trim() !== (profile.licenceNumbers[state] ?? "")) list.push(`licence-${state}`);
    }
    if (savedLanguages && !sameSet(savedLanguages, picked)) list.push("languages");
    return list;
  }, [name, phone, timezone, npn, numbers, picked, profile, states, savedLanguages]);
  const dirty = changes.length > 0;

  function discard() {
    setName(profile.name);
    setPhone(readablePhone(profile.phone));
    setTimezone(profile.displayTimezone ?? "");
    setNpn(profile.npn ?? "");
    setNumbers(profile.licenceNumbers);
    setPicked(savedLanguages ?? []);
    setOther("");
    setError(null);
  }

  const toggleLanguage = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  const addOther = () => {
    const key = languageKey(other.trim());
    if (!key) return;
    if (!picked.includes(key)) setPicked((current) => [...current, key]);
    setOther("");
  };

  async function save() {
    setSaving(true);
    setError(null);
    const problems: string[] = [];
    try {
      const profileChanged = changes.some((change) => change !== "languages");
      if (profileChanged) {
        const body: Record<string, unknown> = { name, phone, displayTimezone: timezone || null };
        // Only sent when they can be stored, so a pending migration never blocks a phone correction.
        if (profile.licenceNumbersReady) {
          body.npn = npn;
          body.licenceNumbers = Object.fromEntries(states.map((state) => [state, numbers[state] ?? ""]));
        }
        const response = await fetch("/api/app/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const result = (await response.json().catch(() => null)) as { profile?: OwnProfile; error?: string } | null;
        if (!response.ok || !result?.profile) {
          problems.push(result?.error ?? "Your details could not be saved.");
        } else {
          setProfile(result.profile);
          setName(result.profile.name);
          setPhone(readablePhone(result.profile.phone));
          setTimezone(result.profile.displayTimezone ?? "");
          setNpn(result.profile.npn ?? "");
          setNumbers(result.profile.licenceNumbers);
        }
      }
      if (changes.includes("languages")) {
        const response = await fetch("/api/app/profile/languages", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languages: picked }) });
        const result = (await response.json().catch(() => null)) as { languages?: string[]; error?: string } | null;
        if (!response.ok) {
          problems.push(result?.error ?? "Your languages could not be saved.");
        } else {
          const keys = (result?.languages ?? picked).map((value) => languageKey(value) ?? value);
          setLanguages({ saved: keys, available: true });
          setPicked(keys);
        }
      }
      if (problems.length) setError(problems.join(" "));
      else notify.done("Profile saved");
      // The top bar's name and initials are drawn by the layout; refresh so they agree.
      router.refresh();
    } catch {
      setError("Your profile could not be saved. Nothing has changed; try again.");
    } finally {
      setSaving(false);
    }
  }

  const extraLanguages = picked.filter((key) => !COMMON_LANGUAGES.includes(key));
  const zones = timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(timezone) ? [timezone, ...WORKSPACE_TIMEZONES] : WORKSPACE_TIMEZONES;

  return (
    <form id="profile" onSubmit={(event) => { event.preventDefault(); if (dirty) void save(); }} className="flex min-w-0 flex-col gap-6">
      <LeaveGuard dirty={dirty} what="your profile" onDiscard={discard} />
      <FormSections>
        <FormSection id="profile-about" title="Your details" help="Your team sees your name and photo. Customers never see your phone.">
          <ProfilePicture
            name={profile.name}
            version={profile.avatarVersion}
            onChange={(version) => { setProfile((current) => ({ ...current, avatarVersion: version })); router.refresh(); }}
          />
          <FieldRow>
            <Field label="Name" htmlFor="profile-name">
              <input id="profile-name" className={control} value={name} maxLength={OWN_NAME_MAX} required autoComplete="name" onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="profile-phone" hint="Your team uses it to reach you.">
              <input id="profile-phone" className={control} type="tel" value={phone} maxLength={OWN_PHONE_MAX} autoComplete="tel" placeholder="(312) 555-0100" onChange={(event) => setPhone(event.target.value)} />
            </Field>
          </FieldRow>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="min-w-0">
              <span className="block text-label text-[var(--body)]">Sign-in email</span>
              <span className="mt-1 block truncate text-sm text-[var(--ink)]">{profile.email}</span>
            </span>
            <a href="#my-profile/security-email" className="text-sm font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Change it in Signing in</a>
          </div>
          <Advanced summary="Time zone" hint={timezone ? zoneName(timezone) : "The agency's"}>
            <Field label="Show times in" htmlFor="profile-timezone" hint={<>How times show for you only. Calling hours still follow each customer&apos;s state.</>}>
              <select id="profile-timezone" className={control} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                <option value="">The agency&apos;s time zone</option>
                {zones.map((zone) => <option key={zone} value={zone}>{zoneName(zone)}</option>)}
              </select>
            </Field>
          </Advanced>
        </FormSection>

        <FormSection id="profile-licences" title="Licence" help="Your own producer numbers. Your owner records the states you are licensed in, on Team & access.">
          {!profile.licenceNumbersReady ? (
            <Callout tone="warning" title="Licence numbers need a database update that has not been applied yet.">Your name and phone still save.</Callout>
          ) : (
            <>
              <FieldRow>
                <Field label="National producer number (NPN)" htmlFor="profile-npn">
                  <input id="profile-npn" className={`${control} font-mono tabular-nums`} inputMode="numeric" value={npn} maxLength={12} onChange={(event) => setNpn(event.target.value)} />
                </Field>
              </FieldRow>
              {profile.licensedStates === null ? (
                <p className="m-0 text-sm text-[var(--muted)]">Your licensed states cannot be read yet, so there are no state numbers to fill in.</p>
              ) : states.length === 0 ? (
                <p className="m-0 text-sm text-[var(--muted)]">No licensed states yet. Your owner adds them on Team &amp; access.</p>
              ) : (
                <FieldRow cols={states.length > 2 ? 3 : 2}>
                  {states.map((state) => (
                    <Field key={state} label={`${state} licence number`} htmlFor={`profile-licence-${state}`}>
                      <input
                        id={`profile-licence-${state}`}
                        className={`${control} font-mono tabular-nums`}
                        value={numbers[state] ?? ""}
                        maxLength={LICENCE_NUMBER_MAX}
                        onChange={(event) => setNumbers((current) => ({ ...current, [state]: event.target.value }))}
                      />
                    </Field>
                  ))}
                </FieldRow>
              )}
            </>
          )}
        </FormSection>

        <FormSection id="profile-languages" title="Languages you speak" help="Callers who speak one of these are offered to you first. Your manager sees the same list in Lead routing.">
          {languages === null ? (
            <p className="m-0 text-sm text-[var(--muted)]">Loading your languages…</p>
          ) : "error" in languages ? (
            <Callout tone="error" title={languages.error} />
          ) : (
            <>
              {!languages.available && <Callout tone="warning" title="Languages need a database update that has not been applied yet." />}
              <div role="group" aria-label="Languages you speak" className="flex flex-wrap gap-2">
                {[...COMMON_LANGUAGES, ...extraLanguages].map((key) => (
                  <ToggleChip key={key} selected={picked.includes(key)} disabled={!languagesOpen || saving} onClick={() => toggleLanguage(key)}>{languageName(key)}</ToggleChip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="profile-language-other" className="sr-only">Another language</label>
                <input id="profile-language-other" className={`${control} mt-0 w-56`} placeholder="Another language" value={other} disabled={!languagesOpen || saving} onChange={(event) => setOther(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addOther(); } }} />
                <Button type="button" variant="outline" disabled={!languagesOpen || saving || !other.trim()} onClick={addOther}>Add</Button>
              </div>
              {picked.length === 0 && <p className="m-0 text-xs text-[var(--muted)]">None listed: you are offered English-speaking callers first.</p>}
            </>
          )}
        </FormSection>
      </FormSections>

      {error && <Callout tone="error" title={error} />}
      <SettingsSaveBar visible={dirty} note={`${changes.length} unsaved change${changes.length === 1 ? "" : "s"}`}>
        <DraftActions dirty={dirty} saving={saving} onDiscard={discard} onSave={() => void save()} />
      </SettingsSaveBar>
    </form>
  );
}
