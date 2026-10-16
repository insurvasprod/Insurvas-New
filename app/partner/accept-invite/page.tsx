import { Suspense } from "react";

import { AcceptPartnerInviteForm } from "@/components/partner/accept-partner-invite-form";
import { PartnerAuthFrame } from "@/components/partner/partner-auth-frame";

/** Accepting a partner invitation with an existing account, in the partner sign-in frame. */
export default function AcceptPartnerInvitePage() {
  return (
    <PartnerAuthFrame>
      <Suspense fallback={<div className="portal-auth-suspense" role="status">Loading invitation…</div>}>
        <AcceptPartnerInviteForm />
      </Suspense>
    </PartnerAuthFrame>
  );
}
