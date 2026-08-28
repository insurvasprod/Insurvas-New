import { Suspense } from "react";

import { SetPasswordForm } from "@/components/app/set-password-form";

export default function SetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <Suspense fallback={null}>
        <SetPasswordForm />
      </Suspense>
    </div>
  );
}
