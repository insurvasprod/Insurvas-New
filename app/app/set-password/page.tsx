import { Suspense } from "react";

import { AuthPage } from "@/components/app/auth-card";
import { SetPasswordForm } from "@/components/app/set-password-form";

export default function SetPasswordPage() {
  return (
    <AuthPage>
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </AuthPage>
  );
}
