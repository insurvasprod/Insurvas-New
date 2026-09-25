import { Suspense } from "react";

import { ConfirmEmailPanel } from "@/components/app/confirm-email-panel";

export default function ConfirmEmailPage() {
  return (
    <div className="portal-agent flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] px-4 py-10 sm:p-10">
      {/* Not a direct `main` child: the shell's `.portal-agent > main` reserves 264px for a sidebar. */}
      <div className="w-full max-w-[640px]">
        <main>
          <Suspense fallback={null}>
            <ConfirmEmailPanel />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
