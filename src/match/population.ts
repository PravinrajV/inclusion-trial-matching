import type { FactSheet } from "../schema/fact-sheet";
import type { Judgment, TypedCheck, TypedKind } from "../schema/criterion";
import type { TrialMeta } from "../cache/trial-meta";
import { describeVerdict, TRIAL_WORDS_CAPTION } from "../ui/verdict";
import { GROUP_DISCUSS, GROUP_MET, GROUP_NOT_MET } from "../ui/copy";
import { judgeTypedCheck } from "./typed";

export type PopulationClass = "nsclc" | "solid_tumor" | "mixed" | "other";
export type DriverGene = "EGFR" | "ALK" | "KRAS" | "ROS1" | "BRAF" | "RET" | "MET" | "HER2" | "NTRK" | "NRG1" | "MTAP" | "RAS";
export type FieldSource = "title" | "official title" | "condition" | "keyword";
export type PriorLineHint = "first_line" | "later_line" | "tki_naive" | null;
export type DriverMatch = "confirmed" | "none_required" | "unknown" | "conflict";
export type MatchTier = "strong" | "possible" | "unlikely";

export interface StructuredFields {
  briefTitle?: string | undefined;
  officialTitle?: string | undefined;
  overallStatus?: string | undefined;
  conditions?: string[] | undefined;
  keywords?: string[] | undefined;
  interventions?: string[] | undefined;
}

export interface DriverRequirement {
  gene: DriverGene;
  variant?: string;
  presence: "present" | "absent";
  label: string;
  quote: string;
  source: FieldSource;
}

export interface DriverGroup {
  op: "all" | "any";
  drivers: DriverRequirement[];
}

export interface TrialPopulation {
  population: PopulationClass;
  nsclcSpecific: boolean;
  driverGroups: DriverGroup[];
  priorLineHint: PriorLineHint;
  priorLineQuote?: string;
  recruiting: boolean;
}

export interface StructuredCheck {
  check: TypedCheck;
  judgment: Judgment;
  group: string;
  quote: string;
  headline: string;
  quoteLabel: string;
}

const NSCLC_RE = /\bnon[-\s]?small[-\s]?cell\b|\bnsclc\b|\blung (?:adeno(?:carcinoma)?|squamous|non[-\s]?squamous|cancer|carcinoma|neoplasm)/i;
const SOLID_RE = /\bsolid tumors?\b|\bsolid malignancies\b|\badvanced solid\b/;
const OTHER_CANCER_RE = /\b(?:breast|melanoma|gastric|prostate|colorectal|pancreatic|ovarian|bladder|renal cell|urothelial|head and neck|hnscc)\b/i;

interface Pattern {
  gene: DriverGene;
  variant?: string;
  presence: "present" | "absent";
  label: string;
  re: RegExp;
}

