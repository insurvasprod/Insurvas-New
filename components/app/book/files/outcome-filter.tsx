"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ToggleChip } from "@/components/ui/toggle-chip";

/**
 * A file's Rows tab (round 2): pick one outcome, as the address (`?tab=rows&outcome=…`), so a link from the
 * Overview's figures, the back button and a shared link all keep it. One row of ToggleChips (§16).
 */
export function OutcomeFilter({ options, value }: { options: Array<{ key: string; label: string; count: number; href: string; warn?: boolean }>; value: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label="Show rows by outcome" className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      {options.map((option) => (
        <ToggleChip key={option.key} role="radio" selected={value === option.key} count={option.count.toLocaleString("en-US")} countTone={option.warn && option.count > 0 ? "warning" : undefined} onClick={() => start(() => router.push(option.href, { scroll: false }))}>
          {option.label}
        </ToggleChip>
      ))}
    </div>
  );
}
