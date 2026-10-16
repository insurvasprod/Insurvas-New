// Builds docs/la4/demo/clean-demo/: one policy file and one commission statement for each of the 8
// carriers the platform reads, in each carrier's own layout (the bucket samples are the templates),
// planned so that a demo shows every LA-4 calculation working and almost nothing going wrong.
//
// Every policy is in force and paid ahead, and every commission line is exactly what the rate card in
// RATES says it should be â€” except two, on purpose:
//   Â· Mutual of Omaha pays one advance $50.00 short       â†’ one "Paid short" discrepancy
//   Â· Aetna sends no commission for one issued policy      â†’ one "Missing commission" discrepancy
// Two policies are behind on their premium (paid to Sep 15), so the Lapse risk call list has two names.
// Sentinel's statement is the sample's own: one advance-interest account line, âˆ’$46.25.
//
// Synthetic data only: every name, number and address is made up (phones in the 555-01xx range).
//
//   node scripts/la4-demo-clean-dataset.mjs                 writes the files
//   node scripts/la4-demo-clean-dataset.check.mjs           reads them back as the app does and predicts the result
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const ROOT = new URL("../", import.meta.url);
const SAMPLES = new URL("docs/la4/bucket-samples/09-01-2026/Sample Agency/", ROOT);
const OUT = new URL("docs/la4/demo/clean-demo/", ROOT);

export const POLICY_FILE_DATE = "2026-10-01";
export const STATEMENT_DATE = "2026-10-02";
const PAID_TO = "2026-12-01"; // paid ahead: nobody is late until Dec 1, 2026
const BEHIND = "2026-09-15"; // the two the Lapse risk list should show

/**
 * The rate card to enter, per carrier: contract level, the carrier's product name and its family,
 * the first-year rate, the advance rule, and when the carrier pays (Carrier rules).
 */
export const RATES = {
  aetna: { name: "Aetna / CVS", level: 75, product: "Final Exp", family: "final_expense", rate: 45, advance: { months: 9, pct: 75 }, pays: "On the first draft", lag: 10, lagIsPlatform: true },
  aflac: { name: "Aflac", level: 100, product: "Final Exp", family: "final_expense", rate: 40, advance: { months: 9, pct: 75 }, pays: "On issue", lag: 30 },
  american_home_life: { name: "American Home Life", level: 100, product: "Final Exp", family: "final_expense", rate: 40, advance: { months: 9, pct: 75 }, pays: "On issue", lag: 30 },
  american_amicable: { name: "American Amicable", level: 100, product: "CCI2N", family: "final_expense", rate: 50, advance: { months: 9, pct: 75 }, pays: "On the first draft", lag: 30 },
  // Americo's report has no issue date and no paid-to date: no expected figure until a later file shows the policy issued.
  americo: { name: "Americo", level: 100, product: "EAGLE SELECT I NS", family: "final_expense", rate: 40, advance: null, pays: "On issue", lag: 35, lagIsPlatform: true, noExpectedFromOneFile: true },
  corebridge: { name: "Corebridge Financial", level: 100, product: "SimpliNow Legacy MAR 2026", family: "whole_life", rate: 45, advance: { months: 9, pct: 75 }, pays: "On issue", lag: 30 },
  mutual_of_omaha: { name: "Mutual of Omaha", level: 82.5, product: "Living Promise - Level  Benefit", family: "final_expense", rate: 30, advance: { months: 9, pct: 75 }, pays: "On issue", lag: null, lagIsPlatform: true },
  sentinel_security_life: { name: "Sentinel Security Life", level: 100, product: "New Vantage III", family: "whole_life", rate: 50, advance: null, pays: "On issue", lag: null },
};

