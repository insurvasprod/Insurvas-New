"use client";

import { useEffect } from "react";

import { primeAudio } from "@/lib/notify/sound";

/**
 * Opens the audio context on the first real user gesture, then gets out of the way.
 *
 * Browsers refuse to start audio before a gesture. Without this the first sound of a session is
 * swallowed silently and the second one arrives with no warning — which reads as a bug, and is how
 * people end up muting the tab and missing everything after it.
 *
 * `once: true` on each listener, and the listeners removed on unmount, because this only ever needs
 * to happen a single time per tab and a persistent global listener on three events is a cost paid
 * by every interaction for the rest of the session.
 */
export function NotifySoundPrimer() {
  useEffect(() => {
    // Covers a click, a keyboard-only user, and a touch device. `pointerdown` rather than `click`
    // so the context is open before the action that gesture triggers can raise its own toast.
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    const prime = () => primeAudio();
    events.forEach((event) => window.addEventListener(event, prime, { once: true, passive: true }));
    return () => events.forEach((event) => window.removeEventListener(event, prime));
  }, []);

  return null;
}
