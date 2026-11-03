import type { ReactNode } from "react";

/**
 * A platform section with no controls on this screen: one compact card saying what is true in this
 * environment and where the settings actually live. The words come from the page, which knows what
 * is true here.
 */
export function ConfigurationPlaceholder({
  title,
  lede,
  detail,
}: {
  title: string;
  /** What is true right now. */
  lede: ReactNode;
  /** Where the settings actually live. */
  detail?: ReactNode;
}) {
  return (
    <section className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-10 text-center">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="max-w-[64ch] text-sm text-muted-foreground">{lede}</p>
      {detail && <p className="max-w-[64ch] text-sm text-muted-foreground">{detail}</p>}
    </section>
  );
}
