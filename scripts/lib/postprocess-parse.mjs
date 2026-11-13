/**
 * Deterministic post-processing for cloud eligibility-parser output.
 * Operates on public trial text plus the model's JSON. Does not use gold labels or persona text.
 */

export const BRAIN_STATUSES = ["none", "treated_stable", "untreated"];

export function normalizeEligibility(text) {
  return String(text || "")
    .replace(/\\>/g, ">")
    .replace(/\\</g, "<")
    .replace(/\\&/g, "&")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function complementBrain(list) {
  const have = new Set(list || []);
  return BRAIN_STATUSES.filter((s) => !have.has(s));
}

function sameSet(a, b) {
  const A = new Set(a || []);
  const B = new Set(b || []);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

/** inclusion + allowed ≡ exclusion + complement(allowed) */
export function brainAllowedEquivalent(checkA, checkB) {
  if (!checkA || !checkB) return false;
  const canon = (c) =>
    c.polarity === "inclusion" ? [...(c.allowedBrainMets || [])] : complementBrain(c.allowedBrainMets);
  return sameSet(canon(checkA), canon(checkB));
}

export const STATUS_KINDS = new Set(["egfr_status", "alk_status", "kras_status", "ros1_status", "braf_status"]);

export function flipPresence(p) {
  if (p === "present") return "absent";
  if (p === "absent") return "present";
  return null;
}

/** inclusion+absent ≡ exclusion+present (and the reverse) for biomarker status kinds. */
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
  return false;
}

function valueKey(check) {
  if (check.numberValue != null) return `n:${check.numberValue}`;
  if (check.stringValue) return `s:${String(check.stringValue).toLowerCase()}`;
  if (check.presence) return `p:${check.presence}`;
  if (check.stages) return `st:${[...check.stages].sort().join(",")}`;
  if (check.histologies) return `h:${[...check.histologies].sort().join(",")}`;
  if (check.allowedBrainMets) return `b:${[...check.allowedBrainMets].sort().join(",")}`;
  return "empty";
}

function findExisting(typed, kind, polarity, valueLike) {
  return typed.find((t) => t.kind === kind && t.polarity === polarity && valueKey(t) === valueKey(valueLike));
}

function upsert(typed, added, check) {
  const existing = findExisting(typed, check.kind, check.polarity, check);
  if (existing) {
    if (check.exceptions && !existing.exceptions) existing.exceptions = check.exceptions;
    if (check.sourceText && (!existing.sourceText || existing.sourceText.length < check.sourceText.length)) {
      existing.sourceText = check.sourceText;
    }
    return existing;
  }
  typed.push(check);
  added.push({ action: "added", kind: check.kind, polarity: check.polarity, id: check.id });
  return check;
}

function looksLikeMustNotUntreated(s) {
  return /must not have untreated|should not have untreated|no untreated (cns|central nervous system|brain) metastas/i.test(
    s,
  );
}

function looksLikeKnownActiveCns(s) {
  return /known active (central nervous system|cns) metastas/i.test(s);
}

function canonicalizeBrain(typed, text, nctId, added) {
  for (const check of typed) {
    if (check.kind !== "brain_mets") continue;
    const src = `${check.sourceText || ""} ${text}`;
    if (looksLikeMustNotUntreated(check.sourceText || "") || (looksLikeMustNotUntreated(text) && looksLikeMustNotUntreated(src))) {
      const before = { polarity: check.polarity, allowedBrainMets: check.allowedBrainMets };
      check.polarity = "inclusion";
      check.allowedBrainMets = ["none", "treated_stable"];
      if (before.polarity !== check.polarity || !sameSet(before.allowedBrainMets, check.allowedBrainMets)) {
        added.push({ action: "canonicalize-brain", id: check.id, from: before, to: { polarity: check.polarity, allowedBrainMets: check.allowedBrainMets } });
      }
      continue;
    }
    if (looksLikeKnownActiveCns(check.sourceText || "")) {
      const before = { polarity: check.polarity, allowedBrainMets: check.allowedBrainMets };
      check.polarity = "exclusion";
      check.allowedBrainMets = ["untreated"];
      if (before.polarity !== check.polarity || !sameSet(before.allowedBrainMets, check.allowedBrainMets)) {
        added.push({ action: "canonicalize-brain", id: check.id, from: before, to: { polarity: check.polarity, allowedBrainMets: check.allowedBrainMets } });
      }
      continue;
    }
    // Unsafe invert: exclusion whose list is the allowed statuses, not the excluded ones.
    if (check.polarity === "exclusion" && sameSet(check.allowedBrainMets, ["none", "treated_stable"])) {
      check.polarity = "inclusion";
      added.push({ action: "canonicalize-brain-unsafe-invert", id: check.id });
    }
  }

  if (looksLikeMustNotUntreated(text)) {
    const has = typed.some(
      (t) =>
        t.kind === "brain_mets" &&
        t.polarity === "inclusion" &&
        sameSet(t.allowedBrainMets, ["none", "treated_stable"]),
    );
    if (!has) {
      const sentence = (text.match(/[^.]*must not have untreated[^.]*\./i) || ["Participants must not have untreated central nervous system (CNS) metastases."])[0].trim();
      upsert(typed, added, {
        id: `${nctId}-post-brain-no-untreated`,
        kind: "brain_mets",
        polarity: "inclusion",
        sourceText: sentence,
        allowedBrainMets: ["none", "treated_stable"],
      });
    }
  }

  if (looksLikeKnownActiveCns(text)) {
    const has = typed.some(
      (t) => t.kind === "brain_mets" && t.polarity === "exclusion" && sameSet(t.allowedBrainMets, ["untreated"]),
    );
    if (!has) {
      const sentence = (text.match(/[^.]*known active (central nervous system|cns) metastas[^.]*\./i) || [""])[0].trim();
      upsert(typed, added, {
        id: `${nctId}-post-brain-active`,
        kind: "brain_mets",
        polarity: "exclusion",
        sourceText: sentence || "Has known active central nervous system (CNS) metastases",
        allowedBrainMets: ["untreated"],
      });
    }
  }
}

function addRenalEgfrMin(typed, text, nctId, added) {
  const found = [];
  const patterns = [
    /creatinine\s+clearance\s*(?:≥|>=|>|of at least|at least)?\s*(\d+(?:\.\d+)?)\s*(?:mL\s*\/\s*min)?/gi,
    /(?:\beGFR\b|\be-GFR\b|estimated\s+GFR|estimated\s+glomerular\s+filtration\s+rate)\s*(?:≥|>=|>|of at least|at least)?\s*(\d+(?:\.\d+)?)/gi,
    /serum creatinine or creatinine clearance\s+(?:within normal limits\s+or\s+)?(?:≥|>=|>)?\s*(\d+(?:\.\d+)?)\s*mL\s*\/\s*min/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n < 15 || n > 200) continue; // drop obvious non-GFR numbers
      const start = Math.max(0, m.index - 80);
      const snippet = text.slice(start, m.index + m[0].length + 160);
      found.push({ n, snippet, raw: m[0] });
    }
  }
  // Prefer unique cutoffs; if several, emit each once.
  const seen = new Set();
  for (const item of found) {
    if (seen.has(item.n)) continue;
    seen.add(item.n);
    const orCreatinine = /within normal (institutional )?limits/i.test(item.snippet) || /serum creatinine or creatinine clearance/i.test(item.snippet);
    const qualifier = /for subjects with|with above normal AST|alkaline phosphatase/i.test(item.snippet)
      ? item.snippet.trim()
      : orCreatinine
        ? "Serum creatinine within normal limits is an accepted alternative to this clearance cutoff."
        : undefined;
    upsert(typed, added, {
      id: `${nctId}-post-egfr-min-${item.n}`,
      kind: "egfr_min",
      polarity: "inclusion",
      sourceText: item.snippet.trim(),
      numberValue: item.n,
      ...(qualifier ? { exceptions: qualifier } : {}),
    });
  }
}

