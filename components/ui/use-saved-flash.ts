"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motionMs } from "./motion-tokens";

/**
 * The saved glow on an inline edit (Wave B, 2026-11-18): the cell, row or field that just saved wears `data-saved`
 * for one --t-saved, so `m-saved` (app/globals.css 5i) plays behind it once, beside the toast that already says so.
 *
 *   const saved = useSavedFlash();
 *   … await save(); saved.flash(row.id);
 *   <td {...saved.props(row.id)}>…</td>
 *
 * Several keys can glow together (`flash([a, b])`). Flashing the same key again takes the mark off for two frames
 * first, so the glow plays again rather than carrying on. The reduce block in globals.css stills the glow itself.
 */
export function useSavedFlash() {
  const [glowing, setGlowing] = useState<ReadonlySet<string> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
  }, []);

  const flash = useCallback((keys: string | readonly string[]) => {
    const next = new Set(typeof keys === "string" ? [keys] : keys);
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    setGlowing(null);
    // Two frames: the first lets the cleared mark reach the page, so a key that was still glowing starts over.
    frame.current = window.requestAnimationFrame(() => {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = undefined;
        setGlowing(next);
        timer.current = window.setTimeout(() => setGlowing(null), motionMs("--t-saved", 900));
      });
    });
  }, []);

  const props = useCallback(
    (key: string): { "data-saved"?: "" } => (glowing?.has(key) ? { "data-saved": "" } : {}),
    [glowing],
  );

  return { flash, props };
}
