import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight } from "lucide-react";

import styles from "@/components/marketing/cta.module.css";

/**
 * The marketing call-to-action: the brand's pill, with a real pressed, hover and focus state.
 * Marketing only (README): the app's shared Button title-cases its label and stays 8px-cornered; the
 * landing page speaks in sentence case, the way the header's "Start free trial" already does.
 *
 * - primary: the brand green fill with ink text; the arrow sits in its own ink disc and nudges on
 *   hover while a single band of light sweeps across.
 * - secondary: a quiet outline on light grounds.
 * - onDark: the outline for the deep-olive closing band.
 */
type Variant = "primary" | "secondary" | "onDark";

export function MarketingCta({ href, children, variant = "primary", icon = "right", type = "button", disabled = false }: {
  /** A link when set; without it the CTA is a button element (a form's submit, 2026-11-06). */
  href?: string;
  children: ReactNode;
  variant?: Variant;
  icon?: "right" | "down" | "none";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const Icon = icon === "down" ? ArrowDown : ArrowRight;
  if (!href) {
    return (
      <button type={type} disabled={disabled} className={`${styles.cta} ${styles.button} ${styles[variant]}`}>
        <span className={styles.label}>{children}</span>
        {icon !== "none" && <span className={styles.icon} aria-hidden="true"><Icon /></span>}
      </button>
    );
  }
  return (
    <Link href={href} className={`${styles.cta} ${styles[variant]}`}>
      <span className={styles.label}>{children}</span>
      {icon !== "none" && <span className={styles.icon} aria-hidden="true"><Icon /></span>}
    </Link>
  );
}
