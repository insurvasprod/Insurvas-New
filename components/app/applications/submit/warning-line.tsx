import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/** One amber line under a field: a warning the agent can read and ignore. Never red, never a block. */
export function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
