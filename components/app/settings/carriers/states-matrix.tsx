"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { st } from "@/components/app/settings/primitives";
import { Avatar } from "@/components/app/settings/team/parts";
import { US_STATES } from "@/lib/appointments/constants";
import type { AppointmentRow } from "@/lib/appointments/service-types";
import { appointedStatesFor, pendingStatesFor } from "@/lib/appointments/tickModel";
import { cn } from "@/lib/utils";

import { writersIn, type Writer } from "./model";

const NAMES = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));

/**
 * Board screen 10 · States: the appointment matrix. States down, carriers across; "✓ and a number" is
 * appointed with how many writers are licensed there. Pick a writer to see only theirs. A cell opens who
 * is licensed there and adds or ends the agency's appointment (a tick saves from today, an untick ends
 * it today; never deleted).
 */
export function StatesMatrix({ carriers, appointments, today, writers, canEdit, onToggle, onAddCarrier }: {
  carriers: { id: string; name: string }[];
  appointments: AppointmentRow[];
  today: string;
  writers: Writer[] | null;
  canEdit: boolean;
  onToggle: (state: string, carrierId: string, on: boolean) => Promise<void>;
  onAddCarrier: () => void;
}) {
  const [who, setWho] = useState("agency");
  const [everyState, setEveryState] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const appointed = new Map(carriers.map((carrier) => [carrier.id, new Set(appointedStatesFor(appointments, carrier.id, today))]));
  const pending = new Map(carriers.map((carrier) => [carrier.id, new Set(pendingStatesFor(appointments, carrier.id, today))]));
  const writer = who === "agency" ? null : writers?.find((item) => item.id === who) ?? null;
  const used = US_STATES.map(([code]) => code as string).filter((code) => carriers.some((carrier) => appointed.get(carrier.id)?.has(code) || pending.get(carrier.id)?.has(code)));
  const rows = (everyState ? US_STATES.map(([code]) => code as string) : used).filter((code) => !writer || writer.states.length === 0 || writer.states.includes(code));
  const pool = writer ? [writer] : writers ?? [];
  const firstWriters = (writers ?? []).slice(0, 3);
  const restWriters = (writers ?? []).slice(3);

  if (carriers.length === 0) {
    return (
      <TableCard title="Where you can sell" className="lg:min-h-0 lg:flex-1">
        <EmptyState title="No carriers yet" hint="Add a carrier, then the states it appointed you in." action={canEdit ? <Button type="button" variant="outline" onClick={onAddCarrier}>Add carrier</Button> : undefined} />
      </TableCard>
    );
  }

  return (
    <TableCard
      title="Where you can sell"
      className="lg:min-h-0 lg:flex-1"
      bodyClassName="min-h-[200px] overflow-auto lg:min-h-0"
      action={
        <div className="flex flex-wrap items-center gap-2">
          {writers && writers.length > 0 && (
            <Segmented
              label="Show the states of"
              value={firstWriters.some((item) => item.id === who) || who === "agency" ? who : "more"}
              onChange={(key) => { if (key !== "more") setWho(key); }}
              options={[{ key: "agency", label: "Whole agency" }, ...firstWriters.map((item) => ({ key: item.id, label: item.name }))]}
            />
          )}
          {restWriters.length > 0 && (
            <select aria-label="Another writer" className="h-9 rounded-md border border-[var(--border)] bg-[var(--color-card)] px-2 text-sm text-[var(--body)]" value={restWriters.some((item) => item.id === who) ? who : ""} onChange={(event) => setWho(event.target.value || "agency")}>
              <option value="">+{restWriters.length} more</option>
              {restWriters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <ToggleChip selected={everyState} onClick={() => setEveryState((value) => !value)}>Every state</ToggleChip>
        </div>
      }
      footer={<span className="text-xs text-[var(--muted)]">✓ and a number = appointed, with how many writers are licensed there · — = not appointed{canEdit ? " · click a cell to add or end an appointment" : ""}</span>}
    >
      {rows.length === 0 ? (
        <EmptyState title={writer ? `${writer.name} isn't licensed where you're appointed` : "No states yet"} hint={writer ? "Add their states in Team & access." : "Tick Every state, then click a cell to add an appointment."} />
      ) : (
        <table className={cn(st.table, "min-w-[640px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>State</th>
              {carriers.map((carrier) => <th key={carrier.id} scope="col" className={cn(st.th, "text-center")}>{carrier.name}</th>)}
              <th scope="col" className={cn(st.th, "text-right")}>Licensed writers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((code) => {
              const here = writersIn(pool, code);
              return (
                <tr key={code}>
                  <td className={cn(st.td, "font-semibold whitespace-nowrap text-[var(--ink)]")}>{NAMES.get(code) ?? code}</td>
                  {carriers.map((carrier) => {
                    const on = appointed.get(carrier.id)?.has(code) ?? false;
                    const waiting = !on && (pending.get(carrier.id)?.has(code) ?? false);
                    const key = `${code}:${carrier.id}`;
                    return (
                      <td key={carrier.id} className={cn(st.td, "p-0 text-center")}>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" aria-label={`${carrier.name} in ${NAMES.get(code) ?? code}: ${on ? "appointed" : waiting ? "pending" : "not appointed"}`} className={cn("h-[44px] w-full px-3 text-sm hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]", on ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--muted)]")}>
                              {busy === key ? "…" : on ? `✓${writers ? ` ${here.length}` : ""}` : waiting ? <StatusChip tone="info">Pending</StatusChip> : "—"}
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72">
                            <div className="flex flex-col gap-2">
                              <p className="m-0 text-sm font-semibold text-[var(--ink)]">{carrier.name} in {NAMES.get(code) ?? code}</p>
                              <p className="m-0 text-xs text-[var(--muted)]">{on ? "Your agency is appointed here." : waiting ? "Applied for, not granted yet." : "Your agency is not appointed here."}</p>
                              {writers && (
                                <ul className="m-0 flex list-none flex-col p-0">
                                  {here.length === 0 && <li className="py-1 text-xs text-[var(--muted)]">No writer is licensed here.</li>}
                                  {here.map((item) => (
                                    <li key={item.id} className="flex items-center gap-2 border-b border-[var(--border)] py-1.5 text-sm text-[var(--body)] last:border-b-0">
                                      <Avatar name={item.name} size="sm" />
                                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                                      <span className="shrink-0 text-xs text-[var(--muted)]">{item.states.length === 0 ? "agency states" : `licensed in ${code}`}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                {canEdit && (
                                  <Button type="button" size="sm" variant={on || waiting ? "outline" : "default"} disabled={busy !== null} onClick={async () => { setBusy(key); try { await onToggle(code, carrier.id, !(on || waiting)); } finally { setBusy(null); } }}>
                                    {on || waiting ? "End the appointment" : "Add the appointment"}
                                  </Button>
                                )}
                                <Link href="/app/settings#team-access" className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">Writers in Team &amp; access</Link>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>
                    );
                  })}
                  <td className={cn(st.td, "text-right tabular-nums")}>{writers ? here.length : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