const VARIANT_TOKEN_RE =
  /exon\s*\d+\s*(?:deletions?|insertions?|ins|del)|L858R|T790M|C797S|L861Q|S768I|E709X|G719X|G719[A-Z]|G12C|G12D|G12V|L858\b/gi;

function extractVariantTokens(blob) {
  const tokens = [];
  const seen = new Set();
  let m;
  const re = new RegExp(VARIANT_TOKEN_RE.source, "gi");
  while ((m = re.exec(blob))) {
    let tok = m[0].replace(/\s+/g, " ").trim();
    tok = tok.replace(/deletions$/i, "deletion").replace(/insertions$/i, "insertion").replace(/\bins\b/i, "insertion").replace(/\bdel\b/i, "deletion");
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(tok);
  }
  return tokens;
}

function addExampleVariants(typed, text, nctId, added) {
  // Do not split on the dots inside "e.g." / "i.e.". Capture the example list in parentheses or after a cue.
  const listRe =
    /\b(EGFR|KRAS)\b[\s\S]{0,160}?(?:e\.g\.|i\.e\.|for example|including but not limited to|such as)[:\s]+(?:but not limited to\s+)?([^)]+)\)/gi;
  let m;
  while ((m = listRe.exec(text))) {
    const gene = m[1].toLowerCase();
    const sentence = text.slice(Math.max(0, m.index - 80), m.index + m[0].length + 20).trim();
    const isExclusion = /are not eligible|is not eligible|must not have|non-sensitizing/i.test(sentence);
    const tokens = extractVariantTokens(m[2] + " " + sentence);
    if (!tokens.length) continue;
    const kind = gene === "kras" ? "kras_variant_in" : "egfr_variant_in";
    const polarity = isExclusion ? "exclusion" : "inclusion";
    upsert(typed, added, {
      id: `${nctId}-post-${kind}-${polarity}`,
      kind,
      polarity,
      sourceText: sentence,
      stringValue: tokens.join(", "),
    });
  }
}

