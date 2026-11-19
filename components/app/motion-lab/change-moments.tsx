"use client";

import { addTransitionType, startTransition, useEffect, useRef, useState, ViewTransition } from "react";
import { Bell, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection } from "@/components/ui/bulk-bar";
import { BarSeries } from "@/components/ui/chart";
import { CheckBox } from "@/components/ui/check-box";
import { CountBadge } from "@/components/ui/count-badge";
import { DoneStamp } from "@/components/ui/done-stamp";
import { control, Field } from "@/components/ui/field";
import { SaveStatus, type SaveState } from "@/components/ui/save-status";
import { useDenyShake } from "@/components/ui/use-deny-shake";
import { useSavedFlash } from "@/components/ui/use-saved-flash";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { useGlidePill } from "@/components/ui/tab-track";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UploadProgress } from "@/components/ui/upload-progress";
import { useArrivals } from "@/components/ui/use-arrivals";
import { useRowExit } from "@/components/ui/use-row-exit";
import { ShowSwap, useShow, ViewSwitch } from "@/components/ui/view-switch";
import { notify } from "@/lib/notify";

import { Section } from "./lab-section";

/**
 * Motion lab · Tier 1 and Tier 2 (2026-11-17, plan "more premium motion"): the new change moments on the real kit
 * parts, for the owner's sign-off before any screen gets them. Every specimen here is lab-only.
 */

const STEP_MOTION = { "nav-forward": "page-forward", "nav-back": "page-back", default: "page-area" } as const;

// ---------------------------------------------------------------------------------------------------------- Tier 1

const TODO = [
  { id: "t1", text: "Match the Americo statement", who: "Avery Stone" },
  { id: "t2", text: "Approve 3 vendor bills", who: "Jordan Lee" },
  { id: "t3", text: "Close October", who: "Sam Rivera" },
  { id: "t4", text: "Check the chargeback on 0119990312", who: "Casey Brooks" },
];
const MORE = ["Pay Riley Chen's advance", "Send the 1099s", "Review the new lead source", "Fix a missing rate"];

/** 1 · A done row leaves; a new row arrives tinted. */
function RowsLeaveAndArrive() {
  const [rows, setRows] = useState(TODO);
  const [added, setAdded] = useState(0);
  const leave = useRowExit();
  const isNew = useArrivals(rows.map((row) => row.id));
  const done = (id: string) => void leave.exit(id, () => setRows((now) => now.filter((row) => row.id !== id)));
  const add = () => {
    setRows((now) => [{ id: `n${added}`, text: MORE[added % MORE.length], who: "Riley Chen" }, ...now]);
    setAdded((n) => n + 1);
  };
  return (
    <Section title="Rows leave and arrive" note="Press Done: the row fades, slides and closes up. Add one: it comes in with a soft tint.">
      <div className="flex gap-2">
        <Button variant="outline" onClick={add}>Add a row</Button>
        <Button variant="outline" onClick={() => { TODO.forEach((row) => leave.restore(row.id)); setRows(TODO); }}>Reset</Button>
      </div>
      <div className="flex flex-col rounded-lg border border-[var(--border)]">
        {rows.map((row) => (
          <div key={row.id} {...leave.rowProps(row.id)} data-row-new={isNew(row.id) ? "" : undefined} className="flex min-h-[44px] items-center gap-3 border-b border-[var(--border)] px-4 last:border-b-0">
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--ink)]">{row.text}</span>
            <span className="text-sm text-[var(--body)]">{row.who}</span>
            <Button variant="outline" onClick={() => done(row.id)}>Done</Button>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-3 text-sm text-[var(--body)]">All done.</p>}
      </div>
    </Section>
  );
}

/** 2 · Counts roll; a badge pops in and shrinks away at 0. */
function CountsRoll() {
  const [count, setCount] = useState(3);
  return (
    <Section title="Counts roll" note="The number rolls to its new value. A count pops in when it first shows and shrinks away at 0.">
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setCount((n) => n + 1)}>Add one</Button>
        <Button variant="outline" onClick={() => setCount((n) => Math.max(0, n - 1))}>Take one</Button>
        <Button variant="outline" onClick={() => setCount(0)}>Clear</Button>
        <Button variant="outline" onClick={() => setCount((n) => n + 12)}>Add 12</Button>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <span className="flex items-center gap-2 text-[var(--ink)]">Needs you <CountBadge value={count} label={`${count} need you`} tone="action" /></span>
        <span className="flex items-center gap-2 text-[var(--ink)]">Pay issues <CountBadge value={count} label={`${count} pay issues`} tone="danger" /></span>
        <span className="relative inline-flex size-9 items-center justify-center rounded-lg border border-[var(--border)]">
          <Bell aria-hidden="true" className="size-4" />
          <CountBadge value={count} label={`${count} unread`} tone="action" className="absolute -right-2 -top-2" />
        </span>
      </div>
    </Section>
  );
}

