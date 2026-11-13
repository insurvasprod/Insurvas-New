import type { KeyboardEvent, ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";

import { cn } from "@/lib/utils";

import { IntentLink } from "./nav-pending";
import { TabTrack } from "./tab-track";
import { ToggleChip } from "./toggle-chip";
import { titleCaseNode } from "@/components/ui/title-case";

/**
 * THE sub-page bar (owner 2026-11-09, "the foundation of every single design"; UI-CONSISTENCY §8): a row of plain
 * text tabs, the chosen one in bright text over a 2px green (`--primary`) line, the others muted, and a hairline
 * under the whole row. It is the bar Appointments & setters drew first (Overview · Calendar · Setup, 2026-11-05),
 * now the one way any page shows its sub-pages or views — the pill tabs on the title's line were "a bit hidden and
 * hard for the eyes to catch". On a page it goes in `PageHeader tabs`, on the title's line between the title and the buttons.
 *
 * Two doors to one look: `ViewTabs` (no hooks, so a server page can draw link tabs; `href`) and `UnderlineTabs`
 * (a client island that also moves with the arrow keys). `TabbedPanels` (view-tabs-panels.tsx) is the client island
 * for server pages that hand in rendered sections.
 *
 * A link tab is an `IntentLink` (2026-11-08, "feel instant"): it fetches its view once the pointer rests on it, and
 * from the click until the view is here it looks chosen and the page's content dims (nav-pending.tsx) — the title,
 * the tabs and the rest of the frame never leave the screen. The green line slides to the chosen tab (TabTrack).
 */
export type ViewTab<K extends string> = {
  key: K;
  label: string;
  /** A small count after the label; omitted when null or undefined. */
  count?: number | null;
  /** "danger" colours a non-zero count, for a tab that holds something to act on. */
  tone?: "danger";
  /** Server pages: the tab is a link to this URL instead of a button. */
  href?: string;
  /** Drawn before the label, e.g. a step's number or a done tick. */
  marker?: ReactNode;
  /** Read after the label by screen readers, e.g. "(done)". */
  srSuffix?: string;
};

/** The row: full width where it stands alone (a hairline across the page), content-wide inside a toolbar row. */
const TRACK = "flex min-w-0 max-w-full gap-5 overflow-x-auto overflow-y-hidden";
const RULE = "border-b border-border";

const item = (selected: boolean) =>
  cn(
    "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-sm font-medium tracking-[-0.01em] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    selected ? "border-[var(--primary)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
  );

function Count({ value, tone }: { value: number | null | undefined; tone?: "danger" }) {
  if (value == null) return null;
  return (
    <span className={cn("rounded-badge px-1.5 text-xs tabular-nums", tone === "danger" && value > 0 ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>
      {value.toLocaleString("en-US")}
    </span>
  );
}

function Body<K extends string>({ tab }: { tab: ViewTab<K> }) {
  return <>{tab.marker}{titleCaseNode(tab.label)}{tab.srSuffix && <span className="sr-only"> {tab.srSuffix}</span>}<Count value={tab.count} tone={tab.tone} /></>;
}

export function ViewTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  actions,
  idPrefix,
  controls,
  className,
}: {
  /** Accessible name of the tab list. */
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange?: (key: K) => void;
  /** Right-aligned on the same row, over the same hairline: the view's actions, primary last. */
  actions?: ReactNode;
  /** Gives each tab an id (`${idPrefix}-${key}`) for a tabpanel's aria-labelledby. */
  idPrefix?: string;
  /** The id of the panel the tabs switch, when there is one; a function when each tab has its own panel. */
  controls?: string | ((key: K) => string);
  /** Layout only (margins). */
  className?: string;
}) {
  const list = (
    <TabTrack role="tablist" aria-label={label} data-subpage-tabs="" className={cn(TRACK, !actions && RULE, !actions && className)}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const panel = typeof controls === "function" ? controls(tab.key) : controls;
        const id = idPrefix ? `${idPrefix}-${tab.key}` : panel ? `${panel}-tab-${tab.key}` : undefined;
        return tab.href ? (
          <IntentLink key={tab.key} id={id} href={tab.href} role="tab" aria-selected={selected} aria-controls={panel} scroll={false} className={item(selected)}><Body tab={tab} /></IntentLink>
        ) : (
          <button key={tab.key} id={id} type="button" role="tab" aria-selected={selected} aria-controls={panel} onClick={() => onChange?.(tab.key)} className={item(selected)}><Body tab={tab} /></button>
        );
      })}
    </TabTrack>
  );
  if (!actions) return list;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-3", RULE, className)}>
      {list}
      <div className="ml-auto flex flex-wrap items-center gap-2 py-1">{actions}</div>
    </div>
  );
}

