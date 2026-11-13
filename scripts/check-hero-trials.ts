/**
 * Rank Alex and Sam against a public criteria cache and print hero stats.
 * Usage: npx vite-node scripts/check-hero-trials.ts [--cache PATH]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import personasDoc from "../gold/personas.json";
import { rankTrials, type TrialMatch } from "../src/match/evaluate";
import { keyCriteriaTally } from "../src/ui/matrix";
import { nearestSite, type TrialMeta } from "../src/cache/trial-meta";
import type { FactSheet } from "../src/schema/fact-sheet";
import type { CachedTrial } from "../src/cache/load";

const root = resolve(import.meta.dirname, "..");
const cacheArg = process.argv.includes("--cache")
  ? process.argv[process.argv.indexOf("--cache") + 1]
  : resolve(root, "public/criteria-cache.json");

function loadMeta(): Map<string, TrialMeta> {
  const data = JSON.parse(readFileSync(resolve(root, "public/trial-meta.json"), "utf8")) as { trials?: TrialMeta[] };
  const map = new Map<string, TrialMeta>();
  for (const row of data.trials || []) if (row?.nctId) map.set(row.nctId, row);
  return map;
}

function metQuotes(match: TrialMatch) {
  return match.results
    .filter((r) => r.judgment === "met")
    .map((r) => ({
      kind: r.check.kind,
      headline: r.headline,
      quote: (r.quote || r.check.evidence_quote || r.check.sourceText || "").slice(0, 180),
      hasQuote: Boolean((r.quote || r.check.evidence_quote || r.check.sourceText || "").trim()),
    }));
}

function reportPersona(id: string, cache: { trials: CachedTrial[] }, meta: Map<string, TrialMeta>) {
  const persona = personasDoc.personas.find((p) => p.id === id);
  if (!persona) throw new Error(`Missing persona ${id}`);
  const sheet = persona.factSheet as FactSheet;
  const all = rankTrials(
    sheet,
    cache.trials.map((trial) => {
      const m = meta.get(trial.nctId);
      const site = nearestSite(sheet.home, m?.sites);
      return {
        trial,
        briefTitle: trial.briefTitle || m?.briefTitle,
        meta: m,
        miles: site?.miles,
      };
    }),
  );
  const strong = all.filter((m) => m.tier === "strong");
  const possible = all.filter((m) => m.tier === "possible");
  const unlikely = all.filter((m) => m.tier === "unlikely");
  const first = strong[0] || all[0];
  const tally = first ? keyCriteriaTally(first) : { met: 0, total: 6 };
  const quotes = first ? metQuotes(first) : [];
  const site = first ? nearestSite(sheet.home, meta.get(first.nctId)?.sites) : null;
  const out = {
    persona: persona.displayName,
    id,
    reviewed: all.length,
    strong: strong.length,
    possible: possible.length,
    unlikely: unlikely.length,
    first: first
      ? {
          nctId: first.nctId,
          briefTitle: first.briefTitle,
          officialTitle: meta.get(first.nctId)?.officialTitle,
          tier: first.tier,
          miles: site?.miles ?? first.miles,
          siteLabel: site?.label,
          keyCriteriaMet: tally.met,
          keyCriteriaTotal: tally.total,
          metQuoted: quotes.filter((q) => q.hasQuote).length,
          metChecks: quotes,
          discuss: first.discussItems.slice(0, 4).map((d) => (d.sourceText || d.reason || "").slice(0, 160)),
        }
      : null,
    heroOk: Boolean(first && first.tier === "strong" && tally.met >= 4 && quotes.filter((q) => q.hasQuote).length >= 4),
  };
  return out;
}

const cache = JSON.parse(readFileSync(cacheArg, "utf8")) as { trials: CachedTrial[]; parserModel?: string; promptVersion?: string; pipeline?: string };
const meta = loadMeta();
const alex = reportPersona("alex-rivera", cache, meta);
const sam = reportPersona("sam-okonkwo", cache, meta);
const report = {
  cache: cacheArg,
  parserModel: cache.parserModel,
  promptVersion: cache.promptVersion,
  pipeline: cache.pipeline,
  trials: cache.trials.length,
  alex,
  sam,
  bothHeroesOk: alex.heroOk && sam.heroOk,
};
console.log(JSON.stringify(report, null, 2));
if (!report.bothHeroesOk) process.exit(4);
