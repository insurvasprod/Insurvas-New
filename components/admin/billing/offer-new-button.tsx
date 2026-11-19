"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** "New offer" on the title line: opens the offer sheet empty (`?new=1`), with no round trip. */
export function OfferNewButton() {
  return (
    <Button type="button" onClick={() => setParamsInPlace({ new: "1", offer: null })}>
      New offer
    </Button>
  );
}
