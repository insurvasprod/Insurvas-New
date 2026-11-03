"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { SettingsSectionHeader, SettingsTableCard, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { inputControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { SIGNAL_LABELS, SIGNALS, type Weights } from "@/lib/retention/constants";
import { weightTotal } from "@/lib/retention/settingsHub";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * LA-5.11 · the scoring weights, on their own page under Settings › Retention (Money & compliance
 * redesign A, 2026-11-03). A save is a new weight version; scores already made keep theirs, so
 * Retention results can compare versions. Save waits for a preview of these exact weights: how many
 * policies would change band, worked out on the server against today's book.
 */
type Preview = { moved: number; up: number; down: number; intoCritical: number; total: number };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/app/retention/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}
const count = (v: number) => v.toLocaleString("en-US");

export function RetentionWeightsBoard({ weights: initial, version, isPlatform, platformWeights, canEdit }: { weights: Weights; version: number; isPlatform: boolean; platformWeights: Weights; canEdit: boolean }) {
  const router = useRouter();
  const [weights, setWeights] = useState<Weights>(initial);
  const [preview, setPreview] = useState<{ for: string; result: Preview } | null>(null);
  const [busy, setBusy] = useState<"preview" | "save" | "reset" | null>(null);
  const [resetting, setResetting] = useState(false);
  const total = weightTotal(weights);
  const key = JSON.stringify(weights);
  const dirty = key !== JSON.stringify(initial);
  const previewed = preview?.for === key;
  const dis = !canEdit;

  const runPreview = async () => {
    setBusy("preview");
    try { setPreview({ for: key, result: (await post({ action: "preview_weights", weights })).preview }); }
    catch (e) { notify.fail(e instanceof Error ? e.message : "The preview did not run"); }
    finally { setBusy(null); }
  };
  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(body.action === "reset" ? "reset" : "save");
    try {
      await post(body);
      notify.done(done);
      setPreview(null);
      setResetting(false);
      router.push("/app/retention-settings#weights");
      router.refresh();
      return true;
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSectionHeader
        trail={<span className="flex min-w-0 items-center gap-2 text-sm"><Link className="text-[var(--muted)] hover:text-[var(--ink)]" href="/app/retention-settings#weights">Start here</Link><ChevronRight aria-hidden="true" className="size-4 text-[var(--muted)]" /><span className="font-semibold text-[var(--ink)]">Scoring weights</span><span className="text-[var(--muted)]">· version {version}{isPlatform ? ", Insurvas's" : ", yours"}</span></span>}
        actions={canEdit ? (
          <>
            <MoreMenu items={[{ label: "Reset to Insurvas weights", onSelect: () => setResetting(true) }, { label: "History", href: "/app/settings?history=retention#settings-history" }, { label: "Retention results", href: "/app/retention-results" }]} />
            <Button variant="outline" disabled={busy !== null || total !== 100 || !dirty} onClick={() => void runPreview()}>{busy === "preview" ? "Previewing…" : "Preview"}</Button>
            <Button disabled={busy !== null || total !== 100 || !previewed || !dirty} onClick={() => void save({ action: "save_weights", weights }, `Saved as version ${version + 1}`)}>{busy === "save" ? "Saving…" : `Save as version ${version + 1}`}</Button>
          </>
        ) : undefined}
      />
      <LeaveGuard dirty={dirty} onDiscard={() => setWeights(initial)} what="the scoring weights" />

      <SettingsTableCard title="Signals" actions={<span className="text-sm text-[var(--muted)]">Each signal&apos;s share of a policy&apos;s risk score</span>}>
        <table className={st.table}>
          <thead><tr className={st.headRow}><th className={st.th}>Signal</th><th className={cn(st.th, "text-right")}>Weight</th><th className={cn(st.th, "text-right")}>Insurvas</th></tr></thead>
          <tbody>
            {SIGNALS.map((s) => (
              <tr key={s}>
                <td className={cn(st.td, "text-[var(--ink)]")}>{SIGNAL_LABELS[s]}</td>
                <td className={cn(st.td, "text-right")}><input aria-label={`${SIGNAL_LABELS[s]} weight`} className={cn(inputControl, "ml-auto w-24 text-right tabular-nums")} disabled={dis} type="number" min={0} max={100} value={weights[s]} onChange={(e) => setWeights({ ...weights, [s]: Math.round(Number(e.target.value)) || 0 })} /></td>
                <td className={cn(st.td, st.num, "text-[var(--muted)]")}>{platformWeights[s]}</td>
              </tr>
            ))}
            <tr>
              <td className={cn(st.td, st.strong)}>Total</td>
              <td className={cn(st.td, st.num, st.strong, total !== 100 && "text-[var(--error-ink)]")}>{total}</td>
              <td className={cn(st.td, st.num, "text-[var(--muted)]")}>100</td>
            </tr>
          </tbody>
        </table>
        <div className="border-t border-[var(--border)] px-4 py-3 text-sm" aria-live="polite">
          {total !== 100 ? <p role="alert" className="m-0 text-[var(--error-ink)]">The weights add up to {total}. They must add up to 100 to preview or save.</p>
            : previewed && preview ? <p className="m-0 text-[var(--ink)]">Against today&apos;s book: <strong className="tabular-nums">{count(preview.result.moved)}</strong> of {count(preview.result.total)} policies change band ({count(preview.result.up)} up, {count(preview.result.down)} down; <strong className="tabular-nums">{count(preview.result.intoCritical)}</strong> newly critical). Scores already made keep version {version}.</p>
            : <p className="m-0 text-[var(--muted)]">{dirty ? "Preview to see how many policies change band, then save as a new version." : `Scoring with version ${version}. Change a weight to make a new version.`}</p>}
        </div>
      </SettingsTableCard>

      <ConfirmDialog open={resetting} onOpenChange={setResetting} busy={busy === "reset"} destructive={false}
        title="Go back to Insurvas's weights?" description={`They are saved as version ${version + 1} and the book is scored again now. Scores already made keep their version.`}
        confirmLabel="Use Insurvas weights" cancelLabel="Keep mine" onConfirm={() => void save({ action: "reset", section: "weights", confirmation: null }, "Insurvas weights in use")} />
    </div>
  );
}
