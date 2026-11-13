import type { TrialMeta } from "../cache/trial-meta";
import { classifyTrial, type DriverRequirement } from "../match/population";
import type { TrialMatch } from "../match/evaluate";

function driverPhrase(req: DriverRequirement): string {
  if (req.presence === "absent") {
    if (req.gene === "EGFR") return "EGFR wild-type";
    return `${req.gene}-negative`;
  }
  if (req.variant) {
    if (req.gene === "EGFR" && /exon 19/i.test(req.variant)) return "EGFR exon 19 deletion";
    return `${req.gene} ${req.variant}`;
  }
  if (req.gene === "EGFR") return "EGFR-mutant";
  if (req.gene === "ALK" || req.gene === "ROS1" || req.gene === "RET" || req.gene === "NTRK" || req.gene === "NRG1") {
    return `${req.gene}-positive`;
  }
  if (req.gene === "MTAP") return "MTAP-deleted";
  return `${req.gene}-mutant`;
}

function afterTherapyPhrase(text: string): string | null {
  const src = text.replace(/\s+/g, " ").trim();
  if (!src) return null;
  const after = src.match(
    /\bafter\s+(?:progression\s+on\s+|failure\s+(?:of|on)\s+)?((?:a\s+)?(?:third|3rd|second|2nd)[-\s]?generation\s+)?(?:EGFR\s+)?(?:TKI|tyrosine kinase inhibitor|osimertinib|alectinib|lorlatinib|crizotinib|chemotherapy|platinum)s?\b/i,
  );
  if (after) {
    const raw = after[0].replace(/^after\s+/i, "").replace(/\s+/g, " ").trim();
    const tidy = raw
      .replace(/\b3rd\b/i, "third")
      .replace(/\b2nd\b/i, "second")
      .replace(/tyrosine kinase inhibitor/i, "TKI");
    return `after ${tidy}`;
  }
  const progressed = src.match(
    /\bprogress(?:ed|ion)\s+on\s+((?:a\s+)?(?:third|3rd)[-\s]?generation\s+)?(?:EGFR\s+TKI|osimertinib|alectinib|lorlatinib|crizotinib)\b/i,
  );
  if (progressed) {
    const drug = (progressed[0].replace(/^progress(?:ed|ion)\s+on\s+/i, "") || "").replace(/\s+/g, " ").trim();
    return drug ? `after ${drug}` : "after prior therapy";
  }
  return "after prior therapy";
}

function populationPhrase(match: TrialMatch, nsclcSpecific: boolean, population: string): string | null {
  if (match.nsclcSpecific || nsclcSpecific || population === "nsclc" || population === "mixed") return "NSCLC";
  if (population === "solid_tumor") return "solid tumor";
  return null;
}

/** A short plain-language line for a trial card, from public structured fields. */
export function plainTrialSubtitle(match: TrialMatch, meta: TrialMeta | undefined): string {
  const title = match.briefTitle || meta?.briefTitle;
  const pop = classifyTrial(meta ? { ...meta, briefTitle: meta.briefTitle || title } : { briefTitle: title });
  const bits: string[] = [];
  for (const group of pop.driverGroups) {
    const phrases = group.drivers.map(driverPhrase);
    if (!phrases.length) continue;
    if (group.op === "any" && phrases.length > 1) bits.push(phrases.join(" or "));
    else bits.push(phrases.join(" and "));
  }
  const disease = populationPhrase(match, pop.nsclcSpecific, pop.population);
  if (disease && !bits.some((b) => b.includes(disease))) bits.push(disease);
  if (pop.priorLineHint === "later_line") {
    const after = afterTherapyPhrase(`${pop.priorLineQuote || ""} ${title || ""} ${meta?.officialTitle || ""}`);
    if (after) bits.push(after);
  } else if (pop.priorLineHint === "first_line") {
    bits.push("first-line");
  } else if (pop.priorLineHint === "tki_naive") {
    bits.push("no prior TKI");
  }
  const line = bits.join(" · ");
  if (line.length <= 88) return line;
  return `${line.slice(0, 85).replace(/\s+\S*$/, "")}…`;
}
