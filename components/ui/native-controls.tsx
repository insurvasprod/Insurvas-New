"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The control foundation (owner 2026-11-02): "fix the foundation of every dropdown in the whole system …
 * a different design rather than having a default one … also for the calendar". The app has hundreds of
 * native `<select>`s and date fields; rather than replace each one, this layer — mounted once in the root
 * layout — opens the app's own panel in place of the browser's:
 *
 *   select        a designed list: the options with their group headings, a tick on the chosen one, a
 *                 highlight that follows the mouse and the arrow keys, and type-to-filter (a search line
 *                 shows once a list is long). Enter picks, Escape closes.
 *   date fields   (`type="date"` and `"datetime-local"`) a month calendar with Today and Clear, the times
 *                 of day for a date-and-time field, and the field's own `min` / `max` honoured.
 *
 * The element stays the real control: its value, its form, its label, React's onChange (fired by setting
 * the value and dispatching `input` and `change`). Focus never leaves it, so a dialog's focus trap and
 * typing a date by hand both keep working. Inside a dialog or a popover the panel is drawn inside it, so
 * picking never closes it. On a touch screen the phone's own picker is better, and is left alone. A
 * control opts out with `data-native="keep"`; a `multiple` or `size` list is never touched.
 */

type Kind = "select" | "date" | "datetime";
type Target = { kind: Kind; el: HTMLSelectElement | HTMLInputElement };

const CONTAINERS = '[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"], [data-slot="popover-content"]';

function targetOf(node: EventTarget | null): Target | null {
  const el = node instanceof Element ? node.closest("select, input") : null;
  if (!el || (el as HTMLElement).dataset.native === "keep") return null;
  if (el instanceof HTMLSelectElement) return el.multiple || el.size > 1 || el.disabled ? null : { kind: "select", el };
  if (el instanceof HTMLInputElement && !el.disabled && !el.readOnly) {
    if (el.type === "date") return { kind: "date", el };
    if (el.type === "datetime-local") return { kind: "datetime", el };
  }
  return null;
}

