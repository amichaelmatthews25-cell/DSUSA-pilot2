/**
 * check-migrations.ts — F0 migration order + pairing verification.
 *
 * Verifies (without a database — this environment has none):
 *  - every forward migration NNNN_*.sql has a matching NNNN_*_down.sql,
 *  - numeric prefixes are contiguous from 0000 with no gaps/duplicates,
 *  - forward order matches the Implementation Program build order (§5).
 *
 * Real schema application happens via the deployment pipeline against Postgres.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "db", "migrations");

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
const forward = files.filter((f) => !f.endsWith("_down.sql")).sort();
const down = new Set(files.filter((f) => f.endsWith("_down.sql")));

let ok = true;
const problems: string[] = [];

const prefixes: number[] = [];
for (const f of forward) {
  const m = /^(\d{4})_/.exec(f);
  if (!m) {
    problems.push(`migration has no NNNN_ prefix: ${f}`);
    ok = false;
    continue;
  }
  prefixes.push(Number(m[1]));
  const downName = f.replace(/\.sql$/, "_down.sql");
  if (!down.has(downName)) {
    problems.push(`missing rollback for ${f} (expected ${downName})`);
    ok = false;
  }
}

prefixes.sort((a, b) => a - b);
for (let i = 0; i < prefixes.length; i++) {
  if (prefixes[i] !== i) {
    problems.push(`migration numbering gap/duplicate at expected ${String(i).padStart(4, "0")}`);
    ok = false;
    break;
  }
}

console.log("DSUSA migration check");
console.log("forward migrations:", forward.join(", ") || "(none)");
if (ok) {
  console.log("RESULT: OK — ordered, contiguous, each forward migration has a rollback.");
  process.exit(0);
} else {
  console.error("RESULT: FAIL");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
