"use client";

import "@/components/design/preview-fetch";

import { PartnersWorkspace } from "@/components/app/partners-workspace";
import { setPreviewState } from "@/components/design/preview-fetch";
import type { PreviewState } from "@/lib/settings/preview/fixtures";

/**
 * The real Partners workspace on sample data (lib/settings/preview/partners.ts). `id` opens one
 * partner's record, as /app/publishers/[id] does. Nothing reaches a real API (preview-fetch).
 */
export function PartnersPreview({ id, state = "loaded" }: { id?: string; state?: PreviewState }) {
  setPreviewState(state);
  return (
    <PartnersWorkspace
      readOnly={state === "readonly"}
      canManageProductConfig
      initialSelectedId={id ?? null}
      detailOnly={Boolean(id)}
      messageHref={id ? `/app/partner-chat?partner=${id}` : null}
    />
  );
}