// â”€â”€ the book â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FIRST = ["Avery", "Blake", "Casey", "Dana", "Ellis", "Finley", "Gray", "Harper", "Indigo", "Jordan", "Kai", "Logan", "Morgan", "Noel", "Oakley", "Parker", "Quinn", "Reese", "Sage", "Taylor", "Umber", "Vale", "Wren", "Xander", "Yael", "Zion", "Arden", "Briar", "Cyrus", "Dellan", "Emory", "Fallon", "Greer", "Hollis", "Ivory", "Jules", "Kendall", "Lennox", "Marlow", "Nico", "Orion", "Peyton", "Remy", "Sutton", "Tatum", "Vesper", "Winslow", "Zephyr"];
const LAST = ["Ashgrove", "Brightwell", "Copperfield", "Dunmore", "Elmstead", "Fairbourne", "Glenhaven", "Hartwood", "Ironside", "Juniper", "Kestrel", "Larkspur", "Merriweather", "Northcott", "Oakhurst", "Pembrook", "Quillfeather", "Redfern", "Silverton", "Thornbury", "Underhill", "Valemont", "Westbrook", "Yarrowby", "Ambervale", "Birchmere", "Cloverdale", "Driftwood", "Emberly", "Foxhollow", "Goldcrest", "Hawthorne", "Ivybridge", "Jasperton", "Kingsley", "Lindenhall", "Moorcroft", "Nettlefield", "Oxbury", "Primrose", "Rosedale", "Stonebridge", "Tamberlane", "Umberfield", "Violetta", "Wexley", "Yorkshire", "Zellwood"];
const STATES = ["TX", "FL", "GA", "OH", "NC", "AZ", "TN", "MO"];
const MONTHLY = [31.25, 38.4, 44.1, 27.85, 52.6, 35.75]; // the modal premium of policies 1â€“6 at every carrier
const ISSUED = ["2026-06-03", "2026-06-17", "2026-07-01", "2026-07-15", "2026-08-05", "2026-08-19"];
const EFFECTIVE = ["2026-06-10", "2026-06-24", "2026-07-08", "2026-07-22", "2026-08-12", "2026-08-26"];

const CARRIER_ORDER = ["aetna", "aflac", "american_home_life", "american_amicable", "americo", "corebridge", "mutual_of_omaha", "sentinel_security_life"];
const NUMBER = {
  aetna: (i) => `ACC781000${i + 1}`, aflac: (i) => `TER681000${i + 1}`, american_home_life: (i) => `AMH681000${i + 1}`, american_amicable: (i) => `011880000${i + 1}`,
  americo: (i) => `AM0810000${i + 1}`, corebridge: (i) => `726810000${i + 1}`, mutual_of_omaha: (i) => `BU810000${i + 1}`, sentinel_security_life: (i) => `081000${i + 1}`,
};
/** Policy 6 at Aetna gets no commission line; policy 4 at Mutual of Omaha is paid $50.00 short. */
export const PLANTED = { missing: { carrier: "aetna", index: 5 }, short: { carrier: "mutual_of_omaha", index: 3, cents: 5000 } };
const BEHIND_AT = [{ carrier: "american_home_life", index: 1 }, { carrier: "corebridge", index: 2 }];

const cents = (dollars) => Math.round(dollars * 100);
const mulDivRound = (a, b, c) => { const sign = a < 0 !== b < 0 ? -1 : 1; const n = Math.abs(a) * Math.abs(b) * 2 + c; const d = 2 * c; return sign * ((n - (n % d)) / d); };

export function book() {
  const policies = [];
  let k = 0;
  for (const carrier of CARRIER_ORDER) {
    for (let i = 0; i < 6; i++, k++) {
      const monthlyCents = cents(MONTHLY[i]);
      const annualCents = monthlyCents * 12;
      const r = RATES[carrier];
      const rateBp = Math.round(r.rate * 100);
      const expectedCents = mulDivRound(annualCents, rateBp, 10_000);
      const advanceCents = r.advance ? mulDivRound(expectedCents, r.advance.pct * 100, 10_000) : null;
      const behind = BEHIND_AT.some((b) => b.carrier === carrier && b.index === i);
      policies.push({
        carrier, index: i, number: NUMBER[carrier](i), first: FIRST[k], last: LAST[k], state: STATES[(k + i) % STATES.length],
        dob: `19${52 + ((k * 7) % 14)}-${String(1 + (k % 12)).padStart(2, "0")}-${String(3 + (k % 25)).padStart(2, "0")}`,
        issued: ISSUED[i], effective: EFFECTIVE[i], paidTo: behind ? BEHIND : PAID_TO, monthlyCents, annualCents, face: [5000, 8000, 10000, 7000, 15000, 12000][i] * 1,
        phone: `555-01${String(10 + k).padStart(2, "0")}`, rateBp, expectedCents, advanceCents,
        // What the statement pays: the advance (or, at Americo, one month earned); none for the missing one.
        paidCents: carrier === "sentinel_security_life" ? null
          : PLANTED.missing.carrier === carrier && PLANTED.missing.index === i ? null
          : carrier === "americo" ? mulDivRound(expectedCents, 1, 12)
          : advanceCents - (PLANTED.short.carrier === carrier && PLANTED.short.index === i ? PLANTED.short.cents : 0),
      });
    }
  }
  return policies;
}

