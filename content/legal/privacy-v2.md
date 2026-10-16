# Privacy Policy

**Draft — for counsel review. This text has not been reviewed by a lawyer and is not final. Items
in [SQUARE BRACKETS] are facts the owner or counsel must supply before publication. Do not publish
until every bracket is resolved.**

Effective date: [EFFECTIVE DATE]

## 1. Who we are and what this policy covers

Insurvas is software that insurance agencies, call centers, IMOs/FMOs and independent agents
("**agencies**") use to buy and work leads, dial, take insurance applications, and track policies
and commissions. The service is operated by [LEGAL ENTITY NAME], a [ENTITY TYPE] formed in [STATE
OF FORMATION], with its address at [POSTAL ADDRESS] ("**Insurvas**", "**we**", "**us**").

This policy covers two different relationships, and our role is different in each:

- **Data about agencies and their users** (agency owners, agents, staff, lead-vendor partners who
  sign in to the partner portal, and visitors to our website). For this data **we decide why and
  how it is used**, and this policy describes what we do.
- **Data about the agencies' own consumers** (the leads, prospects, applicants, insureds and
  beneficiaries an agency works with). An agency puts this data into Insurvas, and **we process it
  on the agency's behalf and on its instructions**, as its service provider / processor, under our
  agreement with that agency (including our Data Processing Agreement, where one is in place). The
  agency decides what to collect and why, and the agency's own privacy notice governs it. If you
  are a consumer and want to exercise a right over that data, contact the agency you dealt with;
  if you contact us, we will pass your request to that agency (see section 9).

## 2. Data about agencies and their users

| Category | What it includes | Where it comes from |
|---|---|---|
| Account | Name, work email, mobile phone number, password (stored only as a one-way bcrypt hash), role, profile photo (if uploaded) | You, at signup or in Settings |
| Agency profile | Agency name and trading name, address, National Producer Number (NPN), licence numbers and licensed states, carrier appointments and writing numbers, logo, tax ID (EIN) — the tax ID is stored encrypted and shown only by its last four digits | You |
| Security | Two-step verification (TOTP) secret and hashed recovery codes; sign-in history including IP address, browser user agent, time and success or failure; active sessions | Generated when you use the service |
| Legal acceptances | Which version of which document you accepted, when, and from what IP address and user agent | Generated when you accept |
| Calendar connection (optional) | If you link a Google or Microsoft calendar: the calendar account's email address, an OAuth refresh token (stored encrypted), and your busy/free time blocks. We request free/busy access only; we do not read event titles, attendees, or email | Google or Microsoft, with your permission |
| Billing | Plan, billing cycle, subscription status, invoices, and the customer and membership references our payment provider gives us. **We do not receive or store the card used to pay for your subscription**; it is entered on the payment provider's hosted page | You and our payment provider |
| Support and communications | Messages you send us, feedback you submit in the product, and records of emails we send you | You |
| Usage and audit | Actions taken in the product (for example who changed a record and when), kept in audit logs; usage counts used for plan limits and metered billing | Generated when you use the service |
| Partner portal | For lead-vendor partners: name, email, organisation, and the leads and messages the partner submits | The partner and the agency |

## 3. Data about agencies' consumers (processed for agencies)

Depending on which features an agency uses, the data it stores in Insurvas about its consumers can
include:

- **Contact and lead data:** name, phone numbers, email, postal address, date of birth, the lead's
  source, vendor and cost, call outcomes, notes, callbacks and appointments.
- **Consent and compliance evidence:** consent certificates and their identifiers (for example
  TrustedForm certificate IDs and URLs, or a Jornaya LeadiD token recorded with the lead), the IP
  address and web page recorded with the consent, do-not-call and suppression-list entries, and
  the results of pre-dial screening checks.
- **Insurance application data:** Social Security number; date of birth;
  answers to health questions; medications (name, dose and what each is prescribed for); income;
  beneficiaries, who may include **minor children** (name, relationship, date of birth, contact
  details); and premium payment details, which can include **bank routing and account numbers or
  payment card numbers and expiry dates**.
- **Policy and commission data:** carrier statements and files, policy numbers, status, premiums,
  and commissions.
- **Uploaded files:** carrier statements, application confirmations, compliance files and
  attachments, including carrier statements received by email (see section 5).

Social Security numbers, bank account and routing numbers, and payment card numbers entered on an
application are encrypted by the application before they are stored, with a key specific to each
agency, and can be shown in full only to permitted roles who have completed two-step verification;
each such reveal is logged. [COUNSEL/OWNER: health answers, medications and dates of birth are
currently stored without field-level encryption, protected by access controls and the database
provider's storage encryption — confirm this description, or extend field-level encryption before
publishing.]

Agencies are responsible for having a lawful basis and any required notices and consents for the
consumer data they put into Insurvas, including under insurance, telemarketing and health-privacy
rules that apply to them.

## 4. How we use data

We use data about agencies and their users to:

- provide, maintain and secure the service, including signing you in, enforcing roles and plan
  limits, and detecting misuse and account takeover;
- bill you, through our payment provider, for your plan, add-ons and metered usage;
- communicate with you about your account (for example email verification, trial and billing
  notices, security alerts, and changes to our terms), and contact you by phone about your
  account where you gave us a number;
- provide support and improve the service; and
- meet legal obligations and enforce our agreements.

We use consumer data only to provide the service to the agency that put it in, on that agency's
instructions, and as required by law.

