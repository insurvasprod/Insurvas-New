# Subprocessors

**Draft — for counsel review. This list has not been reviewed by a lawyer and is not final. Items
in [SQUARE BRACKETS] must be confirmed before publication.**

Effective date: [EFFECTIVE DATE]

These are the third parties [LEGAL ENTITY NAME] ("**Insurvas**") uses to provide the service and
that may process personal data, including personal data our customers (insurance agencies) put
into the service. Our Data Processing Agreement explains how we choose them, bind them to
data-protection obligations, and tell customers before adding a new one.

| Subprocessor | What it does for Insurvas | Data it processes | Location |
|---|---|---|---|
| Supabase, Inc. | Database, file storage and scheduled jobs | All service data, including customer and consumer data | [REGION — OWNER to confirm] |
| [HOSTING PROVIDER — e.g. Vercel Inc.; OWNER to confirm] | Hosting and running the web application | All data passing through the application while it is served | [REGION] |
| Whop, Inc. [COUNSEL: confirm legal entity] | Subscription checkout and payments; merchant of record for subscriptions | Agency billing contact, payment details entered on Whop's page, subscription and invoice records | United States [confirm] |
| Google LLC | Sending transactional email; reading free/busy time for users who link a Google calendar | Recipient email addresses and email content; calendar account email and busy/free blocks | United States [confirm] |
| Microsoft Corporation | Reading free/busy time for users who link a Microsoft calendar | Calendar account email and busy/free blocks | United States [confirm] |
| Postmark (ActiveCampaign, LLC) | Receiving carrier statements emailed to an agency's Insurvas address | Email sender and recipient addresses, message content and attachments (carrier statements, which can contain consumer policy data) | United States [confirm] |
| ActiveProspect, Inc. (TrustedForm) | Retaining consent certificates for leads, where enabled | Consent certificate identifiers and the consent record held by TrustedForm | United States [confirm] |
| [DNC / TCPA-litigator screening vendor(s) — OWNER to list those configured at platform level] | Checking a phone number before it is dialed | Phone numbers | [REGION] |

**Not subprocessors:**

- **Vendors an agency configures itself** in the service — for example its own do-not-call or
  screening vendor, or webhook endpoints that send data to the agency's own systems — act for the
  agency, not for Insurvas.
- **Jornaya (LeadiD):** the service stores the LeadiD token supplied with a lead but does not send
  data to Jornaya.
- **No artificial-intelligence provider** is used to process personal data.

Last updated: [DATE]. Questions: [CONTACT EMAIL]
