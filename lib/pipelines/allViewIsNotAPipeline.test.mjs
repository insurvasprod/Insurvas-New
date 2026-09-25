// Run with: npm test
//
// The Lead workspace gained an "All" tab that combines every pipeline's leads.
//
// The thing that makes this easy to get wrong is that **All is a view, not a pipeline**. Every
// pipeline carries its own stage vocabulary — on the demo tenant the five pipelines have 12, 0, 2,
// 7 and 5 stages — so there is no honest single set of columns across them, and no single stage
// list to resolve a lead's stage against.
//
// The two ways this regresses are both silent:
//
//   1. Something keeps resolving stages against the ACTIVE BOARD's stage list. In every
//      single-pipeline tab that list is correct, so the change looks fine; in All the list is empty,
//      so the KPI row reports 0 converted and 0 open, and every row in the table says "Open".
//      Nothing throws, nothing is blank — the numbers are just wrong.
//
//   2. Somebody makes All resolve to a real pipeline to simplify the downstream code. Then the
//      "combined" view quietly shows one pipeline's leads under a tab labelled All.
//
// Both are invisible to a reader and to a screenshot, so they are pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PATH = "components/app/lead-workspace.tsx";
const source = readFileSync(join(process.cwd(), PATH), "utf8");

function block(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${PATH} no longer contains ${startMarker} — this guard needs rewriting`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${PATH} no longer contains ${endMarker} after ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}

test("the All view is offered, reports itself as chosen, and carries the combined count", () => {
  // The redesign moved the pipeline tabs into one labelled menu (the board's control bar). A native
  // select announces which option is chosen, which is what the tab's aria-pressed used to do.
  assert.match(source, /const ALL = "all";/, "the All sentinel is gone");
  assert.match(
    source,
    /aria-label="Pipeline"[\s\S]{0,120}?value=\{isAll \? ALL :/,
    "the pipeline menu is missing, or no longer shows All as the chosen view",
  );
  assert.match(
    source,
    /<option value=\{ALL\}>All pipelines \(\{data\.leads\.length\}\)<\/option>/,
    "the All option no longer shows the combined lead count",
  );
  assert.match(source, /selectPipeline\(event\.target\.value\)/, "choosing from the menu no longer switches the board");
});

test("All resolves to no pipeline, so it cannot silently become one", () => {
  assert.match(
    source,
    /const activePipeline = useMemo\(\(\) => \(isAll \? undefined :/,
    "All now resolves to a pipeline — the combined view would show a single board's leads",
  );
});

test("the KPI row resolves stages across every pipeline, not against the active board", (t) => {
  // The redesign dropped the KPI row (the board has none). If one comes back, the rule still holds.
  if (!source.includes("const kpis = useMemo(")) { t.skip("no KPI row on the workspace"); return; }
  const kpis = block("const kpis = useMemo(", "}, [visibleLeads");
  assert.ok(
    kpis.includes("stageIndex"),
    "the KPIs no longer use the cross-pipeline stage index; in the All view they will report 0 converted and 0 open",
  );
  assert.ok(
    !kpis.includes("allStages"),
    "the KPIs read the active board's stages again; that list is empty in the All view",
  );
});

test("the table resolves a lead's stage across every pipeline", () => {
  // The table moved into components/app/pipeline-views.tsx (TableView); the workspace hands it the
  // stage lookup, and that lookup is what must go through the cross-pipeline index.
  const body = block("<TableView", "/>");
  assert.ok(
    body.includes("stageIndex.get(stageId)"),
    "the table no longer resolves stages through the cross-pipeline index",
  );
  assert.ok(
    !body.includes("allStages"),
    "the table reads the active board's stages again; every All-view row would fall back to \"Open\"",
  );
});

test("the All board stacks a real section per pipeline rather than inventing one column set", () => {
  // From the All branch to the single-pipeline board that follows it.
  const start = source.search(/\{view === "board" \? \(\s*isAll \? \(/);
  assert.notEqual(start, -1, `${PATH} no longer branches the board on isAll — this guard needs rewriting`);
  const end = source.indexOf("<PipelineBoard stages={allStages}", start);
  assert.notEqual(end, -1, `${PATH} no longer draws the single-pipeline board after the All branch`);
  const board = source.slice(start, end);
  assert.ok(
    board.includes("pipelines.filter(") && board.includes("stages={item.stages}"),
    "the All board no longer draws each pipeline with its own stages — there is no honest shared column set",
  );
  assert.ok(
    !board.includes("stages={allStages}"),
    "the All board is drawing one pipeline's columns for every pipeline's leads",
  );
});
