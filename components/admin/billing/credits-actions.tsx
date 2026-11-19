"use client";

import { Button } from "@/components/ui/button";
import { setParamsInPlace } from "@/components/ui/nav-pending";

/** The title line's two buttons on Credits & limits: open the grant and pack dialogs the panel draws (`?dialog=`). */
export function CreditsActions() {
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setParamsInPlace({ dialog: "grant" })}>Grant credits…</Button>
      <Button type="button" onClick={() => setParamsInPlace({ dialog: "pack" })}>Add a credit pack</Button>
    </>
  );
}
