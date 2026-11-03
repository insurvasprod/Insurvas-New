// The platform layout maps for the carriers in the bucket samples (docs/la4/bucket-samples), as data.
// One source for three things: scripts/gen-bucket-layout-seed.mjs writes the migration from it,
// lib/ingestion/bucketLayouts.test.mjs reads every sample file with it and checks the answer key,
// and a person can read here exactly what each carrier column becomes.
//
// Entry: [source column, target field, data type, transform, required, enum values?]
//   A source column "=annual" is a fixed value; "Status + Reason" reads two columns joined.
// PDF layouts give each column's left edge in PDF points, measured from the carrier's statement.

const money = "strip_currency";

/** Field lists shared by carriers on the same platform (Aetna, Aflac and American Home Life). */
const POLICY_SUMMARY_46 = [
  ["POLICYNUMBER", "policy_number", "text", "none", true],
  ["STATUSDISPLAYTEXT", "carrier_status_raw", "text", "none", true],
  ["PAIDTODATE", "paid_to_date", "date", "none", false],
  ["ORIGEFFDATE", "effective_date", "date", "none", false],
  ["ISSUEDATE", "issue_date", "date", "none", false],
  ["APPSIGNATUREDATE", "application_date", "date", "none", false],
  ["TERMDATE", "termination_date", "date", "none", false],
  ["CURRENTMODALPREMIUM", "premium_cents", "int_cents", money, false],
  ["PAYMENTMODEDISPLAYTEXT", "premium_mode", "enum", "none", false, { M: "monthly", Q: "quarterly", S: "semiannual", A: "annual" }],
  ["PAYMENTMETHODDISPLAYTEXT", "payment_method", "enum", "none", false, { EFT: "bank_draft", "DIRECT BILL": "direct_bill", "CREDIT CARD": "card" }],
  ["FACEVALUE", "face_amount_cents", "int_cents", money, false],
  ["PRODUCT", "product_code", "text", "none", false],
  ["LONGDESCRIPTION", "product_tier", "text", "none", false],
  ["AGENTNUMBER", "agent_identifier", "text", "none", false],
  ["INSUREDNAME", "insured_name", "text", "none", false],
  ["BIRTHDATE", "insured_dob", "date", "none", false],
  ["PHONE1", "insured_phone", "text", "none", false],
  ["ADDRESSLINE1", "insured_address", "text", "none", false],
  ["STATE", "insured_state", "text", "none", false],
  ["POSTALCODE", "insured_zip", "text", "none", false],
];

const COMMISSION_DETAIL = [
  ["POLICYNUMBER", "policy_number", "text", "none", true],
  ["COMMISSIONCATEGORY", "entry_type", "enum", "none", true, { Advance: "advance", Initial: "earned", "First Year": "earned", Renewal: "earned", Adjustments: "chargeback" }],
  ["COMMISSIONAMOUNT", "amount_cents", "int_cents", money, true],
  ["RATE%", "rate_bp", "basis_points", "pct_to_bp", false],
  ["COMMISSIONABLEPREMIUM", "commissionable_premium_cents", "int_cents", money, false],
  ["MONTHSADVANCED", "months_advanced", "integer", "none", false],
  ["WRITINGAGENTNUMBER", "agent_identifier", "text", "none", false],
  ["CLIENT", "insured_name", "text", "none", false],
  ["PREMIUMDUEDATE", "transaction_date", "date", "mmddyyyy", false],
  // The statement is the agency's: every line is an override on its writing agents' sales.
  ["COMMISSIONTYPE", "payee_level", "enum", "none", false, { "Commission Override": "upline", "Advance Commission Overide": "upline", "Advance Commission Override": "upline", "Recover Unearned Advance": "upline", Commission: "writing_agent", "Advance Commission": "writing_agent" }],
];

