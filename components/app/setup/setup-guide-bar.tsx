"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DoneStamp } from "@/components/ui/done-stamp";
import { StatusChip } from "@/components/ui/status-chip";
import { currentSetupStepKey, guideHref, isManualStep, type SetupChecklist, type SetupChecklistStep } from "@/lib/dashboard/checklist";
import { guideMovesFor, guidePages, isRequiredStep, pageMatches, resolveMove, type GuideMove } from "@/lib/dashboard/guideMoves";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";

import { markSetupStep } from "./setup-step-list";

import { titleCaseNode } from "@/components/ui/title-case";
type SetupResponse = { checklist: SetupChecklist; paused?: { key: string; move: number } | null };

/**
 * Where a paused required step stopped: on the person's own setup row (tenant_setup_guide.paused_step, so Resume
 * follows them to any device) and in this browser, so the page can offer Resume at once and still works before
 * the columns are migrated.
 */
export type PausedGuide = { key: string; label: string; move: number; moves: number; href: string };
const PAUSE_KEY = "setup-guide-paused";

export function readPausedGuide(): PausedGuide | null {
  try {
    const raw = window.localStorage.getItem(PAUSE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as PausedGuide;
    return typeof value?.key === "string" && typeof value.href === "string" ? value : null;
  } catch {
    return null;
  }
}

function writePausedGuide(value: PausedGuide | null) {
  try {
    if (value) window.localStorage.setItem(PAUSE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(PAUSE_KEY);
  } catch { /* storage blocked: the server copy still holds it */ }
  void fetch("/api/app/setup", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value ? { action: "pause", step: value.key, move: value.move } : { action: "resume" }),
  }).catch(() => undefined);
}

/**
 * The guide running in this tab, so leaving its page by another link (the guide follows one page) can offer
 * "Take me back" (R3·3: "You left the Carriers page · Take me back"). Per tab; Pause, Stop and Done clear it.
 */
/**
 * A run (owner 2026-11-16: "click one, then two, then on to the next Get set up step"): "ready" walks every
 * Ready to sell step in a row, opening the next one itself; "single" is one step (Guide me, Docs). `pages` are
 * every page the step's guide follows, so a move on another page (the import review) keeps guiding without
 * `?guide=` in its address; `at` is the exact address left, for "Take me back".
 */
type ActiveGuide = PausedGuide & { path: string; run: "ready" | "single"; pages: string[]; at: string };
const ACTIVE_KEY = "setup-guide-active";
function readActiveGuide(): ActiveGuide | null {
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_KEY);
    const value = raw ? (JSON.parse(raw) as ActiveGuide) : null;
    return value && typeof value.key === "string" ? { ...value, run: value.run === "ready" ? "ready" : "single", pages: Array.isArray(value.pages) ? value.pages : [], at: value.at ?? value.href } : null;
  } catch { return null; }
}
function writeActiveGuide(value: ActiveGuide | null) {
  try { if (value) window.sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(value)); else window.sessionStorage.removeItem(ACTIVE_KEY); } catch { /* storage blocked */ }
}

/** Whether this tab is walking all of Ready to sell (pages quieten their own "go next" offers). */
export function inReadySetupRun(): boolean {
  return typeof window !== "undefined" && readActiveGuide()?.run === "ready";
}

/** Whether this tab's guide is running on this page (one of the pages its step follows). */
export function activeSetupGuide(pathname: string): boolean {
  if (typeof window === "undefined") return false;
  const active = readActiveGuide();
  return active !== null && active.pages.some((page) => pageMatches(page, pathname));
}

/** A guide link that starts at a given move: `&move=` goes before any `#tab`. */
export function withMove(href: string, move: number): string {
  if (move <= 0) return href;
  const [before, hash] = href.split("#", 2);
  return `${before}${before.includes("?") ? "&" : "?"}move=${move}${hash ? `#${hash}` : ""}`;
}

/** A guide link that walks all of Ready to sell from this step on: `&run=ready` goes before any `#tab`. */
export function withRun(href: string): string {
  const [before, hash] = href.split("#", 2);
  return `${before}${before.includes("?") ? "&" : "?"}run=ready${hash ? `#${hash}` : ""}`;
}