function addPriorRules(typed, text, nctId, added) {
  if (
    /must not have had any prior systemic (treatment|therapy) for metastatic disease/i.test(text) ||
    /has not received prior systemic treatment for (their )?metastatic/i.test(text) ||
    /no prior systemic (anti-cancer )?therapy given as primary therapy for (advanced or )?metastatic/i.test(text)
  ) {
    const sentence = (text.match(/[^.]*prior systemic[^.]*metastatic[^.]*\./i) || ["Patient must not have had any prior systemic treatment for metastatic disease."])[0].trim();
    upsert(typed, added, {
      id: `${nctId}-post-prior-lines-max-0`,
      kind: "prior_lines_max",
      polarity: "inclusion",
      sourceText: sentence,
      numberValue: 0,
      exceptions: "This line limit applies to systemic treatment for metastatic or advanced disease.",
    });
  }

  if (
    /must have received at least (?:one|1) line of systemic therapy/i.test(text) ||
    /received at least (?:one|1) (?:prior )?line of systemic therapy/i.test(text)
  ) {
    const sentence = (text.match(/[^.]*at least (?:one|1) line of systemic therapy[^.]*\./i) || [""])[0].trim();
    const unless = (text.match(/at least (?:one|1) line of systemic therapy[^.]*?(\.[^.]*(?:platinum|anti-PD)[^.]*)/i) || [])[1];
    upsert(typed, added, {
      id: `${nctId}-post-prior-lines-min-1`,
      kind: "prior_lines_min",
      polarity: "inclusion",
      sourceText: sentence || "patients must have received at least one line of systemic therapy",
      numberValue: 1,
      ...(unless ? { exceptions: unless.trim() } : { exceptions: "Later clauses may narrow the required prior regimen (for example platinum or anti-PD-1/PD-L1)." }),
    });
  }

  const tki = text.match(/prior treatment with an egfr tki is not allowed(.{0,500}?)(?:patient must not|patients that have received prior radiation|\*|\n\n|$)/i);
  if (tki || /prior treatment with an egfr tki is not allowed/i.test(text)) {
    const block = tki ? tki[0] : (text.match(/[^.]*prior treatment with an egfr tki is not allowed[^.]*\./i) || [""])[0];
    const however = (block.match(/however[^.]*\./i) || [block])[0];
    const source = (text.match(/[^.]*prior treatment with an egfr tki is not allowed[\s\S]{0,400}?eligible[^.]*\./i) || [block])[0] || block;
    upsert(typed, added, {
      id: `${nctId}-post-prior-egfr-tki`,
      kind: "prior_therapy_excluded",
      polarity: "exclusion",
      sourceText: source.trim(),
      stringValue: "EGFR TKI",
      exceptions: however.trim(),
    });
    if (/osimertinib/i.test(block)) {
      upsert(typed, added, {
        id: `${nctId}-post-prior-osimertinib`,
        kind: "prior_therapy_excluded",
        polarity: "exclusion",
        sourceText: source.trim(),
        stringValue: "osimertinib",
        exceptions: however.trim(),
      });
    }
  }
}

