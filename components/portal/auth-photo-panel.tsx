"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { WaveField } from "@/components/shared/wave-field";

/**
 * The agent auth story. Plan and payment summaries remain real content in this panel.
 *
 * The panel runs **the landing page's own field** (`wave-field.tsx`, look "auth"), not a picture
 * of its own: the owner asked for a theme that suits the rest of the product (12 Nov), and a door
 * that carries the front page's field is the same software to anyone arriving from the site.
 * Before this it was a bought photograph of a road with a slow zoom on it; the studies that led
 * here are in tasks/auth-panel/todo.md.
 *
 * The words are set "Top set": the claim under the logo, the field taking the lower half, and the
 * one supporting line at the foot. Four stacked voices — a caps kicker, the claim, a paragraph
 * that repeated it and a rule above a footnote — were a wall, not a hierarchy.
 */
export function AuthPhotoPanel({ children }: { children?: ReactNode }) {
  const [paused, setPaused] = useState(false);
  return (
    <div className="auth-photo-panel" data-paused={paused || undefined} data-has-summary={children ? "" : undefined}>
      <span className="auth-photo-field" aria-hidden="true">
        <WaveField look="auth" paused={paused} />
      </span>
      <div className="auth-photo-shade" aria-hidden="true" />
      <Link href="/" aria-label="Insurvas home" className="auth-photo-logo">
        <InsurvasLogo size="auth" tone="dark" />
      </Link>
      {children ? (
        <div className="auth-photo-summary">{children}</div>
      ) : (
        <>
          <div className="auth-photo-copy">
            <p className="auth-photo-kicker">The operating system for life insurance sales teams</p>
            {/* One word in the accent serif, as on the landing page's own headlines. */}
            <p className="auth-photo-title">Know what every <em>lead</em> cost you.</p>
          </div>
          {/* At the foot of the panel, not under the claim: it is the quiet line, not a second one. */}
          <p className="auth-photo-description">Leads, calls, applications and commissions, connected in one workspace.</p>
        </>
      )}
      <button type="button" className="auth-photo-motion" aria-pressed={paused} onClick={() => setPaused(!paused)}>
        {paused ? "▶  Play motion" : "Ⅱ  Pause motion"}
      </button>
    </div>
  );
}
