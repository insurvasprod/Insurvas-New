"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Upload } from "lucide-react";

import { Field, checkboxControl, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { WORKSPACE_TIMEZONES } from "@/lib/agencyProfile/types";
import { LANGUAGE_CODES, languageKey, languageName } from "@/lib/transferInbox/constants";
import { AVATAR_TYPES, avatarFileProblem } from "@/lib/users/avatarRules";
import { LICENCE_NUMBER_MAX, OWN_NAME_MAX, OWN_PHONE_MAX, type OwnProfile } from "@/lib/users/ownProfile";

/**
 * Settings › My profile › Profile. One draft for the section — name, phone, time zone, languages, NPN,
 * licence numbers and (settings round 8, board A) the photo — saved by the page's ONE save bar. The
 * photo used to save the moment a file was chosen, so the page had two ways to save; now choosing it
 * shows it here as a change, and Save uploads it.
 *
 * Email is shown, not edited: it is the sign-in, changed under Sign-in & security with its own
 * confirmation. Licensed states are shown, not edited: one home for licences (the producer record /
 * Team & access); the person fills in the numbers.
 *
 * useOwnProfileDraft holds the draft; OwnProfileFields draws it; My profile owns the save bar.
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

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

type Languages = { saved: string[]; available: boolean } | { error: string } | null;
/** The photo as drafted: a new file (shown from a local preview), removed, or unchanged (null). */
type PhotoDraft = { file: File; preview: string } | "remove" | null;

const CHANGE_WORDS: Record<string, string> = { name: "name", phone: "mobile phone", timezone: "time zone", npn: "NPN", languages: "languages", photo: "photo" };
export const profileChangeWord = (change: string) => CHANGE_WORDS[change] ?? (change.startsWith("licence-") ? `${change.slice(8)} licence number` : change);

export type OwnProfileDraft = ReturnType<typeof useOwnProfileDraft>;

export function useOwnProfileDraft(initial: OwnProfile) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(readablePhone(initial.phone));
  const [npn, setNpn] = useState(initial.npn ?? "");
  const [numbers, setNumbers] = useState<Record<string, string>>(initial.licenceNumbers);
  const [timezone, setTimezone] = useState(initial.displayTimezone ?? "");
  const [languages, setLanguages] = useState<Languages>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [photo, setPhotoState] = useState<PhotoDraft>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/profile/languages", { cache: "no-store" }).then(async (response) => {
      const body = (await response.json().catch(() => null)) as { languages?: string[]; available?: boolean; error?: string } | null;
      if (!live) return;
      if (!response.ok) { setLanguages({ error: body?.error ?? "Your languages could not be loaded." }); return; }
      const keys = (body?.languages ?? []).map((value) => languageKey(value) ?? value);
      setLanguages({ saved: keys, available: body?.available !== false });
      setPicked(keys);
    }).catch(() => { if (live) setLanguages({ error: "Your languages could not be loaded." }); });
    return () => { live = false; };
  }, []);

  // The local preview of a chosen photo lives until it is replaced, saved or discarded.
  useEffect(() => () => { if (photo && photo !== "remove") URL.revokeObjectURL(photo.preview); }, [photo]);

  const states = useMemo(() => profile.licensedStates ?? [], [profile.licensedStates]);
  const savedLanguages = languages && "saved" in languages ? languages.saved : null;

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
    if (photo === "remove" ? profile.avatarVersion !== null : photo !== null) list.push("photo");
    return list;
  }, [name, phone, timezone, npn, numbers, picked, profile, states, savedLanguages, photo]);

  function choosePhoto(file: File) {
    const refused = avatarFileProblem(file);
    if (refused) { setPhotoProblem(refused); return; }
    setPhotoProblem(null);
    setPhotoState({ file, preview: URL.createObjectURL(file) });
  }
  const removePhoto = () => { setPhotoProblem(null); setPhotoState(profile.avatarVersion ? "remove" : null); };

  function discard() {
    setName(profile.name);
    setPhone(readablePhone(profile.phone));
    setTimezone(profile.displayTimezone ?? "");
    setNpn(profile.npn ?? "");
    setNumbers(profile.licenceNumbers);
    setPicked(savedLanguages ?? []);
    setPhotoState(null);
    setPhotoProblem(null);
  }

  const toggleLanguage = (key: string) => setPicked((current) => (current.includes(key) ? current.filter((value) => value !== key) : [...current, key]));
  const addLanguage = (value: string) => {
    const key = languageKey(value.trim());
    if (!key) return false;
    if (!picked.includes(key)) setPicked((current) => [...current, key]);
    return true;
  };

  /** Saves what changed; resolves to the problems (empty when everything saved). */
  async function save(): Promise<string[]> {
    const problems: string[] = [];
    try {
      const profileChanged = changes.some((change) => change !== "languages" && change !== "photo");
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
          const saved = { ...result.profile, avatarVersion: profile.avatarVersion };
          setProfile(saved);
          setName(saved.name);
          setPhone(readablePhone(saved.phone));
          setTimezone(saved.displayTimezone ?? "");
          setNpn(saved.npn ?? "");
          setNumbers(saved.licenceNumbers);
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
      if (changes.includes("photo") && photo) {
        if (photo === "remove") {
          const response = await fetch("/api/app/profile/avatar", { method: "DELETE" });
          const result = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!response.ok) problems.push(result?.error ?? "Your picture could not be removed.");
          else { setProfile((current) => ({ ...current, avatarVersion: null })); setPhotoState(null); }
        } else {
          const form = new FormData();
          form.set("file", photo.file);
          const response = await fetch("/api/app/profile/avatar", { method: "POST", body: form });
          const result = (await response.json().catch(() => null)) as { avatar?: { version: string }; error?: string } | null;
          if (!response.ok || !result?.avatar) problems.push(result?.error ?? "Your picture could not be saved.");
          else { const version = result.avatar.version; setProfile((current) => ({ ...current, avatarVersion: version })); setPhotoState(null); }
        }
      }
      // The top bar's name, initials and photo are drawn by the layout; refresh so they agree.
      router.refresh();
    } catch {
      problems.push("Your profile could not be saved. Check your connection and try again.");
    }
    return problems;
  }

  /** What the status line should say about this section: database updates not applied, a list that did not load. */
  const notes: string[] = [];
  if (!profile.licenceNumbersReady) notes.push("licence numbers need a database update");
  if (languages && "error" in languages) notes.push(languages.error);
  if (languages && "available" in languages && !languages.available) notes.push("languages need a database update");

  return {
    profile, name, setName, phone, setPhone, npn, setNpn, numbers, setNumbers, timezone, setTimezone,
    languages, picked, toggleLanguage, addLanguage, photo, photoProblem, choosePhoto, removePhoto,
    states, changes, notes, discard, save,
  };
}

