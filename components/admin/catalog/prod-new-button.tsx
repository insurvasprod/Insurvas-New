"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** "New product" on the title line: opens the product form sheet the list draws (`?new=1`), with no round trip. */
export function ProdNewButton() {
  return (
    <Button type="button" onClick={() => setParamsInPlace({ new: "1", product: null, edit: null })}>
      New product
    </Button>
  );
}
