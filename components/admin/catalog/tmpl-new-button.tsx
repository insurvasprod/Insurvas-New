"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** "New template" on the title line: opens the editor sheet the list draws (`?new=1`), with no round trip. */
export function TmplNewButton() {
  return (
    <Button type="button" onClick={() => setParamsInPlace({ new: "1", template: null })}>
      New template
    </Button>
  );
}
