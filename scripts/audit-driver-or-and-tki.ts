/**
 * Audit the hardened driver-OR rule and list tkiNaiveConflict Unlikely marks.
 * Usage: npx vite-node scripts/audit-driver-or-and-tki.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import personasDoc from "../gold/personas.json";
import { classifyTrial, tkiNaiveConflict } from "../src/match/population";
import { evaluateTrial, type CheckResult, type TrialMatch } from "../src/match/evaluate";
import {
  driverQuotesAreDisjunctiveLoose,
  quotesOf,
} from "../src/ui/driver-or";
import { groupMatrix, pickMatrixItem, type MatrixRowKey } from "../src/ui/matrix";
import { nearestSite, type TrialMeta } from "../src/cache/trial-meta";
import type { FactSheet } from "../src/schema/fact-sheet";
import type { CachedTrial } from "../src/cache/load";

const root = resolve(import.meta.dirname, "..");
const cache = JSON.parse(readFileSync(resolve(root, "public/criteria-cache.json"), "utf8")) as {
  trials: CachedTrial[];
  parserModel?: string;
  promptVersion?: string;
  pipeline?: string;
};
const metaDoc = JSON.parse(readFileSync(resolve(root, "public/trial-meta.json"), "utf8")) as { trials?: TrialMeta[] };
const meta = new Map<string, TrialMeta>();
for (const row of metaDoc.trials || []) if (row?.nctId) meta.set(row.nctId, row);

function rankState(judgment: CheckResult["judgment"]): number {
  if (judgment === "not_met") return 0;
  if (judgment === "unknown") return 1;
  return 2;
}

/** Pre-hardening pick: any "or" in the joined quotes plus a met gene wins, including over not_met. */
function pickOld(items: CheckResult[], key?: MatrixRowKey): CheckResult | null {
  if (!items.length) return null;
  if (key === "driver" && driverQuotesAreDisjunctiveLoose(items) && items.some((i) => i.judgment === "met")) {
    return items.find((i) => i.judgment === "met") ?? items[0];
  }
  return [...items].sort((a, b) => rankState(a.judgment) - rankState(b.judgment))[0] ?? null;
}

const PERSONA_IDS = ["alex-rivera", "sam-okonkwo", "jordan-blake"];

function evaluatePersona(id: string): { sheet: FactSheet; name: string; matches: TrialMatch[] } {
  const persona = personasDoc.personas.find((p) => p.id === id);
  if (!persona) throw new Error(`missing persona ${id}`);
  const sheet = persona.factSheet as FactSheet;
  const matches = cache.trials.map((trial) => {
    const m = meta.get(trial.nctId);
    const site = nearestSite(sheet.home, m?.sites);
    return evaluateTrial(sheet, trial, trial.briefTitle || m?.briefTitle, m, site?.miles);
  });
  return { sheet, name: persona.displayName, matches };
}

type Flip = {
  persona: string;
  nctId: string;
  briefTitle?: string;
  officialTitle?: string;
  oldJudgment: string | null;
  newJudgment: string | null;
  oldKind?: string;
  newKind?: string;
  looseOr: boolean;
  driverChecks: { kind: string; judgment: string; quote: string }[];
  tier: string;
};

const flips: Flip[] = [];
const hero: Record<string, { strong: number; possible: number; unlikely: number; first?: { nctId: string; metKey: number; tier: string } }> = {};

for (const id of PERSONA_IDS) {
  const { matches, name } = evaluatePersona(id);
  const strong = matches.filter((m) => m.tier === "strong");
  const possible = matches.filter((m) => m.tier === "possible");
  const unlikely = matches.filter((m) => m.tier === "unlikely");
  // first strong by the same sort as rankTrials would need compareMatches; matches are not sorted.
  // Re-run through rank isn't necessary for flip audit. Hero counts don't depend on pickMatrixItem.
  const first = [...matches].sort((a, b) => {
    const tierRank = { strong: 0, possible: 1, unlikely: 2 };
    return (tierRank[a.tier] - tierRank[b.tier]) || (a.miles ?? 1e5) - (b.miles ?? 1e5);
  })[0];
  const groupsFirst = first ? groupMatrix(first) : null;
  const metKey = groupsFirst
    ? (["driver", "stage", "ecog", "brain", "labs", "prior"] as const).filter(
        (k) => pickMatrixItem(groupsFirst[k], k)?.judgment === "met",
      ).length
    : 0;
  hero[id] = {
    strong: strong.length,
    possible: possible.length,
    unlikely: unlikely.length,
    first: first ? { nctId: first.nctId, metKey, tier: first.tier } : undefined,
  };

  for (const match of matches) {
    const groups = groupMatrix(match);
    const items = groups.driver;
    const oldP = pickOld(items, "driver");
    const newP = pickMatrixItem(items, "driver");
    const oldJ = oldP?.judgment ?? null;
    const newJ = newP?.judgment ?? null;
    if (oldJ !== newJ) {
      const m = meta.get(match.nctId);
      flips.push({
        persona: name,
        nctId: match.nctId,
        briefTitle: match.briefTitle || m?.briefTitle,
        officialTitle: m?.officialTitle,
        oldJudgment: oldJ,
        newJudgment: newJ,
        oldKind: oldP?.check.kind,
        newKind: newP?.check.kind,
        looseOr: driverQuotesAreDisjunctiveLoose(items),
        driverChecks: items.map((r) => ({
          kind: r.check.kind,
          judgment: r.judgment,
          quote: (quotesOf(r)[0] || "").slice(0, 400),
        })),
        tier: match.tier,
      });
    }
  }
}

