"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentProps, type DragEvent, type ReactNode } from "react";

import { ImportDialog, READ_ONLY, type Account } from "@/components/app/accounting/bank-board";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { readableDay } from "@/lib/accounting/bankResultsCore";
import { cn } from "@/lib/utils";

/**
 * Check a payment (round 1 board B1; round 7 board 1·5, owner 2026-11-10): the two pieces of evidence side by
 * side, each a drop zone. The carrier's file opens the one upload pop-up Carrier sync uses; the bank file opens the
 * Import dialog with the file already chosen. Either can come on its own.
 */
type Carriers = ComponentProps<typeof CarrierFileUploadButton>["carriers"];

function Zone({ title, children, disabled, onFile, onClick }: { title: string; children: ReactNode; disabled: boolean; onFile: (file: File | null) => void; onClick: () => void }) {
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) onFile(e.dataTransfer.files?.[0] ?? null);
  };
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-[var(--color-card)] p-4">
      <h2 className="m-0 text-base font-semibold text-[var(--ink)]">{title}</h2>
      <button
        type="button"
        aria-disabled={disabled}
        title={disabled ? READ_ONLY : undefined}
        onClick={() => { if (!disabled) onClick(); }}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn("flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors", over ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-border", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[var(--surface-alt)]")}
      >
        {children}
      </button>
    </section>
  );
}

export function CheckDropZones({ accounts, carriers, readOnly, bankThrough }: { accounts: Account[]; carriers: Carriers; readOnly: boolean; bankThrough: string | null }) {
  const router = useRouter();
  const [carrierOpen, setCarrierOpen] = useState(false);
  const [bankFile, setBankFile] = useState<File | null | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const noAccount = accounts.length === 0;
  const account = accounts[0];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Zone title="1 · What the carrier says" disabled={readOnly} onFile={() => setCarrierOpen(true)} onClick={() => setCarrierOpen(true)}>
        <span className="font-medium text-[var(--ink)]">Drop the carrier&apos;s commission file</span>
        <span className="text-xs text-muted-foreground">CSV, Excel or PDF, read with the layout you set up for that carrier · or <span className="text-[var(--accent-ink)] underline-offset-2 hover:underline">choose a file</span></span>
      </Zone>
      {noAccount ? (
        <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-[var(--color-card)] p-4">
          <h2 className="m-0 text-base font-semibold text-[var(--ink)]">2 · What really landed</h2>
          <div className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm">
            <span className="font-medium text-[var(--ink)]">First add the account the carriers pay into</span>
            <span className="text-xs text-muted-foreground">Only a name and the last four digits are kept. {readOnly ? null : <Link className="text-[var(--accent-ink)] hover:underline" href="/app/bank?view=accounts&add=1">Add an account</Link>}</span>
          </div>
        </section>
      ) : (
        <Zone title="2 · What really landed" disabled={readOnly} onFile={(f) => setBankFile(f)} onClick={() => picker.current?.click()}>
          <span className="font-medium text-[var(--ink)]">Drop your bank statement</span>
          <span className="text-xs text-muted-foreground">A CSV from your bank, any date range · {accounts.length === 1 && account ? `${account.nickname}${account.lastFour ? ` ••${account.lastFour}` : ""} · ` : ""}{bankThrough ? `your lines reach ${readableDay(bankThrough)} · ` : ""}or <span className="text-[var(--accent-ink)] underline-offset-2 hover:underline">choose a file</span></span>
        </Zone>
      )}
      <input ref={picker} type="file" accept=".csv,text/csv" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { setBankFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      {!readOnly ? <CarrierFileUploadButton carriers={carriers} open={carrierOpen} onOpenChange={setCarrierOpen} /> : null}
      {bankFile !== undefined ? <ImportDialog accounts={accounts} initialFile={bankFile} onClose={() => setBankFile(undefined)} onDone={() => router.refresh()} /> : null}
    </div>
  );
}
