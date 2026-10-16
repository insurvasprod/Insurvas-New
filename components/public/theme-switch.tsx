"use client";

import { useId } from "react";

import { useTheme } from "@/components/theme-provider";
import styles from "@/components/public/site-header.module.css";

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> };
};

/**
 * The landing nav's light/dark switch. One click flips the theme the page is actually showing (a
 * visitor on "system" gets the opposite of what their machine chose, saved from then on).
 *
 * Where the browser has view transitions, the new theme spreads out from the button as a growing
 * circle; elsewhere, or with reduced motion, it switches at once. The class is applied inside the
 * transition callback so the browser captures the new frame; ThemeProvider then saves the choice
 * and re-applies the same class.
 *
 * `compact` (2026-10-13) is the same switch for the product top bars (/app, /admin, /partner): the
 * 36px square of the bar's other icon buttons (.portal-top-icon) and a 16px icon, beside the bell.
 */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { setTheme } = useTheme();
  const maskId = `${useId()}-moon`;

  const toggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    const root = document.documentElement;
    const next = root.classList.contains("dark") ? "light" : "dark";
    const apply = () => {
      root.classList.toggle("dark", next === "dark");
      root.style.colorScheme = next;
      setTheme(next);
    };

    const doc = document as ViewTransitionDocument;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduced) {
      apply();
      return;
    }

    const box = event.currentTarget.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    root.classList.add("theme-reveal");
    const transition = doc.startViewTransition(apply);
    transition.ready
      .then(() => {
        const animation = root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 650, easing: "cubic-bezier(.16, 1, .3, 1)", pseudoElement: "::view-transition-new(root)" },
        );
        return animation.finished;
      })
      .catch(() => undefined)
      .finally(() => root.classList.remove("theme-reveal"));
  };

  return (
    <button type="button" onClick={toggle} aria-label="Switch between light and dark mode" title="Light / dark" className={compact ? "portal-top-icon" : styles.themeSwitch}>
      <svg viewBox="0 0 24 24" className={styles.icon} style={compact ? { width: 16, height: 16 } : undefined} aria-hidden="true">
        <mask id={maskId}>
          <rect x="-12" y="-12" width="48" height="48" fill="white" />
          <circle className={styles.bite} cx="31" cy="7" r="6.5" fill="black" />
        </mask>
        <g mask={`url(#${maskId})`}>
          <circle className={styles.core} cx="12" cy="12" r="4.75" fill="currentColor" />
        </g>
        <g className={styles.rays} stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="1.5" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  );
}
