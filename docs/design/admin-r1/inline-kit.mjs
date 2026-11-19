// Inlines the Settings r8 kit (../settings-r8/kit.css + kit.js) into every board in this folder, so a board opens
// correctly as a single file (the file pane and file:// previews do not load relative assets). Re-runnable.
// Usage: node docs/design/admin-r1/inline-kit.mjs
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kit = join(here, "..", "settings-r8");
const css = readFileSync(join(kit, "kit.css"), "utf8");
const js = readFileSync(join(kit, "kit.js"), "utf8");
const CSS_BLOCK = `<!--kit-css-->\n<style>\n${css}\n</style>\n<!--/kit-css-->`;
const JS_BLOCK = `<!--kit-js-->\n<script>\n${js}\n</script>\n<!--/kit-js-->`;

for (const name of readdirSync(here).filter((file) => file.endsWith(".html") && !file.startsWith("_"))) {
  const path = join(here, name);
  let html = readFileSync(path, "utf8");
  html = html.replace(/<!--kit-css-->[\s\S]*?<!--\/kit-css-->|<link rel="stylesheet" href="kit\.css">/, () => CSS_BLOCK);
  html = html.replace(/<!--kit-js-->[\s\S]*?<!--\/kit-js-->|<script src="kit\.js"><\/script>/, () => JS_BLOCK);
  writeFileSync(path, html);
  console.log("inlined", name);
}
