"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LAPSE_SIGNAL_KINDS, LAPSE_SIGNAL_LABELS, LAPSE_SIGNAL_NOTE_MAX, OTHER_NOTE_MIN, type LapseSignalKind } from "@/lib/lapseRisk/model";

/**
 * "Record a lapse signal": the reason a policy goes on /app/lapse-risk.
 *
 * Self-contained so it can be mounted with one line — per row on /app/policies (pass `policy`), or
 * as a page action on /app/lapse-risk (omit it, and the dialog asks which policy). It fetches its
 * own access from GET /api/app/policies/lapse-risk, once per page for every instance, and renders
 * nothing when that is refused: a bookkeeper, a plan without chargeback_radar, or the feature
 * switched off platform-wide all see the policies page exactly as before.
 *
 * Which policies it offers is the server's answer (`recordable`): active and pending policies the
 * viewer may see commission on — an owner every one, a producer the ones they recorded.
 */

type Recordable = { id: string; policyNumber: string; insuredName: string; status: "active" | "pending" };
type Access = { readOnly: boolean; recordable: Recordable[]; atRisk: Set<string> };

// One fetch per page, shared by every row's instance, re-run after each write.
let snapshot: Access | null | undefined;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Access | null) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function loadAccess(force = false): Promise<void> {
  if (inflight && !force) return inflight;
  inflight = fetch("/api/app/policies/lapse-risk", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) return publish(null);
      const body = await response.json().catch(() => null);
      publish({
        readOnly: Boolean(body?.readOnly) || body?.storage === "pending",
        recordable: Array.isArray(body?.recordable) ? body.recordable : [],
        atRisk: new Set<string>(Array.isArray(body?.policies) ? body.policies.map((policy: { policyId: string }) => policy.policyId) : []),
      });
    })
    .catch(() => publish(null))
    .finally(() => { inflight = null; });
  return inflight;
}

/** Re-read access after a write made elsewhere on the page (a resolution on Lapse risk). */
export function refreshLapseSignalAccess(): Promise<void> {
  return loadAccess(true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const FIELD = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function RecordLapseSignal({
  policy,
  label,
  showAtRisk = true,
  onRecorded,
}: {
  /** The row's policy. Omit to let the dialog choose from every policy the viewer may record on. */
  policy?: { id: string; status: string };
  /** Trigger text; defaults to the short row form or the page-action form. */
  label?: string;
  /** Show the "At risk" link beside a row already on Lapse risk. Off on Lapse risk itself. */
  showAtRisk?: boolean;
  /** Called after a signal is saved, besides refreshing the current route. */
  onRecorded?: () => void;
}) {
  const router = useRouter();
  const access = useSyncExternalStore(subscribe, () => snapshot, () => undefined);
  const [open, setOpen] = useState(false);
  const [policyId, setPolicyId] = useState(policy?.id ?? "");
  const [kind, setKind] = useState<LapseSignalKind>("missed_draft");
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (snapshot === undefined) void loadAccess();
  }, []);

  if (!access || access.readOnly) return null;
  const recordable = access.recordable;
  if (policy && !recordable.some((item) => item.id === policy.id)) return null;
  if (!policy && recordable.length === 0) return null;
  const atRisk = policy ? access.atRisk.has(policy.id) : false;
  const flagAtRisk = atRisk && showAtRisk;

  function start() {
    setPolicyId(policy?.id ?? "");
    setKind("missed_draft");
    setOccurredOn(today());
    setNote("");
    setOpen(true);
  }

  const noteRequired = kind === "other";
  const noteShort = noteRequired && note.trim().length < OTHER_NOTE_MIN;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!policyId || noteShort) return;
    setSaving(true);
    try {
      const response = await fetch("/api/app/policies/lapse-risk/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyId, kind, occurredOn, note: note.trim() || null }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not record the lapse signal");
      notify.done(`${LAPSE_SIGNAL_LABELS[kind]} recorded — the policy is on Lapse risk`);
      setOpen(false);
      await loadAccess(true);
      onRecorded?.();
      router.refresh();
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "Could not record the lapse signal");
    } finally {
      setSaving(false);
    }
  }

  const chosen = recordable.find((item) => item.id === policyId);

  return (
    <>
      <span className={`inline-flex items-center gap-2 whitespace-nowrap${policy ? " ml-2 align-middle" : ""}`}>
        {flagAtRisk && (
          <Link href="/app/lapse-risk" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--error-ink)] hover:underline">
            <span className="size-1.5 rounded-full bg-[var(--error)]" aria-hidden="true" />
            At risk
          </Link>
        )}
        {policy ? (
          <Button type="button" variant="link" size="xs" className="h-auto px-0 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={start}>
            {label ?? (atRisk ? "Add signal" : "Record lapse signal")}
          </Button>
        ) : (
          <Button type="button" variant="outline" className="border-[var(--border-strong)]" onClick={start}>
            {label ?? "Record a lapse signal"}
          </Button>
        )}
      </span>

      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
        <DialogContent>
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle className="text-base">Record a lapse signal</DialogTitle>
              <DialogDescription>
                What happened, and when. The policy goes on Lapse risk with this as its reason, and stays there until someone resolves it.
              </DialogDescription>
            </DialogHeader>

            {policy ? (
              chosen && (
                <p className="text-sm text-foreground">
                  <span className="font-semibold">{chosen.policyNumber}</span>
                  <span className="text-muted-foreground"> · {chosen.insuredName}</span>
                </p>
              )
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="lapse-signal-policy">Policy</Label>
                <select id="lapse-signal-policy" required className={FIELD} value={policyId} onChange={(event) => setPolicyId(event.target.value)}>
                  <option value="">Choose a policy…</option>
                  {recordable.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.policyNumber} · {item.insuredName}{item.status === "pending" ? " (pending)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="lapse-signal-kind">Signal</Label>
                <select id="lapse-signal-kind" className={FIELD} value={kind} onChange={(event) => setKind(event.target.value as LapseSignalKind)}>
                  {LAPSE_SIGNAL_KINDS.map((value) => <option key={value} value={value}>{LAPSE_SIGNAL_LABELS[value]}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lapse-signal-date">Happened on</Label>
                <Input id="lapse-signal-date" type="date" required max={today()} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="lapse-signal-note">
                Note {noteRequired ? <span className="font-normal text-muted-foreground">required for “Other”</span> : <span className="font-normal text-muted-foreground">optional</span>}
              </Label>
              <textarea
                id="lapse-signal-note"
                rows={3}
                maxLength={LAPSE_SIGNAL_NOTE_MAX}
                required={noteRequired}
                aria-invalid={noteShort && note.length > 0 ? true : undefined}
                placeholder={noteRequired ? "What happened?" : "Draft returned NSF, customer called about cancelling…"}
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving || !policyId || noteShort}>{saving ? "Recording…" : "Record signal"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
