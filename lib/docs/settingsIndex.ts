/**
 * The Settings pages Docs covers, without their fields: small enough for the menu and every page title's (i) link to
 * load, where lib/docs/settingsDocs.ts (every setting) is not. lib/docs/content.test.mjs keeps the two in step.
 */
export type SettingsIndexEntry = { slug: string; title: string; group: string; href: string };

export const SETTINGS_DOC_GROUPS: string[] = ["Your account","Agency","Selling","Leads & calling","Integrations","Money & compliance","Records"];

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  {"slug":"my-profile","title":"My profile","group":"Your account","href":"/app/settings#my-profile"},
  {"slug":"plan-and-billing","title":"Plan & billing","group":"Your account","href":"/app/settings#billing"},
  {"slug":"business-identity","title":"Business identity","group":"Agency","href":"/app/settings#business-identity"},
  {"slug":"team-access","title":"Team & access","group":"Agency","href":"/app/settings#team-access"},
  {"slug":"products","title":"Products","group":"Agency","href":"/app/settings#products"},
  {"slug":"carriers","title":"Carriers","group":"Agency","href":"/app/settings#carriers"},
  {"slug":"sales-process","title":"Sales process","group":"Selling","href":"/app/settings#sales-process"},
  {"slug":"application-forms","title":"Application forms","group":"Selling","href":"/app/settings#form-templates"},
  {"slug":"ai-assistant","title":"AI assistant","group":"Selling","href":"/app/settings#sales-ai"},
  {"slug":"lead-posting","title":"Lead posting","group":"Leads & calling","href":"/app/settings#lead-posting"},
  {"slug":"dialing-cadence","title":"Dialing cadence","group":"Leads & calling","href":"/app/settings#cadence"},
  {"slug":"calling-windows","title":"Calling windows","group":"Leads & calling","href":"/app/settings#calling-windows"},
  {"slug":"inbound-settings","title":"Inbound settings","group":"Leads & calling","href":"/app/settings#queue-sla"},
  {"slug":"calendar-availability","title":"Calendar & availability","group":"Leads & calling","href":"/app/settings#calendar"},
  {"slug":"pipelines-outcomes","title":"Pipelines & outcomes","group":"Leads & calling","href":"/app/settings#pipelines"},
  {"slug":"integrations","title":"Integrations","group":"Integrations","href":"/app/settings#integrations"},
  {"slug":"browser-extension","title":"Browser extension","group":"Integrations","href":"/app/settings#sales-extension"},
  {"slug":"accounting","title":"Accounting","group":"Money & compliance","href":"/app/accounting-settings"},
  {"slug":"retention","title":"Retention","group":"Money & compliance","href":"/app/retention-settings"},
  {"slug":"compliance","title":"Compliance","group":"Money & compliance","href":"/app/compliance/settings"},
  {"slug":"settings-history","title":"Settings history","group":"Records","href":"/app/settings#settings-history"},
];

/** The Settings page with its own route that holds this address (longest first), if any. */
export function settingsIndexForPath(pathname: string): SettingsIndexEntry | undefined {
  return SETTINGS_INDEX
    .filter((page) => !page.href.includes("#") && (pathname === page.href || pathname.startsWith(`${page.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
