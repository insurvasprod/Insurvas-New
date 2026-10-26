"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The agency's own address for carrier files: forwarding the carrier's email is the same as uploading. */
export function ForwardAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(address); setCopied("yes"); } catch { setCopied("no"); }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-foreground">Or forward the carrier&rsquo;s email</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-md bg-[var(--surface-alt)] px-3 py-2 font-mono text-sm text-foreground">{address}</code>
        <Button type="button" variant="outline" className="border-[var(--border-strong)] px-3" onClick={() => void copy()}>
          <Copy className="size-4" aria-hidden="true" />
          {copied === "yes" ? "Copied" : "Copy"}
        </Button>
      </div>
      {copied === "no" && <p className="mt-2 text-xs text-muted-foreground">Copying is blocked here. Select the address and copy it yourself.</p>}
    </div>
  );
}

/**
 * What the first number looks like, before the agency has a statement of its own. Labelled a sample
 * in its title and its figures; nothing here is written to the account.
 */
export function FirstValueSample() {
  const [open, setOpen] = useState(false);
  const rows = [
    ["FE-20931", "Advance not paid", "$612.00"],
    ["TL-11804", "Paid at the wrong rate", "$148.50"],
    ["FE-20417", "Charged back twice", "$390.00"],
  ];
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls="first-value-sample" className="text-sm font-semibold text-[var(--accent-ink)] hover:text-foreground hover:underline" onClick={() => setOpen((value) => !value)}>
        {open ? "Hide the sample" : "No statement handy? See a sample result"}
      </button>
      {open && (
        <section id="first-value-sample" aria-label="Sample result" className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="bg-[var(--brand-700)] px-4 py-4 text-[var(--on-dark)]">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--nav-muted)]">Sample · not your data</p>
            <p className="mt-1 text-sm text-[var(--nav-muted)]">You appear to be owed</p>
            <p className="text-3xl font-semibold tracking-[-0.03em] tabular-nums">$3,412.60</p>
            <p className="mt-1 text-xs text-[var(--nav-muted)]">7 policies on one sample statement</p>
          </div>
          <ul className="text-sm" aria-label="Sample findings">
            {rows.map(([policy, why, amount]) => (
              <li key={policy} className="flex items-baseline gap-3 border-t border-border px-4 py-2.5">
                <span className="font-semibold tabular-nums text-foreground">{policy}</span>
                <span className="min-w-0 flex-1 text-[var(--body)]">{why}</span>
                <span className="font-semibold tabular-nums text-foreground">{amount}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
