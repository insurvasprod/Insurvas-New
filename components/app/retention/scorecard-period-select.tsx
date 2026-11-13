"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { SelectMenu } from "@/components/ui/select-menu";

/**
 * The period on the title line of Retention › Scorecard and Results (round 7, boards 5·A and 6·A: "the page's one
 * control"). Kept in `?period=`, the default left out of the address; the tab and the person stay.
 */
export function RetentionPeriodSelect<K extends string>({ value, fallback, options }: { value: K; fallback: K; options: ReadonlyArray<{ value: K; label: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (next: K) => {
    const query = new URLSearchParams(params.toString());
    if (next === fallback) query.delete("period"); else query.set("period", next);
    router.push(query.size ? `${pathname}?${query}` : pathname);
  };
  return (
    <SelectMenu
      label="Period"
      value={value}
      defaultValue={fallback}
      icon={<CalendarDays className="size-4" aria-hidden="true" />}
      options={options}
      onChange={go}
      className="w-48"
    />
  );
}
