"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { control, Field } from "@/components/ui/field";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { API_SCOPES, DEFAULT_ROTATION_OVERLAP_HOURS, IDLE_DAYS, KEY_EXPIRY_DAYS, KEY_PRESETS, ROTATION_OVERLAP_HOURS, type ApiKeyView, type ApiScope } from "@/lib/apiKeys/constants";
import { canDoWords, daysSince, requestSample, samplePath, type SampleLanguage } from "@/lib/apiKeys/hub";
import { dateTime, dayMonth, dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { notify } from "@/lib/notify";
import { ChoiceCard, CodeCard, send, ShownOnce, Steps, TickCard, whenWords } from "./shared";

/**
 * Settings › Integrations, round 8 option A · the key's pop-ups: the new-key steps (A4–A6), rotate
 * with overlap and revoke by name (A7), and the 90-day idle question (A8).
 */

const STEPS = ["Name", "What it can do", "Ends", "Key shown once"];
type PresetKey = (typeof KEY_PRESETS)[number]["key"];

/** The key, shown once, with a ready request and "I've copied it". Shared by the new-key steps and rotation. */
function KeyShownOnce({ apiKey, scopes, origin, presetLabel, copied, onCopied }: { apiKey: string; scopes: readonly ApiScope[]; origin: string; presetLabel: string | null; copied: boolean; onCopied: (value: boolean) => void }) {
  const [language, setLanguage] = useState<SampleLanguage>("curl");
  return (
    <div className="flex flex-col gap-3">
      <ShownOnce label="Your key" value={apiKey} copyLabel="Copy key" />
      <p className="m-0 text-center text-xs text-[var(--muted)]">This is the only time the full key is shown. We keep a fingerprint, never the key. If it&rsquo;s lost, rotate it.</p>
      <div className="border-t border-[var(--border)] pt-3">
        <p className="m-0 text-sm font-semibold text-[var(--ink)]">{presetLabel ? `Paste it into ${presetLabel}` : "Paste it into the app"}</p>
        <p className="m-0 mt-0.5 mb-2 text-xs text-[var(--muted)]">Where the app asks for an API key, paste it. Or test it yourself:</p>
        <CodeCard code={requestSample(language, origin, apiKey, samplePath(scopes))} language={language} onLanguage={setLanguage} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--body)]">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={copied} onChange={(event) => onCopied(event.target.checked)} />
        I&rsquo;ve copied the key somewhere safe
      </label>
    </div>
  );
}

async function leaveKey(copied: boolean) {
  return copied || confirmAction({ title: "Close without the key?", description: "Closing hides the key for good. If it wasn't copied, rotate it to get a new one.", confirmLabel: "Close anyway", cancelLabel: "Go back" });
}

