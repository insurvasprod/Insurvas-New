"use client";

import { usePathname, useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { SelectMenu } from "@/components/ui/select-menu";

/** The agency dashboard's month ("This month ▾", round 2): kept in ?period=, so a link holds it. */
export function AgencyPeriodSelect({ value }: { value: "this" | "last" }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <SelectMenu
      label="Month shown"
      value={value}
      defaultValue="this"
      icon={<CalendarDays className="size-4" aria-hidden="true" />}
      options={[{ value: "this", label: "This month" }, { value: "last", label: "Last month" }]}
      onChange={(next) => router.push(next === "this" ? path : `${path}?period=last`)}
      className="w-40"
    />
  );
}