function addBiomarkerExclusions(typed, text, nctId, added) {
  const m = text.match(/patients with known egfr[\s\S]{0,280}?are not eligible(?:\s+unless [^.]+)?\.?/i);
  if (!m) return;
  const sentence = m[0].trim();
  const unless = (sentence.match(/unless ([^.]+)/i) || [])[1];
  const exceptions = unless ? `Unless ${unless.trim().replace(/\.$/, "")}.` : undefined;
  const geneKinds = [
    { re: /EGFR/i, kind: "egfr_status" },
    { re: /\bALK\b/i, kind: "alk_status" },
    { re: /ROS\s*-?\s*1/i, kind: "ros1_status" },
    { re: /\bBRAF\b/i, kind: "braf_status" },
  ];
  for (const g of geneKinds) {
    if (!g.re.test(sentence)) continue;
    upsert(typed, added, {
      id: `${nctId}-post-${g.kind}-excl`,
      kind: g.kind,
      polarity: "exclusion",
      sourceText: sentence,
      presence: "present",
      ...(exceptions ? { exceptions } : {}),
    });
  }
}

/**
 * @param {object} parsed model JSON
 * @param {string} eligibilityCriteria public eligibility text
 * @param {string} nctId
 */

const STAGE_ORDER = ["IA", "IB", "IIA", "IIB", "IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"];

function expandAdvancedStages(typed, text, added) {
  for (const check of typed) {
    if (check.kind !== "stage_in" || !Array.isArray(check.stages)) continue;
    const stages = new Set(check.stages);
    const blob = `${check.sourceText || ""} ${text || ""}`;
    const hasIv = stages.has("IV") || stages.has("IVA") || stages.has("IVB") || /stage IV\b/i.test(blob);
    if (hasIv) {
      stages.add("IV");
      stages.add("IVA");
      stages.add("IVB");
    }
    // Older records say "IIIB not amenable to definitive therapy" for unresectable III, which in AJCC 8 includes IIIC.
    const hasIiib = stages.has("IIIB") || /stage IIIB\b/i.test(check.sourceText || "");
    const unresectableIii = /not amenable to (definitive|curative)|unresectable|locally advanced/i.test(blob);
    if (hasIiib && (hasIv || unresectableIii)) {
      stages.add("IIIB");
      stages.add("IIIC");
    }
    const next = STAGE_ORDER.filter((s) => stages.has(s));
    if (next.join(",") !== (check.stages || []).join(",")) {
      added.push({ action: "expand-stages", id: check.id, from: check.stages, to: next });
      check.stages = next;
    }
  }
}

