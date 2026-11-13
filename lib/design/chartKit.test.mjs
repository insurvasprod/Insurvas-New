// The chart kit (components/ui/chart.tsx, UI-CONSISTENCY §5b) after the Reports round 7 foundation (2026-11-11):
// BarList, BarSeries negatives/pairs/links, LineSeries up to four lines with a linked key, ShareBar links, the load
// motion every chart plays once, and StatTile's sparkline. Source-text contracts plus the pure scale helpers.
// Run with: node --experimental-strip-types --test lib/design/chartKit.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { barListScale, chartTop, signedScale } from "../chart/scale.ts";

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const chart = read("components/ui/chart.tsx");
const stat = read("components/ui/stat.tsx");
const css = read("app/globals.css");

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** The body of one exported function: from its signature to the next top-level export. */
function body(name) {
  const at = chart.indexOf(`export function ${name}(`);
  assert.ok(at >= 0, `${name} is exported from the kit`);
  const next = chart.indexOf("\nexport ", at + 10);
  return chart.slice(at, next < 0 ? undefined : next);
}

test("the kit stays one server-safe file", () => {
  assert.doesNotMatch(chart, /^["']use client["']/m, "server pages draw charts");
  for (const name of ["BarSeries", "BarList", "ChartLegend", "ShareBar", "Sparkline", "ChartHeading", "DonutChart", "LineSeries", "SparkLine"]) body(name);
  assert.doesNotMatch(chart, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, "colours come from tokens");
});

test("BarList: two layers, segments, a whisker, a tone a row, a link a row, ranked or categorical", () => {
  const list = body("BarList");
  for (const field of ["label: string", "value: number", "inner?: number", "segments?: readonly BarListSegment[]", "interval?: readonly [number, number]", "figure?: ReactNode", "caption?: ReactNode", "chip?: ReactNode", "tone?: ChartTone", "href?: string"]) {
    assert.ok(chart.includes(`  ${field};`), `BarListRow has ${field}`);
  }
  assert.match(list, /color\?: "rank" \| "categorical"/);
  assert.match(list, /row\.tone \?\? \(row\.value < 0 \? "warning" : color === "categorical"/, "a negative row takes the warning tone");
  assert.match(list, /row\.href\s*\? <Link key=\{row\.key\} href=\{row\.href\}/, "the whole row is the link");
  assert.match(list, /grid-cols-subgrid/, "every bar starts and every figure ends on one line");
  assert.match(list, /m-chart-x/, "bars grow from the left on load");
  assert.match(list, /stagger\(index\)/, "rows arrive one after another");
  assert.match(list, /<ChartFigures/, "the figures are in text behind the picture");
});

test("BarSeries: negatives below a zero line, a pair, links, a key — and the old chart unchanged without them", () => {
  const bars = body("BarSeries");
  for (const field of ["pair?: number", "below?: number"]) assert.ok(chart.includes(`  ${field};`), `ChartBar has ${field}`);
  assert.match(bars, /hrefFor\?: \(bar: ChartBar\) => string \| null/);
  assert.match(bars, /belowTone = "warning"/, "a loss is the warning tone by default");
  assert.match(bars, /const signed = bars\.some\(\(bar\) => downOf\(bar\) > 0\)/, "the signed layout only when something goes below zero");
  assert.match(bars, /: ticks\(top\)\.map\(\(value, index\) => \(\{ value, at: index \/ 2 \}\)\)/, "otherwise the same three gridlines");
  assert.match(bars, /m-chart-y-down/, "a bar below the line grows down");
  assert.match(bars, /m-chart-y m-chart-tween flex flex-col justify-end overflow-hidden rounded-t-\[4px\] rounded-b-\[2px\]/, "the column every caller already draws");
  assert.doesNotMatch(bars, /m-bar-rise/, "the kit's own load motion, not the dashboard's");
});

test("LineSeries: up to four lines, a key whose rows are links, lines that draw in", () => {
  const line = body("LineSeries");
  assert.match(line, /lines\?: readonly LineSeriesLine\[\]/);
  assert.match(line, /\(lines \?\? \[\]\)\.slice\(0, compare \? 2 : 3\)/, "four lines in all, counting the main line and compare");
  assert.match(line, /legend\?: \{ label: string; figure\?: string; href\?: string \}/);
  assert.match(line, /<ChartLegend items=\{key\}/);
  // Stretched (preserveAspectRatio none, non-scaling stroke), a dash offset is measured on screen and stops short.
  assert.match(line, /className="m-chart-reveal m-chart-tween size-full overflow-visible"/, "the drawing reveals left to right");
  assert.doesNotMatch(line, /pathLength/, "no dash-offset draw on a stretched line");
  assert.doesNotMatch(line, /m-reveal-x/, "the kit's 600ms reveal, not the 900ms one");
  assert.match(body("ChartLegend"), /item\.href\s*\? <Link href=\{item\.href\}/, "a key row is a link");
});

test("ShareBar's href links, from the legend and from the bar", () => {
  const share = body("ShareBar");
  assert.match(share, /segment\.href\s*\? <Link key=\{segment\.key\} href=\{segment\.href\} tabIndex=\{-1\}/);
  assert.match(share, /<Link href=\{segment\.href\} className="-mx-1\.5 flex/);
  assert.match(share, /m-chart-x flex h-3/, "the share widens on load");
});

test("no new donuts: DonutChart stays for the screens that have it and Book scorecards (owner 2026-11-11)", () => {
  const ALLOWED = new Set([
    "components/ui/chart.tsx",
    "components/app/home/views/agency-cards.tsx",
    "components/app/home/views/book-view.tsx",
    "components/app/home/views/leads-view.tsx",
    "components/partner/partner-portal-overview.tsx",
    "components/partner/partner-team-review-workspace.tsx",
  ]);
  const found = [...walk("components"), ...walk("app")].filter((file) => /\bDonutChart\b/.test(read(file)) && !ALLOWED.has(file) && !/book-scorecard/.test(file));
  assert.deepEqual(found, [], "draw bars (BarList), a line or stacked bars instead of a donut");
});

test("the load motion: defined once, short, staggered, and still under reduced motion", () => {
  assert.match(css, /--t-chart: 600ms;/, "500–700ms, the owner's \"short\"");
  for (const name of ["m-chart-x", "m-chart-y", "m-chart-y-down", "m-chart-reveal", "m-chart-line", "m-chart-fade", "m-chart-dot"]) {
    assert.equal([...css.matchAll(new RegExp(`^\\.${name} \\{`, "gm"))].length, 1, `.${name} is defined once`);
  }
  assert.match(css, /\.m-chart-x \{[^}]*var\(--e-out\) backwards; animation-delay: calc\(var\(--m-i, 0\) \* 30ms\); \}/, "ease-out, 30ms a row");
  assert.match(css, /\.m-chart-line \{ stroke-dasharray: 1; animation: m-draw /, "lines draw by their dash offset");
  assert.match(css, /\.m-chart-reveal \{ animation: m-reveal-x var\(--t-chart\) var\(--e-out\) backwards; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.m-chart-x, \.m-chart-y, \.m-chart-y-down, \.m-chart-reveal, \.m-chart-line, \.m-chart-fade, \.m-chart-dot \{ animation: none; \}/);
  assert.match(chart, /Math\.min\(Math\.max\(index, 0\), 12\)/, "the stagger is capped, so a long chart is whole within a second");
});

test("StatTile's trend draws in like the charts, beside the figure or under it", () => {
  assert.match(stat, /trend\?: \{ points: number\[\]; tone\?: MeterTone; placement\?: "beside" \| "under" \}/);
  assert.match(stat, /<path className="m-chart-line" pathLength=\{1\} d=\{d\}/);
  assert.match(stat, /tone === "primary"\s*\? "var\(--primary\)"/, "the brand line the 0·C cards draw");
  assert.match(stat, /trend\.placement === "under" && trend\.points\.length > 1/);
  assert.match(stat, /className="m-chart-reveal block overflow-visible"/, "stretched under the figure, it reveals by a clip");
});

test("the scale helpers: a zero line where it falls, and a list scaled to its longest row", () => {
  const plain = signedScale([12, 30, 8], [0, 0, 0]);
  assert.equal(plain.top, chartTop(30));
  assert.equal(plain.bottom, 0);
  assert.equal(plain.zero, 1, "nothing below: the zero line is the baseline");
  assert.deepEqual(plain.ticks.map((tick) => tick.at), [0, 0.5, 1]);

  const net = signedScale([400, 900], [120, 0]);
  assert.equal(net.top, chartTop(900));
  assert.equal(net.bottom, chartTop(120));
  assert.ok(net.zero > 0.5 && net.zero < 1, "the line sits low when the losses are small");
  assert.deepEqual(net.ticks.map((tick) => tick.value), [chartTop(900), 0, -net.bottom]);
  assert.deepEqual(net.ticks.map((tick) => tick.at), [0, net.zero, 1]);

  const losses = signedScale([0, 0], [50, 20]);
  assert.equal(losses.top, 0);
  assert.equal(losses.zero, 0, "all losses: the zero line is at the top");

  assert.equal(barListScale([{ value: 4 }, { value: 9, inner: 3 }, { value: -12 }]), 12, "a negative row is measured by its size");
  assert.equal(barListScale([{ value: 2, segments: [{ value: 5 }, { value: 6 }] }]), 11, "segments add up");
  assert.equal(barListScale([{ value: 3, interval: [1, 7] }]), 7, "the whisker fits");
  assert.equal(barListScale([{ value: 3 }], 50), 50, "a shared scale wins");
  assert.equal(barListScale([{ value: 0 }]), 1, "an all-zero list never divides by zero");
});