const STATES: ReadonlyArray<{ label: string; tone: StatusTone }> = [
  { label: "Open", tone: "warning" },
  { label: "In review", tone: "info" },
  { label: "Settled", tone: "good" },
];

/** 3 · A chip's state changes by cross-fade. */
function ChipsCrossFade() {
  const [at, setAt] = useState(0);
  const state = STATES[at];
  return (
    <Section title="Status chips cross-fade" note="Open → In review → Settled: the colour turns over 0.2s instead of cutting. Every chip in the app does this since Wave A.">
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <Button variant="outline" onClick={() => setAt((n) => (n + 1) % STATES.length)}>Next state</Button>
        <StatusChip tone={state.tone}>{state.label}</StatusChip>
      </div>
    </Section>
  );
}

const CARRIERS = [
  { key: "americo", label: "Americo", value: 18 },
  { key: "aetna", label: "Aetna", value: 11 },
  { key: "moo", label: "Mutual of Omaha", value: 24 },
  { key: "foresters", label: "Foresters", value: 7 },
];

/** 4 · The Table · Chart pill glides, and the two views cross. */
function TableChartSwitch() {
  const show = useShow("table");
  return (
    <Section title="Table · Chart" note="The pill slides to your pick and the view under it settles in. Every switch does this since Wave A.">
      <div className="flex flex-wrap items-center gap-6 text-sm text-[var(--body)]">
        <ViewSwitch fallback="table" label="Show as" />
      </div>
      <ShowSwap fallback="table">
        {show === "chart" ? (
          <BarSeries bars={CARRIERS} summary="Policies by carrier" unit="policies" />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Carrier</TableHead><TableHead className="text-right">Policies</TableHead></TableRow></TableHeader>
            <TableBody>
              {CARRIERS.map((row) => <TableRow key={row.key}><TableCell>{row.label}</TableCell><TableCell className="text-right tabular-nums">{row.value}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        )}
      </ShowSwap>
    </Section>
  );
}

const RECORDS = [
  { id: "BILL-1042", vendor: "Lead Sail", amount: "$1,240.00", due: "Nov 20" },
  { id: "BILL-1043", vendor: "Quote Harbor", amount: "$860.00", due: "Nov 24" },
];

/** 5 · ‹ › between records slides from the side you clicked. */
function RecordStepper() {
  const [at, setAt] = useState(0);
  const go = (to: number) => {
    if (to < 0 || to >= RECORDS.length || to === at) return;
    startTransition(() => { addTransitionType(to > at ? "nav-forward" : "nav-back"); setAt(to); });
  };
  const record = RECORDS[at];
  return (
    <Section title="Record ‹ ›" note="Next slides the record in from the right; back, from the left. The title holds still.">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Previous bill" disabled={at === 0} onClick={() => go(at - 1)}><ChevronLeft aria-hidden="true" /></Button>
        <Button variant="outline" size="icon" aria-label="Next bill" disabled={at === RECORDS.length - 1} onClick={() => go(at + 1)}><ChevronRight aria-hidden="true" /></Button>
        <span className="text-sm text-[var(--body)] tabular-nums">{at + 1} of {RECORDS.length}</span>
      </div>
      <div className="overflow-hidden">
        <ViewTransition key={record.id} enter={STEP_MOTION} exit={STEP_MOTION} default="none">
          <div className="grid grid-cols-3 gap-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
            <div><div className="text-[var(--muted)]">Bill</div><div className="font-semibold text-[var(--ink)]">{record.id}</div></div>
            <div><div className="text-[var(--muted)]">Vendor</div><div className="text-[var(--ink)]">{record.vendor}</div></div>
            <div><div className="text-[var(--muted)]">Amount · due</div><div className="tabular-nums text-[var(--ink)]">{record.amount} · {record.due}</div></div>
          </div>
        </ViewTransition>
      </div>
    </Section>
  );
}

const RAIL = [
  { key: "files", label: "Carrier files", count: 2 },
  { key: "match", label: "Match", count: 5 },
  { key: "issues", label: "Pay issues", count: 1 },
  { key: "pay", label: "Producer pay", count: 0 },
];

/** 6 · The active rail step's highlight glides. */
function RailGlide() {
  const [at, setAt] = useState("files");
  const track = useRef<HTMLDivElement>(null);
  const pill = useGlidePill(track, { items: ":scope > button", chosen: '[aria-current="page"]', watch: "aria-current" });
  return (
    <Section title="Rail step glides" note="The highlight slides to the step you pick, as the tabs already do.">
      <div ref={track} data-glide-track="" className="relative isolate flex w-[220px] flex-col gap-1">
        {pill && (
          <span aria-hidden="true" data-tab-pill={pill.glide ? "glide" : ""} data-tab-indicator="soft" style={{ transform: `translate(${pill.left}px, ${pill.top}px)`, width: pill.width, height: pill.height }} />
        )}
        {RAIL.map((step) => (
          <button
            key={step.key}
            type="button"
            aria-current={step.key === at ? "page" : undefined}
            onClick={() => setAt(step.key)}
            className={`flex h-9 items-center justify-between rounded-[5px] px-3 text-left text-sm ${step.key === at ? "font-semibold text-[var(--accent-ink)]" : "text-[var(--body)] hover:text-[var(--ink)]"}`}
          >
            {step.label}
            <CountBadge value={step.count} label={`${step.count} in ${step.label}`} />
          </button>
        ))}
      </div>
    </Section>
  );
}

export function TierOne() {
  return (
    <>
      <RowsLeaveAndArrive />
      <CountsRoll />
      <ChipsCrossFade />
      <TableChartSwitch />
      <RecordStepper />
      <RailGlide />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------- Tier 2

/** 7 · Saving… → ✓ Saved → gone; and a saved cell glows once. */
function SaveMoments() {
  const [state, setState] = useState<SaveState>("idle");
  const savedCell = useSavedFlash();
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const save = () => {
    window.clearTimeout(timer.current);
    setState("saving");
    timer.current = window.setTimeout(() => setState("saved"), 700);
  };
  return (
    <Section title="Saved" note="Saving…, then ✓ Saved with the tick popping, gone after 2s. An edited cell glows green once." onReplay={() => savedCell.flash("rent")}>
      <div className="flex items-center gap-3">
        <Button onClick={save}>Save</Button>
        <SaveStatus state={state} />
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Expense</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Office rent</TableCell>
            <TableCell {...savedCell.props("rent")} className="text-right tabular-nums">$2,400.00</TableCell>
          </TableRow>
          <TableRow><TableCell>Dialer seats</TableCell><TableCell className="text-right tabular-nums">$396.00</TableCell></TableRow>
        </TableBody>
      </Table>
    </Section>
  );
}

/** 8 · An error line opens gently; a refused submit shakes once. */
function ErrorMoments() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refusal = useDenyShake();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      setError("Enter the policy number.");
      refusal.deny();
      return;
    }
    setError(null);
  };
  return (
    <Section title="Errors" note="Send it empty: the error line opens and fades in, and the form shakes once. Type to clear it.">
      <form noValidate onSubmit={submit} className="flex max-w-[360px] flex-col gap-3">
        <div className={refusal.className}>
          <Field label="Policy number" htmlFor="lab-policy" error={error}>
            <input id="lab-policy" className={control} value={value} onChange={(event) => { setValue(event.target.value); if (error) setError(null); }} />
          </Field>
        </div>
        <Button type="submit" className="w-fit">Save</Button>
      </form>
    </Section>
  );
}

const PEOPLE = ["Avery Stone", "Jordan Lee", "Sam Rivera", "Casey Brooks", "Riley Chen"].map((name, i) => ({ id: `p${i}`, name, premium: 60 + i * 17 }));

/** 9 · The bulk bar slides down and up, and its count rolls; the table never jumps. */
function BulkMoments() {
  const selection = useRowSelection(PEOPLE.map((person) => person.id));
  return (
    <Section title="Bulk bar" note="Tick rows: the bar slides down over the table's top and the count rolls. Untick all: it slides away. The table stays put.">
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <BulkBar count={selection.count} noun={["policy", "policies"]} onClear={selection.clear} selectAll={<SelectAllCheckbox selection={selection} />} actions={<Button variant="outline" onClick={() => notify.done(`${selection.count} exported`)}>Export</Button>} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><SelectAllCheckbox selection={selection} /></TableHead>
              <TableHead>Client</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PEOPLE.map((person) => (
              <TableRow key={person.id}>
                <TableCell><RowCheckbox selection={selection} id={person.id} label={`Select ${person.name}`} /></TableCell>
                <TableCell>{person.name}</TableCell>
                <TableCell className="text-right tabular-nums">${person.premium}.00</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}

/** 10 · The kit's checkbox, now the only one in the app (Wave B): the tick pops in; a list's header shows a dash. */
function CheckboxCompare() {
  const [kit, setKit] = useState(false);
  const [some, setSome] = useState(true);
  return (
    <Section title="Checkbox" note="Tick it: the tick pops in. Every checkbox in the app is this one now; a select-all box shows a dash while only some rows are ticked.">
      <div className="flex flex-wrap items-center gap-8 text-sm">
        <label className="flex items-center gap-2"><CheckBox checked={kit} onChange={(event) => setKit(event.target.checked)} />Tick me</label>
        <label className="flex items-center gap-2"><CheckBox checked={false} mixed={some} onChange={() => setSome(!some)} />Some of a list</label>
      </div>
    </Section>
  );
}

/** 11 · Done stamps, an upload that ends with a check, a drop zone that lifts. */
function DoneMoments() {
  const [stamp, setStamp] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const upload = () => {
    window.clearInterval(timer.current);
    setProgress(0);
    timer.current = window.setInterval(() => {
      setProgress((now) => {
        const next = Math.min(1, (now ?? 0) + 0.2);
        if (next >= 1) window.clearInterval(timer.current);
        return next;
      });
    }, 320);
  };
  return (
    <Section title="Done" note="The check draws and the label pops, once. An upload fills, then ends with a check. Drag a file over the box: it lifts and glows." onReplay={() => setStamp((n) => n + 1)}>
      <div key={stamp} className="flex flex-wrap items-center gap-3">
        <DoneStamp label="Paid" />
        <DoneStamp label="Matched" />
        <DoneStamp label="Month closed" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Button variant="outline" className="w-fit" onClick={upload}>Upload a file</Button>
          {progress !== null && <UploadProgress name="americo-october.csv" value={progress} />}
        </div>
        <div
          data-drag-over={over ? "" : undefined}
          onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); }}
          className="m-dropzone grid min-h-24 place-items-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-4 text-sm text-[var(--body)]"
        >
          Drop a carrier file here
        </div>
      </div>
    </Section>
  );
}

export function TierTwo() {
  return (
    <>
      <SaveMoments />
      <ErrorMoments />
      <BulkMoments />
      <CheckboxCompare />
      <DoneMoments />
    </>
  );
}
