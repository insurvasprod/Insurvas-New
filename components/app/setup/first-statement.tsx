"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";

import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, control } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { percentLabel, periodLabel, type FirstStatementFindings } from "@/lib/ledger/firstStatement";
import { statementDay, statementMoney } from "@/lib/ledger/statementConstants";
import { statementFileKind, statementFileProblem } from "@/lib/ledger/statementFile";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Statement first (ledger-r1 board 3·A, owner pick 2026-11-19): Get set up for a Ledger agent in three steps on one
 * page. 1 Your statement: drop the file, nothing else asked. 2 Check what we found: the six cards the board draws
 * (carrier, policies, period, rate, advance, already wrong), each changeable, and one Looks Right. 3 Your money:
 * Looks Right writes everything in one go (app/api/app/statements/first) and opens the Ledger home with the money
 * already checked. Carriers, states and licences wait in Get set up's Fine-tune later.
 */

const STEPS = ["Your statement", "Check what we found", "Your money"] as const;
const ACCEPT = ".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type Read = {
  findings: FirstStatementFindings;
  carriers: Array<{ id: string; name: string }>;
  products: Array<{ code: string; name: string }>;
  productCode: string | null;
  duplicate: boolean;
};

type Choices = { carrierId: string; periodStart: string; periodEnd: string; productCode: string; ratePct: string; advance: boolean; advancePct: string; advanceMonths: string };