/** A move's control: the first visible `data-guide="x"`, or `#id` for an id the page already has; an empty anchor stands for its row. */
const findTarget = (target: string): HTMLElement | null => {
  const visible = (element: HTMLElement | null) => (element && element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0 ? element : null);
  if (target.startsWith("#")) {
    let element = document.getElementById(target.slice(1));
    if (element && element.getBoundingClientRect().width < 4) element = element.closest<HTMLElement>("tr, li, section") ?? element;
    return visible(element);
  }
  for (const element of document.querySelectorAll<HTMLElement>(`[data-guide="${CSS.escape(target)}"]`)) if (visible(element)) return element;
  return null;
};

/** The dialog or side panel open over the page (not the guide's own confirms), if any. */
const openDialog = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]:not([data-setup-own]), [role="alertdialog"][data-state="open"], aside[data-slot="detail-panel"][data-state="open"]');

const isDisabled = (element: HTMLElement) => element.matches(":disabled, [aria-disabled='true'], [data-disabled]") || element.closest("fieldset:disabled") !== null;

/** A clip-path that covers the window except the given boxes (evenodd: each box is a hole). */
function holesPath(boxes: Box[], pad: number): string {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const holes = boxes.map((box) => {
    const x = Math.max(0, box.left - pad);
    const y = Math.max(0, box.top - pad);
    const right = Math.min(w, box.left + box.width + pad);
    const bottom = Math.min(h, box.top + box.height + pad);
    return `M${x} ${y}H${right}V${bottom}H${x}Z`;
  });
  return `path(evenodd, "M0 0H${w}V${h}H0Z${holes.join("")}")`;
}

type Box = { top: number; left: number; width: number; height: number; /** A dialog kept clear around its lit control: no ring of its own. */ plain?: boolean };
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (a !== null && b !== null && Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1);

/**
 * Guided setup (owner, 2026-11-12/13: "a walkthrough into what to click first, then to click what, then to
 * do what… for every single step"). A step on Get set up opens its real screen with `?guide=<step>`. This
 * draws, above the page, the setup bar (which step, Pause or Skip), and over the page one spotlight on the
 * control to touch with a coach beside it naming it. The coach moves on when the person does the action —
 * a click on the control, leaving a field, the control of a later move appearing — never on a Next
 * button, except a move that only asks for a look ("Looks right"). Done still comes from the step's own
 * fact (/api/app/setup), so nobody has to tell us they finished.
 *
 * Ready to sell (the counted steps) is required: always guided, no Skip, only Pause, which keeps the place
 * for Resume. Fine-tune later steps are optional: Skip this step and Stop guide. A guide the person started,
 * pinned to one control and always leavable, is UI-CONSISTENCY §3's one exception to "no notices".
 */