const DRIVER_PATTERNS: Pattern[] = [
  { gene: "KRAS", variant: "G12C", presence: "present", label: "KRAS G12C", re: /KRAS\s*G12C|KRASG12C/i },
  { gene: "KRAS", variant: "G12D", presence: "present", label: "KRAS G12D", re: /KRAS\s*G12D/i },
  {
    gene: "EGFR",
    variant: "exon 20 insertion",
    presence: "present",
    label: "EGFR exon 20 insertion",
    re: /EGFR[\s\S]{0,48}exon\s*20\s*(?:insertion|insertions|change|insert)|exon\s*20\s+insertions?\s+in\s+EGFR/i,
  },
  {
    gene: "EGFR",
    variant: "exon 19 deletion",
    presence: "present",
    label: "EGFR exon 19 deletion",
    re: /EGFR[\s\S]{0,36}ex(?:on)?\s*19\s*del/i,
  },
  { gene: "EGFR", presence: "absent", label: "EGFR wild-type", re: /EGFR\s*wild[-\s]?type|\bEGFR\s*WT\b/i },
  {
    gene: "EGFR",
    presence: "present",
    label: "EGFR",
    re: /EGFR[-\s]?mutant|EGFR[-\s]?mutated|EGFRm\b|EGFR mutation[-\s]?positive|EGFR-mutated|epidermal growth factor receptor\s*\(?EGFR\)?\s*mutation[-\s]?positive|harboring EGFR|with an EGFR|EGFR and\/or HER2|EGFR and MET/i,
  },
  {
    gene: "ALK",
    presence: "present",
    label: "ALK",
    re: /ALK[-\s]?positive|ALK[-\s]?rearranged|ALK[-\s]?rearrangement|ALK[-\s]?fusion|\bALK\+|ALK NSCLC|harboring ALK|anaplastic lymphoma kinase(?:\s*\(ALK\))?[-\s]?positive/i,
  },
  {
    gene: "ROS1",
    presence: "present",
    label: "ROS1",
    re: /ROS1[-\s]?(?:positive|rearranged|rearrangement|fusion)|ROS1(?=\s*,|\s+or\s+)/i,
  },
  {
    gene: "HER2",
    presence: "present",
    label: "HER2",
    re: /HER-?2[-\s]?(?:mutant|mutated|mutation|positive|amplif)|ERBB2[-\s]?(?:mutant|mutated|mutation)|(?:and\/or|harboring EGFR and\/or)\s*HER2/i,
  },
  { gene: "MTAP", presence: "present", label: "MTAP-deleted", re: /MTAP[-\s]?(?:delet|deficient|loss)/i },
  { gene: "BRAF", presence: "present", label: "BRAF", re: /BRAF[-\s]?(?:mutant|mutated|V600|positive|fusion)/i },
  { gene: "RET", presence: "present", label: "RET", re: /RET[-\s]?(?:fusion|rearranged|rearrangement|positive|mutant)/i },
  { gene: "MET", presence: "present", label: "MET", re: /\bMET[-\s]?(?:amplif|exon\s*14|ex14|mutant|gene change)|EGFR and MET gene/i },
  { gene: "NTRK", presence: "present", label: "NTRK", re: /NTRK\s*[123]?(?:[\s,\-]*[123])*[\s\-]*(?:fusion|rearrang)/i },
  { gene: "NRG1", presence: "present", label: "NRG1", re: /NRG1[-\s]?(?:fusion|rearrang)/i },
  { gene: "RAS", presence: "present", label: "RAS", re: /RAS(?:\(ON\))?[-\s]mutat|RAS\/MAPK mutation[-\s]?positive|RAS-mutated/i },
  { gene: "KRAS", presence: "present", label: "KRAS", re: /KRAS[-\s]?(?:mutant|mutated|mutation[-\s]?positive)/i },
];

const TKI_NAMES = [
  "osimertinib",
  "alectinib",
  "brigatinib",
  "ceritinib",
  "crizotinib",
  "lorlatinib",
  "ensartinib",
  "erlotinib",
  "gefitinib",
  "afatinib",
  "dacomitinib",
  "lazertinib",
  "mobocertinib",
  "repotrectinib",
  "entrectinib",
];

export function fieldsFromMeta(meta: TrialMeta | StructuredFields | undefined): StructuredFields {
  if (!meta) return {};
  return {
    briefTitle: "briefTitle" in meta ? meta.briefTitle : undefined,
    officialTitle: "officialTitle" in meta ? meta.officialTitle : undefined,
    overallStatus: "overallStatus" in meta ? meta.overallStatus : undefined,
    conditions: "conditions" in meta ? meta.conditions : undefined,
    keywords: "keywords" in meta ? meta.keywords : undefined,
    interventions: "interventions" in meta ? meta.interventions : undefined,
  };
}

export function classifyTrial(fields: StructuredFields | TrialMeta | undefined): TrialPopulation {
  const f = fieldsFromMeta(fields);
  const titles = joinTexts([f.briefTitle, f.officialTitle]);
  const conditions = (f.conditions || []).join(" ");
  const haystack = joinTexts([titles, conditions, (f.keywords || []).join(" ")]);
  const population = classifyPopulation(haystack, f.conditions || []);
  const drivers = extractDrivers(f);
  const driverGroups = groupDrivers(drivers, titles || haystack);
  const prior = priorLineHint(titles);
  const out: TrialPopulation = {
    population,
    nsclcSpecific: population === "nsclc",
    driverGroups,
    priorLineHint: prior.hint,
    recruiting: isRecruiting(f.overallStatus),
  };
  if (prior.quote) out.priorLineQuote = prior.quote;
  return out;
}