type TkiHit = {
  persona: string;
  nctId: string;
  briefTitle?: string;
  officialTitle?: string;
  priorLineQuote?: string;
  priorLineHint: string | null;
  injectedNotMet: boolean;
  otherNotMetKinds: string[];
  otherUnlikelyReasons: string[];
  wouldBeUnlikelyAnyway: boolean;
  tier: string;
};

const tkiHits: TkiHit[] = [];

for (const id of PERSONA_IDS) {
  const { sheet, name, matches } = evaluatePersona(id);
  for (const trial of cache.trials) {
    const m = meta.get(trial.nctId);
    const pop = classifyTrial(m ? { ...m, briefTitle: m.briefTitle || trial.briefTitle } : { briefTitle: trial.briefTitle });
    if (!tkiNaiveConflict(sheet, pop.priorLineHint)) continue;
    const match = matches.find((row) => row.nctId === trial.nctId);
    if (!match) continue;
    const injected = match.results.filter((r) => r.check.id === "structured-tki-naive");
    const otherNotMet = match.results.filter((r) => r.judgment === "not_met" && r.check.id !== "structured-tki-naive");
    const reasons: string[] = [];
    if (otherNotMet.length) reasons.push(`other_not_met:${otherNotMet.map((r) => r.check.kind).join(",")}`);
    if (match.driverMatch === "conflict") reasons.push("driver_conflict");
    if (match.population === "other") reasons.push("population_other");
    tkiHits.push({
      persona: name,
      nctId: trial.nctId,
      briefTitle: trial.briefTitle || m?.briefTitle,
      officialTitle: m?.officialTitle,
      priorLineQuote: pop.priorLineQuote,
      priorLineHint: pop.priorLineHint,
      injectedNotMet: injected.length > 0,
      otherNotMetKinds: otherNotMet.map((r) => r.check.kind),
      otherUnlikelyReasons: reasons,
      wouldBeUnlikelyAnyway: reasons.length > 0,
      tier: match.tier,
    });
  }
}

// Held-out gold sets: which labeled trials have a tki_naive title hint, and would the rule fire for each persona?
const goldFiles = [
  "gold/held-out-criteria-2026-11-11T211725-0500.json",
  "gold/held-out-2-criteria-2026-11-11T213510-0500.json",
  "gold/held-out-3-criteria-2026-11-11T214338-0500.json",
];
const goldTki: {
  set: string;
  nctId: string;
  inCache: boolean;
  priorLineHint: string | null;
  priorLineQuote?: string;
  briefTitle?: string;
  officialTitle?: string;
  firesFor: string[];
}[] = [];

for (const rel of goldFiles) {
  const gold = JSON.parse(readFileSync(resolve(root, rel), "utf8")) as { labelSet?: string; nctIds: string[] };
  for (const nctId of gold.nctIds) {
    const trial = cache.trials.find((t) => t.nctId === nctId);
    const m = meta.get(nctId);
    const pop = classifyTrial(
      m ? { ...m, briefTitle: m.briefTitle || trial?.briefTitle } : trial ? { briefTitle: trial.briefTitle } : undefined,
    );
    if (pop.priorLineHint !== "tki_naive") continue;
    const firesFor: string[] = [];
    for (const id of PERSONA_IDS) {
      const persona = personasDoc.personas.find((p) => p.id === id)!;
      if (tkiNaiveConflict(persona.factSheet as FactSheet, pop.priorLineHint)) firesFor.push(persona.displayName);
    }
    goldTki.push({
      set: gold.labelSet || rel,
      nctId,
      inCache: Boolean(trial),
      priorLineHint: pop.priorLineHint,
      priorLineQuote: pop.priorLineQuote,
      briefTitle: trial?.briefTitle || m?.briefTitle,
      officialTitle: m?.officialTitle,
      firesFor,
    });
  }
}

const out = {
  cacheTrials: cache.trials.length,
  parserModel: cache.parserModel,
  pipeline: cache.pipeline,
  hero,
  flipCount: flips.length,
  flipsByPersona: Object.fromEntries(
    PERSONA_IDS.map((id) => {
      const name = personasDoc.personas.find((p) => p.id === id)!.displayName;
      return [id, flips.filter((f) => f.persona === name).length];
    }),
  ),
  flips,
  tkiHitCount: tkiHits.length,
  tkiHitsByPersona: Object.fromEntries(
    PERSONA_IDS.map((id) => {
      const name = personasDoc.personas.find((p) => p.id === id)!.displayName;
      return [id, tkiHits.filter((f) => f.persona === name).length];
    }),
  ),
  tkiHits,
  goldTkiNaiveTitleTrials: goldTki,
};
const dest = resolve(root, "notes/driver-or-tki-audit-raw.json");
writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      cacheTrials: out.cacheTrials,
      hero,
      flipCount: out.flipCount,
      flipsByPersona: out.flipsByPersona,
      tkiHitCount: out.tkiHitCount,
      tkiHitsByPersona: out.tkiHitsByPersona,
      goldTkiCount: goldTki.length,
      dest,
    },
    null,
    2,
  ),
);
