/**
 * Deterministic eligibility normalizer.
 * Typed checks for the six key types are produced from verbatim spans in the
 * correct Inclusion/Exclusion section. The model, if used, may only propose
 * spans; values always come from these rules. Ambiguous spans demote to fuzzy.
 */
import { normalizeEligibility, brainAllowedEquivalent } from "./postprocess-parse.mjs";

export const STATUS_KINDS = new Set(["egfr_status", "alk_status", "kras_status", "ros1_status", "braf_status"]);

export const SIX_TYPE_GROUPS = {
  driver: ["egfr_status", "alk_status", "kras_status", "ros1_status", "braf_status", "egfr_variant_in", "kras_variant_in"],
  stage: ["stage_in"],
  prior: ["prior_lines_min", "prior_lines_max", "prior_therapy_required", "prior_therapy_excluded"],
  ecog: ["ecog_max"],
  brain: ["brain_mets"],
  labs: [
    "creatinine_max",
    "egfr_min",
    "anc_min",
    "platelets_min",
    "hemoglobin_min",
    "bilirubin_max",
    "ast_max",
    "alt_max",
  ],
};

export const SIX_TYPE_KINDS = new Set(Object.values(SIX_TYPE_GROUPS).flat());

const STAGE_ORDER = ["IA", "IB", "IIA", "IIB", "IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"];

const DRIVER_GENES = [
  { re: /\bEGFR\b/i, status: "egfr_status", variant: "egfr_variant_in" },
  { re: /\bALK\b/i, status: "alk_status" },
  { re: /\bROS[\s-]?1\b/i, status: "ros1_status" },
  { re: /\bKRAS\b/i, status: "kras_status", variant: "kras_variant_in" },
  { re: /\bBRAF\b/i, status: "braf_status" },
];

const EGFR_VARIANTS = [
  ["exon 19 deletion", /exon\s*19\s*deletions?/i],
  ["exon 19 insertion", /exon\s*19\s*insertions?/i],
  ["L858R", /\bL858R\b/i],
  ["T790M", /\bT790M\b/i],
  ["L861Q", /\bL861Q\b/i],
  ["S768I", /\bS768I\b/i],
  ["G719X", /\bG719X\b/i],
  ["E709X", /\bE709X\b/i],
  ["exon 20 insertion", /exon\s*20\s*insertions?/i],
];

const KRAS_VARIANTS = [["G12C", /\bG12C\b/i]];

const THERAPY_VOCAB = [
  { canonical: "immune checkpoint inhibitor", re: /\bimmune checkpoint inhibitor\b/i },
  { canonical: "anti-PD-1", re: /\banti-?PD(?:-\s*)?(?:L)?1(?:\s+or\s+anti-?PD-?L1)?(?:\s+agent)?\b|\bPD-?1\s*\/\s*PD-?L1(?:\s+inhibitor)?\b|\bPD-?L1 inhibitor\b|\bPD-?1 inhibitor\b/i },
  { canonical: "CTLA-4 inhibitor", re: /\b(?:anti-?CTLA-?4|CTLA-?4 inhibitor)\b/i },
  { canonical: "platinum", re: /\b(?:platinum(?:[-\s]based)?(?:\s+chemotherapy)?|cisplatin|carboplatin)\b/i },
  { canonical: "osimertinib", re: /\bosimertinib\b/i },
  { canonical: "EGFR TKI", re: /\bEGFR\s*TKI\b/i },
  { canonical: "IL-2", re: /\bIL-?2\b/i },
  { canonical: "ALK TKI", re: /\bALK\s*TKI\b/i },
];

const SECTION_HEADER =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:[A-Za-z0-9][\w-]*\s+)?(?:key\s+|selected\s+|main\s+|major\s+|important\s+)?(inclusion|exclusion)\s+criteria(?:\s*\([^)]*\))?\s*:?[ \t]*(?=\n|$)/gi;

const BARE_SECTION = /(?:^|\n)\s*(inclusion|exclusion)\s*:?[ \t]*(?=\n|$)/gi;

export function foldForMatch(text) {
  return normalizeEligibility(text).replace(/\s+/g, " ").trim();
}

/** True when quote is a verbatim substring after CT.gov unescaping and whitespace folding. */
export function isVerbatimQuote(quote, text) {
  const q = foldForMatch(quote);
  const t = foldForMatch(text);
  if (!q || q.length < 8 || !t) return false;
  return t.includes(q);
}

export function splitEligibilitySections(text) {
  const raw = String(text || "");
  const folded = raw;
  const marks = [];
  for (const re of [SECTION_HEADER, BARE_SECTION]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(folded))) {
      marks.push({ at: m.index, end: m.index + m[0].length, section: m[1].toLowerCase() });
    }
  }
  marks.sort((a, b) => a.at - b.at || b.end - a.end);
  const seen = [];
  for (const mark of marks) {
    if (seen.some((s) => Math.abs(s.at - mark.at) < 4)) continue;
    seen.push(mark);
  }
  if (!seen.length) {
    return { inclusion: raw, exclusion: "", hasSplit: false, raw };
  }
  let inclusion = "";
  let exclusion = "";
  for (let i = 0; i < seen.length; i++) {
    const chunk = raw.slice(seen[i].end, i + 1 < seen.length ? seen[i + 1].at : raw.length);
    if (seen[i].section === "inclusion") inclusion += "\n" + chunk;
    else exclusion += "\n" + chunk;
  }
  return {
    inclusion: inclusion.trim(),
    exclusion: exclusion.trim(),
    hasSplit: true,
    raw,
  };
}

export function sectionContainingQuote(quote, sections) {
  const inInc = isVerbatimQuote(quote, sections.inclusion);
  const inExc = isVerbatimQuote(quote, sections.exclusion);
  if (inInc && inExc) return "both";
  if (inInc) return "inclusion";
  if (inExc) return "exclusion";
  if (!sections.hasSplit && isVerbatimQuote(quote, sections.inclusion || sections.raw)) return "unknown";
  return "missing";
}

function polarityMatchesSection(polarity, foundSection) {
  if (foundSection === "missing") return false;
  if (foundSection === "unknown" || foundSection === "both") return false;
  return polarity === foundSection;
}

