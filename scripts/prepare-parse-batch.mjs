/**
 * Build a server-side parse queue from the local regional pull.
 * Does not call any model API.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pulled = JSON.parse(readFileSync(join(root, "data/ctgov/region-trials.json"), "utf8"));
const trials = pulled.trials.filter((t) => t.stage?.mentionsAdvancedOrIIIOrIV);
const queue = {
  schemaVersion: "1",
  promptVersion: "1",
  suggestedModel: "gemini-3.5-flash-lite",
  sourceDataTimestampFromApi: pulled.meta.dataTimestampFromApi,
  note: "Admin queue only. Do not call a paid or free-tier model until that is approved. Clients must not write the cache.",
  count: trials.length,
  nctIds: trials.map((t) => t.nctId),
};
mkdirSync(join(root, "admin"), { recursive: true });
writeFileSync(join(root, "admin/parse-queue.json"), JSON.stringify(queue, null, 2) + "\n");
console.log(`Wrote admin/parse-queue.json with ${queue.count} NCT IDs`);
