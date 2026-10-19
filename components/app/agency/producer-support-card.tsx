"use client";

import { useState } from "react";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { sendJson, useAgencyData } from "./use-agency-data";

type Person = { userId: string; role: "assistant" | "setter"; name: string; invited: boolean; assigned: boolean };

const ROLE_LABEL = { assistant: "Assistant", setter: "Setter" } as const;

/**
 * AG-0.4 · who works for this producer. An assistant sees what the producer sees and no money; a setter books onto
 * his calendar. Without an assignment an assistant sees nothing and a setter only his own work — so this card is
 * where an owner makes them useful. Owner and admins only.
 */
export function ProducerSupportCard({ producerId, producerName }: { producerId: string; producerName: string }) {
  const { data, error, loading, reload } = useAgencyData<{ people: Person[] }>(`/api/app/agency/producers/${producerId}/support`);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const people = data?.people ?? [];
  const assigned = people.filter((p) => p.assigned);
  const available = people.filter((p) => !p.assigned);

  async function change(person: Person, assign: boolean) {
    setBusy(person.userId);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/support`, assign ? "POST" : "DELETE", { userId: person.userId });
    setBusy(null);
    if (message) { notify.fail(message); return; }
    notify.done(assign
      ? `${person.name} now ${person.role === "setter" ? "books for" : "assists"} ${producerName}.`
      : `${person.name} no longer ${person.role === "setter" ? "books for" : "assists"} ${producerName}.`);
    setChoice("");
    reload();
  }

  const chosen = available.find((p) => p.userId === choice) ?? null;
  return (
    <TableCard
      title="Works for this producer"
      action={available.length ? (
        <div className="flex items-center gap-2">
          <select aria-label="Add an assistant or setter" className={`${toolbarControl} h-8`} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Add an assistant or setter</option>
            {available.map((p) => <option key={p.userId} value={p.userId}>{p.name} · {ROLE_LABEL[p.role]}</option>)}
          </select>
          <Button size="sm" disabled={!chosen || busy !== null} onClick={() => chosen && change(chosen, true)}>Add</Button>
        </div>
      ) : undefined}
    >
      {error ? <ErrorState detail={error} /> : loading ? <SectionLoading rows={2} columns={3} label="Loading who works for this producer" /> : assigned.length === 0 ? (
        <EmptyState title="Nobody yet" hint={people.length ? "Add an assistant to see his work, or a setter to book onto his calendar." : "Invite an assistant or a setter from Team first."} />
      ) : (
        <Table>
          <TableBody>
            {assigned.map((p) => (
              <TableRow key={p.userId}>
                <TableCell className="font-medium">{p.name}{p.invited && <span className="ml-2 text-xs text-[var(--muted)]">invited</span>}</TableCell>
                <TableCell><StatusChip tone="neutral">{ROLE_LABEL[p.role]}</StatusChip></TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => change(p, false)}>{busy === p.userId ? "Removing…" : "Remove"}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