function splitSentences(chunk) {
  const rawParts = chunk.split(/(?<=[.;])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  const merged = [];
  for (const part of rawParts) {
    const prev = merged[merged.length - 1];
    if (prev && /(?:\be\.g|\bi\.e|\betc|\bvs|\bDr|\bMr|\bMs|\bNo|\bFig|\bU\.S)$/i.test(prev)) {
      merged[merged.length - 1] = prev + " " + part;
    } else {
      merged.push(part);
    }
  }
  return merged.filter((s) => s.length >= 8);
}

export function splitSpans(sectionText) {
  // Keep newlines until after the split so two criteria on adjacent lines stay separate.
  const raw = String(sectionText || "");
  if (!raw.trim()) return [];
  const chunks = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?:^|\s)\*\s+/))
    .map((c) => c.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((c) => c.length >= 8);
  const out = [];
  for (const chunk of chunks) {
    const parts = splitSentences(chunk);
    if (parts.length) out.push(...parts);
    else out.push(chunk);
  }
  return [...new Set(out)];
}

function hasOpenException(span, topic) {
  if (topic === "brain" && /\bunless\b/i.test(span)) return false;
  return /\bunless\b|\bexcept(?:\s+for|\s+when|\s+if)?\b/i.test(span);
}

function parseNumberToken(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseEcog(span, section) {
  if (section !== "inclusion") return [];
  if (!/\bECOG\b|\bEastern Cooperative Oncology Group\b/i.test(span)) return [];
  if (hasOpenException(span, "ecog")) return [];
  // "score from 0 to 1" / "score of 0, 1, or 2" after an optional (ECOG PS) parenthetical.
  const range = span.match(
    /(?:ECOG|Eastern Cooperative Oncology Group)(?:\s*\([^)]*\))*\s*(?:performance\s+status|PS)?(?:\s*\([^)]*\))?\s*(?:score\s+)?(?:(?:of|from)\s+)?([0-4])((?:\s*,\s*[0-4])*(?:\s*,?\s*(?:or|to|[–—-])\s*[0-4])?)/i,
  );
  const le = span.match(/(?:ECOG|performance status)\s*(?:of\s+)?(?:≤|<=|≤\s*|at most\s*)([0-4])/i);
  let max = null;
  let min = null;
  if (range) {
    const nums = [Number(range[1]), ...[...(range[2] || "").matchAll(/[0-4]/g)].map((m) => Number(m[0]))];
    min = Math.min(...nums);
    max = Math.max(...nums);
  } else if (le) {
    min = 0;
    max = Number(le[1]);
  }
  if (max == null || max > 4) return [];
  // Exclusion-style "ECOG 2-4" in an inclusion sentence is uncommon; if the
  // lower bound is >= 2 and no 0/1 was listed, this is not an ecog_max cap.
  if (range && min >= 2 && !/(?:ECOG[^.]{0,20}[01]|[01]\s*(?:or|to|[–—-]))/i.test(span)) {
    return [];
  }
  const quote = (range || le)[0];
  return [{ kind: "ecog_max", polarity: "inclusion", numberValue: max, evidence_quote: quote, sourceText: quote, section }];
}

function stageIndex(tok) {
  const t = String(tok || "").toUpperCase().replace(/\s+/g, "");
  if (t === "I") return { start: "IA", end: "IB" };
  if (t === "II") return { start: "IIA", end: "IIB" };
  if (t === "III") return { start: "IIIA", end: "IIIC" };
  if (t === "IV") return { start: "IV", end: "IVB" };
  if (STAGE_ORDER.includes(t)) return { start: t, end: t };
  return null;
}

function expandStageRange(fromTok, toTok) {
  const a = stageIndex(fromTok);
  const b = stageIndex(toTok);
  if (!a || !b) return null;
  const i = STAGE_ORDER.indexOf(a.start);
  const j = STAGE_ORDER.indexOf(b.end);
  if (i < 0 || j < 0 || i > j) return null;
  return STAGE_ORDER.slice(i, j + 1);
}

const STAGE_PHRASE_RES = [
  { name: "range", re: /\b(?:stage\s*)?(I{1,3}[ABC]?|IV[AB]?)\s*(?:-|–|—|to)\s*(I{1,3}[ABC]?|IV[AB]?)(?:\s*\(N[0-3]\))?/gi },
  { name: "iii-slash", re: /\bIII\s*B\s*\/\s*C\b|\bIII\s*B\/C\b/gi },
  { name: "iii-ab", re: /\bIII\s*A\s*\/\s*B\b/gi },
  { name: "token", re: /\b(?:stage\s*)(I[ABC]|II[ABC]|III[ABC]|IV[AB]?|I{1,3}|IV)\b/gi },
  { name: "bare-iv", re: /\b(?:stage\s*)?IV[AB]?\b/gi },
  { name: "locally-advanced", re: /\blocally advanced\b/gi },
  { name: "unresectable", re: /\bunresectable\b|\bnot amenable to (?:curative|definitive)\b|\bnot a candidate for definitive\b|\bnot eligible for curative\b/gi },
  { name: "metastatic", re: /\bmetastatic\b/gi },
  { name: "recurrent-metastatic", re: /\b(?:recurrent or metastatic|metastatic or recurrent)\b/gi },
  { name: "n-descriptor-paren", re: /\(N[0-3]\)/gi },
];

/**
 * Expand every stage token, range, and accounted phrase in the span.
 * Returns complete=false when a stage-like phrase cannot be fully represented.
 */