/** Languages as one dropdown of ticks, with a way to add one that is not listed. */
function LanguagePicker({ picked, options, disabled, onToggle, onAdd }: {
  picked: string[];
  options: string[];
  disabled: boolean;
  onToggle: (key: string) => void;
  onAdd: (name: string) => boolean;
}) {
  const [other, setOther] = useState("");
  const add = () => { if (onAdd(other)) setOther(""); };
  const summary = picked.length ? picked.map(languageName).join(", ") : "Choose languages";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button id="profile-languages" type="button" disabled={disabled} className={cn(control, "flex items-center justify-between gap-2 text-left", !picked.length && "text-[var(--muted)]")}>
          <span className="min-w-0 truncate">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-64 p-2">
        <div role="group" aria-label="Languages you speak" className="flex max-h-64 flex-col overflow-y-auto">
          {options.map((key) => (
            <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[8px] px-2 text-sm hover:bg-[var(--surface-alt)]">
              <input type="checkbox" className={checkboxControl} checked={picked.includes(key)} onChange={() => onToggle(key)} />
              <span className="min-w-0 flex-1 truncate">{languageName(key)}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] pt-2">
          <label htmlFor="profile-language-other" className="sr-only">Another language</label>
          <input id="profile-language-other" className={cn(control, "mt-0 min-w-0 flex-1")} placeholder="Another language" value={other} onChange={(event) => setOther(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
          <Button type="button" variant="outline" disabled={!other.trim()} onClick={add}>Add</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The photo (or the initials), Change and Remove. A choice is a change in the draft, saved by the bar. */
function ProfilePicture({ form, disabled }: { form: OwnProfileDraft; disabled: boolean }) {
  const { profile, photo, photoProblem, choosePhoto, removePhoto, name } = form;
  const shown = photo === "remove" ? null : photo ? photo.preview : profile.avatarVersion ? `/api/app/profile/avatar?v=${encodeURIComponent(profile.avatarVersion)}` : null;
  return (
    <div id="profile-about" className="mb-3.5 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span className="inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--highlight-soft)] text-base font-bold text-[var(--highlight-ink)]">
          {shown
            // eslint-disable-next-line @next/next/no-img-element -- a local preview, or a session-bound redirect to a signed URL; next/image cannot optimise either
            ? <img src={shown} alt="Your profile picture" className="size-full object-cover" />
            : <span aria-hidden="true">{initialsOf(name || profile.name)}</span>}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" disabled={disabled}>
              <label className="cursor-pointer">
                <Upload aria-hidden="true" />
                {shown ? "Change photo" : "Upload photo"}
                <input
                  type="file"
                  accept={AVATAR_TYPES.join(",")}
                  className="sr-only"
                  disabled={disabled}
                  onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) choosePhoto(file); }}
                />
              </label>
            </Button>
            {shown && <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={removePhoto}>Remove</Button>}
          </div>
          <p className="m-0 mt-1.5 text-xs text-[var(--muted)]">JPEG or PNG, square works best. Saves with the bar below.</p>
        </div>
        <p className="m-0 ml-auto min-w-0 truncate text-xs text-[var(--muted)]">
          Signs in as <span className="text-[var(--ink)]">{profile.email}</span> · <a href="#my-profile/security-email" className="font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Change in Sign-in &amp; security</a>
        </p>
      </div>
      {photoProblem && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{photoProblem}</p>}
    </div>
  );
}

