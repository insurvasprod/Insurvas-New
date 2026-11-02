/**
 * Data in, one page (owner 2026-11-02, "like Reports and Compliance"): Carrier files, Import your book,
 * Policy matching and Exceptions down a rail on the left, the step on the right
 * (components/app/data-in/data-in-page.tsx). A plain module so the server frame, the client rail, the
 * sidebar and the page trail all read one list.
 */
/** The Data in menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const DATA_IN_RAIL_COOKIE = "insurvas_data_in_rail";

export type DataInStep = "files" | "import" | "matching" | "exceptions";

/** `icon`: the sidebar's own icon for the page, so the rail and the menu name it the same way. */
export const DATA_IN_STEPS: { key: DataInStep; label: string; href: string; icon: string }[] = [
  { key: "files", label: "Carrier files", href: "/app/carrier-files", icon: "files" },
  { key: "import", label: "Import your book", href: "/app/book-import", icon: "import" },
  { key: "matching", label: "Policy matching", href: "/app/policy-matching", icon: "link" },
  { key: "exceptions", label: "Exceptions", href: "/app/exceptions", icon: "circle-alert" },
];

/** Each step's own address. A file's own pages (/app/carrier-files/file/…) are records, not steps. */
const STEP_PATHS: [RegExp, DataInStep][] = [
  [/^\/app\/carrier-files\/?$/, "files"],
  [/^\/app\/book-import\/?$/, "import"],
  [/^\/app\/policy-matching\/?$/, "matching"],
  [/^\/app\/exceptions\/?$/, "exceptions"],
];

export function dataInStepOf(pathname: string): DataInStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function dataInStepLabel(step: DataInStep): string {
  return DATA_IN_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** What waits on a person per step (/api/app/data-in/steps); a step left out has no badge. */
export type DataInStepCounts = Partial<Record<DataInStep, number>>;

/** What each badge counts (/api/app/data-in/steps), one and many. Import has no queue, so no badge. */
export const DATA_IN_WAITING: Record<string, [string, string]> = {
  files: ["file could not be read", "files could not be read"],
  matching: ["policy waiting for you to pick the client", "policies waiting for you to pick the client"],
  exceptions: ["open exception", "open exceptions"],
};