export function collectStages(span) {
  const text = String(span || "");
  const found = new Set();
  const accounted = [];
  let complete = true;
  const leftovers = [];

  // Illegal or unrepresentable tokens (not in the typed vocabulary) fail closed.
  if (/\bIII\s*D\b|\bIIID\b|\bstage\s*0\b|\bTis\b/i.test(text)) {
    return { stages: [], complete: false, leftovers: ["unrepresentable-stage-token"] };
  }

  function addAll(list) {
    for (const s of list || []) found.add(s);
  }

  // Ranges first (inclusive).
  for (const m of text.matchAll(/\b(?:stage\s*)?(I{1,3}[ABC]?|IV[AB]?)\s*(?:-|–|—|to)\s*(I{1,3}[ABC]?|IV[AB]?)(?:\s*\(N[0-3]\))?/gi)) {
    const exp = expandStageRange(m[1], m[2]);
    if (!exp) {
      complete = false;
      leftovers.push(m[0]);
      continue;
    }
    addAll(exp);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "range" });
  }

  for (const m of text.matchAll(/\b(?:stage\s*)?III\s*B\s*\/\s*C\b|\b(?:stage\s*)?III\s*B\/C\b/gi)) {
    addAll(["IIIB", "IIIC"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "iii-slash" });
  }
  for (const m of text.matchAll(/\bIII\s*A\s*\/\s*B\b/gi)) {
    addAll(["IIIA", "IIIB"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "iii-ab" });
  }

  // Explicit "stage X" tokens not already inside an accounted range.
  for (const m of text.matchAll(/\bstage\s*(I[ABC]?|II[ABC]?|III\s*[ABC]|III[ABC]?|IV[AB]?)\b/gi)) {
    const already = accounted.some((a) => m.index >= a.from && m.index < a.to);
    if (already) continue;
    const tok = m[1].toUpperCase().replace(/\s+/g, "");
    const exp = expandStageRange(tok, tok);
    if (!exp) {
      complete = false;
      leftovers.push(m[0]);
      continue;
    }
    // Bare "stage III" / "stage II" / "stage IV" expand to the full family.
    if (tok === "III") addAll(["IIIA", "IIIB", "IIIC"]);
    else if (tok === "II") addAll(["IIA", "IIB"]);
    else if (tok === "I") addAll(["IA", "IB"]);
    else if (tok === "IV") addAll(["IV", "IVA", "IVB"]);
    else addAll(exp);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "stage-token" });
  }

  // Standalone roman tokens after "or"/"and" (e.g. "Stage III or IV") not already consumed.
  for (const m of text.matchAll(/\b(II[ABC]?|III[ABC]?|IV[AB]?)\b/gi)) {
    const already = accounted.some((a) => m.index >= a.from && m.index < a.to);
    if (already) continue;
    const tok = m[1].toUpperCase();
    const exp = expandStageRange(tok, tok);
    if (!exp) {
      complete = false;
      leftovers.push(m[0]);
      continue;
    }
    if (tok === "III") addAll(["IIIA", "IIIB", "IIIC"]);
    else if (tok === "II") addAll(["IIA", "IIB"]);
    else if (tok === "IV") addAll(["IV", "IVA", "IVB"]);
    else addAll(exp);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "bare-token" });
  }

  // Keyword phrases. If explicit stage tokens already exist, these qualifiers
  // are accounted for without widening the list (e.g. "IIIB/C or IV not amenable"
  // must not gain IIIA). If they are the only stage language, they expand.
  const hadExplicit = accounted.some((a) => ["range", "iii-slash", "iii-ab", "stage-token", "bare-token"].includes(a.name));
  for (const m of text.matchAll(/\b(?:recurrent or metastatic|metastatic or recurrent)\b/gi)) {
    if (!hadExplicit) addAll(["IV", "IVA", "IVB"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "recurrent-metastatic" });
  }
  for (const m of text.matchAll(/\bmetastatic\b/gi)) {
    const already = accounted.some((a) => m.index >= a.from && m.index < a.to);
    if (already) continue;
    if (!hadExplicit) addAll(["IV", "IVA", "IVB"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "metastatic" });
  }
  for (const m of text.matchAll(/\blocally advanced\b/gi)) {
    if (!hadExplicit) addAll(["IIIA", "IIIB", "IIIC"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "locally-advanced" });
  }
  for (const m of text.matchAll(/\bunresectable\b|\bnot amenable to (?:curative|definitive)(?:\s+treatment|\s+therapy)?\b|\bnot a candidate for definitive\b|\bnot eligible for curative(?:\s+surgery|\s+therapy)?\b|\bnot amenable to curative therapy\b/gi)) {
    if (!hadExplicit) addAll(["IIIA", "IIIB", "IIIC"]);
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "unresectable" });
  }
  // When a typed stage list already exists, "or recurrent" is a qualifier, not
  // a leftover that should demote a complete III/IV (or metastatic) list.
  // Recurrent alone still fails closed because it does not map onto a typed set.
  for (const m of text.matchAll(/\brecurrent\b/gi)) {
    const already = accounted.some((a) => m.index >= a.from && m.index < a.to);
    if (already) continue;
    if (hadExplicit || found.size > 0) {
      accounted.push({ from: m.index, to: m.index + m[0].length, name: "recurrent" });
    }
  }
  // Parenthetical N-descriptors attached to an already-accounted stage are consumed.
  for (const m of text.matchAll(/\(\s*N[0-3]\s*\)/gi)) {
    accounted.push({ from: m.index, to: m.index + m[0].length, name: "n-paren" });
  }

  // Mask accounted spans and look for leftover stage language.
  const chars = [...text];
  for (const a of accounted) {
    for (let i = a.from; i < a.to && i < chars.length; i++) chars[i] = " ";
  }
  const remainder = chars.join("");
  const leftoverMatch = remainder.match(/\b(?:stage|IIID|T[1-4]|N[0-3]|M[01]|locally advanced|unresectable|metastatic|recurrent)\b/i);
  if (leftoverMatch) {
    complete = false;
    leftovers.push(leftoverMatch[0]);
  }

  const stages = STAGE_ORDER.filter((s) => found.has(s));
  return { stages, complete: complete && stages.length > 0, leftovers };
}

