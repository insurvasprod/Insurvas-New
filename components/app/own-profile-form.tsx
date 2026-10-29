"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LICENCE_NUMBER_MAX, OWN_NAME_MAX, OWN_PHONE_MAX, type OwnProfile } from "@/lib/users/ownProfile";
import { AVATAR_TYPES, avatarFileProblem } from "@/lib/users/avatarRules";
import { notify } from "@/lib/notify";
import { control } from "@/components/app/settings/primitives";
import { WORKSPACE_TIMEZONES } from "@/lib/agencyProfile/types";
import { US_STATES } from "@/lib/signup/constants";
import { missingLicenceStates } from "@/lib/users/profileStatus";
import { cn } from "@/lib/utils";
import { ProfileRow, RowCard } from "@/components/app/profile/row";
import { Upload } from "lucide-react";

/**
 * My profile › About you (redesign 2026-10-27, layout B): one card of rows — a name on the left, the
 * value edited where it sits, actions on the right — and one save bar that appears only when
 * something changed, saying what.
 *
 * Email is shown, not edited — it is the sign-in, and changing it is an account change with its own
 * confirmation, under Signing in. Licensed states are shown, not edited — the owner records them on
 * Team & access and assignment reads them. The person fills in the numbers.
 *
 * The NPN is no longer on this page (owner decision, 2026-10-27). Its stored value is sent back as it
 * was, because the save treats a missing NPN as "clear it" and nothing here may change it.
 */
const STATE_NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
const stateName = (code: string) => STATE_NAMES.get(code) ?? code;

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * The profile picture row: the photo (or the initials), Change photo and Remove. It saves on its own,
 * straight away — choosing a file is the decision, so it does not wait for the save bar.
 */
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
    <ProfileRow
      label="Photo"
      actions={
        <>
          <Button asChild variant="outline" disabled={busy !== null}>
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
          {version && <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void remove()}>{busy === "remove" ? "Removing…" : "Remove"}</Button>}
        </>
      }
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-sm font-semibold text-[var(--accent-ink)]">
          {version
            // eslint-disable-next-line @next/next/no-img-element -- a session-bound redirect to a signed URL; next/image cannot optimise it
            ? <img src={`/api/app/profile/avatar?v=${encodeURIComponent(version)}`} alt="Your profile picture" className="size-full object-cover" />
            : <span aria-hidden="true">{initialsOf(name)}</span>}
        </span>
        {problem
          ? <p role="alert" className="text-xs text-[var(--error-ink)]">{problem}</p>
          : <p className="text-xs leading-[1.45] text-[var(--muted)]">JPG, PNG or WebP, up to 2 MB. Saves as soon as you pick it; your team sees it.</p>}
      </div>
    </ProfileRow>
  );
}

