"use client";

import type { ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { CREDIT_METER_LABELS, type CreditPack } from "@/lib/creditsLimits/constants";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * The Credit packs lens (kept from the old panel): each pack on one line with its actions — edit, add to an invoice,
 * archive or restore. Archived packs stay listed, quiet, so a pack is never lost.
 */
export function CreditsPacks({ packs, lenses, busyId, onEdit, onPurchase, onSetActive }: {
  packs: CreditPack[];
  lenses: ReactNode;
  busyId: string | null;
  onEdit: (pack: CreditPack) => void;
  onPurchase: (pack: CreditPack) => void;
  onSetActive: (pack: CreditPack, active: boolean) => void;
}) {
  return (
    <TableCard className="min-w-0" toolbar={<DataToolbar>{lenses}</DataToolbar>}>
      {packs.length === 0 ? (
        <EmptyState title="No credit packs yet" hint="Add one to sell a top-up." />
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>Pack</TableHead>
              <TableHead>Meter</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packs.map((pack) => (
              <TableRow key={pack.id} className={pack.is_active ? undefined : "text-muted-foreground"}>
                <TableCell className="max-w-[18rem] truncate font-medium">{pack.name}</TableCell>
                <TableCell className="whitespace-nowrap">{CREDIT_METER_LABELS[pack.meter_key] ?? pack.meter_key}</TableCell>
                <TableCell className="text-right tabular-nums">{pack.quantity.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCentsAsCurrency(pack.price_cents)}</TableCell>
                <TableCell><StatusChip tone={pack.is_active ? "good" : "neutral"} dot>{pack.is_active ? "On sale" : "Archived"}</StatusChip></TableCell>
                <TableCell className="py-1 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${pack.name}`} disabled={busyId === pack.id}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem onSelect={() => onEdit(pack)}>Edit pack</DropdownMenuItem>
                      {pack.is_active && (
                        <DropdownMenuItem disabled={pack.price_cents <= 0} onSelect={() => onPurchase(pack)}>
                          {pack.price_cents <= 0 ? "Add to invoice (free packs need none)" : "Add to an invoice"}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {pack.is_active
                        ? <DropdownMenuItem onSelect={() => onSetActive(pack, false)}>Archive</DropdownMenuItem>
                        : <DropdownMenuItem onSelect={() => onSetActive(pack, true)}>Restore</DropdownMenuItem>}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