export const LAYOUTS = [
  { key: "policy_summary_46", name: "Policy Summary (46 columns): Aetna, Aflac, American Home Life", fileType: "policies", headerRow: 2, sheet: "Policy Summary", entries: POLICY_SUMMARY_46 },
  { key: "commission_detail_2sheet", name: "Commission-Detail (details sheet): Aetna, Aflac, American Home Life", fileType: "commissions", headerRow: 2, sheet: "Commission Details", entries: COMMISSION_DETAIL },
  {
    key: "amam_policies_csv", name: "American Amicable Policies.csv", fileType: "policies", headerRow: 1, sheet: null,
    entries: [
      ["Policy", "policy_number", "text", "none", true],
      ["Status", "carrier_status_raw", "text", "none", true],
      ["PaidtoDate", "paid_to_date", "date", "mmddyy", false],
      ["PolicyDate", "effective_date", "date", "mmddyy", false],
      ["App Date", "application_date", "date", "mmddyy", false],
      ["ModePrem", "premium_cents", "int_cents", money, false],
      ["Mode", "premium_mode", "enum", "none", false, { monthly: "monthly", quarterly: "quarterly", semiannual: "semiannual", "semi-annual": "semiannual", annual: "annual" }],
      ["Form", "payment_method", "enum", "none", false, { "Bank Draft": "bank_draft", "Direct Bill": "direct_bill", "Direct Notice": "direct_bill", "Direct Express": "direct_express", "Credit Card": "card" }],
      ["Face", "face_amount_cents", "int_cents", money, false],
      ["Plan", "product_code", "text", "none", false],
      ["WritingAgent", "agent_identifier", "text", "none", false],
      ["FirstName", "insured_first_name", "text", "none", false],
      ["LastName", "insured_last_name", "text", "none", false],
      ["DOB", "insured_dob", "date", "mmddyy", false],
      ["Phone", "insured_phone", "text", "none", false],
      ["Address1", "insured_address", "text", "none", false],
      ["State", "insured_state", "text", "none", false],
      ["Zip", "insured_zip", "text", "none", false],
    ],
  },
  {
    key: "amam_advances_csv", name: "American Amicable Advances_<account>_<date>.csv", fileType: "commissions", headerRow: 1, sheet: null,
    entries: [
      ["Policy", "policy_number", "text", "none", true],
      ["Action", "entry_type", "enum", "none", true, { DELIVR: "advance", CANCEL: "chargeback", NOPREM: "chargeback", PSTDUE: "chargeback" }],
      ["Advance", "amount_cents", "int_cents", money, true],
      ["Adv Rate", "rate_bp", "basis_points", "pct_to_bp", false],
      ["Anz Prem", "commissionable_premium_cents", "int_cents", money, false],
      ["WritingAgent", "agent_identifier", "text", "none", false],
      ["Insured", "insured_name", "text", "none", false],
      ["RptDate", "transaction_date", "date", "mmddyy", false],
      ["RptDate", "statement_date", "date", "mmddyy", false],
    ],
  },
  {
    key: "americo_policies_xlsx", name: "Americo americo-policies-<date>.xlsx", fileType: "policies", headerRow: 1, sheet: null,
    entries: [
      ["Policy #", "policy_number", "text", "none", true],
      ["Policy Status", "carrier_status_raw", "text", "none", true],
      ["Effective Date", "effective_date", "date", "mmddyy", false],
      ["Received Date", "application_date", "date", "mmddyy", false],
      ["Terminated Date", "termination_date", "date", "mmddyy", false],
      ["Annualized Premium", "premium_cents", "int_cents", money, false],
      // The file gives the annualised premium only.
      ["=annual", "premium_mode", "enum", "none", false, { annual: "annual" }],
      ["Product", "product_code", "text", "none", false],
      ["Agent #", "agent_identifier", "text", "none", false],
      ["Insured", "insured_name", "text", "none", false],
    ],
  },
  {
    key: "americo_statement_pdf", name: "Americo Commissions - Statements - Agent Portal (PDF)", fileType: "commissions", headerRow: 1, sheet: null,
    pdf: {
      start: "OVERRIDE ACTIVITY", stop: ["TOTAL PAY BASIS"],
      columns: [["Policy Number", 30], ["Name/Desc", 100], ["Issue Age", 170], ["Eff. Date", 210], ["Plan", 255], ["TRDT", 295], ["PRDT", 335], ["Months", 370], ["DU PRO LV", 410], ["Base Amount", 465], ["TRX", 520], ["Rate", 560], ["Split", 600], ["Amt Acct", 635], ["Primary Balance", 680]],
      rowStart: ["Policy Number", "^[A-Z]{2}\\d{6,}$"],
      continuation: [["Agent Code", 115], ["Agent Name", 155]],
    },
    entries: [
      ["Policy Number", "policy_number", "text", "none", true],
      // Override activity paid on the agents' first-year premium (to confirm with the agency).
      ["TRX", "entry_type", "enum", "none", true, { "AE-NA": "earned" }],
      ["Primary Balance", "amount_cents", "int_cents", money, true],
      ["Rate", "rate_bp", "basis_points", "fraction_to_bp", false],
      ["Base Amount", "commissionable_premium_cents", "int_cents", money, false],
      ["Agent Code", "agent_identifier", "text", "none", false],
      ["Name/Desc", "insured_name", "text", "none", false],
      ["TRDT", "transaction_date", "date", "mmddyy", false],
      ["=upline", "payee_level", "enum", "none", false, { upline: "upline" }],
    ],
  },
  {
    key: "corebridge_policy_summary", name: "Corebridge PolicySummary_<date>.xlsx (policies)", fileType: "policies", headerRow: 2, sheet: null,
    entries: [
      ["Policy Number", "policy_number", "text", "none", true],
      ["Policy Status", "carrier_status_raw", "text", "none", true],
      // The next premium due is the date the policy is paid up to.
      ["Premium Due Date", "paid_to_date", "date", "mmddyyyy", false],
      ["Effective Date", "effective_date", "date", "mmddyyyy", false],
      ["Date of Issue ", "issue_date", "date", "mmddyyyy", false],
      ["Billable Premium", "premium_cents", "int_cents", money, false],
      ["Billing Frequency", "premium_mode", "enum", "none", false, { Monthly: "monthly", Quarterly: "quarterly", "Semi-Annual": "semiannual", Annual: "annual" }],
      ["Billing Method", "payment_method", "enum", "none", false, { "Bank Draft": "bank_draft", Direct: "direct_bill", "Credit Card": "card" }],
      ["Face Amount", "face_amount_cents", "int_cents", money, false],
      ["Product Name", "product_code", "text", "none", false],
      ["Agent Number", "agent_identifier", "text", "none", false],
      ["Insured Name", "insured_name", "text", "none", false],
      ["Insured Birth", "insured_dob", "date", "mmddyyyy", false],
    ],
  },
  {
    key: "corebridge_new_business", name: "Corebridge PolicySummary_<date>.xlsx (new business)", fileType: "new_business", headerRow: 2, sheet: null,
    entries: [
      ["Policy Number", "policy_number", "text", "none", true],
      ["Policy Status", "carrier_status_raw", "text", "none", true],
      ["Effective Date", "effective_date", "date", "mmddyyyy", false],
      ["App Received", "application_date", "date", "mmddyyyy", false],
      // Billable Premium is written to five decimals here ("65.66000"); the annual Premium is exact.
      ["Premium", "premium_cents", "int_cents", money, false],
      ["=annual", "premium_mode", "enum", "none", false, { annual: "annual" }],
      ["Billing Method", "payment_method", "enum", "none", false, { "Bank Draft": "bank_draft", Direct: "direct_bill", "Credit Card": "card" }],
      ["Face Amount", "face_amount_cents", "int_cents", money, false],
      ["Product Name", "product_code", "text", "none", false],
      ["Agent Number", "agent_identifier", "text", "none", false],
      ["Insured Name", "insured_name", "text", "none", false],
      ["Insured Birth", "insured_dob", "date", "mmddyyyy", false],
    ],
  },
  {
    key: "corebridge_statement_pdf", name: "Corebridge view_statements (PDF, weekly)", fileType: "commissions", headerRow: 1, sheet: null,
    pdf: {
      start: "TRANSACTION DETAIL", stop: ["TOTAL ADVANCES PAID"],
      columns: [["CO", 30], ["POLICY", 51], ["INSURED", 101], ["EFF DATE", 156], ["AGENT#", 198], ["COMM TYPE", 232], ["ANNUAL PREM", 292], ["PREM PAID", 345], ["SPLIT", 392], ["SPLIT PREM", 425], ["ADV", 470], ["COMM RATE", 495], ["OUTSTANDING ADV BAL", 538], ["ACTIVITY", 615]],
      rowStart: ["CO", "^[A-Z]{3}$"],
    },
    entries: [
      ["POLICY", "policy_number", "text", "none", true],
      // The statement's legend: AD advance, AE advance recovered (earned against it).
      ["COMM TYPE", "entry_type", "enum", "none", true, { GENERICATTAD: "advance", GENERICATTAE: "earned" }],
      ["ACTIVITY", "amount_cents", "int_cents", money, true],
      ["COMM RATE", "rate_bp", "basis_points", "pct_to_bp", false],
      ["SPLIT PREM", "commissionable_premium_cents", "int_cents", money, false],
      ["AGENT#", "agent_identifier", "text", "none", false],
      ["INSURED", "insured_name", "text", "none", false],
    ],
  },
  {
    key: "moo_policy_csv_76", name: "Mutual of Omaha <producer>-<id>.csv (76 columns)", fileType: "policies", headerRow: 1, sheet: null,
    entries: [
      ["POLICY_NUMBER", "policy_number", "text", "none", true],
      ["POLICY_STATUS_NME", "carrier_status_raw", "text", "none", true],
      ["PAID_TO_DTE", "paid_to_date", "date", "mmddyyyy", false],
      ["POLICY_EFFECTIVE_DTE", "effective_date", "date", "mmddyyyy", false],
      ["POLICY_ISSUE_DTE", "issue_date", "date", "mmddyyyy", false],
      ["APP_SIGNED_DTE", "application_date", "date", "mmddyyyy", false],
      ["POLICY_TERM_DTE", "termination_date", "date", "mmddyyyy", false],
      ["PREMIUM", "premium_cents", "int_cents", money, false],
      ["BILL_MODE", "premium_mode", "enum", "none", false, { Monthly: "monthly", Quarterly: "quarterly", "Semi-Annual": "semiannual", Annual: "annual" }],
      ["FACE_AMT", "face_amount_cents", "int_cents", money, false],
      ["PRODUCT_DESC", "product_code", "text", "none", false],
      ["WRT_AGT_PROD_NUM", "agent_identifier", "text", "none", false],
      ["INSURED_NME", "insured_name", "text", "none", false],
      ["INSURED_DOB", "insured_dob", "date", "mmddyyyy", false],
      ["INSURED_PARTY_PHONE", "insured_phone", "text", "none", false],
      ["INSURED_ADDRESS_LINE_1", "insured_address", "text", "none", false],
      ["INSURED_STATE", "insured_state", "text", "none", false],
      ["INSURED_ZIPCDE", "insured_zip", "text", "none", false],
    ],
  },
  {
    key: "moo_ebssr_details", name: "Mutual of Omaha ebssr_<id>.xlsx (DETAILS sheet)", fileType: "commissions", headerRow: 1, sheet: "DETAILS",
    entries: [
      ["Policy", "policy_number", "text", "none", true],
      ["Activity Type", "entry_type", "enum", "none", true, { "NEW ISS": "advance", "NEW ISS REV": "chargeback", "BFY PAYMENT": "earned", "REN PAYMENT": "earned" }],
      // Comm Amt is what was paid (the lines add up to the SUMMARY's total); Adv Comm is the advance balance moving.
      ["Comm Amt", "amount_cents", "int_cents", money, true],
      ["Comm Pct", "rate_bp", "basis_points", "fraction_to_bp", false],
      ["Comm Premium", "commissionable_premium_cents", "int_cents", money, false],
      ["Prod Num", "agent_identifier", "text", "none", false],
      ["Insureds Name", "insured_name", "text", "none", false],
      ["Activity Date", "transaction_date", "date", "mmddyyyy", false],
      ["Activity Date", "statement_date", "date", "mmddyyyy", false],
    ],
  },
  {
    key: "ssl_policy_list_xls", name: "Sentinel Security Life PolicyList.xls (Excel 2003 XML)", fileType: "policies", headerRow: 1, sheet: null,
    entries: [
      ["Policy Number", "policy_number", "text", "none", true],
      // "Cancelled" alone could be not taken, withdrawn or lapsed: the reason says which.
      ["Status + Reason", "carrier_status_raw", "text", "none", true],
      ["Issue Date", "issue_date", "date", "none", false],
      ["Issue Date", "effective_date", "date", "none", false],
      ["Annual Premium $", "premium_cents", "int_cents", money, false],
      ["=annual", "premium_mode", "enum", "none", false, { annual: "annual" }],
      ["Product Description", "product_code", "text", "none", false],
      ["Writing Agent", "agent_identifier", "text", "none", false],
      ["Client Name", "insured_name", "text", "none", false],
    ],
  },
  {
    key: "ssl_statement_pdf", name: "Sentinel Security Life Statement_<n> (PDF)", fileType: "commissions", headerRow: 1, sheet: null,
    pdf: {
      start: "MANUAL ADJUSTMENTS", stop: ["TOTAL MANUAL ADJUSTMENTS"],
      columns: [["Policy #", 40], ["Name", 75], ["Plan Code", 105], ["Adjustment Type", 125], ["Adjustment Description", 170], ["(+/-) Adjustment Amount", 260]],
      rowStart: ["Adjustment Type", "^[A-Z]{1,4}$"],
    },
    entries: [
      // Version 1: account-level adjustments (advance interest) name no policy, so the line is held. See LATER_VERSIONS.
      ["Policy #", "policy_number", "text", "none", true],
      ["Adjustment Type", "entry_type", "enum", "none", true, { AI: "advance_interest" }],
      ["(+/-) Adjustment Amount", "amount_cents", "int_cents", money, true],
    ],
  },
];

