"use client";

/**
 * Settings › Products › a product's sheet (board P2): the switch, the four things it needs to be quoted in the
 * order the call uses them (each opening its own Settings page), the partners who may send it, and where it
 * shows up. Opened from a row; nothing here saves except the switch, which behaves as the row's does.
 */

import Link from "next/link";

import { SheetSection, WIDE_SHEET } from "@/components/app/settings/sales-process/parts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import type { Need, Readiness } from "@/lib/products/readiness";
import { cn } from "@/lib/utils";

import { lineOf, linkClass, type ProductRow } from "./parts";

const FIX: Record<Need["key"], string> = { form: "Set up its form", carriers: "Add a carrier", health: "Set up health questions", quote: "Set up quote inputs" };

function Step({ need, index, sold }: { need: Need; index: number; sold: boolean }) {
  const done = need.state === "done";
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-[var(--border)] py-3 last:border-b-0">
      <span
        aria-hidden
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
          done ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--muted)]",
        )}
      >
        {done ? "✓" : need.state === "na" ? "–" : index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ink)]">{need.title}</span>
        <span className="block truncate text-xs text-[var(--muted)]">{need.detail}</span>
      </span>
      {need.state === "missing" && sold ? (
        <Button asChild size="sm"><Link href={need.href}>{FIX[need.key]}</Link></Button>
      ) : need.state !== "na" ? (
        <Link href={need.href} className={cn("shrink-0 text-xs", linkClass)}>{need.page} ›</Link>
      ) : null}
    </li>
  );
}

export function ProductSheet({ row, needs, ready, busy, onToggle, onClose }: {
  row: ProductRow;
  needs: Need[] | null;
  ready: Readiness | null;
  busy: boolean;
  onToggle: (next: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={row.name}
      subtitle={`${lineOf(row.category)} · ${row.sold ? "you sell it" : "not sold"}`}
      status={ready ? <StatusChip tone={ready.tone} dot={false}>{ready.label}</StatusChip> : undefined}
      onClose={onClose}
      className={WIDE_SHEET}
      footer={<Button type="button" variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-5">
        <SheetSection title={`Sell ${row.name}`} sub="Saves at once, with Undo. Turning it off asks first; nothing is deleted.">
          <div className="flex items-center gap-3">
            <Switch checked={row.enabled} label={`Sell ${row.name}`} disabled={busy} onChange={onToggle} />
            <span className="text-sm text-[var(--body)]">{row.enabled ? "You sell it" : "You don't sell it"}</span>
          </div>
        </SheetSection>
        <SheetSection title="Ready to quote" sub="What an agent needs on a call, in the order the call uses it. Each one opens its own page.">
          {needs ? (
            <ol className="m-0 list-none p-0">
              {needs.map((need, index) => <Step key={need.key} need={need} index={index} sold={row.sold} />)}
            </ol>
          ) : (
            <p className="m-0 text-sm text-[var(--muted)]">Couldn&apos;t check what it needs. Close the sheet and try again.</p>
          )}
        </SheetSection>
        <SheetSection title="Partners who may send it" sub="Set on each partner; shown here so you see who's affected.">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--body)]">
            <span>{row.partners.length ? row.partners.join(", ") : "No partner may send it yet"}</span>
            <Link href="/app/publishers" className={cn("text-xs", linkClass)}>Manage partners ›</Link>
          </div>
        </SheetSection>
        <SheetSection title="Where it shows up">
          <p className="m-0 text-sm text-[var(--body)]">New lead · lead imports · partner posting · forms · quotes · reports</p>
        </SheetSection>
      </div>
    </Sheet>
  );
}
