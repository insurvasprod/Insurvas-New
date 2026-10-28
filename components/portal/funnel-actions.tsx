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
export function FunnelActions({ back, children, className }: {
  back?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-funnel-actions="" className={cn("flex items-center gap-3", className)}>
      {back && (
        <Button asChild variant="outline" className="h-11 shrink-0 border-[var(--border-strong)] px-5">
          <Link href={back}>
            <ArrowLeft aria-hidden="true" />
            Back
          </Link>
        </Button>
      )}
      <div className="min-w-0 flex-1 [&>*]:w-full">{children}</div>
    </div>
  );
}
