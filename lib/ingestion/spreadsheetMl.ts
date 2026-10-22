/**
 * Excel 2003 XML ("SpreadsheetML") workbooks: the .xls some carrier portals still export (SSL's
 * PolicyList.xls is one). It is plain XML, so it is read here without a library: each worksheet's
 * rows, with each cell at its column — a cell may skip ahead with ss:Index, and an empty cell is
 * often simply left out, so a row's cells are placed by index, never by order alone.
 *
 * A DateTime cell ("2026-06-29T00:00:00.000") is given as its date, "2026-06-29"; a number as the
 * text the file holds. Padding the carrier added ("    ") is kept: the layout map decides.
 *
 * Pure; relative imports only.
 */

export type SpreadsheetMlSheet = { name: string; rows: string[][] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text
    .replace(/<[^>]+>/g, "") // rich text (<Font>, <B>) inside a cell's data
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === "#") {
        const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[entity.toLowerCase()] ?? whole;
    });
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`(?:ss:)?${name}="([^"]*)"`, "i").exec(tag);
  return match ? decode(match[1]) : null;
}

/** Every worksheet of a SpreadsheetML workbook, in order. Throws when the text is not one. */
export function readSpreadsheetMl(xml: string): SpreadsheetMlSheet[] {
  if (!/<Workbook[\s>]/.test(xml)) throw new Error("Not an Excel 2003 XML workbook.");
  const sheets: SpreadsheetMlSheet[] = [];
  for (const sheet of xml.matchAll(/<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/g)) {
    const name = attribute(sheet[1], "Name") ?? `Sheet${sheets.length + 1}`;
    const rows: string[][] = [];
    for (const row of sheet[2].matchAll(/<(?:ss:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/g)) {
      const rowIndex = attribute(row[1], "Index");
      // A row may skip ahead too: the rows it skips are empty.
      if (rowIndex) while (rows.length < Number(rowIndex) - 1) rows.push([]);
      const cells: string[] = [];
      let column = 0;
      for (const cell of (row[2] ?? "").matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g)) {
        const index = attribute(cell[1], "Index");
        if (index) column = Number(index) - 1;
        const data = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/.exec(cell[2] ?? "");
        let value = data ? decode(data[2]) : "";
        if (data && /Type="DateTime"/i.test(data[1])) value = value.slice(0, 10);
        while (cells.length < column) cells.push("");
        cells[column] = value;
        column += 1 + Number(attribute(cell[1], "MergeAcross") ?? 0);
      }
      rows.push(cells);
    }
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error("The workbook has no worksheet.");
  return sheets;
}
