
import { readFileSync } from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const required = [
  "../public/index.html",
  "../public/admin.html",
  "../public/privacy.html",
  "../public/terms.html",
  "../public/assets/js/app.js",
  "../public/assets/js/admin.js",
  "server.js",
  "../firebase/database.rules.json"
];
for (const rel of required) {
  const p = path.join(here, rel);
  const s = readFileSync(p,"utf8");
  if (!s.trim()) throw new Error(`Empty file: ${rel}`);
}
console.log("Smoke check passed.");