function parseStage(span, section) {
  if (section !== "inclusion") return [];
  if (hasOpenException(span, "stage")) return [];
  const looksLikeStageCriterion =
    /\bstage\b/i.test(span) ||
    /\blocally advanced\b/i.test(span) ||
    /\b(?:histolog(?:ically|ic)|cytolog(?:ically|ic)|confirmed)\b[^.]{0,60}\bmetastatic\b/i.test(span) ||
    /\bmetastatic\s+NSCLC\b/i.test(span) ||
    /\bunresectable\b/i.test(span);
  if (!looksLikeStageCriterion) return [];
  // Passing mention in a treatment or prior-line-counting sentence is not a stage criterion,
  // even if the sentence names "Stage I-III disease" as history.
  if (/\b(?:do not count as a line|count as a line of therapy|lines? of therapy|systemic therapy for stage|treatment with systemic therapy for stage|prior (?:systemic )?therapy for stage)\b/i.test(span)) return [];
  if (/\b(?:treatment regimen|prior (?:systemic )?therapy|progressed|received)\b/i.test(span) && !/\bstage\b/i.test(span)) return [];
  const collected = collectStages(span);
  if (!collected.complete) return [];
  const stages = collected.stages;
  if (!stages.length) return [];
  if (!stages.some((s) => s.startsWith("III") || s.startsWith("IV")) && !/\bmetastatic\b/i.test(span)) return [];
  const quoteMatch = span.match(/.{0,40}(?:stage[^.]{0,80}|metastatic\s+NSCLC)[^.]{0,40}/i);
  const quote = quoteMatch ? quoteMatch[0].trim() : span;
  return [{ kind: "stage_in", polarity: "inclusion", stages, evidence_quote: quote.length >= 8 && quote.length < 240 ? quote : span, sourceText: span, section }];
}

function variantsIn(span, table) {
  return table.filter(([, re]) => re.test(span)).map(([name]) => name);
}

export function hasNegationCue(span) {
  return /\babsence of\b|\bnegative for\b|\bnegative test results?\b|\bdocumented negative\b|\bnot harbou?ring\b|\bno known\b|\bwild[\s-]?type\b|\bmust not have\b|\bshould not have\b|\bmust be (?:EGFR |ALK |ROS-?1 |KRAS |BRAF )?negative\b|\bwithout (?:a |an |known |any )?(?:actionable )?(?:EGFR|ALK|ROS|KRAS|BRAF|mutation|rearrangement|fusion)\b|\bwithout EGFR\b/i.test(
    span,
  );
}

export function hasPresenceCue(span) {
  return /\bmust have (?:a |an |documented |somatic |common |known )?(?:activat(?:ing|ed) |sensitis(?:ing|ing) )?(?:EGFR|ALK|ROS-?1|KRAS|BRAF)?.{0,30}\b(?:mutation|rearrangement|fusion|alteration)s?\b|\bmust be positive\b|\bharbou?ring\b|\bpositive for\b|\bknown to harbou?r\b|\bactivat(?:ing|ed)\s+sensitis(?:ing|ing) mutation must be present\b|\bmutation must be present\b/i.test(
    span,
  );
}

function requiredAbsence(span) {
  return (
    hasNegationCue(span) ||
    /\b(?:are|is)\s+excluded\b|\bnot eligible\b|\bineligible\b|\bpatients with these driver mutations are excluded\b|\btumors known to have the following alterations are excluded\b/i.test(
      span,
    )
  );
}

function requiredPresence(span) {
  if (hasNegationCue(span)) return false;
  return hasPresenceCue(span);
}

export function hasExampleHedge(span) {
  return /\bi\.?e\.?\b|\be\.?g\.?\b|\bsuch as\b|\bincluding\b|\bfor example\b/i.test(span);
}

export function hasProceduralCue(span) {
  return /\bto confirm\b|\bconfirm(?:ing)?\s+(?:EGFR|ALK|ROS|KRAS|BRAF)?.{0,24}\bstatus\b|\bconfirm(?:ed)? EGFR\/ALK status\b|\bbiomarker testing\b|\bavailable for (?:biomarker )?testing\b|\bsample available\b|\bbiops(?:y|ies)\b|\bassess(?:ed|ing|ment)?\b.{0,24}\bstatus\b|\bsequencing to confirm\b/i.test(
    span,
  );
}

function negationAndPresenceConflict(span) {
  return hasNegationCue(span) && hasPresenceCue(span);
}

function parseDrivers(span, section) {
  if (hasOpenException(span, "driver")) return [];
  if (hasProceduralCue(span)) return [];
  if (negationAndPresenceConflict(span)) return [];
  let mentioned = DRIVER_GENES.filter((g) => g.re.test(span));
  if (!mentioned.length) return [];
  const checks = [];
  const absence = requiredAbsence(span);
  const presence = requiredPresence(span);
  if (!absence && !presence) return [];
  // Example/hedge spans never produce a required-specific-variant check, and a
  // gene-level status would be a looser stand-in for a listed variant.
  if (hasExampleHedge(span) && (variantsIn(span, EGFR_VARIANTS).length || variantsIn(span, KRAS_VARIANTS).length)) {
    return [];
  }

  const polarity = section;
  const egfrVars = variantsIn(span, EGFR_VARIANTS);
  const krasVars = variantsIn(span, KRAS_VARIANTS);

  if (egfrVars.length && mentioned.some((g) => g.status === "egfr_status")) {
    // A listed variant is typed as variant_in, not a loose status, when the
    // sentence is about those variants (not a generic "EGFR and ALK" bar).
    const variantFocus = /exon\s*\d+|L858R|T790M|L861Q|S768I|G719X|sensitizing mutation/i.test(span);
    if (variantFocus) {
      const presenceVal = absence ? (polarity === "exclusion" ? "present" : "absent") : polarity === "inclusion" ? "present" : "absent";
      // For required absence of a listed resistance/exclusion variant (exon 20
      // insertions not eligible), emit exclusion+variant or inclusion we skip if polarity mismatches.
      if (absence && polarity === "exclusion") {
        checks.push({
          kind: "egfr_variant_in",
          polarity,
          stringValue: egfrVars.join(", "),
          evidence_quote: span,
          sourceText: span,
          section,
        });
      } else if (presence && polarity === "inclusion") {
        checks.push({
          kind: "egfr_variant_in",
          polarity,
          stringValue: egfrVars.join(", "),
          evidence_quote: span,
          sourceText: span,
          section,
        });
      }
      // Still emit status only if the sentence also bars/requires the gene generally
      // and is not solely a variant list. Fall through only when no variant check was added.
      if (checks.length) return boundStatusPolarity(checks, polarity, span, section);
      mentioned = mentioned.filter((g) => g.status !== "egfr_status");
    }
  }
  if (krasVars.length && mentioned.some((g) => g.status === "kras_status")) {
    if ((absence && polarity === "exclusion") || (presence && polarity === "inclusion")) {
      checks.push({
        kind: "kras_variant_in",
        polarity,
        stringValue: krasVars.join(", "),
        evidence_quote: span,
        sourceText: span,
        section,
      });
      return boundStatusPolarity(checks, polarity, span, section);
    }
    // inclusion + "no known KRAS G12C" cannot be a variant_in presence check, and a
    // gene-level status would be a looser (unsafe) stand-in. Demote this gene.
    mentioned = mentioned.filter((g) => g.status !== "kras_status");
  }

  const presenceVal = absence ? (polarity === "exclusion" ? "present" : "absent") : polarity === "inclusion" ? "present" : "absent";
  // If polarity cannot carry the intended meaning, skip (do not invert polarity).
  if (absence && polarity === "inclusion") {
    for (const g of mentioned) {
      checks.push({ kind: g.status, polarity: "inclusion", presence: "absent", evidence_quote: span, sourceText: span, section });
    }
    return checks;
  }
  if (absence && polarity === "exclusion") {
    for (const g of mentioned) {
      checks.push({ kind: g.status, polarity: "exclusion", presence: "present", evidence_quote: span, sourceText: span, section });
    }
    return checks;
  }
  if (presence && polarity === "inclusion") {
    for (const g of mentioned) {
      checks.push({ kind: g.status, polarity: "inclusion", presence: "present", evidence_quote: span, sourceText: span, section });
    }
    return checks;
  }
  if (presence && polarity === "exclusion") {
    for (const g of mentioned) {
      checks.push({ kind: g.status, polarity: "exclusion", presence: "absent", evidence_quote: span, sourceText: span, section });
    }
    return checks;
  }
  return [];
}