/**
 * Later versions of a seeded layout, each from its own migration (the seed above is version 1 and
 * stays as it was applied). What the app reads today is the latest: latestOf(layout).
 */
export const LATER_VERSIONS = {
  // 20261009130000: the owner decided account-level lines are recorded (2026-10-08), so the policy
  // number is no longer required, and the line's description is read.
  // 20261009130000 (v2): the policy number is no longer required, and the line's description is
  // read. 20261009180000 (v3): LA-4.4's balance gate — the lines must add up to the statement's
  // TOTAL MANUAL ADJUSTMENTS, and Beginning + Total Commissions = Ending Balance.
  ssl_statement_pdf: {
    version: 3,
    migration: "20261009180000",
    entries: [
      ["Policy #", "policy_number", "text", "none", false],
      ["Adjustment Type", "entry_type", "enum", "none", true, { AI: "advance_interest" }],
      ["(+/-) Adjustment Amount", "amount_cents", "int_cents", money, true],
      ["Adjustment Description", "description", "text", "none", false],
    ],
    pdf: {
      start: "MANUAL ADJUSTMENTS", stop: ["TOTAL MANUAL ADJUSTMENTS"],
      columns: [["Policy #", 40], ["Name", 75], ["Plan Code", 105], ["Adjustment Type", 125], ["Adjustment Description", 170], ["(+/-) Adjustment Amount", 260]],
      rowStart: ["Adjustment Type", "^[A-Z]{1,4}$"],
      total: { label: "TOTAL MANUAL ADJUSTMENTS", column: "(+/-) Adjustment Amount" },
      balance: { opening: { label: "Beginning Commission Balance:" }, activity: { label: "Total Commissions:", after: "SUMMARY TOTALS" }, closing: { label: "Ending Balance:" } },
    },
  },
  // 20261009180000 (v2): the lines must add up to PRIMARY BALANCE TOTAL, and the Primary account's
  // Previous Bal + Activity = Close Bal.
  americo_statement_pdf: {
    version: 2,
    migration: "20261009180000",
    pdf: {
      start: "OVERRIDE ACTIVITY", stop: ["TOTAL PAY BASIS"],
      columns: [["Policy Number", 30], ["Name/Desc", 100], ["Issue Age", 170], ["Eff. Date", 210], ["Plan", 255], ["TRDT", 295], ["PRDT", 335], ["Months", 370], ["DU PRO LV", 410], ["Base Amount", 465], ["TRX", 520], ["Rate", 560], ["Split", 600], ["Amt Acct", 635], ["Primary Balance", 680]],
      rowStart: ["Policy Number", "^[A-Z]{2}\\d{6,}$"],
      continuation: [["Agent Code", 115], ["Agent Name", 155]],
      total: { label: "PRIMARY BALANCE TOTAL", column: "Primary Balance" },
      balance: { opening: { label: "Primary", after: "Account Balances", nth: 0 }, activity: { label: "Primary", after: "Account Balances", nth: 1 }, closing: { label: "Primary", after: "Account Balances", nth: 2 } },
    },
  },
  // 20261009180000 (v2): the lines must add up to TOTAL ADVANCES PAID, and PRIOR ACCOUNT BALANCE +
  // COMMISSIONS CURRENT PERIOD = ENDING ACCOUNT BALANCE.
  corebridge_statement_pdf: {
    version: 2,
    migration: "20261009180000",
    pdf: {
      start: "TRANSACTION DETAIL", stop: ["TOTAL ADVANCES PAID"],
      columns: [["CO", 30], ["POLICY", 51], ["INSURED", 101], ["EFF DATE", 156], ["AGENT#", 198], ["COMM TYPE", 232], ["ANNUAL PREM", 292], ["PREM PAID", 345], ["SPLIT", 392], ["SPLIT PREM", 425], ["ADV", 470], ["COMM RATE", 495], ["OUTSTANDING ADV BAL", 538], ["ACTIVITY", 615]],
      rowStart: ["CO", "^[A-Z]{3}$"],
      total: { label: "TOTAL ADVANCES PAID", column: "ACTIVITY" },
      balance: { opening: { label: "PRIOR ACCOUNT BALANCE" }, activity: { label: "COMMISSIONS CURRENT PERIOD" }, closing: { label: "ENDING ACCOUNT BALANCE" } },
    },
  },
};

