"use client";

import { addTransitionType, startTransition, useState, ViewTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InfoTip } from "@/components/ui/info-tip";
import { Sheet } from "@/components/ui/sheet";
import { BarSeries, LineSeries } from "@/components/ui/chart";
import { CheckBox } from "@/components/ui/check-box";
import { CountUp } from "@/components/ui/count-up";
import { Switch } from "@/components/ui/field";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Table, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ViewTabs } from "@/components/ui/view-tabs";
import { notify } from "@/lib/notify";

/**
 * Motion lab (premium motion foundation, 2026-11-09): every pattern of docs/design/UI-CONSISTENCY.md § Motion on
 * the real kit parts, side by side, for the owner's sign-off before the rollout. Nothing here is a page of its own.
 */

const STEPS = ["Carrier files", "Policies", "Commission ledger"] as const;
const STEP_MOTION = { "nav-forward": "page-forward", "nav-back": "page-back", default: "page-area" } as const;

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="text-sm text-[var(--body)]">{note}</p>
      </div>
      {children}
    </Card>
  );
}

/** page-forward / page-back: a step further down slides in from the right, one back up from the left. */
function PageMotion() {
  const [at, setAt] = useState(0);
  // As a rail link does: the move is tagged nav-forward or nav-back, and both sides read the tag.
  const go = (to: number) => { if (to !== at) startTransition(() => { addTransitionType(to > at ? "nav-forward" : "nav-back"); setAt(to); }); };
  return (
    <Section title="Page · forward and back" note="A rail step down slides in from the right; back up, from the left. The rail holds still.">
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {STEPS.map((label, index) => (
            <li key={label}>
              <button type="button" onClick={() => go(index)} aria-current={index === at ? "page" : undefined} className={index === at ? "w-full rounded-lg bg-[var(--primary-soft)] px-3 py-2 text-left text-sm font-semibold" : "w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"}>
                {label}
              </button>
            </li>
          ))}
        </ul>
        <div className="min-h-[140px] overflow-hidden">
          <ViewTransition key={at} enter={STEP_MOTION} exit={STEP_MOTION} default="none">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="text-sm font-semibold text-[var(--ink)]">{STEPS[at]}</div>
              <p className="mt-1 text-sm text-[var(--body)]">The content of step {at + 1} — only this part moves.</p>
            </div>
          </ViewTransition>
        </div>
      </div>
    </Section>
  );
}

function Overlays() {
  const [sheet, setSheet] = useState(false);
  return (
    <Section title="Overlays" note="Dialog: fade + rise + .98 scale. Popover and menu: scale from their side. Hint: fade. Panel: slides from its edge. Exits are shorter than entrances.">
      <div className="flex flex-wrap items-center gap-3">
        <Dialog>
          <DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record the payment?</DialogTitle>
              <DialogDescription>A dialog rises 6px and settles from .98 while the page behind it dims.</DialogDescription>
            </DialogHeader>
            <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
          </DialogContent>
        </Dialog>
        <Popover>
          <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
          <PopoverContent className="w-64 text-sm">A popover grows from the side it opens on.</PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">More</Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Download CSV</DropdownMenuItem>
            <DropdownMenuItem>Print</DropdownMenuItem>
            <DropdownMenuItem>Archive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <InfoTip label="About the hint">A hint fades in on hover.</InfoTip>
        <Button variant="outline" onClick={() => setSheet(true)}>Open side panel</Button>
      </div>
      {sheet && (
        <Sheet title="Policy 0119990312" subtitle="Americo · Eagle Premier" onClose={() => setSheet(false)}>
          <p className="text-sm text-[var(--body)]">A side panel slides in 16px from its edge.</p>
        </Sheet>
      )}
    </Section>
  );
}

function Charts() {
  const [shift, setShift] = useState(0);
  const values = [12, 18, 9, 22, 30, 26, 34].map((v, i) => Math.max(2, v + ((i * 7 + shift * 5) % 11) - 5));
  return (
    <Section title="Charts" note="Bars rise and the line draws once; new figures move the marks to their new values.">
      <div className="flex justify-end"><Button variant="outline" onClick={() => setShift((n) => n + 1)}>New figures</Button></div>
      <div className="grid gap-6 md:grid-cols-2">
        <BarSeries bars={values.map((value, i) => ({ key: `d${i}`, label: `Day ${i + 1}`, value }))} summary="Applications per day" unit="applications" />
        <LineSeries points={values.map((value, i) => ({ key: `d${i}`, label: `Day ${i + 1}`, value }))} summary="Premium per day" unit="premium" />
      </div>
    </Section>
  );
}