function boundStatusPolarity(checks, polarity, span, section) {
  return checks.map((c) => ({ ...c, evidence_quote: c.evidence_quote || span, sourceText: c.sourceText || span, section, polarity: c.polarity || polarity }));
}

function parsePriorLines(span, section) {
  if (hasOpenException(span, "prior")) return [];
  // Compound or conditional caps (different limits if concurrent vs sequential) cannot be a single number.
  if ((span.match(/no more than\s+\d+/gi) || []).length > 1) return [];
  if (/no more than\s+\d+[^.]{0,120}\bif\b/i.test(span) && /(?:concurrent|sequential|separate lines)/i.test(span)) return [];
  const checks = [];
  const noPrior = /\bno prior (?:systemic )?(?:treatment|therapy|chemotherapy|anti-cancer|anticancer)\b|\bnot have had any prior systemic\b|\btreatment[\s-]?naive\b|\bpreviously untreated\b|\bno previous systemic\b/i.test(
    span,
  );
  const atLeast = span.match(/\bat least\s+(one|1|two|2|three|3)\s+lines?\b|\breceived at least\s+(one|1)\s+line\b|\bat least\s+(one|1)\s+line of systemic\b|\bhas received (?:appropriate )?first[-\s]?line\b|\bmust have (?:received|progressed after)\b[^.]{0,40}(?:line|systemic therapy)/i);
  const maxN = span.match(/\b(?:no more than|up to|≤|<=)\s*(\d+)\s+prior lines?\b|\b(\d+)\s+or fewer prior lines?\b/i);

  if (noPrior) {
    if (section === "inclusion") {
      checks.push({ kind: "prior_lines_max", polarity: "inclusion", numberValue: 0, evidence_quote: span, sourceText: span, section });
    } else if (section === "exclusion") {
      // "No prior ..." listed under exclusion is too easy to invert. Demote.
      return [];
    }
  }
  if (atLeast && section === "inclusion") {
    const token = (atLeast[1] || atLeast[2] || atLeast[3] || "1").toLowerCase();
    const n = token === "one" ? 1 : token === "two" ? 2 : token === "three" ? 3 : Number(token);
    if (Number.isFinite(n)) {
      checks.push({ kind: "prior_lines_min", polarity: "inclusion", numberValue: n, evidence_quote: atLeast[0], sourceText: span, section });
    }
  }
  if (maxN && section === "inclusion") {
    const n = Number(maxN[1] || maxN[2]);
    if (Number.isFinite(n)) {
      checks.push({ kind: "prior_lines_max", polarity: "inclusion", numberValue: n, evidence_quote: maxN[0], sourceText: span, section });
    }
  }
  return checks;
}

function parsePriorTherapy(span, section) {
  if (hasOpenException(span, "prior")) return [];
  if (hasExampleHedge(span) || hasProceduralCue(span)) return [];
  // A conjunction of several required classes cannot be a single typed drug check.
  if (/\bAND\b/.test(span) && (span.match(/\b(?:inhibitor|chemotherapy|checkpoint|platinum)\b/gi) || []).length >= 2) {
    return [];
  }
  const hits = THERAPY_VOCAB.filter((t) => t.re.test(span));
  if (!hits.length) return [];
  const required = /\bmust have (?:previously )?(?:derived|received|been treated)\b|\bhave previously derived\b|\bmust have received\b|\bprior (?:treatment|therapy) with\b.*\brequired\b/i.test(
    span,
  );
  const excludedLang = /\bprior (?:treatment|therapy) with\b|\bprior [A-Za-z0-9+\/-].{0,40}treatment\b|\bnot allowed\b|\bmust not have (?:received|been treated)\b|\bare excluded\b/i.test(
    span,
  );
  const checks = [];
  for (const hit of hits) {
    const matched = span.match(hit.re);
    const stringValue = matched ? foldForMatch(matched[0]) : hit.canonical;
    if (section === "inclusion" && required && !excludedLang) {
      checks.push({
        kind: "prior_therapy_required",
        polarity: "inclusion",
        stringValue,
        evidence_quote: span,
        sourceText: span,
        section,
      });
    } else if (section === "exclusion" && (excludedLang || /\bprior\b/i.test(span)) && !required) {
      checks.push({
        kind: "prior_therapy_excluded",
        polarity: "exclusion",
        stringValue,
        evidence_quote: span,
        sourceText: span,
        section,
      });
    }
    // Inclusion "no prior osimertinib" cannot be encoded as inclusion +
    // prior_therapy_excluded with the current matcher, so it is demoted.
  }
  return checks;
}

