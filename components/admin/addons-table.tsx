"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";
import type { AddonRow } from "@/lib/addons/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

export function AddonsTable({
  initialAddons,
  featureLabels,
  meterLabels,
}: {
  initialAddons: AddonRow[];
  featureLabels: Record<string, string>;
  meterLabels: Record<string, string>;
}) {
  return (
    <div className={tableShell}>
      <Table>
        <TableHeader>
          <TableRow className={tableHeaderRow}>
            <TableHead className={tableHeadCell}>Add-on</TableHead>
            <TableHead className={tableHeadCell}>Price</TableHead>
            <TableHead className={tableHeadCell}>Grants</TableHead>
            <TableHead className={tableHeadCell}>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {initialAddons.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                No add-ons yet.
              </TableCell>
            </TableRow>
          )}
          {initialAddons.map((addon) => (
            <TableRow key={addon.id} className={addon.is_active ? undefined : "opacity-55"}>
              <TableCell>
                <p className="font-medium">{addon.name}</p>
                <code className="text-xs text-muted-foreground">{addon.code}</code>
                {addon.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{addon.description}</p>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatCentsAsCurrency(addon.price_cents)}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  / {BILLING_CYCLE_LABELS[addon.billing_cycle].toLowerCase()}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {addon.feature_keys.map((key) => (
                    <Badge key={key} variant="outline" className="text-[10px]">
                      {featureLabels[key] ?? key}
                    </Badge>
                  ))}
                  {addon.meters.map((m) => (
                    <Badge
                      key={m.meter_key}
                      variant="outline"
                      className="border-transparent bg-[var(--color-blue-faint)] text-[10px] text-[var(--color-blue)]"
                    >
                      +{m.included_qty.toLocaleString("en-US")} {meterLabels[m.meter_key] ?? m.meter_key}
                    </Badge>
                  ))}
                  {addon.feature_keys.length === 0 && addon.meters.length === 0 && (
                    <span className="text-xs text-muted-foreground">Nothing — needs configuring</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={
                    addon.is_active
                      ? "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]"
                      : "border-transparent bg-muted text-muted-foreground"
                  }
                >
                  {addon.is_active ? "Active" : "Retired"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