export function postprocessParse(parsed, eligibilityCriteria, nctId) {
  const text = normalizeEligibility(eligibilityCriteria);
  const typed = Array.isArray(parsed?.typedChecks) ? parsed.typedChecks.map((t) => ({ ...t })) : [];
  const fuzzy = Array.isArray(parsed?.fuzzyCriteria) ? parsed.fuzzyCriteria.map((f) => ({ ...f })) : [];
  const added = [];
  canonicalizeBrain(typed, text, nctId || parsed?.nctId || "unknown", added);
  expandAdvancedStages(typed, text, added);
  addRenalEgfrMin(typed, text, nctId || parsed?.nctId || "unknown", added);
  addExampleVariants(typed, text, nctId || parsed?.nctId || "unknown", added);
  addPriorRules(typed, text, nctId || parsed?.nctId || "unknown", added);
  addBiomarkerExclusions(typed, text, nctId || parsed?.nctId || "unknown", added);
  return {
    ...parsed,
    typedChecks: typed,
    fuzzyCriteria: fuzzy,
    postprocessActions: added,
  };
}

export function valuesMatchGold(gold, emitted) {
  if (gold.numberValue != null) {
    if (typeof emitted.numberValue !== "number") return false;
    return emitted.numberValue === gold.numberValue;
  }
  if (gold.stringValue) {
    const got = String(emitted.stringValue || "").toLowerCase();
    const want = String(gold.stringValue).toLowerCase();
    return got.includes(want) || want.includes(got);
  }
  if (gold.presence) return emitted.presence === gold.presence;
  if (gold.stages) {
    const got = new Set(emitted.stages || []);
    return gold.stages.every((s) => got.has(s));
  }
  if (gold.histologies) {
    const got = new Set(emitted.histologies || []);
    return gold.histologies.every((h) => got.has(h));
  }
  if (gold.allowedBrainMets) {
    const got = new Set(emitted.allowedBrainMets || []);
    return gold.allowedBrainMets.every((v) => got.has(v)) && (emitted.allowedBrainMets || []).every((v) => gold.allowedBrainMets.includes(v));
  }
  return true;
}

function sourceOverlap(a, b) {
  const A = String(a || "").toLowerCase();
  const B = String(b || "").toLowerCase();
  if (!A || !B) return false;
  return A.includes(B.slice(0, 40)) || B.includes(A.slice(0, 40));
}

function topicCompetes(gold, check) {
  if (check.kind === gold.kind) return true;
  if (gold.kind === "egfr_variant_in" && check.kind === "egfr_status" && sourceOverlap(gold.sourceText, check.sourceText)) return true;
  if (gold.kind === "kras_variant_in" && check.kind === "kras_status" && sourceOverlap(gold.sourceText, check.sourceText)) return true;
  if (gold.kind === "egfr_min" && check.kind === "egfr_status") return false;
  if (gold.kind === "prior_therapy_excluded" && check.kind === "prior_therapy_excluded") {
    // A different named drug from a different sentence is not a competing wrong value for this gold item.
    return sourceOverlap(gold.sourceText, check.sourceText) || valuesMatchGold(gold, check);
  }
  if (gold.kind === "prior_lines_max" || gold.kind === "prior_lines_min") {
    return check.kind === gold.kind;
  }
  return false;
}

/**
 * Classify an official miss as safe (left fuzzy / omitted, on-device judge handles it)
 * or unsafe (a typed check that could wrongly include or exclude).
 * Official hits are neither.
 */
