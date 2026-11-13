/**
 * Detect when two driver genes sit in the same quoted list joined by
 * "or" / "and/or" (e.g. "ALK, ROS1, NTRK1, NTRK2, or NTRK3").
 *
 * A bare "or" elsewhere in the sentence ("histologically or cytologically",
 * "stage III or IV") does not count. This is the only signal that may
 * let a met gene cover an UNKNOWN sibling on the driver row. It must
 * never cover a not_met sibling.
 */
export type DriverGeneKey =
  | "egfr"
  | "alk"
  | "kras"
  | "ros1"
  | "ret"
  | "met"
  | "braf"
  | "ntrk"
  | "her2"
  | "mtap"
  | "nrg1"
  | "ras";

export interface DriverQuoteItem {
  judgment?: string;
  quote?: string;
  check?: {
    kind?: string;
    evidence_quote?: string;
    sourceText?: string;
  };
}

const TOKEN_TO_KEY: { re: RegExp; key: DriverGeneKey }[] = [
  { re: /^EGFR$/i, key: "egfr" },
  { re: /^ALK$/i, key: "alk" },
  { re: /^ROS-?1$/i, key: "ros1" },
  { re: /^KRAS$/i, key: "kras" },
  { re: /^RET$/i, key: "ret" },
  { re: /^(C-)?MET$/i, key: "met" },
  { re: /^BRAF$/i, key: "braf" },
  { re: /^NTRK[123]?$/i, key: "ntrk" },
  { re: /^HER-?2$/i, key: "her2" },
  { re: /^ERBB2$/i, key: "her2" },
  { re: /^MTAP$/i, key: "mtap" },
  { re: /^NRG1$/i, key: "nrg1" },
  { re: /^RAS$/i, key: "ras" },
];

// Longer tokens first so "C-MET" and "ROS-1" win over "MET" / "ROS".
const GENE_TOKEN_RE =
  /EGFR|ALK|ROS-?1|KRAS|NTRK[123]?|HER-?2|ERBB2|C-MET|BRAF|MTAP|NRG1|\bRET\b|\bMET\b|\bRAS\b/gi;

const FILLER =
  "gene|genes|fusion|fusions|rearrangement|rearrangements|alteration|alterations|mutation|mutations|mutant|mutated|variant|variants|change|changes|status";

const CONNECTOR_RE = new RegExp(
  `^[\\s,;:()/]*((and\\/or|or|and)\\s+)?((an|a|the)\\s+)?((${FILLER})\\s+)*((and\\/or|or|and)\\s+)?((an|a|the)\\s+)*[\\s,;:()/]*$`,
  "i",
);

export function geneKeyFromKind(kind: string | undefined): DriverGeneKey | null {
  if (!kind) return null;
  const m = kind.match(/^(egfr|alk|kras|ros1|ret|met|braf|ntrk|her2|mtap|nrg1|ras)_/);
  return (m?.[1] as DriverGeneKey) ?? null;
}

export function geneKeyFromToken(token: string): DriverGeneKey | null {
  for (const row of TOKEN_TO_KEY) {
    if (row.re.test(token)) {
      row.re.lastIndex = 0;
      return row.key;
    }
    row.re.lastIndex = 0;
  }
  return null;
}

export function quotesOf(item: DriverQuoteItem): string[] {
  const out: string[] = [];
  for (const s of [item.quote, item.check?.evidence_quote, item.check?.sourceText]) {
    if (s && s.trim() && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Gene families that appear together in one "or" / "and/or" list in `text`. */
export function extractDisjunctiveGeneSets(text: string): Set<DriverGeneKey>[] {
  if (!text.trim()) return [];
  const matches: { start: number; end: number; key: DriverGeneKey }[] = [];
  const re = new RegExp(GENE_TOKEN_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = geneKeyFromToken(m[0]);
    if (key) matches.push({ start: m.index, end: m.index + m[0].length, key });
  }
  const sets: Set<DriverGeneKey>[] = [];
  let i = 0;
  while (i < matches.length) {
    const run = [matches[i]];
    let hasOr = false;
    let j = i;
    while (j + 1 < matches.length) {
      const gap = text.slice(matches[j].end, matches[j + 1].start);
      if (!CONNECTOR_RE.test(gap)) break;
      if (/\band\/or\b|\bor\b/i.test(gap)) hasOr = true;
      run.push(matches[j + 1]);
      j += 1;
    }
    if (run.length >= 2 && hasOr) {
      sets.push(new Set(run.map((r) => r.key)));
    }
    i = j + 1;
  }
  return sets;
}

/** True when a met gene and another gene sit in the same quoted OR / and/or list. */
export function genesShareDisjunctiveList(metItem: DriverQuoteItem, otherItem: DriverQuoteItem): boolean {
  const metKey = geneKeyFromKind(metItem.check?.kind);
  const otherKey = geneKeyFromKind(otherItem.check?.kind);
  if (!metKey || !otherKey || metKey === otherKey) return false;
  const texts = [...new Set([...quotesOf(metItem), ...quotesOf(otherItem)])];
  for (const text of texts) {
    for (const set of extractDisjunctiveGeneSets(text)) {
      if (set.has(metKey) && set.has(otherKey)) return true;
    }
  }
  return false;
}

export function unknownDriverCoveredByOrList(unknown: DriverQuoteItem, items: DriverQuoteItem[]): boolean {
  if (unknown.judgment !== "unknown") return false;
  return items.some((item) => item.judgment === "met" && genesShareDisjunctiveList(item, unknown));
}

/**
 * The driver row may display as met, covering UNKNOWN siblings only, when
 * every unknown driver gene shares an OR / and/or list with a met gene.
 * A not_met sibling always blocks this override.
 */
export function driverRowMetThroughOrList(items: DriverQuoteItem[]): boolean {
  if (!items.some((i) => i.judgment === "met")) return false;
  if (items.some((i) => i.judgment === "not_met")) return false;
  const unknowns = items.filter((i) => i.judgment === "unknown" && geneKeyFromKind(i.check?.kind));
  if (!unknowns.length) return false;
  return unknowns.every((u) => unknownDriverCoveredByOrList(u, items));
}

/** Loose "or anywhere in the joined quotes" rule, kept only to audit old vs new. */
export function driverQuotesAreDisjunctiveLoose(items: DriverQuoteItem[]): boolean {
  const text = items
    .flatMap((i) => quotesOf(i))
    .join(" \n ");
  if (!text.trim()) return false;
  return /and\/or|\bor\b/i.test(text);
}
