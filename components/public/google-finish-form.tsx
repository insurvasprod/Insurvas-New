"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";

import { Input } from "@/components/ui/input";
import { AuthAlert, AuthSubmit, authLabel } from "@/components/portal/auth-controls";
import { FunnelHeading } from "@/components/app/funnel-frame";
import { cn } from "@/lib/utils";

type LegalDoc = { id: string; doc_type: string; version: number; title: string };

const fieldClass = "h-11 border-[var(--border-strong)] bg-card px-3 text-base md:text-base";

/**
 * Step 1 after "Continue with Google" (owner, 2026-10-27). The same form as step 1: the Email field
 * filled and locked with Google's mark, the terms and "Create account". Name and phone are asked on
 * step 3, About you, like every sign-up (manager review, 2026-10-28); Google's name is used until then.
 * The address is the one Google vouched for, read again from the signed cookie on the server. On
 * "Create account" the workspace is made and step 2 is skipped.
 */
export function GoogleFinishForm({ email, name }: { email: string; name: string }) {
  const router = useRouter();
  const [legalDocs, setLegalDocs] = useState<LegalDoc[]>([]);
  const [legalState, setLegalState] = useState<"loading" | "ready" | "failed">("loading");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLegal = useCallback(() => {
    setLegalState("loading");
    fetch("/api/public/legal", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error();
        setLegalDocs(body?.documents ?? []);
        setLegalState("ready");
      })
      .catch(() => setLegalState("failed"));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the first load of the legal text
    loadLegal();
  }, [loadLegal]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const fullName = name.trim().length >= 2 ? name.trim() : undefined;
    if (!accepted) { setError("Tick the box to accept the terms and privacy policy."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/public/signup/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, acceptedDocumentIds: legalDocs.map((doc) => doc.id) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not create your account. Try again."); return; }
      router.replace(body?.redirectTo ?? "/app/onboarding/business-profile");
    } catch {
      setError("Could not reach Insurvas. Check your connection and press the button again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <FunnelHeading title="Finish your account">Google confirmed your email.</FunnelHeading>

      <form onSubmit={submit} noValidate data-auth-fields="" className="flex flex-col gap-4">
        {/* The step 1 Email field, filled and locked: Google's mark at the start, "Verified" at the end. */}
        <div className="space-y-1.5">
          <label htmlFor="google-email" className={authLabel}>Email</label>
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- an 18px brand mark */}
            <img src="/brand/google-g.svg" alt="" width={18} height={18} className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2" />
            <Input id="google-email" type="email" value={email} readOnly aria-describedby="google-email-verified" className={cn(fieldClass, "pl-10 pr-28 text-[var(--body)]")} />
            <span id="google-email-verified" className="pointer-events-none absolute right-2.5 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full bg-[var(--success-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--success-ink)]">
              <Check className="size-3 stroke-[3]" aria-hidden="true" />Verified
            </span>
          </div>
        </div>

        {legalState === "failed" ? (
          <AuthAlert>
            The terms could not be loaded, so they cannot be accepted yet.{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={loadLegal}>Try again</button>
          </AuthAlert>
        ) : legalDocs.length > 0 ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--accent-ink)]" />
            <span>
              I agree to the{" "}
              {legalDocs.map((doc, index) => (
                <span key={doc.id}>
                  {index > 0 && (index === legalDocs.length - 1 ? " and the " : ", ")}
                  <Link href={`/legal/${doc.doc_type}?v=${doc.version}`} target="_blank" className="font-semibold text-foreground underline-offset-2 hover:underline">{doc.title}</Link>
                </span>
              ))}
              .
            </span>
          </label>
        ) : legalState === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading the terms…</div>
        ) : null}

        {error && <AuthAlert>{error}</AuthAlert>}

        <AuthSubmit className="mt-1" disabled={submitting || !accepted}>
          {submitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {submitting ? "Creating your account…" : "Create account"}
        </AuthSubmit>
      </form>
    </div>
  );
}
