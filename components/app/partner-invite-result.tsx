"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";

export type PartnerInviteResult = {
  url: string;
  expiresAt: string;
  delivered: boolean;
  recipient: string;
  mode?: "set_password" | "existing_account";
};

export function PartnerInviteResultPanel({ result }: { result: PartnerInviteResult }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The URL remains selectable if the browser denies clipboard access.
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-[var(--color-blue-faint)] p-4" role="status">
      <div className="flex items-start gap-2 text-sm">
        <Mail className="mt-0.5 size-4 shrink-0 text-[var(--color-blue)]" aria-hidden="true" />
        <p className="text-muted-foreground">
          {result.delivered
            ? result.mode === "existing_account"
              ? `Sign-in invitation sent to ${result.recipient}.`
              : `Invitation sent to ${result.recipient}.`
            : `Email could not be delivered to ${result.recipient}. Copy the secure link below and send it to them yourself.`}
          {" "}It expires {new Date(result.expiresAt).toLocaleString()}.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          aria-label="Partner invitation link"
          className="h-9 min-w-0 flex-1 rounded-md border bg-card px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          readOnly
          title={result.url}
          value={result.url}
        />
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
