import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The centred card the signed-out and onboarding screens share (verify email, set password):
 * canvas ground, one white card, 12px radius, 40px padding, a 32px centred title.
 */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="portal-agent flex min-h-screen items-center justify-center bg-[var(--canvas)] px-4 py-10">
      {children}
    </div>
  );
}

export function AuthCard({ width, eyebrow, title, description, children, className }: {
  width: 640 | 680 | 1040;
  eyebrow?: string;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("m-in w-full", width === 640 ? "max-w-[640px]" : width === 680 ? "max-w-[680px]" : "max-w-[1040px]", className)}>
      <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
        {eyebrow && <div className="text-center text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{eyebrow}</div>}
        {title && <h1 className={cn("text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground", eyebrow ? "mt-2" : "mt-2")}>{title}</h1>}
        {description && <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">{description}</p>}
        {children}
      </div>
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

export const authLabel = "text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]";
export const authControl =
  "mt-1.5 box-border h-11 w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 text-base leading-normal tracking-[-0.02em] text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";