// â”€â”€ formats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const us = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`; // 06/10/2026
const usShort = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(2, 4)}`; // 06/10/26
const usLoose = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}`; // 6/10/26
const mmddyy = (iso) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(2, 4)}`; // 061026
const plain = (c) => (c / 100).toFixed(2);
const usd = (c) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const grouped = (c) => (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const age = (dob, on) => Number(on.slice(0, 4)) - Number(dob.slice(0, 4)) - (on.slice(5) < dob.slice(5) ? 1 : 0);
const write = (name, bytes) => { writeFileSync(new URL(name, OUT), bytes); console.log("wrote", name); };

async function workbook(path) { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(new URL(path, SAMPLES)); return wb; }
/** Replace the data rows under a header row with new ones, keyed by header name, copying a template row. */
function fillSheet(ws, headerRow, templateRow, rows) {
  const header = ws.getRow(headerRow).values.slice(1).map((v) => (v == null ? "" : String(v)));
  const template = ws.getRow(templateRow).values.slice(1);
  const last = ws.rowCount;
  rows.forEach((values, n) => {
    const cells = header.map((name, i) => (name in values ? values[name] : template[i] ?? null));
    const row = ws.getRow(headerRow + 1 + n);
    cells.forEach((value, i) => { row.getCell(i + 1).value = value === undefined ? null : value; });
    row.commit();
  });
  // The template's other rows go, row objects and all (an emptied row still counts as a row).
  if (last > headerRow + rows.length) ws._rows.length = headerRow + rows.length;
}

// â”€â”€ policy files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SUMMARY_46 = {
  aetna: { file: "Aetna", company: "ACC", long: "ACC Final Exp Level Ben       ", agent: ["GNW5067869", "Alisha Hunter"] },
  aflac: { file: "Aflac", company: "TIER", long: "Final Exp Level Bene          ", agent: ["TEW5035090", "James Gonzalez"] },
  american_home_life: { file: "AHL", company: "AMH", long: "AMH Final Exp Level Ben       ", agent: ["AMW5038355", "Sara Cook"] },
};

async function policySummary46(carrier, policies) {
  const s = SUMMARY_46[carrier];
  const wb = await workbook(`${s.file}/Policies/policySummary.xlsx`);
  const ws = wb.getWorksheet("Policy Summary");
  let template = 3;
  for (let r = 3; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(4).value === "Active - Premium paying") { template = r; break; }
  fillSheet(ws, 2, template, policies.map((p) => ({
    COMPANYCODE: s.company, POLICYNUMBER: p.number, STATUSCATEGORY: "Active", STATUSDISPLAYTEXT: "Active - Premium paying", PRODUCT: "Final Exp",
    APPRECDDATE: p.issued.slice(0, 8) + "01", APPSIGNATUREDATE: p.issued.slice(0, 8) + "01", ORIGEFFDATE: p.effective, PAIDTODATE: p.paidTo, ISSUEDATE: p.issued, TERMDATE: null,
    ISSUEDPREMIUM: p.annualCents / 100, CURRENTANNUALPREMIUM: p.annualCents / 100, CURRENTMODALPREMIUM: p.monthlyCents / 100, DRAFTDAY: Number(p.effective.slice(8, 10)),
    PAYMENTMODEDISPLAYTEXT: "M", PAYMENTMETHODDISPLAYTEXT: "EFT", LASTPAYMENTDATE: p.paidTo === BEHIND ? "2026-08-15" : "2026-09-30", LASTPAYAMT: p.monthlyCents / 100,
    ISSUEZIP: "75001", FACEVALUE: p.face, ISSUESTATE: p.state, LONGDESCRIPTION: s.long, INSUREDNAME: `${p.first} ${p.last}`, SEX: p.index % 2 ? "F" : "M",
    BIRTHDATE: p.dob, ADDRESSLINE1: `${100 + p.index * 11} Sample Lane`, CITY: "Sampletown", STATE: p.state, POSTALCODE: "75001", PHONE1: `(214) ${p.phone}`,
    EMAIL: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.com`, ISSUEAGE: age(p.dob, p.effective), AGENTNUMBER: s.agent[0], AGENTCOMPLETENAME: s.agent[1],
  })));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function mooPolicies(policies) {
  const text = readFileSync(new URL("Mutual of Omaha/Policies/7376635-8641652185198.csv", SAMPLES), "utf8");
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const template = lines.find((l) => l.includes("Level  Benefit") && l.includes("Inforce")).split(",");
  const pad = (v, w) => String(v).padStart(w);
  const rows = policies.map((p) => {
    const values = { POLICY_NUMBER: p.number, POLICY_EFFECTIVE_DTE: us(p.effective), INSURED_NME: `${p.first}  ${p.last}  `, INSURED_AGE_AT_ISSUE: age(p.dob, p.effective), OWNER_NME: `${p.first}  ${p.last}  `,
      INSURED_GENDER: p.index % 2 ? "Female " : "Male   ", OWNER_GENDER: p.index % 2 ? "Female " : "Male   ",
      BILL_MODE: "Monthly", PREMIUM: pad(`$${plain(p.monthlyCents)}`, 12), ANNUAL_PREMIUM: pad(`$${plain(p.annualCents)}`, 12), PAID_TO_DTE: us(p.paidTo), APP_SIGNED_DTE: us(p.issued.slice(0, 8) + "01"),
      POLICY_ISSUE_DTE: us(p.issued), POLICY_TERM_DTE: "", APP_ISSUE_STATE_CDE: p.state, POLICY_STATUS_NME: "Inforce", FACE_AMT: pad(`$${p.face}.00`, 12),
      APPLICATION_RECEIVED_DTE: us(p.issued.slice(0, 8) + "01"), SSN_TIN_NUM: `xxx-xx-${String(1000 + p.index * 137).slice(-4)}` };
    return header.map((name, i) => (name in values ? values[name] : template[i] ?? "")).join(",");
  });
  return [lines[0], ...rows, ""].join("\n");
}