/** The Profile section's fields, drawn from the page's draft. */
export function OwnProfileFields({ form, saving, recordHref }: { form: OwnProfileDraft; saving: boolean; recordHref: string | null }) {
  const { profile, languages, picked, timezone, states } = form;
  const languagesOpen = languages !== null && "saved" in languages && languages.available;
  const languagesReady = languages !== null && "saved" in languages;
  const extraLanguages = picked.filter((key) => !COMMON_LANGUAGES.includes(key));
  const zones = timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(timezone) ? [timezone, ...WORKSPACE_TIMEZONES] : WORKSPACE_TIMEZONES;
  const languageOptions = [...COMMON_LANGUAGES, ...extraLanguages];

  return (
    <div id="profile">
      <ProfilePicture form={form} disabled={saving} />
      <div className="grid min-w-0 gap-x-[18px] gap-y-3 @lg:grid-cols-2">
        <Field label="Full name" htmlFor="profile-name">
          <input id="profile-name" className={control} value={form.name} maxLength={OWN_NAME_MAX} required autoComplete="name" onChange={(event) => form.setName(event.target.value)} />
        </Field>
        <Field label="Mobile phone" htmlFor="profile-phone" hint="Yours. The agency line is on Business identity.">
          <input id="profile-phone" className={control} type="tel" value={form.phone} maxLength={OWN_PHONE_MAX} autoComplete="tel" placeholder="(312) 555-0100" onChange={(event) => form.setPhone(event.target.value)} />
        </Field>
        <Field label="Your time zone" htmlFor="profile-timezone" hint={<>How times show for you only. Calling hours still follow each customer&apos;s state.</>}>
          <select id="profile-timezone" className={control} value={timezone} onChange={(event) => form.setTimezone(event.target.value)}>
            <option value="">The agency&apos;s time zone</option>
            {zones.map((zone) => <option key={zone} value={zone}>{zoneName(zone)}</option>)}
          </select>
        </Field>
        <Field label="Languages you speak with clients" htmlFor="profile-languages" hint={languagesReady && picked.length === 0 ? "None listed: you are offered English-speaking callers first. Callers who speak a language you list are offered to you first." : "Callers who speak these are offered to you first."}>
          <LanguagePicker picked={picked} options={languageOptions} disabled={!languagesOpen || saving} onToggle={form.toggleLanguage} onAdd={form.addLanguage} />
        </Field>
        {profile.licenceNumbersReady && (
          <>
            <Field label="Your NPN" htmlFor="profile-npn">
              <input id="profile-npn" className={`${control} font-mono tabular-nums`} inputMode="numeric" value={form.npn} maxLength={12} onChange={(event) => form.setNpn(event.target.value)} />
            </Field>
            {states.map((state) => (
              <Field key={state} label={`${state} licence number`} htmlFor={`profile-licence-${state}`}>
                <input
                  id={`profile-licence-${state}`}
                  className={`${control} font-mono tabular-nums`}
                  value={form.numbers[state] ?? ""}
                  maxLength={LICENCE_NUMBER_MAX}
                  onChange={(event) => form.setNumbers((current) => ({ ...current, [state]: event.target.value }))}
                />
              </Field>
            ))}
          </>
        )}
        <div id="profile-states" className="min-w-0 @lg:col-span-2">
          <span className="text-label text-[var(--body)]">Licensed states</span>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {states.length
              ? states.map((state) => <span key={state} className="inline-flex h-[22px] items-center rounded-badge border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-medium text-[var(--body)]">{state}</span>)
              : <span className="text-sm text-[var(--muted)]">{profile.licensedStates === null ? "Cannot be read yet" : "None yet"}</span>}
            {recordHref
              ? <Link href={recordHref} className="text-xs font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline">Change on your producer record ›</Link>
              : null}
          </div>
          <span className="mt-1.5 block text-xs leading-[1.5] text-[var(--muted)]">
            {recordHref ? "Read-only here: one home for licences, on your producer record." : "Read-only here: your owner records them on Team & access."}
          </span>
        </div>
      </div>
    </div>
  );
}