function parseBrain(span, section) {
  if (!/\b(?:brain|CNS|central nervous system)\b/i.test(span) || !/\bmetastas/i.test(span)) return [];
  const untreatedOrActive = /\buntreated\b|\bknown active\b|\bactive (?:central nervous system|CNS|brain)\b|\buncontrolled\b|\bsymptomatic (?:and )?untreated\b/i.test(
    span,
  );
  const treatedAllowed = /\bunless\b[^.]{0,80}(?:treat(?:ed|ment)|stable|asymptomatic)|\btreated and (?:stable|inactive)\s+(?:CNS|brain|central)|\bstable (?:CNS|brain) metastas/i.test(
    span,
  );
  if (hasOpenException(span, "other") && !treatedAllowed) return [];

  if (section === "exclusion" && untreatedOrActive && !treatedAllowed) {
    return [
      {
        kind: "brain_mets",
        polarity: "exclusion",
        allowedBrainMets: ["untreated"],
        evidence_quote: span,
        sourceText: span,
        section,
      },
    ];
  }
  // "Brain metastases unless treated/stable" in an exclusion list is
  // judgment-equivalent to inclusion + [none, treated_stable].
  if (section === "exclusion" && treatedAllowed) {
    return [
      {
        kind: "brain_mets",
        polarity: "exclusion",
        allowedBrainMets: ["untreated"],
        evidence_quote: span,
        sourceText: span,
        section,
      },
    ];
  }
  if (section === "inclusion" && (treatedAllowed || /\bmust not have untreated\b|\bno untreated\b/i.test(span))) {
    return [
      {
        kind: "brain_mets",
        polarity: "inclusion",
        allowedBrainMets: ["none", "treated_stable"],
        evidence_quote: span,
        sourceText: span,
        section,
      },
    ];
  }
  if (section === "inclusion" && /\bno (?:known )?(?:brain|CNS|central nervous system) metastas/i.test(span) && !treatedAllowed && !untreatedOrActive) {
    return [
      {
        kind: "brain_mets",
        polarity: "inclusion",
        allowedBrainMets: ["none"],
        evidence_quote: span,
        sourceText: span,
        section,
      },
    ];
  }
  return [];
}

function labNumber(span, pattern) {
  const m = span.match(pattern);
  if (!m) return null;
  return { n: parseNumberToken(m[1]), quote: m[0], match: m };
}

