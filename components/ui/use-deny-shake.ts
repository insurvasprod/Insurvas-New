"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { motionMs } from "./motion-tokens";

/**
 * The single "no" shake on a refused submit (Wave B, 2026-11-18): `deny()` puts `m-deny-now` (app/globals.css 5i) on
 * the form's error summary or its primary button for one --t-panel, so it shakes once. A second refusal takes the
 * class off for two frames first, so it shakes again rather than not at all. The reduce block stills it.
 *
 *   const refusal = useDenyShake();
 *   if (problems.length) { setShowErrors(true); refusal.deny(); return; }
 *   <Button className={refusal.className}>Save</Button>
 *
 * or, where the errors are state the submit sets, `refusal.denyIfErrors(event.currentTarget)` in the submit handler.
 */
export function useDenyShake() {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
  }, []);

  const deny = useCallback(() => {
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => {
      setOn(false);
      frame.current = window.requestAnimationFrame(() => {
        frame.current = undefined;
        setOn(true);
        timer.current = window.setTimeout(() => setOn(false), motionMs("--t-panel", 200));
      });
    });
  }, []);

  /**
   * For a form whose submit handler shows its errors by setting state (`tried`, `errors`): call it with the form on
   * submit, and once the errors have painted, a form left with a Field error line (`data-field-error`) is refused and
   * shakes. A form that went through (or closed) does not.
   */
  const denyIfErrors = useCallback((form: HTMLFormElement | null) => {
    if (!form) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (form.isConnected && form.querySelector("[data-field-error]")) deny();
    }));
  }, [deny]);

  return { deny, denyIfErrors, className: on ? "m-deny-now" : undefined };
}