/**
 * The same bar for a client screen that keeps the tab in state, with the tab pattern's keys: the chosen tab is the
 * one stop in the Tab order, and the arrow keys (Home and End too) move to and choose another. Used for a page's
 * sub-pages (Appointments & setters) and for a record's sections (a lead's or a case's parts, a sheet's sections).
 */
export function UnderlineTabs<K extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  controls,
  className,
}: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange: (key: K) => void;
  idPrefix?: string;
  /** The panel the tabs switch; a function when each tab has its own panel. */
  controls?: string | ((key: K) => string);
  /** Layout only (margins, padding). */
  className?: string;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const to = event.key === "ArrowRight" ? (from + 1) % tabs.length
      : event.key === "ArrowLeft" ? (from - 1 + tabs.length) % tabs.length
        : event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : -1;
    if (to < 0) return;
    event.preventDefault();
    onChange(tabs[to].key);
    const row = event.currentTarget.parentElement;
    row?.querySelectorAll<HTMLElement>(':scope > [role="tab"]')[to]?.focus();
  };
  return (
    <TabTrack role="tablist" aria-label={label} data-subpage-tabs="" className={cn(TRACK, RULE, className)}>
      {tabs.map((tab, index) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => move(event, index)}
            id={idPrefix ? `${idPrefix}-${tab.key}` : undefined}
            role="tab"
            aria-selected={selected}
            aria-controls={typeof controls === "function" ? controls(tab.key) : controls}
            tabIndex={selected ? 0 : -1}
            className={item(selected)}
          >
            <Body tab={tab} />
          </button>
        );
      })}
    </TabTrack>
  );
}

/** The segmented control inside a toolbar (a filter, not a page view): the same look, pressed buttons. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; count?: number | null; tone?: "danger" }>;
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
}) {
  // The one filter chip (owner 2026-10-30): a pick-one row of ToggleChips, as on the Source page.
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <ToggleChip key={option.key} role="radio" selected={value === option.key} disabled={disabled} onClick={() => onChange(option.key)} count={option.count ?? undefined} countTone={option.tone}>
          {option.label}
        </ToggleChip>
      ))}
    </div>
  );
}

/**
 * The boxed switch's look, shared by IconViewSwitch and the Reports "Table · Chart" ViewSwitch
 * (components/ui/view-switch.tsx): a 36px bordered box on the card colour, the chosen option tinted brand.
 */
export const SWITCH_FRAME = "inline-flex h-9 items-center rounded-md border border-border bg-card p-0.5";
export function switchOption(selected: boolean, className?: string) {
  return cn(
    className,
    "rounded-[5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    selected ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "text-muted-foreground hover:bg-[var(--hover-wash)] hover:text-foreground",
  );
}

/** Compact two-view switch for dense list and board pages. */
export function IconViewSwitch<K extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: ReadonlyArray<{ key: K; label: string; icon: "grid" | "list" }>;
  value: K;
  onChange: (key: K) => void;
  disabled?: boolean;
}) {
  return <div role="group" aria-label={label} className={SWITCH_FRAME}>
    {options.map((option) => {
      const Icon = option.icon === "grid" ? LayoutGrid : List;
      const selected = value === option.key;
      return <button
        key={option.key}
        type="button"
        aria-label={option.label}
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => onChange(option.key)}
        className={switchOption(selected, "grid size-8 place-items-center")}
      ><Icon aria-hidden="true" className="size-4" /></button>;
    })}
  </div>;
}