/** New API key: name (with app presets) → what it can do → ends → the key, shown once. */
export function NewKeyWizard({ origin, onClose, onCreated }: { origin: string; onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(0);
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState<PresetKey | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [days, setDays] = useState<number | null>(90);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; record: ApiKeyView } | null>(null);
  const [copied, setCopied] = useState(false);
  const presetItem = KEY_PRESETS.find((item) => item.key === preset) ?? null;
  const presetLabel = presetItem && presetItem.key !== "other" ? presetItem.label : null;
  const name = label.trim() || "this key";
  const zone = viewerTimeZone();
  const [openedAt] = useState(() => Date.now());
  const dayIn = (n: number) => dayMonthYear(new Date(openedAt + n * 86_400_000).toISOString(), zone);

  function pickPreset(key: PresetKey) {
    const item = KEY_PRESETS.find((entry) => entry.key === key);
    if (!item) return;
    const wasPreset = KEY_PRESETS.some((entry) => entry.label === label.trim());
    setPreset(key);
    if ((!label.trim() || wasPreset) && key !== "other") setLabel(item.label);
    setScopes([...item.scopes]);
  }

  async function make() {
    setSaving(true);
    setError(null);
    try {
      const result = await send<{ key: string; record: ApiKeyView }>("/api/app/api-keys", "POST", { label: label.trim(), scopes, expiresInDays: days });
      setMade(result);
      setStep(3);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not make the key");
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (made && !(await leaveKey(copied))) return;
    onClose();
  }

  const title = step === 0 ? "What will use this key?" : step === 1 ? `What can ${name} do?` : step === 2 ? "When should it stop working?" : `${made?.record.label ?? name} is ready`;
  const description = step === 0 ? "Name it after the app, so anyone can tell what breaks if it's revoked."
    : step === 1 ? (presetLabel ? `Pre-ticked for ${presetLabel}. Choose only what it needs.` : "Choose only what it needs.")
      : step === 2 ? "An end date is a good idea for anything temporary."
        : `${canDoWords(made?.record.scopes ?? scopes)} · ${made?.record.expiresAt ? `ends ${dayMonth(made.record.expiresAt, zone)}` : "no end date"}`;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) void close(); }}>
      <DialogContent size={step === 0 || step === 2 ? "md" : "xl"} className="max-h-[calc(100vh-4rem)] overflow-y-auto">
        <DialogHeader>
          <Steps steps={STEPS} at={step} />
          <DialogTitle className="mt-2">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Field label="Name" htmlFor="new-key-name" hint="Picking an app ticks what it usually needs on the next step. You can change it.">
              <input id="new-key-name" className={control} value={label} maxLength={80} autoFocus autoComplete="off" placeholder="Zapier · new policies" onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Start from">
              <span className="text-xs text-[var(--muted)]">Start from</span>
              {KEY_PRESETS.map((item) => <ToggleChip key={item.key} role="radio" selected={preset === item.key} onClick={() => pickPreset(item.key)}>{item.label}</ToggleChip>)}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-2">
            {(["read", "change"] as const).map((group) => (
              <div key={group} className="flex flex-col gap-2">
                <span className="mt-1 text-xs font-semibold text-[var(--ink)]">{group === "read" ? "Read" : "Change"}</span>
                {API_SCOPES.filter((scope) => scope.group === group).map((scope) => (
                  <TickCard
                    key={scope.key}
                    checked={scopes.includes(scope.key)}
                    onChange={(checked) => setScopes(checked ? [...scopes, scope.key] : scopes.filter((item) => item !== scope.key))}
                    title={scope.label}
                    sub={scope.description}
                    end={presetLabel && (presetItem?.scopes as readonly string[] | undefined)?.includes(scope.key) ? `${presetLabel} usually needs this` : undefined}
                  />
                ))}
              </div>
            ))}
            <p className="m-0 mt-1 text-xs text-[var(--muted)]">No key can ever read a Social Security number, bank details, a card number or health answers.</p>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-2">
            {KEY_EXPIRY_DAYS.map((n) => (
              <ChoiceCard key={n} name="new-key-ends" selected={days === n} onSelect={() => setDays(n)} title={n === 365 ? "In a year" : `In ${n} days`} sub={`${dayIn(n)}${n === 30 ? " · for a trial or a one-off export" : ""}`} />
            ))}
            <ChoiceCard name="new-key-ends" selected={days === null} onSelect={() => setDays(null)} title="Never" sub={`We'll still ask if it goes ${IDLE_DAYS} days unused`} />
            {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
          </div>
        )}

        {step === 3 && made && <KeyShownOnce apiKey={made.key} scopes={made.record.scopes} origin={origin} presetLabel={presetLabel} copied={copied} onCopied={setCopied} />}

        <DialogFooter className="items-center">
          {step === 0 && (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="button" disabled={!label.trim()} onClick={() => { if (preset === null) setScopes(scopes); setStep(1); }}>Next</Button>
            </>
          )}
          {step === 1 && (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <span className="text-xs text-[var(--muted)] sm:ml-auto">{scopes.length} of {API_SCOPES.length} ticked</span>
              <Button type="button" disabled={scopes.length === 0} onClick={() => setStep(2)}>Next: when it ends</Button>
            </>
          )}
          {step === 2 && (
            <>
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button type="button" disabled={saving} onClick={() => void make()}>{saving ? "Making the key…" : "Make the key"}</Button>
            </>
          )}
          {step === 3 && (
            <>
              <span className="text-xs text-[var(--muted)] sm:mr-auto">Closing hides the key for good</span>
              <Button type="button" disabled={!copied} onClick={onClose}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const overlapLabel = (hours: number) => (hours === 0 ? "Stops now" : hours === 1 ? "1 hour" : hours === 72 ? "3 days" : `${hours} hours`);

/** Rotate: the old key keeps working for a window you pick (24 h by default), then the new key is shown once. */
export function RotateDialog({ apiKey, origin, onClose, onRotated }: { apiKey: ApiKeyView; origin: string; onClose: () => void; onRotated: () => void }) {
  const [hours, setHours] = useState<number>(DEFAULT_ROTATION_OVERLAP_HOURS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; record: ApiKeyView; oldExpiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const until = dateTime(new Date(openedAt + hours * 3_600_000).toISOString(), viewerTimeZone(), { clock: "12h", weekday: true });

  async function rotate() {
    setSaving(true);
    setError(null);
    try {
      const result = await send<{ key: string; record: ApiKeyView; oldExpiresAt: string }>(`/api/app/api-keys/${apiKey.id}/rotate`, "POST", { overlapHours: hours });
      setMade(result);
      onRotated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rotate the key");
    } finally {
      setSaving(false);
    }
  }

  async function close() {
    if (made && !(await leaveKey(copied))) return;
    onClose();
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) void close(); }}>
      <DialogContent size={made ? "xl" : "md"}>
        <DialogHeader>
          <DialogTitle>{made ? `${apiKey.label}: new key` : `Rotate ${apiKey.label}'s key?`}</DialogTitle>
          <DialogDescription>
            {made
              ? hours === 0 ? "The old key has stopped working." : `The old key keeps working until ${dateTime(made.oldExpiresAt, viewerTimeZone(), { clock: "12h", weekday: true })}, then stops.`
              : "A new key with the same permissions is shown once. The old one keeps working for a while, so nothing breaks while you swap it in."}
          </DialogDescription>
        </DialogHeader>
        {made ? (
          <KeyShownOnce apiKey={made.key} scopes={made.record.scopes} origin={origin} presetLabel={null} copied={copied} onCopied={setCopied} />
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-label text-[var(--body)]">Old key keeps working for</span>
            <Segmented label="Old key keeps working for" options={ROTATION_OVERLAP_HOURS.map((n) => ({ key: String(n), label: overlapLabel(n) }))} value={String(hours)} onChange={(next) => setHours(Number(next))} />
            <span className="text-xs text-[var(--muted)]">{hours === 0 ? "The old key stops the moment the new one is made." : `Until ${until}.`} Pick &ldquo;Stops now&rdquo; if the key may have leaked.</span>
            {error && <span role="alert" className="text-xs text-[var(--error-ink)]">{error}</span>}
          </div>
        )}
        <DialogFooter>
          {made ? (
            <Button type="button" disabled={!copied} onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>Keep it</Button>
              <Button type="button" disabled={saving} onClick={() => void rotate()}>{saving ? "Rotating…" : "Rotate key"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Revoke: type the name; says what breaks. */
export function RevokeDialog({ apiKey, onClose, onRevoked }: { apiKey: ApiKeyView; onClose: () => void; onRevoked: () => void }) {
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = typed.trim() === apiKey.label.trim();

  async function revoke() {
    setSaving(true);
    setError(null);
    try {
      await send(`/api/app/api-keys/${apiKey.id}`, "DELETE");
      notify.done(`${apiKey.label} revoked.`);
      onRevoked();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the key");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Revoke {apiKey.label}?</DialogTitle>
          <DialogDescription>
            Anything using it is refused from its next request: <b className="text-[var(--ink)]">{apiKey.label} stops being able to {canDoWords(apiKey.scopes).toLowerCase()}</b>. It was last used {whenWords(apiKey.lastUsedAt).replace(/^Today/, "today").replace(/^Yesterday/, "yesterday").replace(/^Never$/, "never")}. A revoked key can&rsquo;t be turned back on.
          </DialogDescription>
        </DialogHeader>
        <Field label={<>Type <b>{apiKey.label}</b> to confirm</>} htmlFor="revoke-name" error={error ?? undefined}>
          <input id="revoke-name" className={control} value={typed} autoFocus autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Keep the key</Button>
          <Button type="button" variant="destructive" disabled={!match || saving} onClick={() => void revoke()}>{saving ? "Revoking…" : "Revoke key"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The idle question (90 days): revoke it (recommended) or keep it; "Later" asks again next visit. */
export function IdleDialog({ apiKey, onClose, onRevoke, onKept }: { apiKey: ApiKeyView; onClose: () => void; onRevoke: () => void; onKept: () => void }) {
  const [choice, setChoice] = useState<"revoke" | "keep">("revoke");
  const [saving, setSaving] = useState(false);
  const zone = viewerTimeZone();
  const [openedAt] = useState(() => Date.now());
  const idle = daysSince(apiKey.lastUsedAt ?? apiKey.createdAt, openedAt) ?? IDLE_DAYS;

  async function confirm() {
    if (choice === "revoke") { onRevoke(); return; }
    setSaving(true);
    try {
      await send(`/api/app/api-keys/${apiKey.id}`, "PATCH", { keep: true });
      notify.done(`${apiKey.label} kept.`);
      onKept();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "That did not save. Try again.");
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Still using {apiKey.label}?</DialogTitle>
          <DialogDescription>
            {apiKey.lastUsedAt ? <>Nothing has used this key since <b className="text-[var(--ink)]">{dayMonth(apiKey.lastUsedAt, zone)}</b> ({idle} days).</> : <>Nothing has used this key since it was made, {idle} days ago.</>} Keys nobody uses are the ones nobody notices being misused. It can {canDoWords(apiKey.scopes).toLowerCase()}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <ChoiceCard name="idle-choice" selected={choice === "revoke"} onSelect={() => setChoice("revoke")} title="Revoke it" sub="Recommended. You can always make a new one." />
          <ChoiceCard name="idle-choice" selected={choice === "keep"} onSelect={() => setChoice("keep")} title={`Keep it, ask again in ${IDLE_DAYS} days`} sub="We'll note in the settings history that you kept it today" />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Later</Button>
          <Button type="button" disabled={saving} onClick={() => void confirm()}>{saving ? "Saving…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
