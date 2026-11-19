"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { patchQuery } from "@/components/admin/catalog/layout-url";
import { WithReason } from "@/components/app/settings/sales/shared";

/** "Propose a map" on Field maps' title line: opens the propose dialog the board draws (`?propose=1`), with no round trip. */
export function FmapProposeButton({ disabledReason = null }: { disabledReason?: string | null }) {
  return (
    <WithReason reason={disabledReason}>
      <Button type="button" disabled={Boolean(disabledReason)} onClick={() => patchQuery({ propose: "1", map: null })}>
        <Plus aria-hidden="true" />Propose a map
      </Button>
    </WithReason>
  );
}