export function classifyMissSafety(gold, parsed) {
  const typed = parsed?.typedChecks || [];
  const fuzzy = parsed?.fuzzyCriteria || [];

  if (gold.kind === "fuzzy") {
    const fuzzyHit = fuzzy.some((f) => sourceOverlap(f.sourceText, gold.sourceText));
    const typedWrong = typed.some((t) => sourceOverlap(t.sourceText, gold.sourceText));
    if (fuzzyHit && !typedWrong) return { safety: "not_a_miss", reason: "fuzzy hit" };
    if (typedWrong) return { safety: "unsafe", reason: "subjective item was typed and could gate a patient wrongly" };
    return { safety: "safe", reason: "not found in fuzzyCriteria, and no competing typed check" };
  }

  const kindHits = typed.filter((t) => t.kind === gold.kind);
  const kindPolarityHits = kindHits.filter((t) => t.polarity === gold.polarity);
  const valued = kindPolarityHits.find((t) => valuesMatchGold(gold, t));
  if (valued) return { safety: "not_a_miss", reason: "official hit" };

  const equivalent = kindHits.find((t) => checksJudgmentEquivalent(gold, t));
  if (equivalent) return { safety: "not_a_miss", reason: "matcher-equivalent encoding (same judgments)" };

  const sameKindWrongValue = kindPolarityHits.filter((t) => !valuesMatchGold(gold, t));
  if (sameKindWrongValue.length) {
    return { safety: "unsafe", reason: `same kind and polarity with a non-matching value (${sameKindWrongValue.map((t) => valueKey(t)).join(", ")})` };
  }

  const sameKindOppPolarity = kindHits.filter((t) => t.polarity !== gold.polarity);
  const nonEquivalentOpp = sameKindOppPolarity.filter((t) => !checksJudgmentEquivalent(gold, t));
  if (nonEquivalentOpp.length) {
    return { safety: "unsafe", reason: "same kind with opposite polarity that is not judgment-equivalent" };
  }

  const competing = typed.filter((t) => topicCompetes(gold, t) && !(t.kind === gold.kind && t.polarity === gold.polarity && valuesMatchGold(gold, t)));
  // egfr_status on the same source as a missed variant_in is a looser gate.
  const looserStatus = competing.find((t) => gold.kind.endsWith("_variant_in") && t.kind.endsWith("_status") && sourceOverlap(gold.sourceText, t.sourceText));
  if (looserStatus) {
    return { safety: "unsafe", reason: "presence status was typed instead of the listed variant, which can include the wrong variant" };
  }

  const leftFuzzy = fuzzy.some((f) => sourceOverlap(f.sourceText, gold.sourceText));
  if (leftFuzzy) return { safety: "safe", reason: "left fuzzy so the on-device judge can handle it" };
  return { safety: "safe", reason: "omitted from typedChecks with no competing wrong typed check" };
}

export function scoreItem(gold, parsed) {
  if (gold.kind === "fuzzy") {
    const fuzzyHit = (parsed.fuzzyCriteria || []).some((f) => sourceOverlap(f.sourceText, gold.sourceText));
    const typedWrong = (parsed.typedChecks || []).some((t) => sourceOverlap(t.sourceText, gold.sourceText));
    if (fuzzyHit && !typedWrong) return { verdict: "hit", detail: "left fuzzy" };
    if (typedWrong) return { verdict: "miss", detail: "incorrectly typed" };
    return { verdict: "miss", detail: "not found in fuzzyCriteria" };
  }
  const sameKind = (parsed.typedChecks || []).filter((t) => t.kind === gold.kind);
  const exact = sameKind.find((t) => t.polarity === gold.polarity && valuesMatchGold(gold, t));
  if (exact) return { verdict: "hit", detail: "kind, polarity, and value matched" };
  const equivalent = sameKind.find((t) => checksJudgmentEquivalent(gold, t));
  if (equivalent) return { verdict: "hit", detail: "matcher-equivalent encoding (same judgments, different polarity or presence form)" };
  const matches = sameKind.filter((t) => t.polarity === gold.polarity);
  if (!matches.length) {
    const kinds = (parsed.typedChecks || []).map((t) => `${t.kind}/${t.polarity}`).join(", ") || "none";
    return { verdict: "miss", detail: `no typed check with same kind and polarity (emitted: ${kinds})` };
  }
  const near = matches
    .map((t) =>
      JSON.stringify({
        numberValue: t.numberValue,
        stringValue: t.stringValue,
        presence: t.presence,
        stages: t.stages,
        histologies: t.histologies,
        allowedBrainMets: t.allowedBrainMets,
        exceptions: t.exceptions,
      }),
    )
    .join("; ");
  return { verdict: "miss", detail: `kind and polarity matched, value did not (emitted ${near})` };
}
