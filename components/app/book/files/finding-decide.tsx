"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/lib/notify";

/**
 * Book of business › Files › a problem found: the one question, "Was it right?", on its own page (walk
 * 2026-11-03: the Right / Wrong buttons sat in the Problems found table, against round 5's rule that
 * decisions never happen inside a table). An answer saves and opens the next open problem.
 */
export function FindingDecide({ id, open, statusWord, nextHref, doneHref, readOnly }: { id: string; open: boolean; statusWord: string; nextHref: string | null; doneHref: string; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);

  async function answer(verdict: "approved" | "rejected") {
    setBusy(verdict);
    try {
      const response = await fetch("/api/app/carrier-files/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", id, verdict }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The answer could not be saved.");
      notify.done(verdict === "approved" ? "Marked right." : "Marked wrong. It counts against the agent's accuracy.");
      router.push(nextHref ?? doneHref);
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The answer could not be saved.");
      setBusy(null);
    }
  }

  // A Card, not a table card: a question is not a list, so it does not stretch to the window's foot (§6b).
  return (
    <Card>
      <CardHeader>
        <CardTitle>Was it right?</CardTitle>
        {open && <CardDescription>Your answer is how this agent&apos;s accuracy is kept. Marking it right executes nothing.</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {open ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={readOnly || busy !== null} onClick={() => void answer("approved")}>{busy === "approved" ? "Saving…" : "Yes, it was right"}</Button>
              <Button type="button" variant="outline" disabled={readOnly || busy !== null} onClick={() => void answer("rejected")}>{busy === "rejected" ? "Saving…" : "No, it was wrong"}</Button>
            </div>
            <p className="m-0 text-muted-foreground">{nextHref ? "An answer saves and opens the next open problem." : "This is the last open problem: an answer saves and goes back to the list."}</p>
          </>
        ) : (
          <p className="m-0 text-muted-foreground">{statusWord}. Nothing is left to decide.</p>
        )}
      </CardContent>
    </Card>
  );
}