export function classifyPopulation(text: string, conditions: string[]): PopulationClass {
  const condText = conditions.join(" ");
  const nsclc = NSCLC_RE.test(text) || NSCLC_RE.test(condText);
  const solid = SOLID_RE.test(text) || conditions.some((c) => SOLID_RE.test(c));
  const other = OTHER_CANCER_RE.test(condText) || (OTHER_CANCER_RE.test(text) && !nsclc);
  if (nsclc && (solid || other)) return "mixed";
  if (nsclc) return "nsclc";
  if (solid) return "solid_tumor";
  if (other) return "other";
  return "solid_tumor";
}

export function isRecruiting(status: string | undefined): boolean {
  const s = (status || "").toUpperCase();
  return s === "RECRUITING" || s === "ENROLLING_BY_INVITATION" || s === "";
}

function priorLineHint(titles: string): { hint: PriorLineHint; quote?: string } {
  if (!titles) return { hint: null };
  const naive = titles.match(/tki[-\s]?naive|treatment[-\s]?naive|previously untreated|no prior (?:systemic|treatment|therapy)/i);
  if (naive) return { hint: "tki_naive", quote: naive[0] };
  const later = titles.match(/who progressed|after (?:failure|progression)|progressed on|previously treated|after progression|disease progression on/i);
  if (later) return { hint: "later_line", quote: later[0] };
  if (/first[-\s]in[-\s]human/i.test(titles)) return { hint: null };
  const first = titles.match(/first[-\s]line|1st[-\s]line|initial treatment/i);
  if (first) return { hint: "first_line", quote: first[0] };
  return { hint: null };
}

function extractDrivers(f: StructuredFields): DriverRequirement[] {
  const found: DriverRequirement[] = [];
  collectFromField(found, f.officialTitle, "official title");
  collectFromField(found, f.briefTitle, "title");
  for (const cond of f.conditions || []) collectFromField(found, cond, "condition");
  const keywordHits = extractKeywordDrivers(f.keywords || []);
  for (const hit of keywordHits) addDriver(found, hit);
  return found;
}

function extractKeywordDrivers(keywords: string[]): DriverRequirement[] {
  const hits: DriverRequirement[] = [];
  for (const kw of keywords) {
    if (/\btesting\b/i.test(kw)) continue;
    collectFromField(hits, kw, "keyword");
  }
  const genes = new Set(hits.filter((h) => h.presence === "present").map((h) => h.gene));
  // Several different driver populations in keywords usually means a multi-cohort study.
  if (genes.size >= 2) return [];
  const bothWays = hits.some((a) => hits.some((b) => a.gene === b.gene && a.presence !== b.presence));
  if (bothWays) return [];
  return hits;
}


function collectHarboringList(into: DriverRequirement[], text: string, source: FieldSource): void {
  const list = text.match(/harbou?ring\s+([^.]{8,180})/i);
  if (!list) return;
  const chunk = list[1];
  const genes: Array<[DriverGene, string]> = [
    ["ALK", "ALK"],
    ["ROS1", "ROS1"],
    ["NTRK", "NTRK"],
    ["RET", "RET"],
    ["NRG1", "NRG1"],
  ];
  for (const [gene, label] of genes) {
    if (new RegExp("\\b" + gene, "i").test(chunk)) {
      addDriver(into, { gene, presence: "present", label, quote: list[0].trim(), source });
    }
  }
}


function isIncludingContext(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 48), index);
  return /\bincluding\b[\s\S]*$/i.test(before);
}

