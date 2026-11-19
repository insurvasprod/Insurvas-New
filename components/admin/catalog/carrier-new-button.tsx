"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** "New carrier" on the title line: opens the carrier form the list draws (`?new=1`), with no round trip. */
export function CarrierNewButton() {
  return (
    <Button type="button" onClick={() => setParamsInPlace({ new: "1" })}>
      New carrier
    </Button>
  );
}