export function OwnProfileForm({ initial, onSaved, onChangeEmail }: {
  initial: OwnProfile;
  /** My profile's tab status reads the saved profile, so a filled-in number clears its warning. */
  onSaved?: (profile: OwnProfile) => void;
  /** Email changes under Signing in; the Email row's Change goes there. */
  onChangeEmail?: () => void;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [numbers, setNumbers] = useState<Record<string, string>>(initial.licenceNumbers);
  const [timezone, setTimezone] = useState(initial.displayTimezone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const states = profile.licensedStates ?? [];
  const missing = new Set(missingLicenceStates(profile));
  // What is not saved yet, by the name the reader sees on the row — the save bar lists it.
  const changed = [
    name.trim() !== profile.name && "Name",
    (phone.trim() || null) !== profile.phone && "Phone",
    (timezone || null) !== profile.displayTimezone && "Time zone",
    ...(profile.licenceNumbersReady ? states.filter((state) => (numbers[state] ?? "").trim() !== (profile.licenceNumbers[state] ?? "")).map((state) => `${stateName(state)} number`) : []),
  ].filter((item): item is string => Boolean(item));
  const dirty = changed.length > 0;

  function discard() {
    setName(profile.name);
    setPhone(profile.phone ?? "");
    setTimezone(profile.displayTimezone ?? "");
    setNumbers(profile.licenceNumbers);
    setError(null);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, phone, displayTimezone: timezone || null };
      // Only sent when they can be stored, so a pending migration never blocks a phone correction.
      if (profile.licenceNumbersReady) {
        body.npn = profile.npn;
        body.licenceNumbers = Object.fromEntries(states.map((state) => [state, numbers[state] ?? ""]));
      }
      const response = await fetch("/api/app/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => null)) as { profile?: OwnProfile; error?: string } | null;
      if (!response.ok || !result?.profile) {
        setError(result?.error ?? "Your profile could not be saved.");
        // A partial save (name and phone stored, numbers not): read back what was kept, so the save
        // bar lists only what is still unsaved, and the top bar agrees.
        const reread = await fetch("/api/app/profile", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { profile?: OwnProfile } | null;
        if (reread?.profile) { setProfile(reread.profile); onSaved?.(reread.profile); }
        router.refresh();
        return;
      }
      setProfile(result.profile);
      onSaved?.(result.profile);
      setName(result.profile.name);
      setPhone(result.profile.phone ?? "");
      setTimezone(result.profile.displayTimezone ?? "");
      setNumbers(result.profile.licenceNumbers);
      notify.done("Profile saved");
      // The top bar's name and initials are drawn by the layout; refresh so they agree.
      router.refresh();
    } catch {
      setError("Your profile could not be saved. Nothing has changed; try again.");
    } finally {
      setSaving(false);
    }
  }

  const filled = states.length - missing.size;

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      <RowCard id="profile-about" title="About you" sub="Your team sees your name and photo. Customers never see your phone.">

        <ProfilePicture
          name={profile.name}
          version={profile.avatarVersion}
          onChange={(version) => {
            // The photo saves on its own: the header and the page's copy of the profile follow it too.
            const next = { ...profile, avatarVersion: version };
            setProfile(next);
            onSaved?.(next);
            router.refresh();
          }}
        />
        <ProfileRow label="Name" htmlFor="profile-name">
          <Input id="profile-name" className="max-w-[420px]" value={name} maxLength={OWN_NAME_MAX} required autoComplete="name" onChange={(event) => setName(event.target.value)} />
        </ProfileRow>
        <ProfileRow label="Phone" htmlFor="profile-phone">
          <Input id="profile-phone" className="max-w-[420px]" type="tel" value={phone} maxLength={OWN_PHONE_MAX} autoComplete="tel" placeholder="(312) 555-0100" onChange={(event) => setPhone(event.target.value)} />
        </ProfileRow>
        <ProfileRow label="Your time zone" htmlFor="profile-timezone">
          <select id="profile-timezone" className={`${control} mt-0 w-full max-w-[420px]`} value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-describedby="profile-timezone-hint">
            <option value="">The agency&apos;s time zone</option>
            {(timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(timezone) ? [timezone, ...WORKSPACE_TIMEZONES] : WORKSPACE_TIMEZONES).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <p id="profile-timezone-hint" className="mt-1.5 text-xs text-[var(--muted)]">How times show for you only. Calling hours still follow each customer&apos;s state.</p>
        </ProfileRow>
        <ProfileRow label="Email" actions={onChangeEmail && <Button type="button" variant="ghost" onClick={onChangeEmail}>Change</Button>}>
          <p className="truncate text-sm text-[var(--body)]">{profile.email}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">It&apos;s how you sign in, so it changes under Signing in.</p>
        </ProfileRow>
        <ProfileRow
          top
          label={
            <>
              Licence numbers
              {profile.licenceNumbersReady && states.length > 0 && (
                <span className={cn("block text-xs font-semibold", missing.size ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>{filled} of {states.length} filled</span>
              )}
            </>
          }
        >
          {!profile.licenceNumbersReady ? (
            <p role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
              Licence numbers need a database update that has not been applied yet. Your name and phone still save.
            </p>
          ) : profile.licensedStates === null ? (
            <p className="text-sm text-[var(--body)] sm:pt-2">Your licensed states cannot be read yet, so there are no state numbers to fill in.</p>
          ) : states.length === 0 ? (
            <p className="text-sm text-[var(--body)] sm:pt-2">No licensed states recorded yet. Your owner adds them on Team &amp; access.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
                {states.map((state) => {
                  const empty = missing.has(state) && !(numbers[state] ?? "").trim();
                  return (
                    <div key={state} className="flex flex-col gap-1">
                      <label htmlFor={`profile-licence-${state}`} className="text-sm font-semibold text-[var(--ink)]">{stateName(state)}</label>
                      <Input
                        id={`profile-licence-${state}`}
                        value={numbers[state] ?? ""}
                        maxLength={LICENCE_NUMBER_MAX}
                        aria-describedby={empty ? `profile-licence-${state}-empty` : undefined}
                        className={cn(empty && "border-[var(--warning)] bg-[var(--warning-surface)]")}
                        onChange={(event) => setNumbers((current) => ({ ...current, [state]: event.target.value }))}
                      />
                      {empty && <span id={`profile-licence-${state}-empty`} className="text-xs font-semibold text-[var(--warning-ink)]">Not filled in</span>}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted)]">Your own number for each state you&apos;re licensed in. Licensed somewhere else too? Your owner adds states on Team &amp; access.</p>
            </div>
          )}
        </ProfileRow>
      </RowCard>

      {error && <p role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* The one save: only there when something changed, and it says what. Sticks to the bottom of
          the window so it is in reach from any row. */}
      {(dirty || saving) && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[var(--ink)] py-2.5 pr-3 pl-4 text-[var(--surface)] shadow-[var(--shadow-hover)]">
          {/* Said once to a screen reader, not on every keystroke; the list below is for the eye. */}
          <span role="status" className="sr-only">You have changes that are not saved.</span>
          <span aria-hidden="true" className="text-sm font-semibold">Not saved yet: {changed.join(", ")}</span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={discard} className="text-[var(--surface)] hover:bg-transparent hover:text-[var(--surface)] hover:underline">Discard</Button>
            <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? "Saving…" : "Save"}</Button>
          </span>
        </div>
      )}
    </form>
  );
}