function collectFromField(into: DriverRequirement[], text: string | undefined, source: FieldSource): void {
  if (!text) return;
  collectHarboringList(into, text, source);
  const capturedGenes = new Set<string>();
  for (const pattern of DRIVER_PATTERNS) {
    const match = pattern.re.exec(text);
    if (!match) continue;
    if (isIncludingContext(text, match.index)) continue;
    if (capturedGenes.has(pattern.gene) && !pattern.variant && pattern.presence === "present") continue;
    const quote = match[0].trim();
    const req: DriverRequirement = {
      gene: pattern.gene,
      presence: pattern.presence,
      label: pattern.label,
      quote,
      source,
    };
    if (pattern.variant) req.variant = pattern.variant;
    addDriver(into, req);
    if (pattern.presence === "present") capturedGenes.add(pattern.gene);
  }
}

function addDriver(into: DriverRequirement[], req: DriverRequirement): void {
  const key = `${req.gene}|${req.variant || ""}|${req.presence}`;
  const existing = into.find((d) => `${d.gene}|${d.variant || ""}|${d.presence}` === key);
  if (existing) return;
  const general = into.find((d) => d.gene === req.gene && d.presence === req.presence && !d.variant && req.variant);
  if (general) {
    into.splice(into.indexOf(general), 1);
  }
  if (req.variant && into.some((d) => d.gene === req.gene && d.presence === req.presence && d.variant)) {
    into.push(req);
    return;
  }
  if (!req.variant && into.some((d) => d.gene === req.gene && d.presence === req.presence && d.variant)) return;
  into.push(req);
}

function groupDrivers(drivers: DriverRequirement[], titles: string): DriverGroup[] {
  if (!drivers.length) return [];
  const positive = drivers.filter((d) => d.presence === "present");
  const negative = drivers.filter((d) => d.presence === "absent");
  const groups: DriverGroup[] = [];
  if (positive.length) {
    const op: "all" | "any" = /and\/or|\bor\b/.test(titles) && positive.length > 1 ? "any" : positive.length > 1 && /\band\b/.test(titles) ? "all" : "any";
    groups.push({ op, drivers: positive });
  }
  for (const d of negative) groups.push({ op: "all", drivers: [d] });
  return groups;
}

function joinTexts(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" \n ");
}

export function quoteLabelForField(_source: FieldSource): string {
  return TRIAL_WORDS_CAPTION;
}

function chartGene(sheet: FactSheet, gene: DriverGene): { status: FactSheet["biomarkers"]["egfr"]["status"]; variant: string | null } {
  switch (gene) {
    case "EGFR":
      return { status: sheet.biomarkers.egfr.status, variant: sheet.biomarkers.egfr.variant };
    case "ALK":
      return { status: sheet.biomarkers.alk.status, variant: sheet.biomarkers.alk.variant };
    case "KRAS":
    case "RAS":
      return { status: sheet.biomarkers.kras.status, variant: sheet.biomarkers.kras.variant };
    case "ROS1":
      return { status: sheet.biomarkers.ros1.status, variant: sheet.biomarkers.ros1.variant };
    case "BRAF":
      return { status: sheet.biomarkers.braf.status, variant: sheet.biomarkers.braf.variant };
    default:
      return { status: "unknown", variant: null };
  }
}

function kindFor(req: DriverRequirement): TypedKind {
  if (req.gene === "EGFR" && req.variant) return "egfr_variant_in";
  if (req.gene === "KRAS" && req.variant) return "kras_variant_in";
  if (req.gene === "EGFR") return "egfr_status";
  if (req.gene === "ALK") return "alk_status";
  if (req.gene === "KRAS" || req.gene === "RAS") return "kras_status";
  if (req.gene === "ROS1") return "ros1_status";
  if (req.gene === "BRAF") return "braf_status";
  return "egfr_status";
}

