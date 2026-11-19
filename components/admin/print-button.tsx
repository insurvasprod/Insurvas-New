"use client";

import { useEffect } from "react";

/**
 * Opens the browser's print dialog — which is also how the invoice becomes a PDF. `autoPrint` opens it once the
 * page has drawn (the invoice sheet's Download PDF, billing-r2), so saving the PDF is one step.
 */
export function PrintButton({ className, children = "Print", autoPrint = false }: { className?: string; children?: React.ReactNode; autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}
