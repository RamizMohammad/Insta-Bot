// Regenerates the Material Symbols <link> in index.html with only the icons the app uses.
// Google Fonts serves a subset font for `icon_names`, cutting ~3.4 MB to a few KB.
//   node scripts/icons.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const valid = new Set([...readFileSync(join(root, "node_modules/material-symbols/index.d.ts"), "utf8").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });
}

// Any known icon name used as a string, plus every literal on lines that mention icons
// (catches aliases such as "expand_more" that the package's canonical list omits).
const used = new Set();
const literal = /["'`]([a-z][a-z0-9_]{1,40})["'`]/g;
for (const file of walk(join(root, "src"))) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const iconLine = /\b(icon|Icon|name=)/.test(line);
    for (const m of line.matchAll(literal)) {
      if (valid.has(m[1]) || (iconLine && m[1].includes("_"))) used.add(m[1]);
    }
  }
}
const names = [...used].sort();
const href = `https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0..1,0&icon_names=${names.join(",")}&display=block`;
const indexPath = join(root, "index.html");
const html = readFileSync(indexPath, "utf8").replace(
  /<link data-icons[^>]*>/,
  `<link data-icons rel="stylesheet" href="${href}" />`,
);
writeFileSync(indexPath, html);
console.log(`${names.length} icons -> index.html`);
