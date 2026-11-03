import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Continue with Google" (owner, 2026-10-27). It is the same button as "Email me a link"
 * (AuthSecondary: the shared outline Button at 44px), so the alternative ways in look alike in
 * both themes. The first version had its own white card surface and stood out (owner, 22:40).
 * Google's multicolour G stays unmodified, as its branding requires.
 *
 * A plain link to the start route, not a script: the server begins the Google flow and comes back
 * to the callback. `intent` decides where a refusal or a cancel lands; `plan` and `cycle` carry the
 * plan picked on the pricing page into a Google sign-up.
 */
export function GoogleButton({ intent, plan, cycle, className }: {
  intent: "sign-in" | "sign-up";
  plan?: string;
  cycle?: string;
  className?: string;
}) {
  const query = new URLSearchParams({ intent });
  if (plan) query.set("plan", plan);
  if (cycle) query.set("cycle", cycle);
  return (
    <Button asChild variant="outline" className={cn("h-11 w-full gap-2.5 border-[var(--border-strong)]", className)}>
      <a href={`/api/app/auth/google/start?${query}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an 18px brand mark; next/image adds nothing */}
        <img src="/brand/google-g.svg" alt="" width={18} height={18} className="size-[18px] shrink-0" />
        {/* On the sign-in page it says what it does there (manager review, 2026-10-28). */}
        {intent === "sign-in" ? "Sign in with Google" : "Continue with Google"}
      </a>
    </Button>
  );
}
