import { AuthPage } from "@/components/app/auth-card";
import { VerifyEmailPanel } from "@/components/app/verify-email-panel";
import { EMAIL_VERIFICATION_TTL_HOURS } from "@/lib/signup/verification";

export default function VerifyEmailPage() {
  return (
    <AuthPage>
      <VerifyEmailPanel ttlHours={EMAIL_VERIFICATION_TTL_HOURS} />
    </AuthPage>
  );
}