async function post<T>(form: FormData): Promise<T> {
  const response = await fetch("/api/app/statements/first", { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Something went wrong; nothing was written.");
  return data;
}

const pct = (bp: number) => String(bp / 100);
const toBp = (text: string) => Math.round(Number(text) * 100);
const validPct = (text: string, max: number) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) > 0 && Number(text) <= max;

export function FirstStatement({ blocked }: { blocked: string | null }) {
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [panel, setPanel] = useState<"change" | "policies" | "wrong" | null>(null);

  async function choose(next: File | null | undefined) {
    setError(null);
    if (!next || blocked) return;
    const problem = statementFileProblem(next);
    if (problem) { setError(problem); return; }
    if (statementFileKind(next) === "pdf") { setError("A PDF's lines are typed in by hand, so it can't be read here. Drop the carrier's Excel or CSV file, or use Import a Statement for the PDF."); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("action", "read");
      form.set("file", next);
      const data = await post<Read>(form);
      const f = data.findings;
      setFile(next);
      setRead(data);
      setChoices({
        carrierId: f.carrier.carrierId ?? "", periodStart: f.period.start, periodEnd: f.period.end, productCode: data.productCode ?? "",
        ratePct: pct(f.rate.rateBp), advance: f.advance !== null, advancePct: f.advance ? pct(f.advance.pctBp) : "75", advanceMonths: String(f.advance?.months ?? 9),
      });
      // Nothing guessed for the carrier or the product: the changes open, so the one thing to pick is in view.
      setPanel(!f.carrier.carrierId || !data.productCode ? "change" : null);
      setStep(1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement could not be read.");
    } finally {
      setBusy(false);
    }
  }

  const problem = !choices ? null
    : !choices.carrierId ? "Choose the carrier this statement is from."
    : !choices.productCode ? "Choose the product these policies are."
    : !choices.periodStart || !choices.periodEnd || choices.periodEnd < choices.periodStart ? "Check the period: it ends before it starts."
    : !validPct(choices.ratePct, 1000) ? "Enter your rate as a percent, like 100."
    : choices.advance && (!validPct(choices.advancePct, 100) || !(Number(choices.advanceMonths) >= 1 && Number(choices.advanceMonths) <= 120)) ? "Enter the advance as a percent and its months."
    : null;

  async function confirm() {
    if (!file || !choices || problem || blocked) return;
    setBusy(true); setError(null);
    setStep(2);
    const form = new FormData();
    form.set("action", "confirm");
    form.set("file", file);
    form.set("choices", JSON.stringify({
      carrier_id: choices.carrierId, period_start: choices.periodStart, period_end: choices.periodEnd, product_code: choices.productCode,
      rate_bp: toBp(choices.ratePct), advance: choices.advance ? { pct_bp: toBp(choices.advancePct), months: Math.round(Number(choices.advanceMonths)) } : null,
    }));
    try {
      await notify.promise(post<{ accepted: number; policiesAdded: number; opened: number }>(form), {
        loading: "Setting up from your statement…",
        done: (data) => ({ title: `${data.accepted.toLocaleString("en-US")} ${data.accepted === 1 ? "line" : "lines"} checked`, detail: data.opened ? `${data.opened} pay ${data.opened === 1 ? "issue" : "issues"} found.` : "Your money is on the Dashboard." }),
        fail: null,
      });
      router.push("/app/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Nothing was written.");
      setStep(1);
      setBusy(false);
    }
  }

  function startOver() {
    setStep(0); setFile(null); setRead(null); setChoices(null); setPanel(null); setError(null);
  }

  const set = (patch: Partial<Choices>) => setChoices((current) => (current ? { ...current, ...patch } : current));
  const toggle = (next: "change" | "policies" | "wrong") => setPanel((current) => (current === next ? null : next));
  const linkClass = "text-[var(--accent-ink)] underline-offset-2 hover:underline";

  const header = (
    <PageHeader
      title={step === 0 ? "Get set up" : "Check what we found"}
      description="One commission statement is enough to see your money: the carrier, your policies, your rate and your advance are read off it. Carriers, states and licences can wait in Get set up's Fine-tune later."
      lead={<InboundStepBar current={step} steps={STEPS} label="Statement first steps" />}
      actions={step === 0 ? (
        <>
          <Link href="/app/setup" className={buttonVariants({ variant: "outline" })}>Get Set Up</Link>
          <Link href="/app/statements?import=1" className={buttonVariants({ variant: "outline" })}>Import a Statement</Link>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" onClick={startOver} disabled={busy}>Choose Another File</Button>
          <Button type="button" data-guide="first-statement-confirm" onClick={() => void confirm()} disabled={busy || Boolean(problem) || Boolean(blocked) || Boolean(read?.duplicate)} title={blocked ?? (read?.duplicate ? "This file is already imported for this carrier and period." : problem ?? undefined)}>
            Looks Right
          </Button>
        </>
      )}
    />
  );

  const errorLine = error ? <p role="alert" className="m-error-in m-0 text-sm text-[var(--error-ink)]">{error}</p> : null;

  if (step === 0 || !read || !choices) {
    const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); void choose(event.dataTransfer.files?.[0]); };
    return (
      <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
        {header}
        <button
          type="button"
          data-guide="first-statement-drop"
          aria-disabled={Boolean(blocked) || busy}
          title={blocked ?? undefined}
          onClick={() => { if (!blocked && !busy) picker.current?.click(); }}
          onDragOver={(event) => { event.preventDefault(); if (!blocked) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          data-drag-over={over ? "" : undefined}
          className={cn(
            "m-dropzone flex min-h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center",
            over ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-border bg-[var(--color-card)]",
            blocked || busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-[var(--surface-alt)]",
          )}
        >
          <span className="text-base font-semibold text-[var(--ink)]">{busy ? "Reading your statement…" : "Drop a commission statement from any carrier"}</span>
          <span className="text-sm text-muted-foreground">Excel or CSV, exactly as the carrier sent it. Nothing else needed.</span>
          <span className={cn(buttonVariants(), "mt-3")}>Choose a File</span>
        </button>
        <input ref={picker} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        {errorLine}
      </div>
    );
  }

  const f = read.findings;
  const carrierName = read.carriers.find((carrier) => carrier.id === choices.carrierId)?.name ?? null;
  const productName = read.products.find((product) => product.code === choices.productCode)?.name ?? null;
  const rateBp = validPct(choices.ratePct, 1000) ? toBp(choices.ratePct) : f.rate.rateBp;
  const firstWrong = f.wrong[0];
  const changeLink = <button type="button" className={linkClass} onClick={() => toggle("change")}>Change</button>;

  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      {header}
      <StatRow label="What we found">
        <StatCard
          label="Carrier"
          value={carrierName ?? "Choose one"}
          tone={carrierName ? "default" : "warn"}
          period={f.carrier.from && carrierName ? `from the ${f.carrier.from}` : "not named on the statement"}
          action={changeLink}
        />
        <StatCard
          label="Policies"
          value={`${f.policies.length.toLocaleString("en-US")} new`}
          period={f.policies.length ? (f.policies.some((policy) => policy.product) ? "added to your book as the file names them" : `added to your book as ${productName ?? "…"}`) : "every one is in your book"}
          action={f.policies.length ? <button type="button" className={linkClass} onClick={() => toggle("policies")}>See Them</button> : undefined}
        />
        <StatCard label="Period" value={periodLabel(choices.periodStart, choices.periodEnd)} period={f.period.from === "line dates" ? "from the line dates" : "the statement has no dates"} action={changeLink} />
        <StatCard
          label="Your rate"
          value={percentLabel(rateBp)}
          period={f.rate.from === "rate column" ? `the Rate column on ${f.rate.lines} of ${f.rate.of} lines` : f.rate.from === "paid ÷ premium" ? `paid ÷ premium on ${f.rate.lines} of ${f.rate.of} lines` : "no rate on the statement"}
          action={changeLink}
        />
        <StatCard
          label="Advance"
          value={choices.advance && validPct(choices.advancePct, 100) ? `${percentLabel(toBp(choices.advancePct))} · ${choices.advanceMonths} mo` : "None"}
          period={choices.advance ? (f.advance ? `paid ÷ annual premium, ${f.advance.lines} of ${f.advance.of} advance lines` : "as you set it") : "paid as earned"}
          action={changeLink}
        />
        <StatCard
          label="Already wrong"
          value={`${f.wrong.length} ${f.wrong.length === 1 ? "line" : "lines"}`}
          tone={f.wrong.length ? "warn" : "default"}
          period={firstWrong ? `${firstWrong.insuredName ?? firstWrong.policyNumber ?? `Line ${firstWrong.lineNumber}`} ${firstWrong.what === "rate" ? "paid" : "advanced"} at ${percentLabel(firstWrong.paidBp)}, not ${percentLabel(firstWrong.expectedBp)}` : "every line at your rate"}
          action={f.wrong.length > 1 ? <button type="button" className={linkClass} onClick={() => toggle("wrong")}>See Them</button> : undefined}
        />
      </StatRow>
      {read.duplicate ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">This file is already imported for this carrier and period. <Link className={linkClass} href="/app/statements">Open Statements</Link></p> : null}
      {errorLine}

      {panel === "change" ? (
        <TableCard title="Change what we found" action={<Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Done</Button>}>
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Carrier" htmlFor="first-carrier">
              <select id="first-carrier" className={control} value={choices.carrierId} onChange={(event) => set({ carrierId: event.target.value })}>
                <option value="">Choose the carrier…</option>
                {read.carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
              </select>
            </Field>
            <Field label="Product" htmlFor="first-product" hint="Used where the file names no product. The rate and advance are saved for every product the file names, and this one.">
              <select id="first-product" className={control} value={choices.productCode} onChange={(event) => set({ productCode: event.target.value })}>
                <option value="">Choose the product…</option>
                {read.products.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Period from" htmlFor="first-start"><Input id="first-start" type="date" className="mt-1.5" value={choices.periodStart} onChange={(event) => set({ periodStart: event.target.value })} /></Field>
              <Field label="To" htmlFor="first-end"><Input id="first-end" type="date" className="mt-1.5" value={choices.periodEnd} onChange={(event) => set({ periodEnd: event.target.value })} /></Field>
            </div>
            <Field label="Your rate (%)" htmlFor="first-rate" hint="What the carrier pays you, as a percent of the annual premium.">
              <Input id="first-rate" inputMode="decimal" className="mt-1.5" value={choices.ratePct} onChange={(event) => set({ ratePct: event.target.value })} />
            </Field>
            <Field label="Advance" htmlFor="first-advance">
              <select id="first-advance" className={control} value={choices.advance ? "yes" : "no"} onChange={(event) => set({ advance: event.target.value === "yes" })}>
                <option value="yes">Paid up front</option>
                <option value="no">None, paid as earned</option>
              </select>
            </Field>
            {choices.advance ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Advance (%)" htmlFor="first-advance-pct"><Input id="first-advance-pct" inputMode="decimal" className="mt-1.5" value={choices.advancePct} onChange={(event) => set({ advancePct: event.target.value })} /></Field>
                <Field label="Months" htmlFor="first-advance-months"><Input id="first-advance-months" inputMode="numeric" className="mt-1.5" value={choices.advanceMonths} onChange={(event) => set({ advanceMonths: event.target.value })} /></Field>
              </div>
            ) : null}
          </div>
          {problem ? <p role="alert" className="m-0 px-4 pb-4 text-sm text-[var(--error-ink)]">{problem}</p> : null}
        </TableCard>
      ) : null}

      {panel === "policies" ? (
        <TableCard title={`${f.policies.length.toLocaleString("en-US")} new policies`} action={<Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Close</Button>}>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Policy number</TableHead><TableHead>Insured</TableHead><TableHead>Issued</TableHead><TableHead className="text-right">Annual premium</TableHead><TableHead className="text-right">Lines</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {f.policies.map((policy) => (
                <TableRow key={policy.policyNumber}>
                  <TableCell className="tabular-nums">{policy.policyNumber}</TableCell>
                  <TableCell>{policy.insuredName}</TableCell>
                  <TableCell className="tabular-nums">{statementDay(policy.effectiveDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{policy.premiumFrom === "none" ? "Not on the statement" : `${statementMoney(policy.annualPremiumCents)}${policy.premiumFrom === "worked out" ? " (worked out)" : ""}`}</TableCell>
                  <TableCell className="text-right tabular-nums">{policy.lines}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {panel === "wrong" ? (
        <TableCard title={`${f.wrong.length} lines already wrong`} action={<Button type="button" variant="outline" size="sm" onClick={() => setPanel(null)}>Close</Button>}>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Line</TableHead><TableHead>Policy number</TableHead><TableHead>Insured</TableHead><TableHead>What</TableHead><TableHead className="text-right">Paid at</TableHead><TableHead className="text-right">Should be</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {f.wrong.map((line) => (
                <TableRow key={line.lineNumber}>
                  <TableCell className="tabular-nums">{line.lineNumber}</TableCell>
                  <TableCell className="tabular-nums">{line.policyNumber ?? "None"}</TableCell>
                  <TableCell>{line.insuredName ?? "Not named"}</TableCell>
                  <TableCell>{line.what === "rate" ? "Rate" : "Advance"}</TableCell>
                  <TableCell className="text-right tabular-nums">{percentLabel(line.paidBp)}</TableCell>
                  <TableCell className="text-right tabular-nums">{percentLabel(line.expectedBp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </div>
  );
}
