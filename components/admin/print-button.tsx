"use client";

/** Opens the browser's print dialog — which is also how the invoice becomes a PDF. */
export function PrintButton({ className, children = "Print" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      {children}
    </button>
  );
}
