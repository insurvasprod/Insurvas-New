"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { CarrierFileUploadButton, type UploadPreset } from "@/components/app/carrier-file-upload";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { CarrierChoice } from "@/lib/ingestion/path";

/**
 * Book of business › Files (round 3, owner 2026-11-02, docs/la4/POLISH-ROUND3.md): a header shows at most
 * two buttons; the rest sit in this "More" menu. Each item opens a page, or — for
 * "Replace with a corrected file" — the one Upload pop-up, preset to the file's carrier, type and day.
 */
export function MoreMenu({ items = [], replace }: {
  items?: Array<{ label: string; href: string }>;
  replace?: { carriers: CarrierChoice[]; preset: UploadPreset; label: string };
}) {
  const [uploading, setUploading] = useState(false);
  if (!items.length && !replace) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline">More<ChevronDown aria-hidden="true" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {replace && <DropdownMenuItem onSelect={() => setUploading(true)}>{replace.label}</DropdownMenuItem>}
          {items.map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              {/* A file from an API route downloads; it is never a page to route or prefetch. */}
              {item.href.startsWith("/api/") ? <a href={item.href} download>{item.label}</a> : <Link href={item.href}>{item.label}</Link>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {replace && <CarrierFileUploadButton carriers={replace.carriers} preset={replace.preset} openWhenDone open={uploading} onOpenChange={setUploading} />}
    </>
  );
}
