// LA-3.13 value transforms: how one canonical value becomes the string a carrier's form expects.
// Deterministic and pure — the fill applies exactly one of these, server-side, to the stored value.
// There is no AI at fill time and nothing here guesses: a value the transform cannot convert is
// returned as null, and a null value is left empty (the field shows in the copy list instead).

export const FIELD_MAP_TRANSFORMS = ["none", "digits_only", "mmddyyyy", "state_code", "yes_no_yn", "uppercase"] as const;
export type FieldMapTransform = (typeof FIELD_MAP_TRANSFORMS)[number];

export const TRANSFORM_LABEL: Record<FieldMapTransform, string> = {
  none: "As typed",
  digits_only: "Digits only",
  mmddyyyy: "MM/DD/YYYY",
  state_code: "Two-letter state",
  yes_no_yn: "Yes/No → Y/N",
  uppercase: "Uppercase",
};

export function isTransform(value: string | null | undefined): value is FieldMapTransform {
  return (FIELD_MAP_TRANSFORMS as readonly string[]).includes(value ?? "");
}

/** A readable name for a stored transform; unknown strings (older rows) are shown as they are. */
export function transformLabel(value: string | null | undefined) {
  if (!value || value === "none") return null;
  return isTransform(value) ? TRANSFORM_LABEL[value] : value;
}

type Raw = string | number | boolean | null | undefined;

function asText(value: Raw): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * The string to put in the carrier's field, or null when there is nothing safe to put there.
 * An `option_map` entry for the canonical value wins over the transform (female → F); otherwise the
 * transform runs on the canonical value.
 */
export function applyTransform(value: Raw, transform: string | null | undefined, optionMap?: Record<string, string> | null): string | null {
  const text = asText(value);
  if (text === null) return null;
  if (optionMap) {
    const mapped = optionMap[text] ?? optionMap[text.toLowerCase()];
    if (typeof mapped === "string") return mapped;
  }
  switch (transform ?? "none") {
    case "none":
      return text;
    case "digits_only": {
      const digits = text.replace(/\D/g, "");
      return digits === "" ? null : digits;
    }
    case "mmddyyyy": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (m) return `${m[2]}/${m[3]}/${m[1]}`;
      return /^\d{2}\/\d{2}\/\d{4}$/.test(text) ? text : null;
    }
    case "state_code":
      return /^[a-z]{2}$/i.test(text) ? text.toUpperCase() : null;
    case "yes_no_yn": {
      const lower = text.toLowerCase();
      if (["yes", "y", "true"].includes(lower)) return "Y";
      if (["no", "n", "false"].includes(lower)) return "N";
      return null;
    }
    case "uppercase":
      return text.toUpperCase();
    default:
      // A transform this build does not know: never guess what it meant.
      return null;
  }
}