function checkFromDriver(req: DriverRequirement, index: number): TypedCheck | null {
  const unsupported = req.gene === "HER2" || req.gene === "MET" || req.gene === "MTAP" || req.gene === "RET" || req.gene === "NTRK" || req.gene === "NRG1";
  if (unsupported) return null;
  const check: TypedCheck = {
    id: `structured-${req.gene}-${req.variant || req.presence}-${index}`,
    kind: kindFor(req),
    polarity: "inclusion",
    sourceText: req.quote,
    evidence_quote: req.quote,
    presence: req.presence,
  };
  if (req.variant) check.stringValue = req.variant;
  return check;
}

function judgeUnsupported(sheet: FactSheet, req: DriverRequirement): Judgment {
  const { status, variant } = chartGene(sheet, req.gene);
  if (req.presence === "absent") {
    if (status === "absent") return "met";
    if (status === "present") return "not_met";
    return "unknown";
  }
  if (req.variant) {
    if (status === "absent") return "not_met";
    if (status === "unknown" || !variant) return "unknown";
    return normalizeVariant(variant) === normalizeVariant(req.variant) ? "met" : "not_met";
  }
  if (status === "present") return "met";
  if (status === "absent") return "not_met";
  return "unknown";
}

function normalizeVariant(raw: string): string {
  return raw.toLowerCase().replace(/ex(?:on)?\s*19\s*del(?:etion)?/g, "exon 19 deletion").replace(/\s+/g, " ").trim();
}

function headlineForUnsupported(req: DriverRequirement, judgment: Judgment, sheet: FactSheet): string {
  const { status, variant } = chartGene(sheet, req.gene);
  const need = req.presence === "absent" ? `Requires no ${req.label}` : `Requires ${req.label}`;
  const chart =
    variant
      ? `chart shows ${req.gene === "RAS" ? "KRAS" : req.gene} ${variant}`
      : status === "absent"
        ? `chart shows ${req.gene === "RAS" ? "KRAS" : req.gene} is absent`
        : `${req.label} is not on the fact sheet`;
  if (judgment === "unknown") return `${req.label} still needs a closer look with your care team.`;
  return `${need}: ${chart}.`;
}

export function structuredResults(sheet: FactSheet, pop: TrialPopulation): {
  results: StructuredCheck[];
  driverMatch: DriverMatch;
  positiveDriverMatch: boolean;
} {
  const results: StructuredCheck[] = [];
  const groupJudgments: Judgment[] = [];

  pop.driverGroups.forEach((group, gi) => {
    const parts: Array<{ req: DriverRequirement; judgment: Judgment; result?: StructuredCheck }> = group.drivers.map((req, di) => {
      const check = checkFromDriver(req, gi * 10 + di);
      let judgment: Judgment;
      let result: StructuredCheck | undefined;
      if (check) {
        judgment = judgeTypedCheck(sheet, check);
        const copy = describeVerdict(sheet, check, judgment);
        result = {
          check,
          judgment,
          group: judgment === "met" ? GROUP_MET : judgment === "not_met" ? GROUP_NOT_MET : GROUP_DISCUSS,
          quote: req.quote,
          headline: copy.headline,
          quoteLabel: quoteLabelForField(req.source),
        };
      } else {
        judgment = judgeUnsupported(sheet, req);
        const synthetic: TypedCheck = {
          id: `structured-${req.gene}-${gi}-${di}`,
          kind: "egfr_status",
          polarity: "inclusion",
          sourceText: req.quote,
          evidence_quote: req.quote,
        };
        result = {
          check: synthetic,
          judgment,
          group: judgment === "met" ? GROUP_MET : judgment === "not_met" ? GROUP_NOT_MET : GROUP_DISCUSS,
          quote: req.quote,
          headline: headlineForUnsupported(req, judgment, sheet),
          quoteLabel: quoteLabelForField(req.source),
        };
      }
      return { req, judgment, result };
    });

    let groupJudgment: Judgment;
    if (group.op === "any") {
      if (parts.some((p) => p.judgment === "met")) groupJudgment = "met";
      else if (parts.every((p) => p.judgment === "not_met")) groupJudgment = "not_met";
      else groupJudgment = "unknown";
    } else {
      if (parts.some((p) => p.judgment === "not_met")) groupJudgment = "not_met";
      else if (parts.every((p) => p.judgment === "met")) groupJudgment = "met";
      else groupJudgment = "unknown";
    }
    groupJudgments.push(groupJudgment);

    if (group.op === "any" && groupJudgment === "met") {
      for (const p of parts) {
        if (p.judgment === "met" && p.result) results.push(p.result);
      }
    } else {
      for (const p of parts) {
        if (p.result) results.push(p.result);
      }
    }
  });

  let driverMatch: DriverMatch = "none_required";
  if (groupJudgments.length) {
    if (groupJudgments.some((j) => j === "not_met")) driverMatch = "conflict";
    else if (groupJudgments.every((j) => j === "met")) driverMatch = "confirmed";
    else driverMatch = "unknown";
  }
  const positiveIdx = pop.driverGroups
    .map((g, i) => (g.drivers.some((d) => d.presence === "present") ? i : -1))
    .filter((i) => i >= 0);
  const positiveDriverMatch =
    driverMatch === "confirmed" &&
    positiveIdx.length > 0 &&
    positiveIdx.every((i) => groupJudgments[i] === "met");
  return { results, driverMatch, positiveDriverMatch };
}

