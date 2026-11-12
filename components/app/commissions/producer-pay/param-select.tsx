"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { toolbarControl } from "@/components/ui/data-toolbar";
import { NavPending, useNavTransition } from "@/components/ui/nav-pending";

/**
 * A select whose value lives in the address (round 7): Producer pay's month, My pay's year. Changing it keeps the
 * rest of the address, so the view and the month survive Back and can be sent as a link.
 */
export function ParamSelect({ label, param, value, options, reset = [] }: {
  label: string;
  param: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Params that no longer apply once this changes (a page number). */
  reset?: string[];
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, go] = useNavTransition();
  return (
    <label className="relative inline-flex">
      <span className="sr-only">{label}</span>
      <select
        className={toolbarControl}
        value={value}
        onChange={(event) => {
          const next = new URLSearchParams(search.toString());
          next.set(param, event.target.value);
          for (const key of reset) next.delete(key);
          go(`${pathname}?${next}`);
        }}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <NavPending pending={pending} />
    </label>
  );
}