function parseLabs(span, section) {
  if (section !== "inclusion") return [];
  if (hasOpenException(span, "labs")) return [];
  // Exception-population caps (Gilbert's, liver mets) are not the general threshold.
  if (/\bGilbert'?s?\b|\bliver metastas/i.test(span)) return [];
  const checks = [];

  const ancTimes = span.match(/\b(?:ANC|absolute neutrophil count)\b[^.]{0,40}?(\d+(?:\.\d+)?)\s*(?:[×x]\s*10\s*\^?\s*9|x10\^9|×10\^9)/i);
  const ancAbs = span.match(/\b(?:ANC|absolute neutrophil count)\b[^.]{0,40}?(?:≥|>=|>|at least|of at least)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(?:\/\s*(?:µ|u|μ)?L|per\s*(?:µ|u|μ)?L)?/i);
  if (ancTimes) {
    const n = Math.round(Number(ancTimes[1]) * 1000);
    if (n >= 500 && n <= 5000) {
      checks.push({ kind: "anc_min", polarity: "inclusion", numberValue: n, evidence_quote: ancTimes[0], sourceText: span, section });
    }
  } else if (ancAbs) {
    const n = parseNumberToken(ancAbs[1]);
    if (n != null && n >= 500 && n <= 5000) {
      checks.push({ kind: "anc_min", polarity: "inclusion", numberValue: n, evidence_quote: ancAbs[0], sourceText: span, section });
    }
  }

  const pltTimes = span.match(/\bplatelets?\b[^.]{0,50}?(\d+(?:\.\d+)?)\s*(?:[×x]\s*10\s*\^?\s*9)/i);
  const pltAbs = span.match(/\bplatelets?\b[^.]{0,50}?(?:≥|>=|>|at least)?\s*(\d{2,3}(?:,\d{3})+|\d{5,6})\b/i);
  if (pltTimes) {
    const n = Math.round(Number(pltTimes[1]) * 1000);
    if (n >= 25000 && n <= 500000) {
      checks.push({ kind: "platelets_min", polarity: "inclusion", numberValue: n, evidence_quote: pltTimes[0], sourceText: span, section });
    }
  } else if (pltAbs) {
    const n = parseNumberToken(pltAbs[1]);
    if (n != null && n >= 25000 && n <= 500000) {
      checks.push({ kind: "platelets_min", polarity: "inclusion", numberValue: n, evidence_quote: pltAbs[0], sourceText: span, section });
    }
  }

  const hgb = span.match(/\bhemoglobin\b[^.]{0,40}?(?:≥|>=|>|at least)?\s*(\d+(?:\.\d+)?)\s*(?:g\s*\/\s*dL|g\/dL)?/i);
  if (hgb) {
    const n = Number(hgb[1]);
    if (n >= 7 && n <= 15) {
      checks.push({ kind: "hemoglobin_min", polarity: "inclusion", numberValue: n, evidence_quote: hgb[0], sourceText: span, section });
    }
  }

  const bili = span.match(/\b(?:total\s+)?bilirubin\b[^.]{0,40}?(?:≤|<=|<|less than)?\s*(\d+(?:\.\d+)?)\s*(?:[×x]\s*(?:ULN|the upper)|mg\s*\/\s*dL)?/i);
  if (bili) {
    const n = Number(bili[1]);
    if (n > 0 && n <= 5) {
      checks.push({ kind: "bilirubin_max", polarity: "inclusion", numberValue: n, evidence_quote: bili[0], sourceText: span, section });
    }
  }

  const ast = span.match(/\b(?:AST|SGOT)\b[^.]{0,30}?(?:≤|<=|<)?\s*(\d+(?:\.\d+)?)\s*[×x]\s*(?:ULN|the upper)/i);
  if (ast) {
    const n = Number(ast[1]);
    if (n > 0 && n <= 10) checks.push({ kind: "ast_max", polarity: "inclusion", numberValue: n, evidence_quote: ast[0], sourceText: span, section });
  }
  const alt = span.match(/\b(?:ALT|SGPT)\b[^.]{0,30}?(?:≤|<=|<)?\s*(\d+(?:\.\d+)?)\s*[×x]\s*(?:ULN|the upper)/i);
  if (alt) {
    const n = Number(alt[1]);
    if (n > 0 && n <= 10) checks.push({ kind: "alt_max", polarity: "inclusion", numberValue: n, evidence_quote: alt[0], sourceText: span, section });
  }

  // Kidney function, not the EGFR gene.
  if (!/\bEGFR\s+(?:mutation|mutant|exon|TKI|gene|alter)/i.test(span) && !/\bEGFR\b/.test(span) || /\b(?:creatinine clearance|eGFR|estimated glomerular)\b/i.test(span)) {
    const clr = span.match(/\b(?:creatinine clearance|CrCl|eGFR|estimated glomerular filtration rate)\b[^.]{0,50}?(?:≥|>=|>|at least)?\s*(\d{2,3})\s*(?:mL\s*\/\s*min)?/i);
    if (clr) {
      const n = Number(clr[1]);
      if (n >= 20 && n <= 90) {
        checks.push({ kind: "egfr_min", polarity: "inclusion", numberValue: n, evidence_quote: clr[0], sourceText: span, section });
      }
    }
  }

  const creat = span.match(/\b(?:serum\s+)?creatinine\b[^.]{0,40}?(?:≤|<=|<)?\s*(\d+(?:\.\d+)?)\s*(?:mg\s*\/\s*dL|[×x]\s*ULN)/i);
  if (creat && !/\bcreatinine clearance\b/i.test(creat[0])) {
    const n = Number(creat[1]);
    if (n > 0 && n <= 5) {
      checks.push({ kind: "creatinine_max", polarity: "inclusion", numberValue: n, evidence_quote: creat[0], sourceText: span, section });
    }
  }

  return checks;
}

function parseAge(span, section) {
  if (section !== "inclusion") return [];
  const min = span.match(/\b(?:age[d]?|years of age|years old)\b[^.]{0,30}?(?:≥|>=|>|at least|or older)?\s*(\d{2})\s*(?:years)?|\b(\d{2})\s*years(?:\s*of age)?(?:\s*or older)?/i);
  if (!min) return [];
  const n = Number(min[1] || min[2]);
  if (n >= 16 && n <= 25) {
    return [{ kind: "age_min", polarity: "inclusion", numberValue: n, evidence_quote: min[0], sourceText: span, section }];
  }
  return [];
}

/**
 * Rule-based parse of one verbatim span in a known section.
 * Returns zero or more typed checks; never invents a polarity that disagrees with the section.
 */
export function normalizeSpan(quote, section, eligibilityText) {
  const span = foldForMatch(quote);
  if (!span) return { typedChecks: [], reason: "empty" };
  if (eligibilityText && !isVerbatimQuote(span, eligibilityText) && !isVerbatimQuote(span, foldForMatch(eligibilityText))) {
    return { typedChecks: [], reason: "quote is not a verbatim substring of the eligibility text" };
  }
  if (section !== "inclusion" && section !== "exclusion") {
    return { typedChecks: [], reason: "section is not inclusion or exclusion" };
  }
  const found = eligibilityText ? sectionContainingQuote(span, splitEligibilitySections(eligibilityText)) : section;
  if (eligibilityText && !polarityMatchesSection(section, found) && found !== section) {
    // If the caller already labeled the section and the quote lives only there, ok.
    if (found !== "both" && found !== section) {
      return { typedChecks: [], reason: `quote is in the ${found} section, not ${section}` };
    }
  }
  const checks = [
    ...parseEcog(span, section),
    ...parseStage(span, section),
    ...parseDrivers(span, section),
    ...parsePriorLines(span, section),
    ...parsePriorTherapy(span, section),
    ...parseBrain(span, section),
    ...parseLabs(span, section),
    ...parseAge(span, section),
  ];
  const gated = [];
  for (const check of checks) {
    const q = check.evidence_quote || span;
    if (!isVerbatimQuote(q, span) && !isVerbatimQuote(q, eligibilityText || span)) continue;
    if (check.polarity !== section) continue;
    if (check.numberValue != null && !numberAppearsInQuote(check.numberValue, q, check.kind)) continue;
    if ((check.kind === "egfr_variant_in" || check.kind === "kras_variant_in") && !variantsAppearInQuote(check.stringValue, q)) continue;
    gated.push({ ...check, evidence_quote: q, sourceText: check.sourceText || span, section });
  }
  return { typedChecks: gated, reason: gated.length ? "normalized" : "no deterministic type" };
}

function numberAppearsInQuote(n, quote, kind) {
  const q = foldForMatch(quote);
  if (kind === "anc_min" || kind === "platelets_min") {
    if (q.includes(String(n)) || q.includes(n.toLocaleString("en-US"))) return true;
    // 1.5 x 10^9/L == 1500; 100 x 10^9/L == 100000
    if (kind === "anc_min" && (n % 1000 === 0) && q.includes(String(n / 1000))) return true;
    if (kind === "platelets_min" && (n % 1000 === 0) && q.includes(String(n / 1000))) return true;
    return false;
  }
  if (Number.isInteger(n)) return new RegExp(`\\b${n}\\b`).test(q) || q.includes(String(n));
  return q.includes(String(n)) || q.includes(n.toFixed(1));
}

function variantsAppearInQuote(stringValue, quote) {
  const q = foldForMatch(quote);
  const parts = String(stringValue || "")
    .split(/,|\/|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => q.toLowerCase().includes(p.toLowerCase()));
}

function checkKey(check) {
  const val =
    check.numberValue != null
      ? `n:${check.numberValue}`
      : check.stringValue
        ? `s:${String(check.stringValue).toLowerCase()}`
        : check.presence
          ? `p:${check.presence}`
          : check.stages
            ? `st:${[...check.stages].sort().join(",")}`
            : check.allowedBrainMets
              ? `b:${[...check.allowedBrainMets].sort().join(",")}`
              : "empty";
  return `${check.kind}|${check.polarity}|${val}`;
}

export function flipPresence(p) {
  if (p === "present") return "absent";
  if (p === "absent") return "present";
  return null;
}

export function statusEncodingEquivalent(a, b) {
  if (!a || !b || a.kind !== b.kind || !STATUS_KINDS.has(a.kind)) return false;
  if (!a.presence || !b.presence) return false;
  if (a.polarity === b.polarity) return a.presence === b.presence;
  return b.presence === flipPresence(a.presence);
}

export function checksJudgmentEquivalent(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === "brain_mets") return brainAllowedEquivalent(a, b);
  if (STATUS_KINDS.has(a.kind)) return statusEncodingEquivalent(a, b);
  if (a.polarity !== b.polarity) return false;
  return checkKey(a) === checkKey(b);
}