export const latestOf = (layout) => (LATER_VERSIONS[layout.key] ? { ...layout, ...LATER_VERSIONS[layout.key] } : { ...layout, version: 1 });
/** Which carrier (by code) reads which file type with which layout. */
export const ASSIGNMENTS = [
  ["aetna", "policies", "policy_summary_46"], ["aflac", "policies", "policy_summary_46"], ["american_home_life", "policies", "policy_summary_46"],
  ["aetna", "commissions", "commission_detail_2sheet"], ["aflac", "commissions", "commission_detail_2sheet"], ["american_home_life", "commissions", "commission_detail_2sheet"],
  ["american_amicable", "policies", "amam_policies_csv"], ["american_amicable", "commissions", "amam_advances_csv"],
  ["americo", "policies", "americo_policies_xlsx"], ["americo", "commissions", "americo_statement_pdf"],
  ["corebridge", "policies", "corebridge_policy_summary"], ["corebridge", "new_business", "corebridge_new_business"], ["corebridge", "commissions", "corebridge_statement_pdf"],
  ["mutual_of_omaha", "policies", "moo_policy_csv_76"], ["mutual_of_omaha", "commissions", "moo_ebssr_details"],
  ["sentinel_security_life", "policies", "ssl_policy_list_xls"], ["sentinel_security_life", "commissions", "ssl_statement_pdf"],
];

/** A layout's entries as LayoutEntry objects, and its PDF layout as PdfLayout (what the app reads). */
export const entriesOf = (layout) => layout.entries.map(([sourceColumn, targetField, dataType, transform, required, enumValues]) => ({ sourceColumn, targetField, dataType, transform, required, enumValues: enumValues ?? null }));
export const pdfOf = (layout) => (layout.pdf ? {
  start: layout.pdf.start, stop: layout.pdf.stop,
  columns: layout.pdf.columns.map(([name, x]) => ({ name, x })),
  rowStart: { column: layout.pdf.rowStart[0], pattern: layout.pdf.rowStart[1] },
  ...(layout.pdf.continuation ? { continuation: layout.pdf.continuation.map(([name, x]) => ({ name, x })) } : {}),
  ...(layout.pdf.total ? { total: layout.pdf.total } : {}),
  ...(layout.pdf.balance ? { balance: layout.pdf.balance } : {}),
} : null);
