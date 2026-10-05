// LA-3.12 / 3.13 / 3.14 vocabulary, client-safe: no `server-only`, no `@/` imports, so the settings
// panels, the Submit step, the API and the node tests all read the same values.

/** Decision 1, settled at 60. The table CHECK makes every grant live exactly this long. */
export const GRANT_LIFETIME_MINUTES = 60;
export const GRANT_LIFETIME_MS = GRANT_LIFETIME_MINUTES * 60 * 1000;
export const GRANT_SCOPE = "read_application_fields" as const;

/** The version of the package in `extension/` — the settings panel compares against it. */
export const EXTENSION_LATEST_VERSION = "0.1.0";

/** Set on the Insurvas page's root element by the extension's bridge content script. */
export const EXTENSION_MARKER = "data-insurvas-extension";

/**
 * window.postMessage types between the Insurvas page and the extension's bridge. The page posts the
 * grant to its own origin only; the bridge checks `event.origin` and `event.source` before it
 * forwards anything to the service worker. The token never touches a URL, localStorage or the DOM.
 */
export const GRANT_MESSAGE = "insurvas:extension-grant" as const;
export const GRANT_ACK_MESSAGE = "insurvas:extension-grant-ack" as const;

/** Where a copy-assist tick came from (`tenant_copy_assist_ticks.surface`). */
export const COPY_SURFACES = ["web", "popout", "extension"] as const;
export type CopySurface = (typeof COPY_SURFACES)[number];

/** `carrier_field_map.status`. */
export const FIELD_MAP_STATUSES = ["draft", "in_review", "published", "needs_review", "retired"] as const;
export type FieldMapStatus = (typeof FIELD_MAP_STATUSES)[number];
/** Only these can be edited; everything else is frozen by the immutability trigger. */
export const EDITABLE_FIELD_MAP_STATUSES: readonly FieldMapStatus[] = ["draft", "in_review"];
/** An approved map a fill may use. A miss moves published → needs_review; it is still the approved map. */
export const FILLABLE_FIELD_MAP_STATUSES: readonly FieldMapStatus[] = ["published", "needs_review"];

/** `carrier_field_map_entry.input_kind`. */
export const FIELD_MAP_INPUT_KINDS = ["text", "select", "radio", "checkbox", "date", "masked"] as const;
export type FieldMapInputKind = (typeof FIELD_MAP_INPUT_KINDS)[number];

/** Grant states the settings panel shows. */
export type GrantStatus = "active" | "expired" | "revoked";
