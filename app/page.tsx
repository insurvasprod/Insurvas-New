import Link from "next/link";
import { ArrowRight, Building2, ShieldCheck } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <div className="w-full max-w-2xl">
        <Card>
          <CardHeader className="items-center text-center sm:pt-10">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]"><Building2 className="size-6" /></div>
            <CardTitle className="text-3xl">Welcome to Insurvas</CardTitle>
            <CardDescription>Choose the workspace you want to access.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 sm:px-10 sm:pb-10">
            <Link href="/app/login" className="group rounded-lg border border-[var(--color-border)] p-5 transition-colors hover:bg-[var(--color-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="font-semibold">Tenant workspace</p>
              <p className="mt-1 text-sm text-muted-foreground">Sign in to manage leads, policies, and your agency operations.</p>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-blue)]">Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
            </Link>
            <Link href="/app/signup" className="group rounded-lg border border-[var(--color-border)] p-5 transition-colors hover:bg-[var(--color-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <p className="font-semibold">Create a workspace</p>
              <p className="mt-1 text-sm text-muted-foreground">Create a tenant, choose a published subscription, and start your workspace.</p>
              <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--color-blue)]">Get started <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span>
            </Link>
          </CardContent>
        </Card>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><ShieldCheck className="size-3.5" /> Local demo entry point · <Link href="/admin/login" className="hover:underline">Admin sign in</Link></p>
      </div>
    </main>
  );
}
