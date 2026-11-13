"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { WaveField } from "@/components/shared/wave-field";
import { LayeredText } from "@/components/ui/layered-text";

/**
 * The agent auth story. Plan and payment summaries remain real content in this panel.
 *
 * The panel runs **the landing page's own field** (`wave-field.tsx`, look "auth"), not a picture
 * of its own, so a door reached from the site is the same software as the site.
 *
 * **The staircase (owner, 2026-11-13).** Where there is no summary the panel is the 21st.dev
 * layered text, set as published: the logo, then the words stacked as an isometric staircase over
 * the landing page's field, rolling up one line on hover (owner, 2026-11-13: the plain dark ground
 * went; the gradient from the home page came back). The words are the path a lead takes through the
 * product, from the vendor who sold it to the money it made: each row hands its word to the next,
 * which is exactly what the hover shows.
 */
const JOURNEY = ["LEADS", "CALLS", "SALES", "POLICIES", "PAYOUTS", "PROFIT"];
const LINES = JOURNEY.map((word, i) => ({ top: i === 0 ? " " : JOURNEY[i - 1], bottom: word })).concat({
  top: JOURNEY[JOURNEY.length - 1],
  bottom: " ",
});

export function AuthPhotoPanel({ children }: { children?: ReactNode }) {
  return (
    <div className="auth-photo-panel" data-has-summary={children ? "" : undefined}>
      <span className="auth-photo-field" aria-hidden="true">
        <WaveField look="auth" />
      </span>
      <div className="auth-photo-shade" aria-hidden="true" />
      <Link href="/" aria-label="Insurvas home" className="auth-photo-logo">
        <InsurvasLogo size="auth" tone="dark" />
      </Link>
      {children ? (
        <div className="auth-photo-summary">{children}</div>
      ) : (
        <div className="auth-photo-layered">
          <p className="sr-only">Leads, calls, sales, policies, payouts and profit, in one workspace.</p>
          <div aria-hidden="true">
            <LayeredText lines={LINES} />
          </div>
        </div>
      )}
    </div>
  );
}
