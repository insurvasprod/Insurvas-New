"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LICENCE_NUMBER_MAX, OWN_NAME_MAX, OWN_PHONE_MAX, type OwnProfile } from "@/lib/users/ownProfile";
import { AVATAR_TYPES, avatarFileProblem } from "@/lib/users/avatarRules";
import { notify } from "@/lib/notify";
import { control } from "@/components/app/settings/primitives";
import { WORKSPACE_TIMEZONES } from "@/lib/agencyProfile/types";
import { Upload } from "lucide-react";
import { LeaveGuard } from "@/components/ui/leave-guard";

/**
 * The profile form: identity on top, producer numbers below, one Save.
 *
 * Email is shown, not edited — it is the sign-in, and changing it is an account change with its own
 * confirmation, not a profile field. Licensed states are shown, not edited — the owner records
 * them on Team & access and assignment reads them. The person fills in the numbers.
 */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/**
 * The profile picture: the photo (or the initials), Upload photo and Remove. It saves on its own,
 * straight away — choosing a file is the decision, so it does not wait for Save profile.
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
    <div className="flex items-center gap-4 sm:col-span-2">
      <span className="inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary-soft)] text-lg font-semibold text-[var(--accent-ink)]">
        {version
          // eslint-disable-next-line @next/next/no-img-element -- a session-bound redirect to a signed URL; next/image cannot optimise it
          ? <img src={`/api/app/profile/avatar?v=${encodeURIComponent(version)}`} alt="Your profile picture" className="size-full object-cover" />
          : <span aria-hidden="true">{initialsOf(name)}</span>}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
        {problem
          ? <p role="alert" className="text-xs text-[var(--error-ink)]">{problem}</p>
          : <p className="text-xs text-[var(--muted)]">JPG, PNG or WebP, up to 2 MB. Shown in the top bar.</p>}
      </div>
    </div>
  );
}

export function OwnProfileForm({ initial }: { initial: OwnProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [npn, setNpn] = useState(initial.npn ?? "");
  const [numbers, setNumbers] = useState<Record<string, string>>(initial.licenceNumbers);
  const [timezone, setTimezone] = useState(initial.displayTimezone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const states = profile.licensedStates ?? [];
  const dirty =
    name.trim() !== profile.name ||
    (phone.trim() || null) !== profile.phone ||
    (timezone || null) !== profile.displayTimezone ||
    (profile.licenceNumbersReady && ((npn.trim() || null) !== profile.npn ||
      states.some((state) => (numbers[state] ?? "").trim() !== (profile.licenceNumbers[state] ?? ""))));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, phone, displayTimezone: timezone || null };
      // Only sent when they can be stored, so a pending migration never blocks a phone correction.
      if (profile.licenceNumbersReady) {
        body.npn = npn;
        body.licenceNumbers = Object.fromEntries(states.map((state) => [state, numbers[state] ?? ""]));
      }
      const response = await fetch("/api/app/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => null)) as { profile?: OwnProfile; error?: string } | null;
      if (!response.ok || !result?.profile) {
        setError(result?.error ?? "Your profile could not be saved.");
        // A partial save (name and phone stored, numbers not) is still news to the top bar.
        router.refresh();
        return;
      }
      setProfile(result.profile);
      setName(result.profile.name);
      setPhone(result.profile.phone ?? "");
      setTimezone(result.profile.displayTimezone ?? "");
      setNpn(result.profile.npn ?? "");
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

  return (
    <form onSubmit={(event) => void save(event)} className="flex max-w-[720px] flex-col gap-6">
      <LeaveGuard dirty={dirty} what="your profile" onDiscard={() => { setName(profile.name); setPhone(profile.phone ?? ""); setTimezone(profile.displayTimezone ?? ""); setNpn(profile.npn ?? ""); setNumbers(profile.licenceNumbers); setError(null); }} />
      <section aria-labelledby="profile-identity" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id="profile-identity" className="text-base font-semibold text-[var(--ink)]">Name and contact</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{profile.roleLabel} · {profile.workspaceName}</p>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <ProfilePicture
            name={profile.name}
            version={profile.avatarVersion}
            onChange={(version) => { setProfile((current) => ({ ...current, avatarVersion: version })); router.refresh(); }}
          />
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" value={name} maxLength={OWN_NAME_MAX} required autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={profile.email} readOnly aria-describedby="profile-email-hint" />
            <p id="profile-email-hint" className="text-xs text-[var(--muted)]">Your sign-in. Change it under Sign-in and security.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input id="profile-phone" type="tel" value={phone} maxLength={OWN_PHONE_MAX} autoComplete="tel" placeholder="(312) 555-0100" onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-timezone">Display timezone</Label>
            <select id="profile-timezone" className={`${control} mt-0`} value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-describedby="profile-timezone-hint">
              <option value="">The agency&apos;s timezone</option>
              {(timezone && !(WORKSPACE_TIMEZONES as readonly string[]).includes(timezone) ? [timezone, ...WORKSPACE_TIMEZONES] : WORKSPACE_TIMEZONES).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <p id="profile-timezone-hint" className="text-xs text-[var(--muted)]">How times show for you only. Calling hours still follow each customer&apos;s state.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="profile-licences" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id="profile-licences" className="text-base font-semibold text-[var(--ink)]">Licence numbers</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">Your own producer numbers.</p>
        </header>
        {!profile.licenceNumbersReady ? (
          <div className="px-5 py-4">
            <p role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
              Licence numbers need a database update that has not been applied yet. Your name and phone still save.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex max-w-[280px] flex-col gap-1.5">
              <Label htmlFor="profile-npn">National Producer Number</Label>
              <Input id="profile-npn" inputMode="numeric" value={npn} maxLength={12} onChange={(event) => setNpn(event.target.value)} />
            </div>
            {profile.licensedStates === null ? (
              <p className="text-sm text-[var(--body)]">Your licensed states cannot be read yet, so there are no state numbers to fill in.</p>
            ) : states.length === 0 ? (
              <p className="text-sm text-[var(--body)]">No licensed states recorded yet. Your owner adds them on Team &amp; access.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {states.map((state) => (
                  <div key={state} className="flex flex-col gap-1.5">
                    <Label htmlFor={`profile-licence-${state}`}>{state} licence number</Label>
                    <Input
                      id={`profile-licence-${state}`}
                      value={numbers[state] ?? ""}
                      maxLength={LICENCE_NUMBER_MAX}
                      onChange={(event) => setNumbers((current) => ({ ...current, [state]: event.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {error && <p role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || !dirty} aria-busy={saving}>{saving ? "Saving…" : "Save profile"}</Button>
        {!dirty && !saving && <span className="text-xs text-[var(--muted)]">No unsaved changes</span>}
      </div>
    </form>
  );
}
