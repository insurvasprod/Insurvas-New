/**
 * The Leads table's Partner cell: the partner COMPANY that sent the lead ("Summit Transfers"), the person who
 * entered it only for a partner lead whose company has no name, and "Workspace" for a lead the agency brought in
 * itself — imported, typed in or dialled (walk 2026-11-20: the column showed the partner's portal user instead of
 * the company, and an imported list showed the owner who imported it). `partner_name` and `submitter_name` come
 * from withSubmitterNames (lib/agentTemplates/service.ts).
 */
export function leadPartnerLabel(lead: { partner_id?: string | null; partner_name?: string | null; submitter_name?: string | null }): string {
  return lead.partner_name?.trim() || (lead.partner_id ? lead.submitter_name?.trim() : "") || "Workspace";
}
