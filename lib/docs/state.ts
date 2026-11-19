import "server-only";

import { cache } from "react";

import { DOC_MODULES, type DocModule } from "./modules.ts";
import { loadTaskFacts } from "./taskFacts.ts";
import { DOC_TASKS, type DocTask } from "./tasks.ts";
import { loadDocsViewer } from "./viewer.ts";
import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";

export type TaskState = {
  task: DocTask;
  /** Done in your agency: true / false, or null for a look-up with nothing to finish (not counted). */
  done: boolean | null;
  /** A setup step this plan doesn't include. */
  offPlan: boolean;
};

export type ModuleState = { module: DocModule; tasks: TaskState[]; done: number; total: number };

/**
 * Everything Docs R6 knows about the reader's agency, once per request: the setup checklist (via loadDocsViewer)
 * and the task facts, folded into each task's done state and each module's count. A setup task off this plan is
 * left out of its module, the way Get set up leaves it out.
 */
export const loadDocsState = cache(async () => {
  // Agency-wide facts (a payout run paid, a statement uploaded) are the owner's alone, like Get set up's tenant facts:
  // anyone else sees only their own setup steps ticked. Read beside the viewer, not after it (one round trip, not
  // two): the context is the shell's own request-cached read, so knowing the owner costs nothing.
  const context = await resolveTenantContext();
  const [viewer, facts] = await Promise.all([
    loadDocsViewer(),
    context?.role === "owner" ? loadTaskFacts(context.tenantId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
  ]);
  const state = (task: DocTask): TaskState => {
    if (task.setupStep) {
      const step = viewer.steps.get(task.setupStep);
      return { task, done: step ? step.complete : false, offPlan: !step };
    }
    return { task, done: task.done ? facts.has(task.done) : null, offPlan: false };
  };
  const tasks = new Map(DOC_TASKS.map((task) => [task.slug, state(task)]));
  const modules: ModuleState[] = DOC_MODULES.map((module) => {
    const list = DOC_TASKS.filter((task) => task.module === module.key).map((task) => tasks.get(task.slug)!).filter((item) => !item.offPlan);
    const counted = list.filter((item) => item.done !== null);
    return { module, tasks: list, done: counted.filter((item) => item.done).length, total: counted.length };
  });
  /** The first task not done, in map order (a lead becoming money), whose needs are all done. */
  const order = ["agency", "partners", "leads", "today", "sales", "book", "commissions", "accounting", "retention", "compliance", "carrier-sync", "reports", "home"];
  const ready = (item: TaskState) => (item.task.needs ?? []).every((slug) => tasks.get(slug)?.done !== false || tasks.get(slug)?.offPlan);
  const next = order
    .flatMap((key) => modules.find((entry) => entry.module.key === key)?.tasks ?? [])
    .find((item) => item.done === false && ready(item)) ?? null;
  // A Settings page is done once the Get set up step(s) it holds are done (owner 2026-11-17: "a circle… if he has
  // done that or not"). Pages with no such step are ticked in the browser once read in Docs (DocsMenu).
  const settingsDone = Object.entries(SETTINGS_SETUP_STEPS)
    .filter(([, keys]) => keys.some((key) => viewer.steps.has(key)) && keys.every((key) => !viewer.steps.has(key) || viewer.steps.get(key)!.complete))
    .map(([slug]) => slug);
  const settingsTracked = Object.entries(SETTINGS_SETUP_STEPS).filter(([, keys]) => keys.some((key) => viewer.steps.has(key))).map(([slug]) => slug);
  return { viewer, tasks, modules, next, settingsDone, settingsTracked };
});

/** The Get set up steps each Settings page holds (by its Docs slug). */
const SETTINGS_SETUP_STEPS: Record<string, string[]> = {
  "business-identity": ["phone"],
  "team-access": ["team", "hierarchy"],
  products: ["products"],
  carriers: ["carriers", "states"],
  "sales-process": ["disclosures"],
  "calling-windows": ["calling-windows"],
  "inbound-settings": ["queue-sla"],
  "pipelines-outcomes": ["outcomes"],
  accounting: ["accounting"],
  retention: ["retention"],
  compliance: ["compliance"],
};

/** The menu's view of the modules: titles, counts and each task's done state. */
export function menuModules(modules: ModuleState[]) {
  return modules
    .filter((entry) => entry.tasks.length > 0)
    .map((entry) => ({
      key: entry.module.key,
      title: entry.module.title,
      done: entry.done,
      total: entry.total,
      tasks: entry.tasks.map((item) => ({ slug: item.task.slug, title: item.task.title, done: item.done })),
    }));
}
