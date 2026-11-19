"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { FactTable } from "@/components/ui/fact-table";
import { Sheet } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { auditDiff, auditTargetHref, auditTargetText } from "@/lib/audit/entryView";
import type { AuditLogEntry } from "@/lib/audit/logView";

const LINK = "font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]";
const H = "m-0 text-sm font-semibold text-foreground";

function localTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

/**
 * One audit entry as a right sheet (admin round 1, docs/design/admin-r1/monitoring.html screen 5), in place of the
 * centre dialog: what changed as a Before/After table (from the entry's metadata), the rest of what it recorded in
 * words, who, when (UTC and the reader's own time), from where, the target with a link to its own admin page and to
 * its full history here (`?target=`), and the raw entry behind "Show technical details". Read-only: the log is
 * append-only, so nothing here changes it.
 */
export function AuditEntrySheet({ entry, role, hydrated, onClose, onHistory }: {
  entry: AuditLogEntry;
  role: AdminRole;
  /** Local times exist only in the browser. */
  hydrated: boolean;
  onClose: () => void;
  /** Shows this target's full history in the list (sets `?target=`). */
  onHistory: (targetId: string) => void;
}) {
  const [raw, setRaw] = useState(false);
  const { changes, facts } = auditDiff(entry.metadata);
  const targetHref = auditTargetHref(entry.target_type, entry.target_id);
  const openHref = targetHref && canOpenAdminHref(role, targetHref) ? targetHref : null;
  const hasTarget = Boolean(entry.target_type || entry.target_id);

  return (
    <Sheet
      title={entry.actionLabel ?? entry.action}
      subtitle={`${entry.actorLabel} · ${entry.whenUtc}`}
      onClose={onClose}
      footer={<>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </>}
    >
      {changes.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="What changed">
          <h3 className={H}>What changed</h3>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">Field</TableHead>
                  <TableHead>Before</TableHead>
                  <TableHead className="pr-3">After</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((change, index) => (
                  <TableRow key={`${change.field}-${index}`} className="align-top">
                    <TableCell className="pl-3 whitespace-normal text-foreground">{change.field}</TableCell>
                    <TableCell className="whitespace-normal text-[var(--error-ink)] [overflow-wrap:anywhere]">{change.before}</TableCell>
                    <TableCell className="pr-3 whitespace-normal text-[var(--success-ink)] [overflow-wrap:anywhere]">{change.after}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <FactTable
        rows={[
          ["Who", <span key="who" className="break-words">{entry.actorDetail ?? entry.actorLabel}</span>],
          ["When (UTC)", entry.whenUtc],
          ["Your time", hydrated ? localTime(entry.ts) : "—"],
          ["Reason", entry.reason ?? "None given"],
          ["IP", entry.ip ?? "—"],
          ["Device", <span key="ua" className="break-words [overflow-wrap:anywhere]">{entry.user_agent ?? "—"}</span>],
          ["Action code", <code key="code" className="font-mono text-xs break-all">{entry.action}</code>],
        ]}
      />

      {facts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className={H}>Details</h3>
          <FactTable rows={facts.map((fact) => [fact.field, <span key={fact.field} className="break-words [overflow-wrap:anywhere]">{fact.value}</span>])} />
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className={H}>Target</h3>
        {hasTarget ? (
          <p className="m-0 text-sm text-foreground [overflow-wrap:anywhere]">
            {auditTargetText(entry)}
            {openHref && <> · <Link href={openHref} className={LINK}>Open it</Link></>}
            {entry.target_id && <> · <button type="button" className={LINK} onClick={() => onHistory(entry.target_id as string)}>Its full history</button></>}
          </p>
        ) : (
          <p className="m-0 text-sm text-muted-foreground">This entry has no target.</p>
        )}
        {hasTarget && entry.targetLabel && (
          <p className="m-0 font-mono text-xs text-muted-foreground break-all">{entry.target_type ?? "record"}:{entry.target_id ?? ""}</p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className={H}>Technical details</h3>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRaw((open) => !open)} aria-expanded={raw}>
            {raw ? "Hide technical details" : "Show technical details"}
          </Button>
        </div>
        {raw && (
          <pre className="m-0 max-h-[320px] overflow-auto rounded-md bg-[var(--surface-alt)] p-3 text-xs text-foreground">
            {JSON.stringify(
              { id: entry.id, ts: entry.ts, actor_type: entry.actor_type, actor_id: entry.actor_id, action: entry.action, target_type: entry.target_type, target_id: entry.target_id, reason: entry.reason, ip: entry.ip, user_agent: entry.user_agent, metadata: entry.metadata },
              null,
              2,
            )}
          </pre>
        )}
      </section>
    </Sheet>
  );
}
