"use client";

/**
 * Reveal one sensitive value for a minute (LA-3.7). The server writes the access record before the
 * value leaves; on screen it is shown for 60 seconds and then masked again — sooner if the window
 * loses focus or the field goes away. The revealed value lives only in this hook's state.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useWorkspace } from "./context";

const REVEAL_MS = 60_000;

/**
 * `stamp` identifies the stored value (its mask): when the stored value changes, a value revealed
 * for the old one is no longer shown.
 */
export function useReveal(fieldKey: string, stamp: string | undefined) {
  const { actions } = useWorkspace();
  const [shown, setShown] = useState<{ value: string; stamp: string | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setShown(null);
  }, []);

  const reveal = useCallback(async () => {
    setBusy(true);
    try {
      const value = await actions.reveal(fieldKey);
      if (value === null) return;
      if (timer.current) clearTimeout(timer.current);
      setShown({ value, stamp });
      timer.current = setTimeout(() => { timer.current = null; setShown(null); }, REVEAL_MS);
    } finally {
      setBusy(false);
    }
  }, [actions, fieldKey, stamp]);

  // Leaving the window (or the tab) masks it again; unmounting drops it with the component.
  useEffect(() => {
    const onBlur = () => hide();
    const onVisibility = () => { if (document.visibilityState === "hidden") hide(); };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hide]);

  const value = shown && shown.stamp === stamp ? shown.value : null;
  return { value, busy, reveal, hide };
}

/**
 * The boards' sensitive field (l3-ws-verify, l3-ws-application): a 36px box holding the masked value
 * with Reveal at its right edge. `display` is how the mask reads (e.g. •••-••-4417); `stamp` is the
 * stored mask, so a value revealed for an older number is never shown.
 */
export function RevealBox({ id, fieldKey, masked, display, hasValue, label }: { id?: string; fieldKey: string; masked: string | undefined; display?: string; hasValue: boolean | undefined; label: string }) {
  const { value, busy, reveal, hide } = useReveal(fieldKey, masked);
  const shown = hasValue && value !== null;
  return (
    <div
      id={id}
      tabIndex={id ? -1 : undefined}
      className="mt-1.5 flex h-9 min-w-0 items-center justify-between gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pl-3 pr-1 text-[14px] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
    >
      {!hasValue ? (
        <span className="text-[var(--muted)]">Not given</span>
      ) : (
        <span className="min-w-0 truncate font-mono tabular-nums" title={shown ? "Masked again after a minute" : undefined}>{shown ? value : display ?? masked ?? "••••"}</span>
      )}
      {hasValue && (shown ? (
        <Button type="button" variant="ghost" size="sm" aria-label={`Hide ${label}`} onClick={hide}>
          <EyeOff aria-hidden="true" />Hide
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" aria-label={`Reveal ${label}`} disabled={busy} title={busy ? "Revealing…" : undefined} onClick={() => { void reveal(); }}>
          <Eye aria-hidden="true" />Reveal
        </Button>
      ))}
    </div>
  );
}
