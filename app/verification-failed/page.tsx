import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingFrame } from "@/components/public/onboarding-frame";

export default function VerificationFailedPage() {
  return (
    <OnboardingFrame>
      <Card className="mx-auto max-w-lg bg-white text-center">
        <CardHeader className="items-center">
          <AlertTriangle className="size-10 text-[var(--color-warning)]" />
          <CardTitle className="text-2xl">That link is invalid or expired</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--color-text-muted)]">Sign in with the account you created, then request a fresh 24-hour verification link.</p>
          <Button asChild><Link href="/app/login">Sign in and resend</Link></Button>
        </CardContent>
      </Card>
    </OnboardingFrame>
  );
}
