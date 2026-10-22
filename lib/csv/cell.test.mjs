// Run with: npm test
//
// The one CSV cell every export uses: quoting, and the guard against spreadsheet formula injection.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { csvCell, csvCellMinimal, csvUnguard } from "./cell.ts";

test("text starting with a formula character gets a leading apostrophe", () => {
  for (const start of ["=", "+", "-", "@", "\t", "\r"]) {
    assert.match(csvCellMinimal(`${start}1+1`), /^"?'/, JSON.stringify(start));
    assert.match(csvCell(`${start}1+1`), /^"'/, JSON.stringify(start));
  }
  assert.equal(csvCell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
  assert.equal(csvCellMinimal("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCellMinimal("-5"), "'-5");
  assert.equal(csvCell("+15551234567"), `"'+15551234567"`);
  assert.equal(csvCellMinimal("@cmd"), "'@cmd");
  // A tab or CR as the first character: guarded, and the CR forces quotes.
  assert.equal(csvCellMinimal("\tx"), "'\tx");
  assert.equal(csvCellMinimal("\rx"), `"'\rx"`);
});

test("numbers are never guarded", () => {
  assert.equal(csvCellMinimal(-12.5), "-12.5");
  assert.equal(csvCell(-12.5), `"-12.5"`);
  assert.equal(csvCellMinimal(0), "0");
});

test("ordinary text is unchanged apart from quoting", () => {
  assert.equal(csvCellMinimal("Alex Morgan"), "Alex Morgan");
  assert.equal(csvCell("Alex Morgan"), `"Alex Morgan"`);
  assert.equal(csvCellMinimal("a=b"), "a=b");
  assert.equal(csvCellMinimal("O'Brien"), "O'Brien");
  assert.equal(csvCellMinimal("Smith, Jo"), `"Smith, Jo"`);
  assert.equal(csvCellMinimal('say "hi"'), `"say ""hi"""`);
  assert.equal(csvCellMinimal("two\nlines"), `"two\nlines"`);
  assert.equal(csvCellMinimal("cr\rinside"), `"cr\rinside"`);
});

test("empty values are empty cells", () => {
  assert.equal(csvCellMinimal(null), "");
  assert.equal(csvCellMinimal(undefined), "");
  assert.equal(csvCell(""), `""`);
  assert.equal(csvCell(null), `""`);
  assert.equal(csvCellMinimal(true), "true");
});

test("the importer's half takes back exactly what the guard added", () => {
  for (const text of ["=SUM(A1)", "-5", "+1555", "@x", "\tx", "plain", "'quoted", "", "'"]) {
    const exported = csvCellMinimal(text);
    const unquoted = exported.startsWith('"') ? exported.slice(1, -1).replaceAll('""', '"') : exported;
    assert.equal(csvUnguard(unquoted), text, JSON.stringify(text));
  }
  assert.equal(csvUnguard("'hello"), "'hello");
});

// Every export goes through csvCell: no file builds its own escaper again.
test("no CSV builder keeps a private escaper", () => {
  const root = join(import.meta.dirname, "..", "..");
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(path); continue; }
      if (!/\.(ts|tsx)$/.test(name) || path.endsWith(join("csv", "cell.ts"))) continue;
      const source = readFileSync(path, "utf8");
      if (/replaceAll\('"', '""'\)|replace\(\/"\/g, '""'\)/.test(source) && /\.join\(","\)/.test(source)) offenders.push(path.slice(root.length + 1));
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(join(root, dir));
  // The xlsx reader turns an uploaded workbook into CSV text for the importer: it is input, so it
  // must not gain an apostrophe.
  assert.deepEqual(offenders.filter((path) => !path.replaceAll("\\", "/").endsWith("lib/agentTemplates/xlsx.ts")), []);
});
