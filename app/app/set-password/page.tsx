import { Suspense } from "react";

import { AppAuthFrame } from "@/components/app/app-auth-frame";
import { SetPasswordForm } from "@/components/app/set-password-form";

export default function SetPasswordPage() {
  return (
    <AppAuthFrame>
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </AppAuthFrame>
  );
}
