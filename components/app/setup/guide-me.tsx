"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { notify } from "@/lib/notify";
import { guideHref, type SetupChecklistStep } from "@/lib/dashboard/checklist";
import { guideMovesFor } from "@/lib/dashboard/guideMoves";

import { readPausedGuide, withMove } from "./setup-guide-bar";
import { requiredLeft, useSetupStatus } from "./setup-status";

/** Whether a step's page is the one open: same path, and the same Settings tab when the step names one. */
function stepIsHere(step: Pick<SetupChecklistStep, "path">, pathname: string, hash: string): boolean {
  const [beforeHash, stepHash] = step.path.split("#", 2);
  if (beforeHash.split("?")[0] !== pathname) return false;
  if (!stepHash) return true;
  return hash.replace(/^#/, "").split("/")[0] === stepHash.split("/")[0];
}

const SEEN_KEY = "setup-guide-offered";
const REMINDED_KEY = "setup-reminded-on";

/**
 * "Guide me" beside a page's (i) (owner, Get set up R3·3): on a page that holds one of the reader's setup
 * steps, the same guide Get set up starts, at any time. Also, once per browser per step, the first visit to
 * an optional step's page offers it as a toast; and once a day, while Ready to sell has steps left, a toast
 * says how many and offers Resume (R3·3b). Nothing shows on a page with no step of the reader's, or while a
 * guide is already running.
 */
export function GuideMe() {
  // The agent app only: admin and partner pages share the header but have no setup.
  const pathname = usePathname();
  if (!pathname.startsWith("/app/") || pathname === "/app/login") return null;
  return <GuideMeHere pathname={pathname} />;
}

function GuideMeHere({ pathname }: { pathname: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const status = useSetupStatus();
  const [hash, setHash] = useState("");
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);

  const guiding = params.get("guide") !== null;
  const here = useMemo(() => {
    if (!status || guiding) return null;
    const matches = status.checklist.steps.filter((step) => stepIsHere(step, pathname, hash));
    return matches.find((step) => !step.complete && !step.skipped) ?? matches[0] ?? null;
  }, [status, guiding, pathname, hash]);

  // First visit to an optional step's page: offered once, never started by itself.
  useEffect(() => {
    if (!here || !here.optional || here.complete || here.skipped) return;
    let seen: string[] = [];
    try { seen = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as string[]; } catch { /* storage blocked */ }
    if (seen.includes(here.key)) return;
    try { window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, here.key])); } catch { /* storage blocked */ }
    notify.arrive(`First time on ${here.label.replace(/^(Check|Set|Connect) /, "")}?`, {
      detail: `Insurvas can show you each click · ${guideMovesFor(here).length} ${guideMovesFor(here).length === 1 ? "move" : "moves"}`,
      action: { label: "Guide me", onClick: () => router.push(guideHref(here)) },
    });
  }, [here, router]);

  // Once a day while Ready to sell is unfinished: how many are left, and Resume (or the next step).
  useEffect(() => {
    const left = requiredLeft(status);
    if (!status || left === 0 || guiding || pathname === "/app/setup") return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      if (window.localStorage.getItem(REMINDED_KEY) === today) return;
      window.localStorage.setItem(REMINDED_KEY, today);
    } catch { return; }
    const required = status.checklist.steps.filter((step) => !step.optional);
    const paused = readPausedGuide();
    const pausedStep = paused ? required.find((step) => step.key === paused.key && !step.complete) : undefined;
    const next = pausedStep ?? required.find((step) => !step.complete);
    if (!next) return;
    const word = status.audience === "owner" ? "Ready to sell" : "Ready to work";
    notify.warn(`${word} · ${required.length - left} of ${required.length}`, {
      detail: `Next: ${next.label}${next.minutes ? ` · ${next.minutes} min` : ""}`,
      action: { label: pausedStep ? "Resume" : "Start", onClick: () => router.push(pausedStep && paused ? withMove(paused.href, paused.move) : guideHref(next)) },
    });
  }, [status, guiding, pathname, router]);

  if (!here) return null;
  const moves = guideMovesFor(here).length;
  return (
    <Link href={guideHref(here)} title={`Show me each click: ${here.label}`} className="inline-flex h-7 shrink-0 items-center rounded-md px-2 text-xs font-medium text-[var(--accent-ink)] hover:bg-[var(--surface-alt)]">
      Guide me · {moves} {moves === 1 ? "move" : "moves"}
    </Link>
  );
}
