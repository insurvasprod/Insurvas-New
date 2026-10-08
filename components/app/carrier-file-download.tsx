"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/notify";

/**
 * LA-4.20 (Notion sprint) · the original file, as received: a sixty-second link, owner and
 * bookkeeper only, and every download recorded (who, which file), as the Carrier files list does.
 */
export function CarrierFileDownload({ fileId, label = "Download the original" }: { fileId: string; label?: string }) {
  const [opening, setOpening] = useState(false);
  async function open() {
    setOpening(true);
    try {
      const response = await fetch(`/api/app/carrier-files/${fileId}/file`);
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "The file could not be opened.");
      window.location.assign(data.url);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The file could not be opened.");
    } finally {
      setOpening(false);
    }
  }
  return <Button type="button" variant="outline" disabled={opening} onClick={() => void open()}><Download aria-hidden="true" />{opening ? "Opening…" : label}</Button>;
}