const VIEWS = [{ key: "all", label: "All" }, { key: "active", label: "In force" }, { key: "risk", label: "At risk", count: 4 }, { key: "lapsed", label: "Lapsed" }] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

/** indicator + content-in: the chosen tab's pill slides, the view under it settles in. */
function TabsAndFigures() {
  const [view, setView] = useState<ViewKey>("all");
  const figure = { all: "$54,955", active: "$48,210", risk: "$3,120", lapsed: "$3,625" }[view];
  return (
    <Section title="Tabs and figures" note="The chosen tab's pill slides to the next; the figure counts from the old value to the new one.">
      <ViewTabs label="Policy views" tabs={VIEWS} value={view} onChange={setView} />
      <div role="tabpanel" key={view} className="flex items-baseline gap-2">
        <span className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums text-[var(--ink)]"><CountUp text={figure} /></span>
        <span className="text-sm text-[var(--body)]">monthly premium</span>
      </div>
    </Section>
  );
}

const ROWS = Array.from({ length: 34 }, (_, i) => ({ id: `0119990${String(300 + i)}`, client: ["Avery Stone", "Jordan Lee", "Sam Rivera", "Casey Brooks", "Riley Chen"][i % 5], premium: 40 + ((i * 37) % 120) }));

/** rows-page: the next page's rows come in from the side the pager moved toward. */
function Paging() {
  return (
    <Section title="Pager" note="Next page: rows come in from the right; back: from the left. Eight at most, 16ms apart.">
      <PagedTableCard total={ROWS.length} noun="policies" pageSize={8}>
        <Table>
          <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Client</TableHead><TableHead className="text-right">Monthly</TableHead></TableRow></TableHeader>
          <PagedBody>
            {ROWS.map((row) => (
              <TableRow key={row.id}><TableCell>{row.id}</TableCell><TableCell>{row.client}</TableCell><TableCell className="text-right tabular-nums">${row.premium}.00</TableCell></TableRow>
            ))}
          </PagedBody>
        </Table>
      </PagedTableCard>
    </Section>
  );
}

/** Small controls: switch, checkbox, a folded section, a toast, and the sign-in entrance replayed. */
function Controls() {
  const [on, setOn] = useState(false);
  const [ticked, setTicked] = useState(false);
  const replay = () => {
    const root = document.documentElement;
    root.classList.remove("shell-enter");
    void root.offsetWidth; // restart the animations
    root.classList.add("shell-enter");
    window.setTimeout(() => root.classList.remove("shell-enter"), 900);
  };
  return (
    <Section title="Controls" note="The switch slides, the tick pops in, a fold opens by height, a toast arrives, and the first screen after sign-in builds in.">
      <div className="flex flex-wrap items-center gap-5">
        <span className="flex items-center gap-2 text-sm"><Switch checked={on} onChange={setOn} label="Auto-assign" />Auto-assign</span>
        <label className="flex items-center gap-2 text-sm"><CheckBox checked={ticked} onChange={(event) => setTicked(event.target.checked)} />Include lapsed</label>
        <Button variant="outline" onClick={() => notify.done("Saved")}>Show a toast</Button>
        <Button variant="outline" onClick={replay}>Replay sign-in entrance</Button>
      </div>
      <details className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--ink)]">How a policy&apos;s money is worked out</summary>
        <p className="mt-2 text-[var(--body)]">From the ledger, the rate card and the open pay issues. A fold opens by height rather than snapping.</p>
      </details>
    </Section>
  );
}

export function MotionLab() {
  return (
    <div className="m-stagger flex flex-col gap-4">
      <PageMotion />
      <TabsAndFigures />
      <Paging />
      <Overlays />
      <Controls />
      <Charts />
    </div>
  );
}
