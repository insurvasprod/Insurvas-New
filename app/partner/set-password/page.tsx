import { Suspense } from "react";

import { PartnerAuthFrame } from "@/components/partner/partner-auth-frame";
import { PartnerSetPasswordForm } from "@/components/partner/partner-set-password-form";

/** A new partner choosing a first password, in the partner sign-in frame. */
export default function PartnerSetPasswordPage() {
  return (
    <PartnerAuthFrame>
      <Suspense fallback={null}>
        <PartnerSetPasswordForm />
      </Suspense>
    </PartnerAuthFrame>
  );
}