const amamQuote = (v) => `=("${v}")`;
function amamPolicies(policies) {
  const text = readFileSync(new URL("AMAM/Policies/Policies.csv", SAMPLES), "utf8");
  const header = text.split(/\r?\n/)[0];
  const rows = policies.map((p) => [amamQuote("0000952654"), "LARSON/ ELLEN", amamQuote("110"), amamQuote(p.number), "Active", us(p.dob), us(p.effective), us(p.paidTo), us(p.issued),
    p.last.toUpperCase(), p.first.toUpperCase(), "A", "CCI2N", p.face, "Bank Draft", "monthly", plain(p.monthlyCents), `${100 + p.index * 11} SAMPLE LANE`, `SAMPLETOWN ${p.state} 75001`, "", "",
    p.state, "75001", p.phone.replace("555-", "214-555-").slice(0, 12), "", us(p.issued.slice(0, 8) + "01"), 100].join(","));
  return [header, ...rows, ""].join("\r\n");
}

async function americoPolicies(policies) {
  const wb = await workbook("Americo/Policies/americo-policies-2026-09-08.xlsx");
  const ws = wb.worksheets[0];
  fillSheet(ws, 1, 3, policies.map((p) => ({ "Policy #": p.number, Insured: `${p.first} ${p.last}`, Agent: "Larson,Ellen", "Agent #": "MML13W-444", Product: "EAGLE SELECT I NS", "Policy Status": "Active (inforce)",
    "Status Date": usLoose(p.issued), "Received Date": usLoose(p.issued.slice(0, 8) + "01"), "Effective Date": usLoose(p.effective), "Terminated Date": null, "Annualized Premium": usd(p.annualCents) })));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function corebridgePolicies(policies) {
  const wb = await workbook("Corebridge/Policies/PolicySummary_09012026 (1).xlsx");
  const ws = wb.worksheets[0];
  fillSheet(ws, 2, 4, policies.map((p) => ({ "Writing/Servicing Agent": "COOK, SARA", "Agent Number": "1JTZ5-AGL", "Agency Number": 90517, "Policy Number": Number(p.number), "Product Name": "SimpliNow Legacy MAR 2026",
    "Insured Name": `${p.last.toUpperCase()},${p.first.toUpperCase()}`, "Insured Birth": us(p.dob), "Owner Name": `${p.last.toUpperCase()},${p.first.toUpperCase()}`, "Face Amount": p.face, Premium: p.annualCents / 100,
    "Billable Premium": p.monthlyCents / 100, "Billing Frequency": "Monthly", "Billing Method": "Bank Draft", "Policy Status": "Active", "Product Type": "Whole Life Insurance", "Premium Due Date": us(p.paidTo),
    "Date of Issue ": us(p.issued), "Effective Date": us(p.effective) })));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function sslPolicies(policies) {
  const xml = readFileSync(new URL("SSL/Policies/PolicyList.xls", SAMPLES), "utf8");
  const rows = [...xml.matchAll(/<Row>[\s\S]*?<\/Row>/g)].map((m) => m[0]);
  const template = rows.find((r) => /<Data ss:Type="String">Active<\/Data>/.test(r));
  const cells = (row) => [...row.matchAll(/<Cell(?:\/>|[^>]*>[\s\S]*?<\/Cell>)/g)].map((m) => m[0]);
  const t = cells(template);
  const str = (v) => `<Cell><Data ss:Type="String">${v}</Data></Cell>`;
  const built = policies.map((p) => {
    const c = [...t];
    c[0] = str(p.number); c[1] = str(`${p.first.toUpperCase()} ${p.last.toUpperCase()}`); c[4] = str("New Vantage III");
    c[5] = `<Cell><Data ss:Type="DateTime">${p.issued}T00:00:00.000</Data></Cell>`; c[9] = `<Cell><Data ss:Type="Number">${plain(p.annualCents)}</Data></Cell>`;
    c[12] = str("Active"); c[14] = str("K099581428"); c[15] = str("HUNTER, ALISHA");
    return `<Row>\n    ${c.join("\n    ")}\n   </Row>`;
  });
  const first = xml.indexOf(rows[1]);
  const last = xml.indexOf(rows.at(-1)) + rows.at(-1).length;
  return (xml.slice(0, first) + built.join("\n   ") + xml.slice(last)).replace(/ss:ExpandedRowCount="\d+"/, `ss:ExpandedRowCount="${policies.length + 1}"`);
}

// â”€â”€ commission files â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function commissionDetail(carrier, policies) {
  const s = SUMMARY_46[carrier];
  const wb = await workbook(`${s.file}/Commissions/Commission-Detail.xlsx`);
  const ws = wb.getWorksheet("Commission Details");
  let template = 3;
  for (let r = 3; r <= ws.rowCount; r++) if (ws.getRow(r).getCell(7).value === "Advance") { template = r; break; }
  const paid = policies.filter((p) => p.paidCents !== null);
  fillSheet(ws, 2, template, paid.map((p) => ({ COMPANY: s.company, COMMISSIONTYPE: "Advance Commission Override", WRITINGAGENTNUMBER: s.agent[0], WRITINGAGENTNAME: s.agent[1].toUpperCase(),
    CLIENT: `${p.first} ${p.last}`.toUpperCase(), POLICYNUMBER: p.number, COMMISSIONCATEGORY: "Advance", APPDATE: us(p.issued.slice(0, 8) + "01"), STATE: p.state, EFFECTIVEDATE: us(p.effective),
    PREMIUMDUEDATE: us("2026-09-30"), COMMISSIONABLEPREMIUM: usd(p.annualCents), "SPLIT%": "0.00", "RATE%": `${(p.rateBp / 100).toFixed(2)}%`, MONTHSADVANCED: "009",
    COMMISSIONAMOUNT: usd(p.paidCents), MODE: "Monthly" })));
  const total = paid.reduce((t, p) => t + p.paidCents, 0);
  const sum = wb.getWorksheet("Commission Summary");
  const set = (row, col, v) => { sum.getRow(row).getCell(col).value = v; };
  set(4, 5, us(STATEMENT_DATE)); set(4, 9, "FRIDAY ");
  set(5, 7, usd(total)); set(6, 7, usd(total)); set(12, 4, usd(total)); set(20, 4, "$0.00"); set(21, 4, usd(total));
  return { bytes: Buffer.from(await wb.xlsx.writeBuffer()), total };
}

async function mooStatement(policies) {
  const wb = await workbook("Mutual of Omaha/Commissions/ebssr_e5112b32-f772-4e7c-86f7-7f361d8d8510.xlsx");
  const ws = wb.getWorksheet("DETAILS");
  fillSheet(ws, 1, 2, policies.map((p) => ({ Policy: p.number, "Insureds Name": `${p.last} ${p.first}`.toUpperCase(), "Issue State": p.state, "Activity Date": us(STATEMENT_DATE), "Plan Code": "FEPL 1",
    "Issue Date": us(p.issued), "Paid To Date": us(p.paidTo), Age: age(p.dob, p.effective), MOS: "001", "Face Amount (000)": p.face / 1000, "Comm Premium": p.annualCents / 100, DUR: "F",
    "Activity Type": "NEW ISS", "Comm Pct": p.rateBp / 10_000, "Comm Amt": p.paidCents / 100, "Adv Comm": p.paidCents / 100, Comments: "" })));
  const total = policies.reduce((t, p) => t + p.paidCents, 0);
  const sum = wb.getWorksheet("SUMMARY");
  sum.getRow(3).getCell(2).value = `For Period Ending ${us(STATEMENT_DATE)}`;
  for (const r of [12, 13, 14]) sum.getRow(r).getCell(3).value = total / 100;
  return { bytes: Buffer.from(await wb.xlsx.writeBuffer()), total };
}

function amamStatement(policies) {
  const header = readFileSync(new URL("AMAM/Commissions/Advances_0003559471_01Sep26.csv", SAMPLES), "utf8").split(/\r?\n/)[0];
  const rate = RATES.american_amicable.rate;
  const rows = policies.map((p) => [us(STATEMENT_DATE), `="0000952654"`, `="${p.number}"`, `"${p.last.toUpperCase()},${p.first.toUpperCase()}"`, `="CCI2N"`, usShort(p.issued), p.index % 2 ? "F" : "M",
    age(p.dob, p.effective), plain(p.annualCents), 0, `="L09"`, rate, rate, 100, plain(p.paidCents), 0, plain(p.paidCents), "DELIVR", "MPAC"].join(","));
  return { text: [header, ...rows, ""].join("\r\n"), total: policies.reduce((t, p) => t + p.paidCents, 0) };
}

/** Redraws a template PDF page by page: `edit(pageNumber, items, helpers)` returns that page's text items. */
async function redraw(templatePath, fontNames, edit) {
  const pdfjs = await import(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.mjs", import.meta.url).href);
  const source = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(new URL(templatePath, SAMPLES))), useSystemFonts: false, disableFontFace: true }).promise;
  const out = await PDFDocument.create();
  const fonts = {};
  for (const [key, font] of Object.entries(fontNames)) fonts[key] = await out.embedFont(StandardFonts[font]);
  const fontOf = (name) => fonts[name.split("_").at(-1)] ?? fonts.f1;
  for (let number = 1; number <= source.numPages; number++) {
    const page = await source.getPage(number);
    const { width, height } = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((i) => i.str.trim() !== "").map((i) => ({ x: i.transform[4], y: i.transform[5], size: i.transform[0], font: i.fontName, text: i.str }));
    const target = out.addPage([width, height]);
    const rightAlign = (cell, text) => ({ ...cell, x: cell.x + fontOf(cell.font).widthOfTextAtSize(cell.text, cell.size) - fontOf(cell.font).widthOfTextAtSize(text, cell.size), text });
    for (const item of edit(number, items, { rightAlign })) target.drawText(item.text, { x: item.x, y: item.y, size: item.size, font: fontOf(item.font) });
  }
  return Buffer.from(await out.save({ useObjectStreams: false }));
}

