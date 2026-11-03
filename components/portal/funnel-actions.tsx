import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one footer every sign-up step ends with (manager review, 2026-10-28): Back on the left, the
 * step's own primary button filling the rest. No "← Back to …" link above the heading, no Sign out
 * under the form: the only way through a step is forward or one step back.
 *
 * `children` is the primary action (a submit Button, or a Link styled as one). Leave `back` out on
 * the first step.
 */
export function FunnelActions({ back, children, className, onDark = false }: {
  back?: string;
  /** On the green brand panel (the plan summary): Back in the panel's own light-on-dark colours. */
  onDark?: boolean;
  /** Left out where the step's own form has the button (Payment: Whop's pay button). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div data-funnel-actions="" className={cn("flex items-center gap-3", className)}>
      {back && (
        <Button
          asChild
          variant="outline"
          className={cn(
            "h-11 shrink-0 px-5",
            onDark
              ? "border-white/30 bg-transparent text-[var(--on-dark)] hover:bg-white/10 hover:text-[var(--on-dark)] dark:border-white/30 dark:bg-transparent dark:hover:bg-white/10"
              : "border-[var(--border-strong)]",
          )}
        >
          <Link href={back}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>
      )}
      {children && <div className="min-w-0 flex-1 [&>*]:w-full">{children}</div>}
    </div>
  );
}
