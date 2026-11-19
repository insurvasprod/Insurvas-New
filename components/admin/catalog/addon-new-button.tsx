"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** New add-on on the title line: opens the create sheet in place (`?new=1`, read by AddonsCatalog). */
export function AddonNewButton() {
  return <Button type="button" onClick={() => setParamsInPlace({ new: "1", addon: null })}>New add-on</Button>;
}