async function americoStatement(policies) {
  const total = policies.reduce((t, p) => t + p.paidCents, 0);
  const base = policies.reduce((t, p) => t + p.annualCents, 0);
  const bytes = await redraw("Americo/Commissions/Commissions - Statements - Agent Portal.pdf", { f1: "Helvetica", f2: "HelveticaBold" }, (n, items, { rightAlign }) => {
    const rowY = 417, step = 28, templateRows = 4;
    const row = items.filter((i) => Math.round(i.y) === rowY);
    const agentRow = items.filter((i) => Math.round(i.y) === rowY - 12);
    const kept = items.filter((i) => i.y > rowY + 6 || i.y < rowY - step * (templateRows - 1) - 18);
    const shift = step * (policies.length - templateRows);
    const out = kept.map((i) => {
      const moved = i.y < rowY ? { ...i, y: i.y - shift } : i;
      if (moved.text.startsWith("AMERICO Commission Report as of")) return { ...moved, text: `AMERICO Commission Report as of ${us(STATEMENT_DATE)}` };
      if (moved.text.startsWith("9/2/26")) return { ...moved, text: "10/3/26, 9:12 AM" };
      return moved;
    });
    // The totals and balances, by the label left of them.
    const at = (y, x) => out.find((i) => Math.abs(i.y - y) < 1 && Math.abs(i.x - x) < 2);
    const replace = (y, x, text) => { const cell = at(y, x); if (!cell) throw new Error(`Americo: no cell at ${x},${y}`); Object.assign(cell, rightAlign(cell, text)); };
    const totalY = 305 - shift;
    replace(totalY, 465, grouped(base)); replace(totalY, 680, grouped(total));
    replace(221 - shift, 360, grouped(total)); replace(221 - shift, 550, "0.00"); replace(221 - shift, 574, grouped(total)); replace(221 - shift, 608, grouped(total));
    replace(193 - shift, 360, grouped(total + 1_857_194 - 23_484));
    policies.forEach((p, k) => {
      const y = rowY - k * step;
      const text = { 30: p.number, 100: p.last.toUpperCase(), 170: String(age(p.dob, p.effective)), 210: mmddyy(p.effective), 255: "ES4130", 295: mmddyy("2026-10-01"), 335: "0930", 370: "PAID 1", 410: "01 UTR 12",
        465: plain(p.annualCents), 520: "AE-NA", 560: `.${String(p.rateBp * 10).padStart(5, "0")}`, 600: "100", 680: plain(p.paidCents) };
      for (const cell of row) {
        const key = Math.round(cell.x);
        if (!(key in text)) continue;
        out.push(key >= 465 && key !== 520 ? { ...rightAlign(cell, text[key]), y } : { ...cell, text: text[key], y });
      }
      agentRow.forEach((cell, j) => out.push({ ...cell, y: y - 12, text: j === 0 ? "MML13W" : "ELLEN LARSON" }));
    });
    return out;
  });
  return { bytes, total };
}

