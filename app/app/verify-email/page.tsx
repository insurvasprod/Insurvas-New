import { AppAuthFrame } from "@/components/app/app-auth-frame";
import { VerifyEmailPanel } from "@/components/app/verify-email-panel";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

export default function VerifyEmailPage() {
  return (
    <AppAuthFrame>
      <VerifyEmailPanel ttlHours={EMAIL_VERIFICATION_TTL_HOURS} />
    </AppAuthFrame>
  );
}
