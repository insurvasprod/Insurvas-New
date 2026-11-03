// Run with: npm test
//
// The Lead workspace shows ONE pipeline at a time (2026-10-05, replacing the "All pipelines" view).
//
// Every pipeline carries its own stage vocabulary — on the demo tenant the pipelines have 12, 0, 2, 7
// and 5 stages — so there is no honest single set of columns across them. The All view used to stack
// one board per pipeline down a long scroll; the user asked for one page per pipeline, picked from
// tabs in the bar above the list. These guard the parts of that which regress silently.
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

test("there is no All view: no sentinel, no combined option, no stacked boards", () => {
  assert.doesNotMatch(source, /const ALL = "all"/, "the All sentinel is back");
  assert.doesNotMatch(source, /All pipelines/, "an All pipelines option is back");
  assert.doesNotMatch(source, /\bisAll\b/, "code branches on an All view again");
});

test("each pipeline is a tab that says it is chosen and switches the page", () => {
  // Foundation v3: the shared UnderlineTabs draws role="tab" and aria-selected for every tab.
  const tabs = block('<UnderlineTabs label="Pipeline"', "/>");
  assert.match(tabs, /tabs=\{pipelines\.map\(\(item\) => \(\{ key: item\.id, label: item\.name, count: countFor\(item\.id\) \}\)\)\}/, "a tab no longer carries its pipeline and lead count");
  assert.match(tabs, /value=\{activePipeline\?\.id \?\? ""\}/, "the chosen pipeline is not the selected tab");
  assert.match(tabs, /onChange=\{selectPipeline\}/, "a tab no longer switches the pipeline");
  const kit = readFileSync(join(process.cwd(), "components/ui/view-tabs.tsx"), "utf8");
  assert.match(kit.slice(kit.indexOf("export function UnderlineTabs")), /role="tab"\s+aria-selected=\{selected\}/, "the shared tabs no longer announce the chosen one");
});

test("the page always resolves to one real pipeline, and shows only its leads", () => {
  assert.match(
    source,
    /const activePipeline = useMemo\(\(\) => pipelines\.find\(\(item\) => item\.id === pipelineId\) \?\? /,
    "the active pipeline no longer resolves from the chosen tab",
  );
  assert.match(source, /lead\.pipeline_id === activePipeline\.id/, "leads of other pipelines can reach the page");
  assert.match(source, /<PipelineBoard stages=\{allStages\} leads=\{visibleLeads\}/, "the board is not drawn from the chosen pipeline's stages");
});

test("the table resolves a lead's stage across every pipeline", () => {
  // The table lives in components/app/pipeline-views.tsx (TableView); the workspace hands it the
  // stage lookup, which goes through the cross-pipeline index so an archived stage keeps its name.
  const body = block("<TableView", "/>");
  assert.ok(body.includes("stageIndex.get(stageId)"), "the table no longer resolves stages through the stage index");
});