async function corebridgeStatement(policies) {
  const total = policies.reduce((t, p) => t + p.paidCents, 0);
  const paren = (c) => (c < 0 ? `(${grouped(c)})` : grouped(c));
  const bytes = await redraw("../../balanced/Corebridge/Commissions/view_statements.pdf", { f1: "Helvetica", f2: "CourierBold", f3: "Courier" }, (n, items, { rightAlign }) => {
    const asOf = (i) => (i.text === "AUGUST" ? { ...i, text: "OCTOBER" } : i.text === "21, 2026" ? { ...i, text: "2, 2026" } : i.text === "08-15-2026" ? { ...i, text: "09-26-2026" } : i.text === "08-21-2026" ? { ...i, text: "10-02-2026" } : i);
    if (n === 1) {
      return items.map(asOf).map((i) => {
        const y = Math.round(i.y), x = Math.round(i.x);
        if (y === 495 && x === 136) return rightAlign(i, "0.00");
        if (y === 495 && (x === 294 || x === 486)) return rightAlign(i, paren(total));
        if (y === 435 && (x === 102 || x === 390)) return rightAlign(i, paren(total));
        if (y === 435 && x === 164) return rightAlign(i, `$${grouped(total + 404_412)}`);
        if (y === 387 && x === 136) return rightAlign(i, "0.00");
        if (y === 387 && x === 227) return rightAlign(i, `$${grouped(total)}`);
        if (y === 387 && x === 323) return rightAlign(i, "0.00");
        if (y === 387 && x === 419) return rightAlign(i, paren(total));
        return i;
      });
    }
    const rowY = 483, step = 11;
    const template = items.filter((i) => Math.round(i.y) === 472); // HERNANDEZ: an AE line with every column filled
    const detailYs = [...new Set(items.filter((i) => /^7269\d{6}$/.test(i.text)).map((i) => Math.round(i.y)))];
    const lowest = Math.min(...detailYs);
    // "TRANSACTION" and "DETAIL -" are drawn as one piece, so the layout's start label is read as written.
    const kept = items.filter((i) => !detailYs.includes(Math.round(i.y)) && i.text !== "DETAIL -").map(asOf).map((i) => (i.text === "TRANSACTION" ? { ...i, text: "TRANSACTION DETAIL -" } : i));
    const shift = step * (policies.length - detailYs.length);
    const out = kept.map((i) => (i.y < lowest - 1 && i.y > 60 ? { ...i, y: i.y - shift } : i));
    const totalCell = out.find((i) => i.text.startsWith("(1,758.38)"));
    Object.assign(totalCell, { text: paren(total) });
    policies.forEach((p, k) => {
      const y = rowY - k * step;
      for (const cell of template) {
        const x = Math.round(cell.x);
        const value = { 51: p.number, 101: p.last.toUpperCase(), 156: usShort(p.effective), 232: "GENERICATTAD", 316: plain(p.monthlyCents), 362: plain(p.monthlyCents), 437: plain(p.annualCents),
          500: `${p.rateBp / 100}%`, 563: plain(p.paidCents), 635: plain(p.paidCents) }[x];
        if (value === undefined) { out.push({ ...cell, y }); continue; }
        out.push(x >= 316 && x !== 500 ? { ...rightAlign(cell, value), y } : { ...cell, text: value, y });
      }
    });
    return out;
  });
  return { bytes, total };
}

