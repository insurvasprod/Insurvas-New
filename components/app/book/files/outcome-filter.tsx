"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { ToggleChip } from "@/components/ui/toggle-chip";

/**
 * A file's Rows tab (round 2): pick one outcome, as the address (`?tab=rows&outcome=…`), so a link from the
 * Overview's figures, the back button and a shared link all keep it. One row of ToggleChips (§16).
 * Round 3: the Files step's All · Needs you · Failed · Missing chips are the same control (`label`).
 */
export function OutcomeFilter({ options, value, label = "Show rows by outcome" }: { options: Array<{ key: string; label: string; count: number; href: string; warn?: boolean }>; value: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2" aria-busy={pending || undefined}>
      {options.map((option) => (
        <ToggleChip key={option.key} role="radio" selected={value === option.key} count={option.count.toLocaleString("en-US")} countTone={option.warn && option.count > 0 ? "warning" : undefined} onClick={() => start(() => router.push(option.href, { scroll: false }))}>
          {option.label}
        </ToggleChip>
      ))}
    </div>
  );
}

/** A filter set from elsewhere (a Needs you group's Start), shown as a chip whose × clears it (§16). */
export function RemoveChip({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  return <ToggleChip selected onRemove={() => router.push(href, { scroll: false })}>{label}</ToggleChip>;
}
