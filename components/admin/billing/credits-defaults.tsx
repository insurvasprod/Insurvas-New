"use client";

import type { ReactNode } from "react";

import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import type { DefaultLimits } from "@/lib/creditsLimits/constants";

function limitText(value: number | null) {
  if (value === null) return "Unlimited";
  return value.toLocaleString("en-US");
}

/**
 * The Default limits lens (kept): each meter down the side, each current plan across, the plan's allowance in the
 * cell. "Unlimited" is no limit, a dash is none; a value the plan does not set itself comes from the platform
 * default, said on hover.
 */
export function CreditsDefaults({ defaults, lenses }: { defaults: DefaultLimits; lenses: ReactNode }) {
  return (
    <TableCard className="min-w-0" toolbar={<DataToolbar>{lenses}</DataToolbar>}>
      {defaults.plans.length === 0 ? (
        <EmptyState title="No current plans" hint="Each plan's allowances show here once a plan exists." />
      ) : (
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow>
              <TableHead>Meter</TableHead>
              {defaults.plans.map((plan) => <TableHead key={plan.id} className="text-right" title={`${plan.code} v${plan.version}`}>{plan.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {defaults.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="whitespace-nowrap font-medium">{row.label}</TableCell>
                {defaults.plans.map((plan) => {
                  const cell = row.values[plan.id];
                  const value = cell?.value ?? null;
                  return (
                    <TableCell key={plan.id} className="text-right tabular-nums" title={cell?.source === "platform_default" ? "Platform default: this plan sets no allowance of its own" : undefined}>
                      {value === 0 ? <><span aria-hidden>—</span><span className="sr-only">None</span></> : <span className={cell?.source === "platform_default" ? "text-muted-foreground" : undefined}>{limitText(value)}</span>}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
