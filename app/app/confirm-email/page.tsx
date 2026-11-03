import { Suspense } from "react";

import { AppAuthFrame } from "@/components/app/app-auth-frame";
import { ConfirmEmailPanel } from "@/components/app/confirm-email-panel";

/** Confirming a changed email address, in the agent sign-in frame. */
export default function ConfirmEmailPage() {
  return (
    <AppAuthFrame>
      <Suspense fallback={null}>
        <ConfirmEmailPanel />
      </Suspense>
    </AppAuthFrame>
  );
}