function upsertCheck(typed, check) {
  const equiv = typed.find((t) => checksJudgmentEquivalent(t, check) || checkKey(t) === checkKey(check));
  if (equiv) return equiv;
  typed.push(check);
  return check;
}

function leftoverFuzzy(span, section, typed) {
  if (typed.some((t) => isVerbatimQuote(t.evidence_quote || t.sourceText, span) || isVerbatimQuote(span, t.sourceText || ""))) {
    return null;
  }
  if (!/\b(?:must|ECOG|stage|EGFR|ALK|ROS|KRAS|BRAF|brain|CNS|prior|hemoglobin|bilirubin|platelet|neutrophil|creatinine|eGFR)\b/i.test(span)) {
    return null;
  }
  return {
    id: `${section}-discuss`,
    polarity: section,
    sourceText: span,
    reasonFuzzy: "Could not be turned into a typed check with a verbatim, section-matched quote. Discuss with your care team.",
  };
}

/**
 * Scan public eligibility text and emit typed checks for the six key types
 * (plus a conservative age_min when the text states it). No model involved.
 */
export function extractTypedChecks(eligibilityCriteria, nctId, opts = {}) {
  const sections = splitEligibilitySections(eligibilityCriteria);
  const typed = [];
  const fuzzy = [];
  const actions = [];
  const idBase = nctId || "trial";
  let i = 0;

  const consider = (span, section) => {
    const out = normalizeSpan(span, section, eligibilityCriteria);
    if (out.typedChecks.length) {
      for (const check of out.typedChecks) {
        const found = sectionContainingQuote(check.evidence_quote, sections);
        if (!polarityMatchesSection(check.polarity, found) && found !== "both") {
          actions.push({ action: "demote-wrong-section", kind: check.kind, found });
          fuzzy.push({
            id: `${idBase}-d${i++}`,
            polarity: section,
            sourceText: check.evidence_quote,
            reasonFuzzy: `Evidence quote was not in the ${check.polarity} section.`,
          });
          continue;
        }
        const id = `${idBase}-${check.kind}-${i++}`;
        upsertCheck(typed, { ...check, id });
        actions.push({ action: "normalized", kind: check.kind, polarity: check.polarity, id });
      }
    } else {
      const f = leftoverFuzzy(span, section, typed);
      if (f) {
        f.id = `${idBase}-fz-${i++}`;
        fuzzy.push(f);
      }
    }
  };

  for (const span of splitSpans(sections.inclusion)) consider(span, "inclusion");
  for (const span of splitSpans(sections.exclusion)) consider(span, "exclusion");

  for (const span of opts.modelSpans || []) {
    const section = span.section === "exclusion" ? "exclusion" : span.section === "inclusion" ? "inclusion" : null;
    if (!section || !span.quote) continue;
    consider(span.quote, section);
  }

  if (opts.minimumAge && !typed.some((t) => t.kind === "age_min")) {
    const years = String(opts.minimumAge).match(/(\d+)/);
    // Structured age is not an eligibility-text quote, so it stays fuzzy (Discuss).
    if (years) {
      fuzzy.push({
        id: `${idBase}-age-structured`,
        polarity: "inclusion",
        sourceText: `minimumAge: ${opts.minimumAge}`,
        reasonFuzzy: "Age came from the structured minimumAge field, not a verbatim eligibility sentence.",
      });
    }
  }

  return {
    schemaVersion: "1",
    nctId: idBase,
    typedChecks: typed,
    fuzzyCriteria: fuzzy,
    postprocessActions: actions,
    parserModel: "deterministic-normalizer",
    promptVersion: "4-deterministic",
  };
}

/**
 * Keep a typed check only when both parses agree on kind and judgment-equivalent value.
 * Disagreements are demoted to fuzzyCriteria.
 */
export function consensusParses(parseA, parseB) {
  const typed = [];
  const fuzzy = [...(parseA.fuzzyCriteria || []), ...(parseB.fuzzyCriteria || [])];
  const b = parseB.typedChecks || [];
  for (const check of parseA.typedChecks || []) {
    const agree = b.some((t) => checksJudgmentEquivalent(t, check) || checkKey(t) === checkKey(check));
    if (agree) upsertCheck(typed, check);
    else {
      fuzzy.push({
        id: `${check.id || "c"}-disagree`,
        polarity: check.polarity,
        sourceText: check.evidence_quote || check.sourceText || "",
        reasonFuzzy: "Two parses did not agree on this typed check. Discuss with your care team.",
      });
    }
  }
  return {
    ...parseA,
    typedChecks: typed,
    fuzzyCriteria: fuzzy,
    parserModel: `${parseA.parserModel || "a"}+${parseB.parserModel || "b"}-consensus`,
  };
}