**We do not sell personal data, and we do not share it for cross-context behavioural
advertising.** We do not use any artificial-intelligence or machine-learning provider to process
personal data, and **we do not use agency or consumer data to train AI models**. [OWNER: if an AI
provider is added later, this section and the subprocessor list must change before it is used.]

## 5. Who receives data

We share data only with the service providers below, who process it for us under contract, and
as described in this section. The current list, with each provider's purpose and location, is in
our Subprocessor List at [SUBPROCESSOR LIST URL — /legal/subprocessors once published].

- **Supabase** — database, file storage and scheduled jobs that run the service.
- **Whop** — subscription checkout and payments. Whop acts as the merchant of record for
  subscription payments [COUNSEL: confirm against the Whop agreement], and receives the
  information you give it at checkout under its own terms and privacy policy.
- **[HOSTING PROVIDER — e.g. Vercel; OWNER to confirm where the application is hosted]** —
  application hosting.
- **Google** — sending our transactional email (through Google's email service) and, if you link a
  Google calendar, reading your free/busy time.
- **Microsoft** — if you link a Microsoft calendar, reading your free/busy time.
- **Postmark (ActiveCampaign)** — receiving carrier statements that an agency arranges to have
  emailed to its Insurvas address.
- **ActiveProspect (TrustedForm)** — where enabled, retaining a lead's consent certificate.
- **Do-not-call and litigator-screening vendors chosen by the agency or by us** — a phone number is
  sent to the configured vendor to check it before a dial. [OWNER: list the vendors configured in
  production.]

We also disclose data: to an agency's own systems when that agency configures a webhook or export;
when required by law, subpoena or court order; to protect the rights, safety or property of
Insurvas, our customers or others; and to a successor in a merger, acquisition or sale of assets,
subject to this policy.

## 6. Cookies and browser storage

We use only strictly necessary cookies — the sign-in session cookies that keep you signed in and
complete two-step verification — and browser local storage for preferences such as theme and
recent searches. We do not use analytics or advertising cookies. See our Cookie Notice at [COOKIE
NOTICE URL — /legal/cookies once published].

## 7. How long we keep data

- **While an agency subscribes**, we keep its data for as long as the account is active.
- **When an agency cancels**, its workspace stays readable for a retention window so it can export
  its data — **90 days by default** [OWNER: confirm the production setting
  `billing.cancelled_retention_days`]. After that the workspace can no longer be opened. The data
  is not automatically deleted at that point; **an agency can ask us to delete it** by contacting
  [CONTACT EMAIL], and we will delete or de-identify it within [NUMBER] days except where we must
  keep it (below). [OWNER/COUNSEL: decide whether to adopt an automatic deletion period instead,
  and build it before publishing such a promise.]
- **Agencies control consumer-data retention.** The service gives agencies tools to set retention
  rules per record type and state and to run a deletion when a consumer asks; these are off unless
  the agency turns them on. Numbers on an internal do-not-call list are kept so the person is not
  called again.
- **We keep some records longer** where needed for legal, tax, accounting, security or dispute
  purposes — for example invoices and payment records, sign-in and audit logs, and records of
  which legal documents were accepted. [COUNSEL: state the periods.]

## 8. Security

We protect data with measures appropriate to its sensitivity, including: separation of each
agency's data by database row-level security; encryption of the most sensitive fields (Social
Security, bank and card numbers, tax IDs, calendar tokens and two-step secrets for agency users)
with per-agency keys; passwords stored only as hashes; two-step verification, which is required
before sensitive fields can be revealed; role-based access; audit logs; and encrypted connections
(HTTPS). No system is perfectly secure, and we cannot guarantee that data will never be accessed
without authorisation. If we learn of a breach affecting your personal data, we will notify you
and others as the law requires.

## 9. Your privacy rights

Depending on where you live, you may have the right to know what personal data we hold about you,
to get a copy of it, to correct it, to delete it, and to opt out of its sale or sharing for
targeted advertising (we do neither) or of certain profiling. Residents of states with
comprehensive privacy laws (for example California, Colorado, Connecticut, Virginia, Utah, Texas,
Oregon and others) may have some or all of these rights. [COUNSEL: confirm which state laws apply
to Insurvas given its size and the GLBA and HIPAA entity-level and data-level exemptions, and
adjust this section — including any California "notice at collection" and categories table.]

- **Agency users and website visitors:** email [CONTACT EMAIL]. We will verify your identity
  before acting and respond within the time the applicable law requires. You may use an authorised
  agent where the law allows. If we refuse a request, you may appeal by replying to our decision;
  [COUNSEL: add the appeal process and regulator contact where required].
- **Consumers of an agency:** the agency controls your data. Please contact the agency. If you
  contact us, we will forward your request to the agency and help it respond.

We will not discriminate against you for exercising a privacy right.

## 10. Children

Insurvas is a business service for licensed insurance professionals and is not directed to
children; we do not knowingly collect personal data from children under 13 as users. Agencies may,
however, record information about minors — most often a child named as a beneficiary on an
insurance application. That information is processed on the agency's behalf under section 3.

## 11. Where data is processed

Data is processed in the United States [OWNER: confirm the Supabase and hosting regions]. The
service is intended for use in the United States.

## 12. Changes to this policy

We will post any new version here with its effective date. If a change is material, we will tell
account owners before it takes effect and, where required, ask for acceptance. Earlier versions
remain available.

## 13. Contact

[LEGAL ENTITY NAME]
[POSTAL ADDRESS]
Privacy questions and requests: [CONTACT EMAIL]
