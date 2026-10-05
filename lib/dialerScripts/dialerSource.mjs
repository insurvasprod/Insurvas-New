// The dialer's source, as one string, for the structural tests that read it.
//
// UX-6 (2026-10-03) split components/app/dialer-workspace.tsx into the screen, its state hook, the
// lead column and the shared model. The tests assert what the dialer DOES (a setter is not offered
// authoring, a disposition serves the next lead, …), not which file the line sits in, so they read
// the files together. A new dialer file belongs in this list.
import { readFileSync } from "node:fs";

export const DIALER_FILES = [
  "components/app/dialer-workspace.tsx",
  "components/app/dialer/use-dialer.ts",
  "components/app/dialer/lead-column.tsx",
  "components/app/dialer/model.tsx",
];

export function dialerSource() {
  return DIALER_FILES.map((file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")).join("\n");
}
