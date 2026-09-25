import type { ReactNode } from "react";
import { Check, Phone, ShieldCheck } from "lucide-react";

/**
 * Product screens drawn for the landing page, from the p-mkt-home board. The names and figures are
 * SAMPLE data — every window carries a "Sample data" tag so no reader mistakes them for a customer's
 * results — but each screen shows a behaviour the product really has (server-settled claims, the
 * four pre-dial checks, "—" instead of $0.00, stage changes that need a disposition).
 *
 * Plain server components: no state, so they render into the hero, the tour and the journey alike.
 */

export function AppWindow({ url, children, className = "", tag = true }: { url: string; children: ReactNode; className?: string; tag?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-border bg-card text-left shadow-[0_30px_80px_-20px_rgba(0,0,0,.45),0_0_0_1px_rgba(255,255,255,.04)] ${className}`}>
      <div className="flex items-center gap-2 border-b border-border bg-[var(--surface-alt)] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[var(--error)]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[var(--warning)]" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
        <span className="ml-3 min-w-0 flex-1 truncate rounded-md bg-card px-3 py-1 text-xs text-muted-foreground">{url}</span>
        {tag && <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground">Sample data</span>}
      </div>
      {children}
    </div>
  );
}

function Pill({ tone, children }: { tone: "danger" | "neutral" | "success" | "brand"; children: ReactNode }) {
  const tones = {
    danger: "bg-[var(--error-surface)] text-[var(--error-ink)]",
    neutral: "bg-[var(--surface-alt)] text-muted-foreground",
    success: "bg-[var(--success-surface)] text-[var(--success-ink)]",
    brand: "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)] text-[var(--accent-ink)]",
  };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function InboundMock() {
  const rows = [
    { name: "Grace Oyelaran", partner: "Northline BPO", wait: "4m 12s", breached: true },
    { name: "Alonzo Pike", partner: "Cobalt Media", wait: "1m 02s" },
    { name: "Tomas Herrera", partner: "Harbor Reach", wait: "0m 48s" },
    { name: "Priya Raman", partner: "Cobalt Media", wait: "0m 21s" },
  ];
  return (
    <div className="p-4">
      <div className="grid grid-cols-4 gap-2">
        {[["Waiting", "14"], ["Longest wait", "4m 12s"], ["Claimed", "3"], ["Accepted", "94%"]].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border px-3 py-2">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1.3fr_1fr_.7fr_1fr] bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">
          <span>Customer</span><span>Partner</span><span>Wait</span><span>Screening</span>
        </div>
        {rows.map((row, index) => (
          <div key={row.name} className={`grid grid-cols-[1.3fr_1fr_.7fr_1fr] items-center border-t border-border px-3 py-2 text-xs ${index === 0 ? "bg-[color-mix(in_srgb,var(--primary)_6%,transparent)]" : ""}`}>
            <span className="truncate font-semibold text-foreground">{row.name}</span>
            <span className="truncate text-muted-foreground">{row.partner}</span>
            <span className="tabular-nums text-foreground">{row.wait}</span>
            <span>{row.breached ? <Pill tone="danger">SLA breached</Pill> : <Pill tone="neutral">Waiting</Pill>}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DialerMock({ scanClass = "" }: { scanClass?: string }) {
  const checks = [
    ["Consent on file", "Web form, 12 Sep"],
    ["DNC registry", "Clear · 3 min ago"],
    ["Tenant suppression", "Not suppressed"],
    ["Calling window", "Open until 8:00 PM CT"],
  ];
  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-sm font-semibold text-[var(--accent-ink)]">MV</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">Marisol Vega</div>
          <div className="text-xs tabular-nums text-muted-foreground">(312) 555–0148 · 10:42 AM her time · attempt 1</div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--on-primary)]"><Phone className="size-3.5" aria-hidden="true" />Click to call</span>
      </div>
      <div className={`mt-3 overflow-hidden rounded-lg border border-border ${scanClass}`}>
        {checks.map(([label, value], index) => (
          <div key={label} className={`flex items-center gap-2.5 px-3 py-2 text-xs ${index ? "border-t border-border" : ""}`}>
            <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--success)] text-white"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span>
            <span className="flex-1 font-semibold text-foreground">{label}</span>
            <span className="text-muted-foreground">{value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-[var(--success)]" aria-hidden="true" />The server re-checks all four immediately before it dials.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Contacted", "No answer", "Callback", "Application"].map((label, index) => (
          <span key={label} className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${index === 0 ? "border-[var(--primary)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-foreground" : "border-border text-muted-foreground"}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

export function CpaMock() {
  const rows = [
    ["Cobalt Media · FE-Sep", "1,142", "$4,500", "$145.16"],
    ["Harbor Reach · TL-Sep", "884", "$3,180", "$265.00"],
    ["Northline · MS-Aug", "612", "$2,100", "—"],
  ];
  return (
    <div className="p-4">
      <div className="text-xs text-muted-foreground">True CPA · 1–22 September</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums tracking-[-0.03em] text-foreground">$227.44</span>
        <span className="text-xs text-muted-foreground">per issued policy</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">across 2,638 leads and $9,780 of spend</div>
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1.6fr_.7fr_.7fr_.8fr] bg-[var(--surface-alt)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">
          <span>Vendor &amp; campaign</span><span className="text-right">Leads</span><span className="text-right">Spend</span><span className="text-right">True CPA</span>
        </div>
        {rows.map(([name, leads, spend, cpa]) => (
          <div key={name} className="grid grid-cols-[1.6fr_.7fr_.7fr_.8fr] border-t border-border px-3 py-2 text-xs tabular-nums">
            <span className="truncate font-semibold text-foreground">{name}</span>
            <span className="text-right text-muted-foreground">{leads}</span>
            <span className="text-right text-muted-foreground">{spend}</span>
            <span className={`text-right font-semibold ${cpa === "—" ? "text-muted-foreground" : "text-foreground"}`}>{cpa}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">A missing figure is —, never $0.00.</p>
    </div>
  );
}

export function BoardMock() {
  const columns = [
    { stage: "New", count: "311", cards: ["Marisol Vega", "Dwayne Ellis"] },
    { stage: "Contacted", count: "402", cards: ["Grace Oyelaran", "Alonzo Pike"] },
    { stage: "Quoted", count: "288", value: "$412k", cards: ["Renée Boudreaux"] },
    { stage: "Submitted", count: "190", value: "$286k", cards: ["Curtis Mbeki"] },
    { stage: "Issued", count: "93", value: "$178k", cards: ["Lorraine Fusco"] },
  ];
  return (
    <div className="grid grid-cols-5 gap-2 p-4">
      {columns.map((column, index) => (
        <div key={column.stage} className="min-w-0 rounded-lg bg-[var(--surface-alt)] p-2">
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate text-xs font-semibold text-foreground">{column.stage}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{column.count}</span>
          </div>
          <div className="mt-0.5 h-4 text-xs tabular-nums text-muted-foreground">{column.value ?? ""}</div>
          <div className="mt-1 space-y-1.5">
            {column.cards.map((card) => (
              <div key={card} className={`truncate rounded-md border bg-card px-2 py-1.5 text-xs font-semibold text-foreground ${index === 4 ? "border-[var(--success)]" : "border-border"}`}>{card}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Small floating satellites for the hero stage. */
export function Satellite({ icon, label, value, tone = "brand" }: { icon: ReactNode; label: string; value: string; tone?: "brand" | "success" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card/95 px-3.5 py-2.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,.45)] backdrop-blur">
      <span className={`inline-flex size-8 items-center justify-center rounded-lg ${tone === "success" ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--accent-ink)]"}`}>{icon}</span>
      <span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-sm font-semibold tabular-nums text-foreground">{value}</span>
      </span>
    </div>
  );
}
