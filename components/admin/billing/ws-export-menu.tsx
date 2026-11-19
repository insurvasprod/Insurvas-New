"use client";

import { ChevronDown, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/**
 * "Export month" on the billing workspace (billing-r2 screen 1): one CSV of a month's invoices, payments and
 * credit notes for the bookkeeper, from GET /api/admin/billing/export. The months are worked out on the server
 * (`months`), so the menu renders the same on both sides.
 */
export function WsExportMenu({ months }: { months: { key: string; label: string }[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline">
          <Download aria-hidden="true" />
          Export month
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Invoices, payments and credit notes</DropdownMenuLabel>
        {months.map((month) => (
          <DropdownMenuItem key={month.key} asChild>
            <a href={`/api/admin/billing/export?month=${month.key}`} download>
              {month.label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
