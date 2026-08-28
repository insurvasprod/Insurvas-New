import { Suspense } from "react";

import { ConfirmEmailPanel } from "@/components/app/confirm-email-panel";

export default function ConfirmEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <Suspense fallback={null}>
        <ConfirmEmailPanel />
      </Suspense>
    </div>
  );
}