/** Sets a control's value the way a person would, so React's onChange and any form listener see it. */
function setValue(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Where the panel goes and how it is placed: inside a dialog or popover when the control is in one. */
function placement(el: HTMLElement, height: number): { host: HTMLElement; style: CSSProperties; maxHeight: number } {
  const rect = el.getBoundingClientRect();
  const host = (el.closest(CONTAINERS) as HTMLElement | null) ?? document.body;
  const inBody = host === document.body;
  const box = inBody ? { top: 0, bottom: window.innerHeight, left: 0 } : host.getBoundingClientRect();
  // Room is the screen's, not the dialog's: a dialog does not clip, so a panel may run past its edge.
  const below = window.innerHeight - rect.bottom - 8;
  const above = rect.top - 8;
  const up = below < height && above > below;
  const maxHeight = Math.max(160, Math.min(height, up ? above : below));
  const left = rect.left - box.left + (inBody ? 0 : host.scrollLeft);
  const anchor = up ? rect.top - box.top + (inBody ? 0 : host.scrollTop) - 4 : rect.bottom - box.top + (inBody ? 0 : host.scrollTop) + 4;
  return {
    host,
    maxHeight,
    style: {
      position: inBody ? "fixed" : "absolute",
      left: Math.max(4, left),
      top: anchor,
      transform: up ? "translateY(-100%)" : undefined,
      minWidth: Math.max(rect.width, 200),
      maxWidth: 440,
      zIndex: 80,
    },
  };
}

/* ── the select panel ─────────────────────────────────────────────────────────────────────────── */

type Option = { index: number; value: string; label: string; disabled: boolean; group: string | null };

function readOptions(el: HTMLSelectElement): Option[] {
  const out: Option[] = [];
  for (const option of Array.from(el.options)) {
    if (option.hidden) continue;
    const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null;
    out.push({ index: option.index, value: option.value, label: option.label || option.text, disabled: option.disabled || Boolean((option.parentElement as HTMLOptGroupElement | null)?.disabled), group });
  }
  return out;
}

function SelectPanel({ el, close, filter, active, setActive }: { el: HTMLSelectElement; close: () => void; filter: string; active: number; setActive: (index: number) => void }) {
  const options = useMemo(() => readOptions(el), [el]);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => { list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, filter]);
  return (
    <>
      {options.length > 8 && (
        <div className="flex h-9 items-center gap-2 border-b border-[var(--border)] px-3 text-sm">
          <Search className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
          <span className={cn("min-w-0 flex-1 truncate", filter ? "text-[var(--ink)]" : "text-[var(--muted)]")}>{filter || "Type to filter"}</span>
          {needle && <span className="text-xs text-[var(--muted)] tabular-nums">{shown.length}</span>}
        </div>
      )}
      <div ref={list} role="listbox" aria-label="Choices" className="flex flex-col overflow-y-auto p-1">
        {shown.length === 0 && <p className="m-0 px-3 py-2.5 text-sm text-[var(--muted)]">Nothing matches “{filter}”.</p>}
        {shown.map((option, at) => {
          // A group heading over the first option of each group.
          const heading = option.group && option.group !== shown[at - 1]?.group ? option.group : null;
          const chosen = el.selectedIndex === option.index;
          return (
            <div key={option.index}>
              {heading && <div className="px-3 pt-2.5 pb-1 text-xs font-semibold text-[var(--muted)]">{heading}</div>}
              <button
                type="button"
                role="option"
                aria-selected={chosen}
                disabled={option.disabled}
                data-active={active === option.index}
                onMouseEnter={() => setActive(option.index)}
                onClick={() => { setValue(el, option.value); close(); }}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-[var(--ink)] outline-none transition-colors duration-100",
                  active === option.index && "bg-[var(--surface-alt)]",
                  chosen && "font-semibold",
                  option.disabled && "cursor-not-allowed opacity-45",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label || "—"}</span>
                {chosen && <Check className="size-4 shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── the calendar panel ───────────────────────────────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const clock = (minutes: number) => `${Math.floor(minutes / 60) % 12 || 12}:${pad(minutes % 60)} ${minutes < 720 ? "AM" : "PM"}`;

function CalendarPanel({ el, kind, close }: { el: HTMLInputElement; kind: "date" | "datetime"; close: () => void }) {
  const day = el.value.slice(0, 10);
  const time = kind === "datetime" ? el.value.slice(11, 16) : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00`) : null;
  const [month, setMonth] = useState(() => { const base = parsed ?? new Date(); return new Date(base.getFullYear(), base.getMonth(), 1); });
  const min = el.min ? el.min.slice(0, 10) : null;
  const max = el.max ? el.max.slice(0, 10) : null;
  const today = ymd(new Date());
  const cells = useMemo(() => {
    const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  }, [month]);
  const allowed = (value: string) => (!min || value >= min) && (!max || value <= max);
  const times = useRef<HTMLDivElement | null>(null);
  useEffect(() => { times.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "center" }); }, []);
  const pick = (value: string) => {
    if (kind === "date") { setValue(el, value); close(); return; }
    setValue(el, `${value}T${time || "09:00"}`);
  };
  const shift = (by: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
  const nav = "inline-flex size-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--hover-wash)] hover:text-[var(--ink)]";
  return (
    <div className="flex gap-3 p-3">
      <div className="w-[252px]">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" aria-label="Previous month" className={nav} onClick={() => shift(-1)}><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <span className="text-sm font-semibold text-[var(--ink)]">{month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>
          <button type="button" aria-label="Next month" className={nav} onClick={() => shift(1)}><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center" role="grid">
          {WEEKDAYS.map((head) => <span key={head} className="py-1 text-xs font-semibold text-[var(--muted)]">{head}</span>)}
          {cells.map((cell, index) => {
            if (!cell) return <span key={index} />;
            const value = ymd(cell);
            const on = value === day;
            const ok = allowed(value);
            return (
              <button
                key={index}
                type="button"
                disabled={!ok}
                aria-pressed={on}
                aria-label={cell.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                onClick={() => pick(value)}
                className={cn(
                  "h-8 rounded-md text-sm tabular-nums outline-none transition-colors duration-100",
                  on ? "bg-[var(--primary)] font-semibold text-[var(--on-primary)]"
                    : value === today ? "border border-[var(--primary)] text-[var(--ink)] hover:bg-[var(--hover-wash)]"
                    : "text-[var(--body)] hover:bg-[var(--hover-wash)]",
                  !ok && "cursor-not-allowed opacity-35 hover:bg-transparent",
                )}
              >
                {cell.getDate()}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
          <button type="button" disabled={!allowed(today)} className="h-8 rounded-md px-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--hover-wash)] disabled:opacity-40" onClick={() => { setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)); pick(today); }}>Today</button>
          {!el.required && el.value && <button type="button" className="h-8 rounded-md px-2 text-sm text-[var(--muted)] hover:bg-[var(--hover-wash)] hover:text-[var(--ink)]" onClick={() => { setValue(el, ""); close(); }}>Clear</button>}
        </div>
      </div>
      {kind === "datetime" && (
        <div className="flex w-[124px] flex-col border-l border-[var(--border)] pl-3">
          <span className="mb-2 text-xs font-semibold text-[var(--muted)]">Time</span>
          <div ref={times} role="listbox" aria-label="Time" className="flex max-h-[264px] flex-col gap-1 overflow-y-auto pr-1">
            {Array.from({ length: 96 }, (_, step) => step * 15).map((minutes) => {
              const value = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
              const on = value === time;
              return (
                <button key={minutes} type="button" role="option" aria-selected={on} disabled={!day}
                  onClick={() => { setValue(el, `${day}T${value}`); close(); }}
                  className={cn("h-8 shrink-0 rounded-md px-2 text-left text-sm tabular-nums outline-none", on ? "bg-[var(--primary)] font-semibold text-[var(--on-primary)]" : "text-[var(--body)] hover:bg-[var(--hover-wash)]", !day && "opacity-40")}>
                  {clock(minutes)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── the layer ────────────────────────────────────────────────────────────────────────────────── */

export function NativeControls() {
  const [target, setTarget] = useState<Target | null>(null);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(-1);
  const [, setFrame] = useState(0);
  const panel = useRef<HTMLDivElement | null>(null);
  // The listeners are registered once, at the app's start, so they run before any dialog's own Escape
  // listener (added when the dialog opens); they read the live state through these refs.
  const targetRef = useRef<Target | null>(null);
  const filterRef = useRef("");
  const activeRef = useRef(-1);
  useEffect(() => { targetRef.current = target; filterRef.current = filter; activeRef.current = active; }, [target, filter, active]);

  const close = useCallback(() => { setTarget(null); setFilter(""); }, []);
  const open = useCallback((next: Target) => {
    setFilter("");
    setActive(next.el instanceof HTMLSelectElement ? next.el.selectedIndex : -1);
    setTarget(next);
  }, []);

  useEffect(() => {
    // A touch screen keeps the phone's own picker.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const onDown = (event: MouseEvent) => {
      if (panel.current?.contains(event.target as Node)) return;
      const next = event.button === 0 ? targetOf(event.target) : null;
      const current = targetRef.current;
      if (!next) { if (current) close(); return; }
      if (next.kind === "select") {
        event.preventDefault(); // no browser list
        next.el.focus();
        if (current?.el === next.el) close(); else open(next);
        return;
      }
      if (current?.el !== next.el) open(next); // a date field: typing in it still works
    };
    const onKey = (event: KeyboardEvent) => {
      const current = targetRef.current;
      const focused = targetOf(document.activeElement);
      if (!current) {
        // Open from the keyboard the way the browser's list opens.
        if (focused && ((event.altKey && event.key === "ArrowDown") || event.key === "F4" || (focused.kind === "select" && event.key === " "))) {
          event.preventDefault();
          open(focused);
        }
        return;
      }
      if (document.activeElement !== current.el) return;
      // Escape closes the panel only: a dialog listens on the same node, so stop it there, not just bubbling.
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
      if (event.key === "Tab") { close(); return; }
      if (current.kind !== "select") return;
      const el = current.el as HTMLSelectElement;
      const filter = filterRef.current;
      const active = activeRef.current;
      const needle = filter.trim().toLowerCase();
      const options = readOptions(el).filter((option) => !option.disabled && (!needle || option.label.toLowerCase().includes(needle)));
      const at = options.findIndex((option) => option.index === active);
      const move = (to: number) => { const option = options[Math.max(0, Math.min(options.length - 1, to))]; if (option) { activeRef.current = option.index; setActive(option.index); } };
      if (event.key === "ArrowDown") { event.preventDefault(); move(at + 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(at - 1); }
      else if (event.key === "Home") { event.preventDefault(); move(0); }
      else if (event.key === "End") { event.preventDefault(); move(options.length - 1); }
      else if (event.key === "Enter" || (event.key === " " && !filter)) {
        event.preventDefault();
        const option = options[at] ?? options[0];
        if (option) setValue(el, option.value);
        close();
      } else if (event.key === "Backspace") { event.preventDefault(); filterRef.current = filter.slice(0, -1); setFilter(filterRef.current); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); // the browser's own type-ahead would change the value
        const text = filter + event.key;
        filterRef.current = text;
        setFilter(text);
        const first = readOptions(el).find((option) => !option.disabled && option.label.toLowerCase().includes(text.trim().toLowerCase()));
        if (first) { activeRef.current = first.index; setActive(first.index); }
      }
    };
    const onMove = () => setFrame((n) => n + 1);
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, close]);

  // The control left the page (a dialog closed, a row re-rendered): the panel goes with it, and the next
  // click anywhere clears the stale target.
  if (!target || !target.el.isConnected) return null;
  const { host, style, maxHeight } = placement(target.el, target.kind === "select" ? 300 : 360);
  return createPortal(
    <div
      ref={panel}
      data-native-panel=""
      style={{ ...style, maxHeight }}
      // Clicks inside never take focus from the control (a dialog's focus trap stays happy).
      onMouseDown={(event) => event.preventDefault()}
      className="m-swap flex flex-col overflow-hidden rounded-[10px] border border-[var(--border-strong)] bg-[var(--color-card)] text-[var(--ink)] shadow-[var(--shadow-overlay)]"
    >
      {target.kind === "select"
        ? <SelectPanel el={target.el as HTMLSelectElement} close={() => { close(); target.el.focus(); }} filter={filter} active={active} setActive={setActive} />
        : <CalendarPanel el={target.el as HTMLInputElement} kind={target.kind} close={() => { close(); target.el.focus(); }} />}
    </div>,
    host,
  );
}
