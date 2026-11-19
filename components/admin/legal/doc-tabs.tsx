"use client";

import { useSearchParams } from "next/navigation";

import { setParamsInPlace } from "@/components/ui/nav-pending";
import { UnderlineTabs } from "@/components/ui/view-tabs";
import { SWITCH_LABEL } from "@/components/admin/legal/model";
import { LEGAL_DOC_TYPES, type LegalDocType } from "@/lib/legal/constants";

/**
 * Legal's Terms · Privacy · DPA bar on the Platform frame's title line (admin round 1, 2026-11-18). It writes `?doc=`
 * in place (no round trip) and LegalScreen reads the same parameter, so the bar and the screen always agree.
 */
export function LegalDocTabs({ initialDoc }: { initialDoc: LegalDocType }) {
  const param = useSearchParams().get("doc");
  const value: LegalDocType = (LEGAL_DOC_TYPES as readonly string[]).includes(param ?? "") ? (param as LegalDocType) : initialDoc;
  return (
    <UnderlineTabs
      label="Document"
      value={value}
      tabs={LEGAL_DOC_TYPES.map((type) => ({ key: type, label: SWITCH_LABEL[type] }))}
      onChange={(next) => setParamsInPlace({ doc: next })}
    />
  );
}
