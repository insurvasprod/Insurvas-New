// Builds docs/la4/bucket-samples/balanced/Corebridge/Commissions/view_statements.pdf: the synthetic
// Corebridge weekly statement with the line it was missing, so that it balances.
//
// The original (09-01-2026/Sample Agency/Corebridge/Commissions/view_statements.pdf, from the
// synthetic sample zip) states TOTAL ADVANCES PAID (1,758.38), which is also its period activity
// (opening (11.03) + activity (1,758.38) = closing (1,769.41)), but its seven detail lines add up
// to (1,511.08). The $247.30 between them is one advance recovered: here it is, on 7269717292
// (BAIRD, surrendered in the Corebridge sample policy file). Everything else is the original, word
// for word at the same place, in the same font; the total line and the legend move down one row.
//
//   node scripts/la4-corebridge-balanced-sample.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts } = require("pdf-lib");
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

const SOURCE = new URL("../docs/la4/bucket-samples/09-01-2026/Sample Agency/Corebridge/Commissions/view_statements.pdf", import.meta.url);
const TARGET = new URL("../docs/la4/bucket-samples/balanced/Corebridge/Commissions/", import.meta.url);
// The missing line, in the columns of the line above it (an AD line, as GRAY's and VALENCIA's).
const ADDED = { POLICY: "7269717292", INSURED: "BAIRD", "EFF DATE": "03/01/26", "COMM TYPE": "GENERICATTAD", ACTIVITY: "-247.30" };
const AD_LIKE = "7269648758"; // VALENCIA: an AD line with no premium; the added line copies its shape.

const source = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(SOURCE)), useSystemFonts: false, disableFontFace: true }).promise;
const out = await PDFDocument.create();
out.setTitle("view_statements");
const fonts = { f1: await out.embedFont(StandardFonts.Helvetica), f2: await out.embedFont(StandardFonts.CourierBold), f3: await out.embedFont(StandardFonts.Courier) };
const fontOf = (name) => fonts[name.split("_").at(-1)] ?? fonts.f3;

for (let number = 1; number <= source.numPages; number++) {
  const page = await source.getPage(number);
  const { width, height } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter((item) => item.str.trim() !== "").map((item) => ({ x: item.transform[4], y: item.transform[5], size: item.transform[0], font: item.fontName, text: item.str }));
  const target = out.addPage([width, height]);
  if (number === 2) {
    const rowY = (policy) => items.find((item) => item.text === policy).y;
    const detailYs = [...new Set(items.filter((item) => /^7269\d{6}$/.test(item.text)).map((item) => item.y))].sort((a, b) => b - a);
    const step = detailYs[0] - detailYs[1];
    const last = detailYs.at(-1);
    const headerY = items.find((item) => item.text === "POLICY").y;
    const header = items.filter((item) => Math.abs(item.y - headerY) < 1); // the column names
    const template = items.filter((item) => Math.abs(item.y - rowY(AD_LIKE)) < 1);
    const columnAt = (x) => header.filter((h) => h.x <= x + 6).at(-1)?.text;
    // Everything under the last detail line moves down one row (not the footer at the bottom).
    for (const item of items) if (item.y < last - 1 && item.y > 60) item.y -= step;
    for (const cell of template) {
      const column = columnAt(cell.x);
      const text = column === "POLICY" ? ADDED.POLICY : column === "INSURED" ? ADDED.INSURED : column === "EFF DATE" ? ADDED["EFF DATE"] : column === "COMM TYPE" ? ADDED["COMM TYPE"] : cell.x > 615 ? ADDED.ACTIVITY : cell.text;
      // A right-aligned amount keeps its right edge.
      const x = cell.x > 615 ? cell.x + fontOf(cell.font).widthOfTextAtSize(cell.text, cell.size) - fontOf(cell.font).widthOfTextAtSize(text, cell.size) : cell.x;
      items.push({ ...cell, x, y: last - step, text });
    }
  }
  for (const item of items) target.drawText(item.text, { x: item.x, y: item.y, size: item.size, font: fontOf(item.font) });
}

mkdirSync(TARGET, { recursive: true });
writeFileSync(new URL("view_statements.pdf", TARGET), await out.save({ useObjectStreams: false }));
console.log("wrote docs/la4/bucket-samples/balanced/Corebridge/Commissions/view_statements.pdf");
