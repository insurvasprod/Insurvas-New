import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { AuthHeading } from "@/components/portal/auth-layout";

/**
 * The body of an account screen inside the auth layout (set password, suspended, verification
 * failed): the one AuthHeading, then the screen's own content. It used to be a centred card with
 * its own box and title; inside the layout the column is the surface, so neither is drawn
 * (foundation v3). `width` and `eyebrow` are accepted for existing callers and no longer change
 * anything: the layout sets the width.
 */
export function AuthCard({ title, description, children, className }: {
  width?: 640 | 680 | 1040;
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div data-auth-card="" className={cn("m-in w-full", className)}>
      {title ? <AuthHeading title={title}>{description}</AuthHeading> : description && <p className="text-base leading-normal tracking-[-0.02em] text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

export function AuthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

// One definition for every auth screen (components/portal/auth-controls.tsx, foundation v3).
export { authControl, authLabel } from "@/components/portal/auth-controls";
