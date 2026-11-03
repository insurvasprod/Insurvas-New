/**
 * Bring one setting into view (LA-8.1): search lands on the control, not the top of its page.
 *
 * Settings screens load their values after the page arrives, so the element may not exist yet. This
 * waits for it (up to `timeoutMs`), scrolls it to the middle of the screen, focuses it when it is a
 * control, and pulses a ring so the eye finds it. Returns a cancel function for effect cleanup.
 */
export function revealAnchor(id: string, timeoutMs = 10_000): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const started = Date.now();
  const tick = () => {
    if (cancelled) return;
    const element = document.getElementById(id);
    if (!element) {
      if (Date.now() - started < timeoutMs) timer = setTimeout(tick, 100);
      return;
    }
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    if (element.matches("input, select, textarea, button")) element.focus({ preventScroll: true });
    element.animate?.(
      [{ boxShadow: "0 0 0 3px var(--ring-color)" }, { boxShadow: "0 0 0 3px transparent" }],
      { duration: 1800, easing: "ease-out" },
    );
  };
  tick();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
