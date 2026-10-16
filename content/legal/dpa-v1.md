# Data Processing Agreement

**Draft — for counsel review. This agreement has not been reviewed by a lawyer and is not final.
Items in [SQUARE BRACKETS] must be supplied or decided before publication.**

Effective date: [EFFECTIVE DATE]

This Data Processing Agreement ("**DPA**") forms part of the Terms of Service between [LEGAL
ENTITY NAME] ("**Insurvas**") and the agency that subscribes to the service ("**Customer**"). It
applies to personal information about Customer's consumers — leads, prospects, applicants,
insureds and beneficiaries — that Customer puts into the service ("**Customer Personal
Information**"). If this DPA conflicts with the Terms of Service, this DPA controls for Customer
Personal Information.

## 1. Roles

Customer is the business / controller of Customer Personal Information and decides why and how it
is processed. Insurvas is Customer's service provider / processor (and, where applicable, its
"service provider" under the Gramm-Leach-Bliley Act and its implementing rules, and its "service
provider" or "processor" under applicable US state privacy laws). [COUNSEL: confirm whether any
Customer is a HIPAA covered entity or business associate for any product line, and whether a
Business Associate Agreement is needed; Insurvas does not state that the service is HIPAA
compliant.]

## 2. Customer's instructions

Insurvas will process Customer Personal Information only to provide, secure and support the
service, as described in the Terms of Service and this DPA, on Customer's documented instructions
(which include Customer's use and configuration of the service), or as required by law. If the law
requires other processing, Insurvas will tell Customer first unless the law forbids it.

Insurvas will not: sell or share Customer Personal Information for cross-context behavioural
advertising; retain, use or disclose it for any purpose other than the business purposes in this
DPA; combine it with personal information from other sources except as the law permits for a
service provider; or use it to train artificial-intelligence models.

Customer is responsible for the lawfulness of the data and instructions it provides, including
giving consumers any required notices and obtaining any required consents (for example under the
TCPA, state telemarketing laws, GLBA privacy notice rules and state insurance privacy laws).

## 3. Confidentiality

Insurvas will ensure that people it authorises to process Customer Personal Information are bound
by confidentiality obligations and have access only as needed for their role.

## 4. Security

Insurvas will maintain a written information-security program with administrative, technical and
physical safeguards appropriate to the sensitivity of the data, consistent in substance with the
elements of the FTC Safeguards Rule (16 C.F.R. Part 314), including: a designated person
responsible for the program; risk assessment; access controls; encryption of data in transit and
of the most sensitive fields at rest; multi-factor authentication; logging and monitoring of
access; secure development and change management; service-provider oversight; an incident response
plan; and periodic review. A description of current measures is in Annex 2. [COUNSEL/OWNER:
confirm each element exists as a documented program before publishing; Insurvas does not claim any
certification.]

## 5. Subprocessors

Customer authorises Insurvas to engage the subprocessors listed in the Subprocessor List at
[SUBPROCESSOR LIST URL — /legal/subprocessors once published]. Insurvas will bind each subprocessor
to data-protection obligations at least as protective as this DPA and remains responsible for its
subprocessors' performance. Insurvas will update the list and give at least [NUMBER] days' notice
[by email to account owners / by updating the list — OWNER to choose] before a new subprocessor
processes Customer Personal Information. Customer may object on reasonable data-protection
grounds within that period; if the parties cannot resolve the objection, Customer may terminate the
affected service and receive a refund of prepaid fees for the unused period.

Do-not-call and screening vendors that Customer itself configures in the service are Customer's
own vendors, not Insurvas subprocessors.

## 6. Security incidents

Insurvas will notify Customer without undue delay, and in any event within [NUMBER] hours, after
confirming a breach of security that leads to unauthorised access to or acquisition of Customer
Personal Information. The notice will describe, as far as then known, what happened, the data and
consumers affected, the measures taken, and a contact for more information. Insurvas will
cooperate with Customer so that Customer can meet its own notification obligations to consumers,
regulators (including state insurance regulators and, where applicable, the FTC) and others.
Unless the law requires otherwise, Customer decides whether and how to notify consumers.
[COUNSEL: align with state insurance data-security laws modelled on NAIC Model Law #668, which may
impose 72-hour regulator notice on Customer.]

## 7. Assistance with consumer requests

Taking into account the nature of the processing, Insurvas will help Customer respond to
consumers' requests to access, correct or delete their information — through features in the
service (export, record editing, and the deletion-request workflow) and, where those are not
enough, on Customer's written request. If Insurvas receives a request directly from a consumer
about Customer Personal Information, it will forward it to Customer and will not respond itself
except to direct the consumer to Customer.

## 8. Deletion and return

During the subscription, Customer can export and delete Customer Personal Information using the
service. After the subscription ends, Customer can read and export its data for the retention
window shown at cancellation (90 days by default). On Customer's written request, made at any time
up to [NUMBER] days after the retention window ends, Insurvas will delete or de-identify Customer
Personal Information within [NUMBER] days, except where the law requires Insurvas to keep it, in
which case this DPA continues to protect it. [OWNER/COUNSEL: the service does not currently delete
a cancelled workspace's data automatically; decide whether to commit to automatic deletion after a
fixed period and build it first.] Data in backups is deleted as the backups expire on their normal
cycle [OWNER: state the backup retention period of the database provider].

## 9. Audits and information

Insurvas will make available information reasonably necessary to show compliance with this DPA,
which may take the form of written answers to a reasonable security questionnaire no more than
once a year, and any third-party assessment reports Insurvas then has (it does not currently hold
a certification). Where that information is not enough, or a regulator requires it, Customer may
conduct an audit on [NUMBER] days' notice, during business hours, at Customer's cost, subject to
confidentiality, no more than once in any 12 months unless following a security incident.
Insurvas will cooperate with examinations of Customer by its insurance regulators to the extent
they concern the service.

## 10. Location

Customer Personal Information is stored and processed in the United States [OWNER: confirm the
database and hosting regions].

## 11. Term

This DPA lasts as long as Insurvas processes Customer Personal Information.

## Annex 1 — Details of processing

- **Subject matter and duration:** providing the Insurvas service for the term of the subscription
  and the post-termination period in section 8.
- **Nature and purpose:** storing, organising, displaying, screening, transmitting (on Customer's
  instruction) and deleting data to run Customer's lead handling, dialing, application, policy and
  commission workflows.
- **Consumers concerned:** Customer's leads, prospects, applicants, insureds, beneficiaries
  (including minors named as beneficiaries) and other people Customer records.
- **Categories of data:** contact details; lead source and cost; call outcomes, notes and
  appointments; consent evidence including IP addresses and consent-certificate identifiers;
  do-not-call and suppression entries; Social Security numbers; dates of birth; health answers and
  medications; income; beneficiary details; bank account and routing numbers and payment card
  numbers entered on applications; policy and commission records; uploaded files.
- **Sensitive data:** Social Security numbers, financial account and card numbers, health
  information, and information about minors.

## Annex 2 — Current security measures (summary)

- Separation of each customer's data by database row-level security, with the application
  connecting as a restricted role.
- Application-level AES-256-GCM encryption, with per-customer derived keys, for Social Security
  numbers, bank account and routing numbers, payment card numbers, agency tax IDs, calendar tokens,
  vendor credentials and agency users' two-step secrets.
- Full values of encrypted fields revealed only to permitted roles after two-step verification,
  with each reveal logged.
- Passwords stored as bcrypt hashes; optional TOTP two-step verification for agency users and
  required two-step verification for Insurvas staff.
- Role-based access in the product; audit logs of significant changes; append-only records of
  legal acceptances.
- Encrypted connections (HTTPS) for all traffic.
- [OWNER: add organisational measures — staff access policy, background checks, training, backup
  and recovery, vulnerability management, incident response plan — only if they exist.]
