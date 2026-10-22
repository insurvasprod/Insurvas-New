"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { guideHref, isManualStep, type SetupChecklist } from "@/lib/dashboard/checklist";

import { markSetupStep } from "./setup-step-list";

type SetupResponse = {
  checklist: SetupChecklist;
  next: { key: string; label: string; href: string } | null;
};

/**
 * The walkthrough on the real screen (2026-10-21). A step on the setup page links here with
 * `?guide=<step>`; this bar says what to do on this screen, outlines the control to use (the element
 * carrying `data-guide="<target>"`, when the screen has one — nothing is clicked for the reader), and
 * turns into "Done — next step" once the step's own data proves it, so nobody has to tell us they
 * finished. It is an action the reader is in the middle of, so it is a one-line notice, not an
 * explainer card (UI-CONSISTENCY rule 3).
 *
 * Done is learned by asking /api/app/setup again: on focus, when another tab or the setup list says
 * something changed, and shortly after any click on the page (the click that saved the form).
 */
export function SetupGuideBar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const stepKey = params.get("guide");
  const [data, setData] = useState<SetupResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const timers = useRef<number[]>([]);

  // Every check is numbered and only the newest answer is kept: two checks in flight (a click and a
  // focus) could otherwise land out of order, and an older "not done" overwrote a newer "done" (live
  // walkthrough, 2026-10-22).
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const mine = ++sequence.current;
    const response = await fetch("/api/app/setup", { cache: "no-store" }).catch(() => null);
    if (mine !== sequence.current) return;
    if (!response?.ok) { setFailed(true); return; }
    const body = (await response.json()) as SetupResponse;
    if (mine !== sequence.current) return;
    setFailed(false);
    setData(body);
  }, []);

  useEffect(() => {
    if (!stepKey) return;
    void load();
    const again = () => void load();
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
      window.removeEventListener("focus", again);
      window.removeEventListener("setup:changed", again);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("click", onClick, true);
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, [stepKey, load]);

  const steps = data?.checklist.steps ?? [];
  const index = steps.findIndex((step) => step.key === stepKey);
  const step = index >= 0 ? steps[index] : null;
  const target = step && !step.complete ? step.target : undefined;
  const waiting = step !== null && !step.complete;

  // While the step is still open, check again every few seconds: a save that takes longer than the
  // click-follow-up checks (a slow first compile, a big import) was otherwise never noticed.
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  // Outline the control to use. Settings tabs mount their panel after the hash is read, so the
  // target may appear later: watch for it, and stop once found or when the step changes.
  useEffect(() => {
    if (!target) return;
    let found: HTMLElement | null = null;
    const mark = () => {
      const element = document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(target)}"]`);
      if (!element || element === found) return;
      found = element;
      element.dataset.guideActive = "";
      element.style.outline = "2px solid var(--primary)";
      element.style.outlineOffset = "3px";
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (found) {
        delete found.dataset.guideActive;
        found.style.outline = "";
        found.style.outlineOffset = "";
      }
    };
  }, [target, pathname]);

  if (!stepKey || failed || !data || !step) return null;

  const position = `Step ${index + 1} of ${steps.length}`;
  // The next step after this one (wrapping round), not the first undone one: that may be this step.
  const following = [...steps.slice(index + 1), ...steps.slice(0, index)].find((item) => !item.complete && !item.skipped);
  const next = following ? { label: following.label, href: guideHref(following) } : null;

  const skip = () => {
    void markSetupStep("skip", step.key).then((ok) => {
      if (!ok) return;
      router.push(next ? next.href : "/app/setup");
    });
  };
  const markDone = () => void markSetupStep("done", step.key).then((ok) => { if (ok) void load(); });

  return (
    <div
      role="status"
      aria-live="polite"
      data-setup-guide=""
      className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-primary bg-[var(--color-card)] px-4 py-3"
    >
      {step.complete ? (
        <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)]">
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : null}
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-muted-foreground tabular-nums">{position} · </span>
        <span className="font-semibold">{step.label}</span>
        <span className="text-muted-foreground"> — {step.complete ? "done." : step.instruction}</span>
      </p>
      <span className="flex shrink-0 flex-wrap items-center gap-2">
        <Link href="/app/setup" className={buttonVariants({ variant: "ghost" })}>Back to setup</Link>
        {!step.complete && isManualStep(step.key) ? (
          <Button type="button" variant="outline" onClick={markDone}>Mark done</Button>
        ) : null}
        {!step.complete ? (
          <Button type="button" variant="ghost" onClick={skip}>Skip</Button>
        ) : null}
        {step.complete ? (
          <Link href={next ? next.href : data.checklist.complete ? "/app/setup?celebrate=1" : "/app/setup"} className={buttonVariants({ variant: "default" })}>
            {next ? `Next: ${next.label}` : "Finish"}
          </Link>
        ) : null}
      </span>
    </div>
  );
}

