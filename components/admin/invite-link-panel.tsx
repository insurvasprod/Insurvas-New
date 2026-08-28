"use client";

import { useState } from "react";
import { Copy, Check, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shows the raw invite link. This exists because no email transport is wired up yet
 * (SA-4.11 owns that) — until then the admin passes the link on themselves.
 */
export function InviteLinkPanel({ url, expiresAt }: { url: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions — the link is selectable either way.
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-[var(--color-blue-faint)] p-4">
      <div className="flex items-start gap-2 text-sm">
        <Mail className="mt-0.5 size-4 shrink-0 text-[var(--color-blue)]" />
        <p className="text-muted-foreground">
          Email delivery isn&apos;t configured yet, so send this link to them yourself. It expires{" "}
          <span className="font-medium text-foreground">{new Date(expiresAt).toLocaleString()}</span>.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-card px-3 py-2 text-xs" title={url}>
          {url}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
