"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LICENCE_NUMBER_MAX, OWN_NAME_MAX, OWN_PHONE_MAX, type OwnProfile } from "@/lib/users/ownProfile";
import { notify } from "@/lib/notify";

/**
 * The profile form: identity on top, producer numbers below, one Save.
 *
 * Email is shown, not edited — it is the sign-in, and changing it is an account change with its own
 * confirmation, not a profile field. Licensed states are shown, not edited — the owner records
 * them on Team & access and assignment reads them. The person fills in the numbers.
 */
export function OwnProfileForm({ initial }: { initial: OwnProfile }) {
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [npn, setNpn] = useState(initial.npn ?? "");
  const [numbers, setNumbers] = useState<Record<string, string>>(initial.licenceNumbers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const states = profile.licensedStates ?? [];
  const dirty =
    name.trim() !== profile.name ||
    (phone.trim() || null) !== profile.phone ||
    (profile.licenceNumbersReady && ((npn.trim() || null) !== profile.npn ||
      states.some((state) => (numbers[state] ?? "").trim() !== (profile.licenceNumbers[state] ?? ""))));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { name, phone };
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
      <section aria-labelledby="profile-identity" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id="profile-identity" className="text-base font-semibold text-[var(--ink)]">Name and contact</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{profile.roleLabel} · {profile.workspaceName}</p>
        </header>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" value={name} maxLength={OWN_NAME_MAX} required autoComplete="name" onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={profile.email} readOnly aria-describedby="profile-email-hint" />
            <p id="profile-email-hint" className="text-xs text-[var(--muted)]">Your sign-in. Ask your owner to change it.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-phone">Phone</Label>
            <Input id="profile-phone" type="tel" value={phone} maxLength={OWN_PHONE_MAX} autoComplete="tel" placeholder="(312) 555-0100" onChange={(event) => setPhone(event.target.value)} />
          </div>
        </div>
      </section>

      <section aria-labelledby="profile-licences" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h2 id="profile-licences" className="text-base font-semibold text-[var(--ink)]">Licence numbers</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">Your own producer numbers. The agency&rsquo;s licences stay in Settings.</p>
        </header>
        {!profile.licenceNumbersReady ? (
          <p className="px-5 py-4 text-sm text-[var(--body)]">
            Licence numbers need a database update that has not been applied to this workspace yet. Your name and phone still save.
          </p>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex max-w-[280px] flex-col gap-1.5">
              <Label htmlFor="profile-npn">National Producer Number</Label>
              <Input id="profile-npn" inputMode="numeric" value={npn} maxLength={12} onChange={(event) => setNpn(event.target.value)} />
            </div>
            {profile.licensedStates === null ? (
              <p className="text-sm text-[var(--body)]">Your licensed states cannot be read yet, so there are no state numbers to fill in.</p>
            ) : states.length === 0 ? (
              <p className="text-sm text-[var(--body)]">
                You are not recorded as licensed in any state yet. Your owner records your states on Team &amp; access; a field for each one appears here.
              </p>
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

      {error && <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving || !dirty} aria-busy={saving}>{saving ? "Saving…" : "Save profile"}</Button>
        {!dirty && !saving && <span className="text-xs text-[var(--muted)]">No unsaved changes</span>}
      </div>
    </form>
  );
}
