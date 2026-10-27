import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The controls every sign-in and sign-up screen shares (UI-CONSISTENCY.md §13, foundation v3).
 *
 * Auth fields are 44px, not the app's 36px: these screens are the ones people use on a phone, and
 * four of the five sign-up steps already were. One height, one label, one alert, one primary button,
 * so moving between sign-in and sign-up never changes the size of anything.
 */

/** The label above every auth field. */
export const authLabel = "text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]";

/** Any native auth control (input, select) under a `<span className={authLabel}>`: 44px, 8px corners, the "type here" edge. */
export const authControl =
  "mt-1.5 box-border h-11 w-full rounded-md border border-[var(--border-strong)] bg-card px-3 text-base leading-normal tracking-[-0.02em] text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

/** The shared Input at the auth height. */
export function AuthInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input className={cn("h-11 rounded-md border-[var(--border-strong)] bg-card text-base md:text-base", className)} {...props} />;
}

/** Label, control and an optional hint, stacked. `aside` sits right of the label ("Forgot password?"). */
export function AuthField({ label, htmlFor, aside, hint, children, className }: {
  label: ReactNode;
  htmlFor: string;
  aside?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className={authLabel}>{label}</label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-sm leading-normal tracking-[-0.02em] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The screen's primary action: full width, 44px. Secondary actions use variant="outline" at the same size. */
export function AuthSubmit({ className, type = "submit", onClick, ...props }: ComponentProps<typeof Button>) {
  // onClick passes through by name so lib/design/contract.test.mjs sees the handler a caller gives.
  return <Button type={type} onClick={onClick} className={cn("h-11 w-full", className)} {...props} />;
}

/** The secondary full-width action ("Email me a sign-in link"), the same height as AuthSubmit. */
export function AuthSecondary({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  return <Button type="button" variant="outline" onClick={onClick} className={cn("h-11 w-full border-[var(--border-strong)]", className)} {...props} />;
}

const ALERT_TONE = {
  error: "border-[color-mix(in_srgb,var(--error)_28%,transparent)] bg-[var(--error-surface)] text-[var(--error-ink)]",
  info: "border-[color-mix(in_srgb,var(--info)_28%,transparent)] bg-[var(--info-surface)] text-[var(--info-ink)]",
  success: "border-[color-mix(in_srgb,var(--success)_28%,transparent)] bg-[var(--success-surface)] text-[var(--success-ink)]",
} as const;

/**
 * The one message box on auth screens: what went wrong, what changed, or what to do next.
 * Errors are announced (role="alert"); info and success are polite status messages.
 */
export function AuthAlert({ tone = "error", title, children, className, id }: {
  tone?: keyof typeof ALERT_TONE;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn("grid gap-0.5 rounded-md border px-3.5 py-3 text-sm leading-[1.45] tracking-[-0.01em]", ALERT_TONE[tone], className)}
    >
      {title && <strong className="font-semibold">{title}</strong>}
      {children && <span>{children}</span>}
    </div>
  );
}