// â”€â”€ write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const FILES = {
  aetna: ["1-Aetna-CVS-policySummary.xlsx", "1-Aetna-CVS-Commission-Detail.xlsx"],
  aflac: ["2-Aflac-policySummary.xlsx", "2-Aflac-Commission-Detail.xlsx"],
  american_home_life: ["3-American-Home-Life-policySummary.xlsx", "3-American-Home-Life-Commission-Detail.xlsx"],
  american_amicable: ["4-American-Amicable-Policies.csv", "4-American-Amicable-Advances_0003559471_02Oct26.csv"],
  americo: ["5-Americo-policies-2026-10-01.xlsx", "5-Americo-Commissions-Statements-Agent-Portal.pdf"],
  corebridge: ["6-Corebridge-PolicySummary_10012026.xlsx", "6-Corebridge-view_statements.pdf"],
  mutual_of_omaha: ["7-Mutual-of-Omaha-7376635-policies.csv", "7-Mutual-of-Omaha-ebssr-statement.xlsx"],
  sentinel_security_life: ["8-Sentinel-Security-Life-PolicyList.xls", "8-Sentinel-Security-Life-Statement.pdf"],
};

async function build() {
  mkdirSync(new URL("policies/", OUT), { recursive: true });
  mkdirSync(new URL("commissions/", OUT), { recursive: true });
  const all = book();
  const of = (c) => all.filter((p) => p.carrier === c);
  const totals = {};
  for (const c of ["aetna", "aflac", "american_home_life"]) {
    write(`policies/${FILES[c][0]}`, await policySummary46(c, of(c)));
    const s = await commissionDetail(c, of(c));
    write(`commissions/${FILES[c][1]}`, s.bytes); totals[c] = s.total;
  }
  write(`policies/${FILES.american_amicable[0]}`, amamPolicies(of("american_amicable")));
  { const s = amamStatement(of("american_amicable")); write(`commissions/${FILES.american_amicable[1]}`, s.text); totals.american_amicable = s.total; }
  write(`policies/${FILES.americo[0]}`, await americoPolicies(of("americo")));
  { const s = await americoStatement(of("americo")); write(`commissions/${FILES.americo[1]}`, s.bytes); totals.americo = s.total; }
  write(`policies/${FILES.corebridge[0]}`, await corebridgePolicies(of("corebridge")));
  { const s = await corebridgeStatement(of("corebridge")); write(`commissions/${FILES.corebridge[1]}`, s.bytes); totals.corebridge = s.total; }
  write(`policies/${FILES.mutual_of_omaha[0]}`, mooPolicies(of("mutual_of_omaha")));
  { const s = await mooStatement(of("mutual_of_omaha")); write(`commissions/${FILES.mutual_of_omaha[1]}`, s.bytes); totals.mutual_of_omaha = s.total; }
  write(`policies/${FILES.sentinel_security_life[0]}`, sslPolicies(of("sentinel_security_life")));
  copyFileSync(new URL("SSL/Commissions/Statement_69148518058182096.pdf", SAMPLES), new URL(`commissions/${FILES.sentinel_security_life[1]}`, OUT));
  totals.sentinel_security_life = -4625;
  console.log("statement totals:", Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, (v / 100).toFixed(2)])));
  console.log("net:", (Object.values(totals).reduce((a, b) => a + b, 0) / 100).toFixed(2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await build();