export function SetupGuideBar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const guide = params.get("guide");
  // The run this tab is on, read again on every page: a move on another page of the same step (the import
  // review, the statement it opened) carries on without `?guide=` in the address.
  const [stored, setStored] = useState<ActiveGuide | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- this tab's storage, read once per page
    setStored(readActiveGuide());
  }, [pathname, guide]);
  const carried = !guide && stored && stored.pages.some((page) => pageMatches(page, pathname)) ? stored : null;
  const stepKey = guide ? currentSetupStepKey(guide) : carried ? carried.key : null;
  const run: "ready" | "single" = params.get("run") === "ready" || (stored?.run === "ready" && stored.key === stepKey) ? "ready" : "single";
  const askedMove = Number.parseInt(params.get("move") ?? "", 10);

  const [data, setData] = useState<SetupResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const timers = useRef<number[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const watched = useRef<{ key: string | null; seen: boolean | null }>({ key: null, seen: null });

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    const response = await fetch("/api/app/setup", { cache: "no-store" }).catch(() => null);
    if (mine !== sequence.current) return;
    if (!response?.ok) { setFailed(true); return; }
    const body = (await response.json().catch(() => null)) as SetupResponse | null;
    if (mine !== sequence.current) return;
    if (!body) { setFailed(true); return; }
    const current = body.checklist.steps.find((item) => item.key === watched.current.key);
    if (current && watched.current.seen === false && current.complete) {
      setAnnouncement(`${current.label} is done.`);
      notify.done(`${current.label} · done`, { detail: current.optional ? "Optional setting" : "Ready to sell moves on" });
    }
    if (current) watched.current.seen = current.complete;
    setFailed(false);
    setData(body);
  }, []);

  // The step's facts: asked on arrival, on focus, when the setup list says something changed, after a click.
  useEffect(() => {
    watched.current = { key: stepKey, seen: null };
    if (!stepKey) return;
    const again = () => void load();
    const first = window.setTimeout(again, 0);
    const onVisible = () => { if (document.visibilityState === "visible") again(); };
    const onClick = () => {
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [window.setTimeout(again, 1500), window.setTimeout(again, 4000)];
    };
    window.addEventListener("focus", again);
    window.addEventListener("setup:changed", again);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("click", onClick, true);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("focus", again);
      window.removeEventListener("setup:changed", again);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("click", onClick, true);
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, [stepKey, load]);

  // A dialog closed just before the guide opened the next step's page can leave its page lock behind (Radix sets
  // body pointer-events: none and the route change unmounts it mid-close): the new page then takes no click at all.
  // Once the new page has settled with no dialog open, the lock goes.
  useEffect(() => {
    if (!stepKey) return;
    const timer = window.setTimeout(() => {
      if (!openDialog() && document.body.style.pointerEvents === "none") document.body.style.pointerEvents = "";
    }, 600);
    return () => window.clearTimeout(timer);
  }, [stepKey, pathname]);

  // Set while Pause or Stop takes the guide off the page, so a late answer does not re-record it as running.
  const leaving = useRef(false);
  // Starting the step a pause was kept for (on any device) clears it, judged on the first answer for this step
  // only, so an answer that arrives just after Pause (still on this page) cannot undo it.
  const resumeChecked = useRef<string | null>(null);
  useEffect(() => {
    leaving.current = false;
    if (!stepKey) resumeChecked.current = null;
  }, [stepKey]);
  const serverPaused = data?.paused?.key ?? null;
  useEffect(() => {
    if (!stepKey || !data || resumeChecked.current === stepKey || leaving.current) return;
    resumeChecked.current = stepKey;
    if (serverPaused === stepKey) writePausedGuide(null);
  }, [stepKey, data, serverPaused]);

  const steps = useMemo(() => data?.checklist.steps ?? [], [data]);
  const index = steps.findIndex((item) => item.key === stepKey);
  const step: SetupChecklistStep | null = index >= 0 ? steps[index] : null;
  const moves: readonly GuideMove[] = useMemo(() => (step ? guideMovesFor(step) : []), [step]);
  const waiting = step !== null && !step.complete;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  // Which move: ?move= (Resume), else 0. Starting a step clears any pause kept for it.
  const [move, setMove] = useState(0);
  const [openedDone, setOpenedDone] = useState(false);
  useEffect(() => {
    const start = Number.isFinite(askedMove) && askedMove > 0 ? askedMove : 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new step (or a Resume link) restarts the moves
    setMove(start);
    setOpenedDone(false);
    if (stepKey && readPausedGuide()?.key === stepKey) writePausedGuide(null);
  }, [stepKey, askedMove]);
  const firstAnswer = useRef<string | null>(null);
  useEffect(() => {
    if (!step || firstAnswer.current === step.key) return;
    firstAnswer.current = step.key;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opened on a step that is already done: a replay
    if (step.complete) setOpenedDone(true);
  }, [step]);

  const current = move < moves.length ? moves[move] : null;
  const last = moves.length - 1;
  // Done is the step's own fact AND its last move passed (or reached, when that move only waits for the save):
  // a fact that turns true early (the first carrier ticked) never ends the step before its last click (owner
  // 2026-11-16). A step done before the guide opened ("Guide me again", 2026-11-13) walks every click too.
  const replay = openedDone;
  const done = step !== null && step.complete && (move > last || (move >= last && moves[last]?.advance === "done"));

  // Follow the page: where the lit control is, whether a later move's control already shows (arrived
  // mid-way), whether a dialog is open. Polled lightly while guiding, and on scroll and resize.
  const [box, setBox] = useState<Box | null>(null);
  const [useBoxes, setUseBoxes] = useState<Box[]>([]);
  const [missing, setMissing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const missingSince = useRef<number | null>(null);
  const disabledSince = useRef<number | null>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!step || done || moves.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to light
      setBox(null);
      return;
    }
    const tick = () => {
      // With a dialog or side panel open, only what is in it counts as on screen: a control behind it cannot be
      // used, and a later move inside it (the statement dialog that opens by itself) is where the person is.
      const over = openDialog();
      const present = (target: string) => {
        const element = findTarget(target);
        return element !== null && (!over || over.contains(element));
      };
      // On a later move's own page (the statement the import opened), that move is where the person is.
      const onPage = moves.findIndex((item, at) => at > move && item.page !== undefined && pageMatches(item.page, window.location.pathname));
      if (onPage > move) { setMove(onPage); return; }
      const resolved = resolveMove(moves, move, present);
      if (resolved !== move) { setMove(resolved); return; }
      const until = moves[move]?.advance === "appear" ? moves[move]?.until : undefined;
      if (until && findTarget(until)) { setMove(move + 1); return; }
      const target = moves[move]?.target;
      const element = target ? findTarget(target) : null;
      setDialogOpen(over !== null);
      if (!element) {
        setBox((previous) => (previous === null ? previous : null));
        setUseBoxes((previous) => (previous.length === 0 ? previous : []));
        disabledSince.current = null;
        setBlocked(false);
        if (target) {
          missingSince.current ??= Date.now();
          setMissing(Date.now() - missingSince.current > 1500);
        } else setMissing(false);
        return;
      }
      missingSince.current = null;
      setMissing(false);
      // A lit control that stays disabled is never a dead end: after a moment the coach says what comes first.
      if (isDisabled(element)) {
        disabledSince.current ??= Date.now();
        setBlocked(Date.now() - disabledSince.current > 1500);
      } else {
        disabledSince.current = null;
        setBlocked(false);
      }
      const rect = element.getBoundingClientRect();
      const next = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setBox((previous) => (sameBox(previous, next) ? previous : next));
      const others: Box[] = (moves[move]?.use ?? []).flatMap((name): Box[] => {
        const other = findTarget(name);
        if (!other) return [];
        const r = other.getBoundingClientRect();
        return [{ top: r.top, left: r.left, width: r.width, height: r.height }];
      });
      // A control inside a dialog: the whole dialog stays clear, since its fields come before its button.
      if (over && over.contains(element)) {
        const r = over.getBoundingClientRect();
        others.push({ top: r.top, left: r.left, width: r.width, height: r.height, plain: true });
      }
      setUseBoxes((previous) => (previous.length === others.length && previous.every((item, at) => sameBox(item, others[at])) ? previous : others));
      const scrollKey = `${step.key}:${move}`;
      if (scrolledFor.current !== scrollKey) {
        scrolledFor.current = scrollKey;
        if (rect.top < 80 || rect.bottom > window.innerHeight - 40) element.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    };
    tick();
    const timer = window.setInterval(tick, 250);
    window.addEventListener("scroll", tick, true);
    window.addEventListener("resize", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", tick, true);
      window.removeEventListener("resize", tick);
    };
  }, [step, done, moves, move, pathname]);

  // The action itself moves the guide on: a click on the lit control, or leaving it (a field).
  const advanceFrom = useCallback((from: number) => setMove((now) => (now === from ? from + 1 : now)), []);
  useEffect(() => {
    if (!current?.target || done) return;
    const target = current.target;
    const from = move;
    const inside = (node: EventTarget | null) => {
      const element = findTarget(target);
      return element !== null && node instanceof Node && element.contains(node);
    };
    // Pointer-down too: a menu trigger (Radix) opens on press and locks the page at once, so its click never lands.
    const onClick = (event: Event) => {
      if (current.advance === "click" && inside(event.target)) window.setTimeout(() => advanceFrom(from), 350);
    };
    // Leaving the box, or (a select) choosing an option: picking the campaign moves on at once, not only on Tab.
    const onLeave = (event: Event) => {
      if (current.advance === "leave" && inside(event.target)) window.setTimeout(() => advanceFrom(from), 150);
    };
    const onChange = (event: Event) => {
      if (event.target instanceof HTMLSelectElement) onLeave(event);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("pointerdown", onClick, true);
    document.addEventListener("focusout", onLeave, true);
    document.addEventListener("change", onChange, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("pointerdown", onClick, true);
      document.removeEventListener("focusout", onLeave, true);
      document.removeEventListener("change", onChange, true);
    };
  }, [current, move, done, advanceFrom]);

  // Paused-step reminder on that step's own page, and "Take me back" after leaving a running guide's page.
  const [paused, setPaused] = useState<PausedGuide | null>(null);
  const [left, setLeft] = useState<ActiveGuide | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once per page from this browser's storage
    setPaused(stepKey ? null : readPausedGuide());
    setLeft(stepKey ? null : readActiveGuide());
  }, [stepKey, pathname]);

  // While a step is guided, this tab remembers it, so leaving the page can offer the way back.
  const fromDocs = params.get("from") === "docs";
  useEffect(() => {
    if (!step || leaving.current) return;
    if (done && run !== "ready") { writeActiveGuide(null); return; }
    writeActiveGuide({
      key: step.key, label: step.label, move: Math.min(move, Math.max(moves.length - 1, 0)), moves: moves.length, href: guideHref(step), path: pathname,
      run, pages: guidePages(step), at: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    });
  }, [step, done, move, moves.length, pathname, run]);

  const [confirmPause, setConfirmPause] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const leaveGuide = () => {
    leaving.current = true;
    writeActiveGuide(null);
    const query = new URLSearchParams(params.toString());
    query.delete("guide");
    query.delete("move");
    const rest = query.toString();
    router.replace(`${pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  };

  // Ready to sell as one run (owner 2026-11-16): a finished step opens the next open one by itself, its guide
  // already running, after a short beat the person can stop with "Stay here". The last one ends on Get set up.
  const [stayed, setStayed] = useState<string | null>(null);
  const following = useMemo(() => {
    if (!step) return null;
    const pool = steps.filter((item) => (isRequiredStep(step) ? !item.optional : item.optional));
    const at = pool.findIndex((item) => item.key === step.key);
    return [...pool.slice(at + 1), ...pool.slice(0, Math.max(at, 0))].find((item) => !item.complete && !item.skipped) ?? null;
  }, [step, steps]);
  const autoHref = done && run === "ready" && step && stayed !== step.key ? (following ? withRun(guideHref(following)) : "/app/setup?celebrate=1") : null;
  const [countdown, setCountdown] = useState<number | null>(null);
  useEffect(() => {
    if (!autoHref) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no next step to count down to
      setCountdown(null);
      return;
    }
    setCountdown(2);
    const tick = window.setInterval(() => setCountdown((left) => (left === null ? null : Math.max(0, left - 1))), 1000);
    const go = window.setTimeout(() => {
      if (autoHref.startsWith("/app/setup")) writeActiveGuide(null);
      router.push(autoHref);
    }, 2000);
    return () => { window.clearInterval(tick); window.clearTimeout(go); };
  }, [autoHref, router]);

  if (!stepKey) {
    if (left) {
      return (
        <div data-setup-guide="" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <StatusChip tone="warning">Setup</StatusChip>
          <span className="text-muted-foreground">You left {left.label} at move {Math.min(left.move + 1, left.moves)} of {left.moves}.</span>
          <Link href={left.at || withMove(left.href, left.move)} className={buttonVariants({ size: "sm" })}>Take Me Back</Link>
          <Button type="button" variant="ghost" size="sm" onClick={() => { writeActiveGuide(null); setLeft(null); }}>Stop</Button>
        </div>
      );
    }
    if (!paused || paused.href.split(/[?#]/)[0] !== pathname) return null;
    return (
      <div data-setup-guide="" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <StatusChip tone="warning">Setup paused</StatusChip>
        <span className="text-muted-foreground">{paused.label} · move {Math.min(paused.move + 1, paused.moves)} of {paused.moves}</span>
        <Link href={withMove(paused.href, paused.move)} className={buttonVariants({ size: "sm" })}>Resume</Link>
      </div>
    );
  }

  const retryLine = failed ? (
    <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-sm text-[var(--error-ink)]">
      Could not check your setup progress.
      <Button type="button" variant="ghost" size="sm" onClick={() => void load()}>Retry</Button>
    </p>
  ) : null;
  if (!data || !step) return retryLine && !data ? <div data-setup-guide="" className="mb-4">{retryLine}</div> : null;

  const required = isRequiredStep(step);
  const counted = steps.filter((item) => !item.optional);
  const position = required ? `Step ${counted.findIndex((item) => item.key === step.key) + 1} of ${counted.length}` : "Optional setting";
  const nextHref = following ? (run === "ready" ? withRun(guideHref(following)) : guideHref(following)) : data.checklist.complete ? "/app/setup?celebrate=1" : "/app/setup";

  const pause = () => {
    leaving.current = true;
    writeActiveGuide(null);
    writePausedGuide({ key: step.key, label: step.label, move: Math.min(move, last), moves: moves.length, href: guideHref(step) });
    setConfirmPause(false);
    leaveGuide();
  };
  // An optional step's "Looks right" on its last look, or Skip: put aside (counted as reviewed), then on.
  const putAside = () => void markSetupStep("skip", step.key).then((ok) => { if (ok) { writeActiveGuide(null); setConfirmSkip(false); router.push(nextHref); } });
  const markDone = () => void markSetupStep("done", step.key).then((ok) => { if (ok) void load(); });

  const lookedRight = () => {
    if (move >= last && !required && !step.complete) putAside();
    else advanceFrom(move);
  };

  const waitLine = (item: GuideMove) =>
    item.advance === "click" ? "Moves on when you click it" : item.advance === "leave" ? "Moves on when you leave the box" : item.advance === "appear" ? "Moves on when it opens" : item.advance === "done" ? "Ticks itself once it's saved" : null;

  const coachBody = (item: GuideMove, floating: boolean) => (
    <>
      {/* data-guide-step/-move: which move this coach shows, read by the Docs screenshot script (scripts/docs-shots.mjs). */}
      <div data-guide-step={step.key} data-guide-move={move} className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="whitespace-nowrap">{move + 1} of {moves.length}</span>
        <span className="flex-1" />
        <span className="truncate">{step.label}</span>
      </div>
      <p className="m-0 text-sm font-semibold text-foreground">{item.say}</p>
      {item.detail ? <p className="m-0 text-sm text-muted-foreground">{item.detail}</p> : null}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {item.optional ? <Button type="button" variant="ghost" size="sm" onClick={() => advanceFrom(move)}>Skip this</Button> : null}
        {item.advance === "check" ? (
          <Button type="button" size="sm" onClick={lookedRight}>{item.confirm ?? "Looks right"}</Button>
        ) : blocked && item.advance !== "done" ? (
          <>
            <span className="text-xs text-[var(--warning-ink)]">{item.blocked ?? "This is greyed out until what comes before it is filled in."}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => advanceFrom(move)}>I&apos;ve done this</Button>
          </>
        ) : (floating ? false : missing) && item.advance !== "done" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => advanceFrom(move)}>I&apos;ve done this</Button>
        ) : item.advance === "done" && isManualStep(step.key) && !step.complete ? (
          <Button type="button" variant="outline" size="sm" onClick={markDone}>Mark done</Button>
        ) : (
          <span className="text-xs text-muted-foreground">{waitLine(item)}</span>
        )}
      </div>
    </>
  );

  // The coach beside the lit control: below it when there is room, else above; never over it.
  const coachWidth = 320;
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  const floatingCoach = !done && current && box && narrow ? (
    // Below 768px the coach is a bottom sheet (R3·3), so it never covers the control on a small screen.
    <div role="dialog" data-setup-coach="" aria-label={`Get set up: ${step.label}`} className="pointer-events-auto fixed inset-x-0 bottom-0 z-[70] flex flex-col gap-1.5 rounded-t-[20px] border-t border-primary bg-[var(--color-card)] px-4 pt-3 pb-5 shadow-[0_-18px_40px_rgba(0,0,0,.45)]">
      <span aria-hidden="true" className="mx-auto mb-1 block h-1 w-10 rounded-full bg-[var(--border)]" />
      {coachBody(current, true)}
    </div>
  ) : !done && current && box ? (() => {
    const below = box.top + box.height + 12;
    const roomBelow = window.innerHeight - below;
    const roomAbove = box.top - 12;
    const maxLeft = window.innerWidth - coachWidth - 12;
    // A big control (a whole map or table) leaves no room above or below: the coach docks at the window's
    // bottom-right corner instead of covering what it asks you to read.
    const docked = roomBelow <= 190 && roomAbove <= 190;
    const top = docked ? window.innerHeight - 200 : roomBelow > 190 ? below : Math.max(12, box.top - 12 - 170);
    const left = docked ? maxLeft : Math.max(12, Math.min(box.left, maxLeft));
    return (
      <div role="dialog" data-setup-coach="" aria-label={`Get set up: ${step.label}`} className="pointer-events-auto fixed z-[70] flex flex-col gap-1.5 rounded-[12px] border border-primary bg-[var(--color-card)] p-3.5 shadow-[var(--shadow-overlay,0_12px_30px_rgba(0,0,0,.35))]" style={{ top, left, width: coachWidth }}>
        {coachBody(current, true)}
      </div>
    );
  })() : null;

  // Only the lit control, the controls its move keeps usable (`use`: a search, a pager, the card a tick lands in),
  // the setup bar, the coach and any dialog take a click (owner R3·1: "clicking the dimmed page does nothing").
  // One shield and one dim layer, each the whole window with a hole per usable control (evenodd clip-path).
  const pad = 4;
  const holes = box ? [box, ...useBoxes] : [];
  const shields = !done && box && !dialogOpen ? (
    <div aria-hidden="true" data-guide-shield="" className="fixed inset-0 z-[46]" style={{ clipPath: holesPath(holes, pad) }} />
  ) : null;

  const spotlight = !done && box ? (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] bg-[rgba(3,7,6,.55)]" style={{ clipPath: holesPath(holes, pad) }} />
      {useBoxes.filter((other) => !other.plain).map((other, at) => (
        <div key={at} aria-hidden="true" className="pointer-events-none fixed z-[55] rounded-[10px] ring-1 ring-[var(--border-strong)]" style={{ top: other.top - pad, left: other.left - pad, width: other.width + pad * 2, height: other.height + pad * 2 }} />
      ))}
      <div aria-hidden="true" data-guide-lit="" className="pointer-events-none fixed z-[55] rounded-[10px] ring-2 ring-[var(--primary)] transition-[top,left,width,height] duration-200" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} />
    </>
  ) : null;

  // No control lit (a move without one, or its control not on screen): the coach sits in the bar,
  // and floats at the bottom while a dialog covers the bar.
  const inlineCoach = !done && current && !box ? coachBody(current, false) : null;
  const savedWait = !done && !current ? <span className="text-sm text-muted-foreground">Waiting for Insurvas to see it saved…</span> : null;

  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
      {/* Above the dim only while a control is lit (the dim covers the top bar then). Otherwise under the sticky
          top bar (z-30), so a scrolled page never slides the bar over the search, New or the account menu. */}
      <div data-setup-guide="" data-setup-coach="" role="region" aria-label="Get set up" className={cn("pointer-events-auto relative mb-4 flex flex-col gap-2 rounded-[12px] border border-border bg-[var(--color-card)] px-4 py-2.5", spotlight ? "z-[56]" : "z-[29]")}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-semibold text-foreground">{replay && !done ? "Showing you again" : required ? "Setting up" : "Optional setting"}</span>
          {replay && !done ? <StatusChip tone="good">Already done</StatusChip> : <StatusChip tone={required ? "warning" : "neutral"}>{required ? "Required" : "Optional"}</StatusChip>}
          <span className="min-w-0 text-sm text-muted-foreground"><span className="tabular-nums">{position}</span> · {step.label}</span>
          {!done && moves.length > 1 ? (
            <span aria-hidden="true" className="flex items-center gap-1">
              {moves.map((_, at) => <i key={at} className={cn("block h-1.5 w-4 rounded-full", at < move ? "bg-[var(--primary)]" : at === move ? "bg-[var(--primary)] opacity-60" : "bg-[var(--border)]")} />)}
            </span>
          ) : null}
          <span className="flex-1" />
          {/* The step turned done: its stamp plays once (check draws, label pops) and stays put while the bar's
              buttons change around it (Tier 2 motion, 2026-11-18). */}
          {done ? <DoneStamp label="Done" /> : null}
          {done && countdown !== null && autoHref ? (
            <>
              <span role="status" className="text-sm text-muted-foreground tabular-nums">{following ? `Opening ${following.label} in ${countdown}s` : `Ready to sell is done · back to Get set up in ${countdown}s`}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setStayed(step.key)}>Stay here</Button>
              <Link href={autoHref} className={buttonVariants({ size: "sm" })}>{titleCaseNode(<>{following ? "Go now" : "Finish"}</>)}</Link>
            </>
          ) : done ? (
            <>
              {fromDocs ? <Link href={`/app/docs/${step.key}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Back to Docs</Link> : null}
              <Link href="/app/setup" className={buttonVariants({ variant: "ghost", size: "sm" })}>Back to Get Set Up</Link>
              <Link href={nextHref} className={buttonVariants({ size: "sm" })}>{titleCaseNode(<>{following ? `Next: ${following.label}` : "Finish"}</>)}</Link>
            </>
          ) : replay ? (
            <Button type="button" variant="ghost" size="sm" onClick={leaveGuide}>Stop guide</Button>
          ) : required ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmPause(true)}>Pause</Button>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmSkip(true)}>Skip this step</Button>
              <Button type="button" variant="ghost" size="sm" onClick={leaveGuide}>Stop guide</Button>
            </>
          )}
        </div>
        {inlineCoach && !dialogOpen ? <div className="flex flex-col gap-1.5 border-t border-border pt-2">{inlineCoach}</div> : null}
        {savedWait}
        {retryLine}
      </div>
      {inlineCoach && dialogOpen ? (
        <div role="dialog" data-setup-coach="" aria-label={`Get set up: ${step.label}`} className="pointer-events-auto fixed bottom-6 left-1/2 z-[70] flex w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-1.5 rounded-[12px] border border-primary bg-[var(--color-card)] p-3.5 shadow-[var(--shadow-overlay,0_12px_30px_rgba(0,0,0,.35))]">
          {inlineCoach}
        </div>
      ) : null}
      {shields}
      {spotlight}
      {floatingCoach}
      <Dialog open={confirmPause} onOpenChange={setConfirmPause}>
        <DialogContent data-setup-own="" className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Pause here?</DialogTitle>
            <DialogDescription>What you&apos;ve saved stays, and Get set up keeps your place: {step.label}, move {Math.min(move + 1, moves.length)} of {moves.length}. Ready to sell needs this step before you can work.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmPause(false)}>Keep going</Button>
            <Button type="button" onClick={pause}>Pause</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <DialogContent data-setup-own="" className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Skip &ldquo;{step.label}&rdquo;?</DialogTitle>
            <DialogDescription>It stays on Insurvas&apos;s defaults, which work as they are. You can open it any time from Get set up.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmSkip(false)}>Keep going</Button>
            <Button type="button" onClick={putAside}>Skip</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
