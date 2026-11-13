"use client";

/**
 * Settings › Products › Not in your plan (board P3, right): every catalogue product the agency's plan doesn't
 * include, its line, and the plan that adds it. "See plans" opens a short dialog naming that plan and what else
 * comes with it, then Billing compares plans. Nothing here changes the plan.
 */

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { addedByText } from "@/lib/products/readiness";
import { cn } from "@/lib/utils";

import { lineOf, linkClass, type ProductRow } from "./parts";

export function NotInPlan({ rows, addedBy }: { rows: ProductRow[]; addedBy: Record<string, string[]> | null }) {
  const [open, setOpen] = useState<ProductRow | null>(null);
  const plans = open ? addedBy?.[open.code] ?? [] : [];
  const firstPlan = plans[0] ?? null;
  const alsoWith = open && firstPlan ? rows.filter((row) => row.code !== open.code && addedBy?.[row.code]?.includes(firstPlan)).map((row) => row.name) : [];

  return (
    <TableCard className="min-h-0 flex-1" bodyClassName="flex min-h-0 flex-col">
      {rows.length === 0 ? (
        <EmptyState title="Your plan includes every product" hint="Everything in the Insurvas catalogue can be switched on under In your plan." />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Product</TableHead><TableHead>Line</TableHead><TableHead>Added by</TableHead><TableHead className="w-28" aria-label="Plans" /></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.code}>
                  <TableCell className="text-[var(--muted)]">{row.name}</TableCell>
                  <TableCell className="text-[var(--muted)]">{lineOf(row.category)}</TableCell>
                  <TableCell className="text-[var(--muted)]">{addedBy === null ? "—" : addedByText(addedBy[row.code]) ?? "A larger plan · ask us"}</TableCell>
                  <TableCell className="text-right">
                    <button type="button" onClick={() => setOpen(row)} className={cn("text-sm", linkClass)}>See plans ›</button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>Add {open.name}</DialogTitle>
                <DialogDescription>
                  {firstPlan
                    ? <>It comes with <b>{addedByText(plans)}</b>{alsoWith.length ? <>, with {alsoWith.join(", ")}</> : null}. Compare plans to see the price and change your plan.</>
                    : <>No plan on sale today adds it. Billing shows your plan and how to reach us.</>}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(null)}>Not now</Button>
                <Button asChild><Link href="/app/settings#billing" onClick={() => setOpen(null)}>Compare plans</Link></Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}
