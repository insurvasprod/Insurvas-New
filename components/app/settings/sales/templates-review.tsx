"use client";

/**
 * Settings › Underwriting templates, round 3 (owner picks 2026-10-30, canvas page
 * settings-uw-templates-steps):
 *
 * - `ReviewPanel` (S8): before a draft goes live, every question that differs from the version it
 *   replaces, as it was and as it becomes, and exactly which calls will load it.
 * - `VersionsPanel` (S10): every version of the template with what each changed, any two compared
 *   side by side, and an older one restored as the next draft (a save of its questions; no schema
 *   change: saving onto a published or retired version makes version N + 1 as a draft).
 * - `AgentTemplatesView` (S13): what a licensed agent sees — product × carrier → the questions a call
 *   loads, read-only, with the way to read them.
 */

import { useState } from "react";

import { st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { changeRows, changesSummary, templateChanges, type ChangeKind, type ProductUse } from "@/lib/salesSettings/templateCoverage";
import { questionCount } from "@/lib/salesSettings/templateDefinition";
import type { TemplateRowView } from "@/lib/salesSettings/views";
import { cn } from "@/lib/utils";

import { RowAction, VersionPill, WithReason } from "./shared";

const KIND_TONE: Record<ChangeKind, StatusTone> = {
  Added: "info", Removed: "neutral", "Now a knockout": "danger", "No longer a knockout": "good", Reworded: "warning", Changed: "warning",
};

function ChangesTable({ from, to, empty }: { from: TemplateRowView | null; to: TemplateRowView; empty: string }) {
  const rows = changeRows(from?.definition, to.definition);
  if (!rows.length) return <p className="m-0 px-4 py-6 text-sm text-[var(--body)]">{empty}</p>;
  return (
    <table className={cn(st.table, "min-w-[760px]")}>
      <thead>
        <tr className={st.headRow}>
          <th scope="col" className={cn(st.th, "w-[170px]")}>Change</th>
          <th scope="col" className={st.th}>Question</th>
          <th scope="col" className={st.th}>{from ? `v${from.version}` : "Before"}</th>
          <th scope="col" className={st.th}>v{to.version}</th>
        </tr>
      </thead>
      <tbody className="m-seq">
        {rows.map((r, i) => (
          <tr key={`${r.label}-${i}`}>
            <td className={st.td}><StatusChip tone={KIND_TONE[r.kind]}>{r.kind}</StatusChip></td>
            <td className={cn(st.td, st.strong)}>{r.label}</td>
            <td className={st.td}>{r.before}</td>
            <td className={cn(st.td, "text-[var(--ink)]")}>{r.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReviewPanel({ draft, base, impact, problem, onBack, onPublish }: {
  draft: TemplateRowView;
  /** The version it replaces (the live one), or the one before it. */
  base: TemplateRowView | null;
  /** Which calls load it once published, in words. */
  impact: string;
  problem: string | null;
  onBack: () => void;
  onPublish: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <TableCard
      title={`Review v${draft.version} before it goes live`}
      action={<span className="text-sm text-[var(--body)]">{base ? `Against v${base.version}${base.status === "published" ? ", live now" : ""}` : "Its first version"}</span>}
      footer={
        <div className="flex flex-wrap items-center gap-3 px-1 py-1">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-[var(--ink)]">Publishing v{draft.version}</span>
            <span className="block text-sm leading-[1.5] text-[var(--body)]">{impact}</span>
          </span>
          <Button type="button" variant="outline" onClick={onBack}>Back to editing</Button>
          <WithReason reason={problem}>
            <Button type="button" disabled={busy || Boolean(problem)} onClick={() => { setBusy(true); void onPublish().finally(() => setBusy(false)); }}>{busy ? "Publishing…" : `Publish v${draft.version}`}</Button>
          </WithReason>
        </div>
      }
    >
      <ChangesTable from={base} to={draft} empty={base ? "No question differs from the live version: publishing changes only the name." : `${questionCount(draft.definition)} questions, all new.`} />
    </TableCard>
  );
}

export function VersionsPanel({ lineage, current, isLive, lastChanged, canRestore, onOpen, onRestore }: {
  /** Newest first. */
  lineage: TemplateRowView[];
  current: TemplateRowView;
  isLive: (t: TemplateRowView) => boolean;
  lastChanged: (t: TemplateRowView) => string;
  /** Why restoring is not possible, or null. */
  canRestore: string | null;
  onOpen: (t: TemplateRowView) => void;
  onRestore: (t: TemplateRowView) => void;
}) {
  const [leftId, setLeftId] = useState(lineage[1]?.id ?? lineage[0]?.id ?? "");
  const [rightId, setRightId] = useState(lineage[0]?.id ?? "");
  const left = lineage.find((v) => v.id === leftId) ?? null;
  const right = lineage.find((v) => v.id === rightId) ?? null;
  const status = (v: TemplateRowView) => (v.status === "draft" ? "draft" : isLive(v) ? "live" : v.status === "published" ? "replaced" : "retired");
  const label = (v: TemplateRowView) => `v${v.version} · ${status(v)} · ${lastChanged(v)}`;
  return (
    <div className="flex flex-col gap-4">
      <TableCard title="Versions" info="Every version of this template. A call loads the live one; interviews keep the version they started on, so older versions stay.">
        <table className={cn(st.table, "min-w-[720px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[80px]")}>Version</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Status</th>
              <th scope="col" className={st.th}>What changed</th>
              <th scope="col" className={cn(st.th, "w-[190px]")}>Last changed</th>
              <th scope="col" className={cn(st.th, "w-[1%] text-right")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {lineage.map((v, i) => {
              const prev = lineage[i + 1];
              const summary = prev ? changesSummary(templateChanges(prev.definition, v.definition)) || "No change to the questions" : v.tenantOwned && v.version === 1 ? "First version" : "—";
              const newestDraft = v.status === "draft";
              return (
                <tr key={v.id} className={cn(v.id === current.id && "bg-[var(--brand-50)]")}>
                  <td className={st.td}><VersionPill version={v.version} live={isLive(v)} /></td>
                  <td className={cn(st.td, "capitalize")}>{status(v)}</td>
                  <td className={st.td}>{prev ? <><span className="text-[var(--ink)]">{summary}</span><span className={st.sub}>against v{prev.version}</span></> : summary}</td>
                  <td className={st.td}>{lastChanged(v)}</td>
                  <td className={cn(st.td, "whitespace-nowrap text-right")}>
                    <span className="inline-flex gap-2">
                      {!newestDraft && v.tenantOwned && (
                        <RowAction onClick={() => onRestore(v)} label={`Restore v${v.version} as a new draft`} disabled={Boolean(canRestore)} reason={canRestore}>Restore</RowAction>
                      )}
                      {v.id === current.id ? <span className="px-3 text-sm text-[var(--body)]">Open</span> : <RowAction onClick={() => onOpen(v)} label={`Open v${v.version}`}>Open</RowAction>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>

      {lineage.length > 1 && left && right && (
        <TableCard
          title="Compare two versions"
          action={
            <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--body)]">
              <select aria-label="First version" className="h-9 rounded-md border border-[var(--border)] bg-transparent px-2 text-sm text-[var(--ink)]" value={leftId} onChange={(e) => setLeftId(e.target.value)}>
                {lineage.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
              </select>
              with
              <select aria-label="Second version" className="h-9 rounded-md border border-[var(--border)] bg-transparent px-2 text-sm text-[var(--ink)]" value={rightId} onChange={(e) => setRightId(e.target.value)}>
                {lineage.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
              </select>
            </span>
          }
        >
          <ChangesTable from={left} to={right} empty={left.id === right.id ? "Pick two different versions." : "These two versions ask the same questions."} />
        </TableCard>
      )}
    </div>
  );
}

export function AgentTemplatesView({ uses, onOpen }: { uses: ProductUse[]; onOpen: (t: TemplateRowView) => void }) {
  const rows = uses.flatMap((u) => [
    ...(u.general ? [{ key: `${u.productCode}-all`, product: u.productName, carrier: u.carriers.length ? `Every carrier but ${u.carriers.map((c) => c.carrierName).join(", ")}` : "Every carrier", t: u.general }] : []),
    ...u.carriers.map((c) => ({ key: `${u.productCode}-${c.carrierId}`, product: u.productName, carrier: c.carrierName, t: c.template })),
  ]);
  return (
    <TableCard title="What you'll ask on a call" action={<span className="text-sm text-[var(--body)]">Your agency&apos;s owner sets these</span>}>
      {rows.length === 0 ? (
        <p className="m-0 px-4 py-6 text-sm text-[var(--body)]">No health questions are set up yet. Ask your agency&apos;s owner.</p>
      ) : (
        <table className={cn(st.table, "min-w-[640px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Product</th>
              <th scope="col" className={st.th}>Carrier</th>
              <th scope="col" className={st.th}>Questions you ask</th>
              <th scope="col" className={cn(st.th, st.num, "w-[96px]")}>Questions</th>
              <th scope="col" className={cn(st.th, "w-[1%] text-right")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className={cn(st.td, st.strong)}>{r.product}</td>
                <td className={st.td}>{r.carrier}</td>
                <td className={st.td}>{r.t.name} v{r.t.version}{!r.t.tenantOwned && <span className={st.sub}>Insurvas default</span>}</td>
                <td className={cn(st.td, st.num)}>{questionCount(r.t.definition)}</td>
                <td className={cn(st.td, "text-right")}><RowAction onClick={() => onOpen(r.t)} label={`See the questions in ${r.t.name}`}>See questions</RowAction></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
