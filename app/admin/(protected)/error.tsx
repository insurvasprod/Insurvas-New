"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/page-states";

/**
 * A console page that failed to render. The kit's error state on a card (foundation v3), with the
 * two ways on: try the page again, or go back to the console's home.
 */
export default function AdminRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the failure visible to the local developer without exposing database details in the UI.
    console.error("Admin route failed to render");
  }, []);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center justify-center">
      <Card className="w-full">
        <ErrorState
          title="This page could not load"
          detail="Something went wrong while loading this workspace. Try again, or return to the dashboard while the issue is investigated."
          action={
            <span className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => reset()}>Try again</Button>
              <Button asChild variant="outline"><Link href="/admin">Back to dashboard</Link></Button>
            </span>
          }
        />
      </Card>
    </div>
  );
}