export function hasListedTki(sheet: FactSheet): boolean {
  return (sheet.priorTherapies || []).some((name) => TKI_NAMES.includes(name.trim().toLowerCase()));
}

export function firstLineDemoted(sheet: FactSheet, hint: PriorLineHint): boolean {
  if (hint === "first_line" && (sheet.priorSystemicLines ?? 0) >= 1) return true;
  return false;
}

export function laterLineBonus(sheet: FactSheet, hint: PriorLineHint): boolean {
  return hint === "later_line" && (hasListedTki(sheet) || (sheet.priorSystemicLines ?? 0) >= 1);
}

export function tkiNaiveConflict(sheet: FactSheet, hint: PriorLineHint): boolean {
  return hint === "tki_naive" && hasListedTki(sheet);
}

export function assignTier(input: {
  notMet: number;
  driverMatch: DriverMatch;
  positiveDriverMatch: boolean;
  population: PopulationClass;
  firstLineDemoted: boolean;
  tkiNaiveConflict: boolean;
  recruiting: boolean;
}): MatchTier {
  if (input.tkiNaiveConflict || input.notMet > 0 || input.driverMatch === "conflict" || input.population === "other") {
    return "unlikely";
  }
  if (
    input.positiveDriverMatch &&
    !input.firstLineDemoted &&
    (input.population === "nsclc" || input.population === "mixed") &&
    input.recruiting
  ) {
    return "strong";
  }
  return "possible";
}

export function compareMatches(
  a: {
    tier: MatchTier;
    driverMatch: DriverMatch;
    nsclcSpecific: boolean;
    met: number;
    discuss: number;
    laterLineBonus: boolean;
    recruiting: boolean;
    miles?: number | undefined;
  },
  b: typeof a,
): number {
  const tierRank = { strong: 0, possible: 1, unlikely: 2 };
  const driverRank = { confirmed: 0, none_required: 1, unknown: 2, conflict: 3 };
  return (
    tierRank[a.tier] - tierRank[b.tier] ||
    driverRank[a.driverMatch] - driverRank[b.driverMatch] ||
    Number(b.nsclcSpecific) - Number(a.nsclcSpecific) ||
    Number(b.laterLineBonus) - Number(a.laterLineBonus) ||
    b.met - a.met ||
    a.discuss - b.discuss ||
    Number(b.recruiting) - Number(a.recruiting) ||
    (a.miles ?? 10_000) - (b.miles ?? 10_000)
  );
}

export const EGFR_TKI = ["osimertinib", "erlotinib", "gefitinib", "afatinib", "dacomitinib", "lazertinib", "mobocertinib"];

export function laterLineDriverMet(sheet: FactSheet, pop: TrialPopulation): boolean {
  if (pop.priorLineHint !== "later_line") return false;
  return sheet.priorTherapies.some((name) => EGFR_TKI.includes(name.trim().toLowerCase()));
}
