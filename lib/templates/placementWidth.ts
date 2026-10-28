// How wide a question sits in the partner form's two columns (owner, 2026-10-27). One rule for the
// partner portal and the settings canvas, so the editor never draws a different form. Client-safe.
import type { TemplateField, TemplateFormField } from "./constants";

export type PlacementWidth = "half" | "full";

/** Long answers and "pick several" need the whole row; everything else fits in half. */
export function automaticWidth(field: Pick<TemplateField, "type">): PlacementWidth {
  return field.type === "long_text" || field.type === "multi_select" ? "full" : "half";
}

/** The owner's choice when there is one, else the automatic rule (forms saved before widths existed). */
export function placementWidth(field: Pick<TemplateField, "type">, placement: Pick<TemplateFormField, "width"> | null): PlacementWidth {
  return placement?.width ?? automaticWidth(field);
}
