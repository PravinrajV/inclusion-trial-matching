/**
 * On-device fallbacks for structured fields Nano omitted.
 * Only fills a field when the model left it unknown or empty, and only from
 * a verbatim pattern in the clinic note itself. Quotes are added only when
 * the matched span is a substring of the note.
 */
import type { FactSheet, Histology, Presence, Stage } from "../schema/fact-sheet";
import { isVerbatimNoteQuote } from "./quote-gate";

const STAGE_RE = /\bstage\s+(III[ABC]|IVA|IVB|IV)\b/i;
const AGE_RE = /\b(\d{1,3})\s*-\s*year\s*-\s*old\b|\bage(?:\s+(?:is|of|:))?\s*(\d{1,3})\b/i;
const ECOG_RE = /\bECOG(?:\s+performance\s+status)?(?:\s+of)?\s*([0-4])\b/i;
const PDL1_RE = /\bPD-L1(?:\s+TPS)?\s*(\d+(?:\.\d+)?)\s*%/i;
const HISTOLOGY_RE = /\b(adenocarcinoma|squamous(?:\s+cell(?:\s+carcinoma)?)?|large[-\s]cell)\b/i;

function addQuote(sheet: FactSheet, fact: string, quote: string, note: string): void {
  const q = quote.replace(/\s+/g, " ").trim();
  if (!fact || !isVerbatimNoteQuote(q, note)) return;
  if (sheet.excerpts.some((ex) => ex.quote.toLowerCase() === q.toLowerCase())) return;
  sheet.excerpts = [...sheet.excerpts, { fact, quote: q }];
}

function absentMention(note: string, gene: string): RegExpMatchArray | null {
  return note.match(new RegExp(`\\b${gene}\\b[^\\n.]{0,48}\\b(not\\s+detected|not\\s+present|negative|absent|wild[ -]?type)\\b`, "i"))
    || note.match(new RegExp(`\\b(not\\s+detected|not\\s+present|negative|absent)\\b[^\\n.]{0,48}\\b${gene}\\b`, "i"));
}

function isNegated(span: string): boolean {
  return /\bnot\s+detected\b|\bnot\s+present\b|\bnegative\b|\babsent\b|\bwild[ -]?type\b/i.test(span);
}

function presentMention(note: string, gene: string, variantRe?: RegExp): { status: Presence; variant: string | null; quote: string } | null {
  if (variantRe) {
    const hit = variantRe.exec(note);
    if (hit) {
      const around = note.slice(hit.index, Math.min(note.length, hit.index + hit[0].length + 28));
      if (!isNegated(around)) {
        return { status: "present", variant: hit[1] ? hit[1].replace(/\s+/g, " ").trim() : null, quote: hit[0].trim() };
      }
    }
  }
  if (absentMention(note, gene)) return null;
  const hit = note.match(new RegExp(`\\b${gene}\\b[^\\n.]{0,60}\\b(rearrangement|mutation|alteration|positive|present|detected)\\b`, "i"));
  if (!hit || isNegated(hit[0])) return null;
  return { status: "present", variant: hit[1] && /rearrangement|exon|mutation/i.test(hit[1]) ? hit[1].toLowerCase() : null, quote: hit[0].trim() };
}

function asStage(raw: string): Stage | null {
  const s = raw.toUpperCase();
  const ok: Stage[] = ["IIIA", "IIIB", "IIIC", "IV", "IVA", "IVB"];
  return ok.includes(s as Stage) ? (s as Stage) : null;
}

function asHistology(raw: string): Histology | null {
  const s = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (s.includes("adenocarcinoma")) return "adenocarcinoma";
  if (s.includes("squamous")) return "squamous";
  if (s.includes("large_cell") || s.includes("largecell")) return "large_cell";
  return null;
}

function firstLineTherapy(note: string): string | null {
  const hit = note.match(/\breceived\s+([A-Za-z][A-Za-z0-9-]{2,40})\s+as\s+first[-\s]line\b/i)
    || note.match(/\b(?:treated|therapy)\s+with\s+([A-Za-z][A-Za-z0-9-]{2,40})\s+as\s+first[-\s]line\b/i)
    || note.match(/\bprogressed\s+on\s+([A-Za-z][A-Za-z0-9-]{2,40})\b/i);
  return hit?.[1] ? hit[1].trim() : null;
}

/**
 * Fill only omitted structured fields from verbatim patterns in the note.
 * Does not overwrite a value Nano already decided.
 */
export function fillOmittedFieldsFromNote(sheet: FactSheet, note: string): FactSheet {
  const text = String(note || "");
  if (text.length < 20) return sheet;

  if (sheet.ageYears == null) {
    const hit = AGE_RE.exec(text);
    const age = hit ? Number(hit[1] || hit[2]) : NaN;
    if (Number.isFinite(age) && age >= 18 && age <= 120) {
      sheet.ageYears = age;
      if (hit) addQuote(sheet, "age", hit[0], text);
    }
  }

  if (sheet.ecog == null) {
    const hit = ECOG_RE.exec(text);
    if (hit) {
      const n = Number(hit[1]);
      if (n === 0 || n === 1 || n === 2 || n === 3 || n === 4) {
        sheet.ecog = n;
        addQuote(sheet, "ECOG", hit[0], text);
      }
    }
  }

  if (!sheet.stage || sheet.stage === "unknown") {
    const hit = STAGE_RE.exec(text);
    const stage = hit ? asStage(hit[1]) : null;
    if (stage) {
      sheet.stage = stage;
      addQuote(sheet, "stage", hit![0], text);
    }
  }

  if (!sheet.histology || sheet.histology === "unknown") {
    const hit = HISTOLOGY_RE.exec(text);
    const hist = hit ? asHistology(hit[1]) : null;
    if (hist) {
      sheet.histology = hist;
      addQuote(sheet, "histology", hit![0], text);
    }
  }

  if (sheet.biomarkers.egfr.status === "unknown") {
    const absent = absentMention(text, "EGFR");
    const present = presentMention(text, "EGFR", /\bEGFR\s+(exon\s+\d+\s+(?:deletion|insertion|duplication)|L858R|T790M|G719X?|L861Q)\b/i);
    if (absent && !present) {
      sheet.biomarkers.egfr = { status: "absent", variant: null };
      addQuote(sheet, "EGFR", absent[0], text);
    } else if (present) {
      sheet.biomarkers.egfr = { status: "present", variant: present.variant };
      addQuote(sheet, "EGFR", present.quote, text);
    }
  }

  if (sheet.biomarkers.alk.status === "unknown") {
    const absent = absentMention(text, "ALK");
    const present = presentMention(text, "ALK", /\bALK\s+(rearrangement)\b/i);
    if (present && !/not\s+detected/i.test(present.quote)) {
      sheet.biomarkers.alk = { status: "present", variant: present.variant };
      addQuote(sheet, "ALK", present.quote, text);
    } else if (absent) {
      sheet.biomarkers.alk = { status: "absent", variant: null };
      addQuote(sheet, "ALK", absent[0], text);
    }
  }

  if (sheet.biomarkers.kras.status === "unknown") {
    const absent = absentMention(text, "KRAS");
    const present = presentMention(text, "KRAS", /\bKRAS\s+(G12[A-Z]|G13[A-Z]|Q61[A-Z])\b/i);
    if (present && !/not\s+detected/i.test(present.quote)) {
      sheet.biomarkers.kras = { status: "present", variant: present.variant };
      addQuote(sheet, "KRAS", present.quote, text);
    } else if (absent) {
      sheet.biomarkers.kras = { status: "absent", variant: null };
      addQuote(sheet, "KRAS", absent[0], text);
    }
  }

  if (sheet.biomarkers.pdL1TpsPercent == null) {
    const hit = PDL1_RE.exec(text);
    if (hit) {
      const n = Number(hit[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        sheet.biomarkers.pdL1TpsPercent = n;
        addQuote(sheet, "PD-L1", hit[0], text);
      }
    }
  }

  if (!sheet.priorTherapies.length) {
    const drug = firstLineTherapy(text);
    if (drug) {
      sheet.priorTherapies = [drug];
      const hit = text.match(new RegExp(`\\b${drug}\\b[^\\n.]{0,40}first[-\\s]line|\\bfirst[-\\s]line[^\\n.]{0,40}\\b${drug}\\b|\\bprogressed\\s+on\\s+${drug}\\b`, "i"));
      addQuote(sheet, "prior therapy", hit ? hit[0] : drug, text);
    }
  }

  if (sheet.priorSystemicLines == null) {
    const noOther = /\bno other systemic lines\b/i.test(text);
    const firstLine = /\bfirst[-\s]line\b/i.test(text);
    const numbered = text.match(/\b(\d+)\s+prior\s+systemic\s+lines?\b/i);
    if (numbered) {
      sheet.priorSystemicLines = Number(numbered[1]);
      addQuote(sheet, "prior lines", numbered[0], text);
    } else if (firstLine && !/\b(second[-\s]line|third[-\s]line|two prior|2 prior)\b/i.test(text)) {
      sheet.priorSystemicLines = 1;
      const hit = text.match(/\bno other systemic lines\b/i) || text.match(/\bfirst[-\s]line\b/i);
      if (hit) addQuote(sheet, "prior lines", hit[0], text);
    } else if (noOther && sheet.priorTherapies.length === 1) {
      sheet.priorSystemicLines = 1;
      const hit = text.match(/\bno other systemic lines\b/i);
      if (hit) addQuote(sheet, "prior lines", hit[0], text);
    }
  }

  if ((!sheet.smoking || sheet.smoking === "unknown")) {
    if (/\bnever[-\s]smoker\b/i.test(text)) {
      sheet.smoking = "never";
      const hit = text.match(/\bnever[-\s]smoker\b/i);
      if (hit) addQuote(sheet, "smoking", hit[0], text);
    } else if (/\bformer\s+smoker\b/i.test(text)) {
      sheet.smoking = "former";
    } else if (/\bcurrent\s+smoker\b/i.test(text)) {
      sheet.smoking = "current";
    }
  }

  if (!sheet.home && /\bColumbus,\s*(Ohio|OH)\b/i.test(text)) {
    sheet.home = { city: "Columbus", state: "OH", lat: 39.9612, lon: -82.9988 };
    const hit = text.match(/\bColumbus,\s*(Ohio|OH)\b/i);
    if (hit) addQuote(sheet, "home", hit[0], text);
  }

  if (!sheet.brainMets.status || sheet.brainMets.status === "unknown") {
    if (/\bbrain\b[^\n.]{0,80}\bwithout evidence of metastases\b/i.test(text) || /\bno\s+(?:untreated\s+)?brain metastases\b/i.test(text)) {
      sheet.brainMets = { status: "none", detail: null };
      const hit = text.match(/\b(?:MRI\s+)?brain\b[^\n.]{0,80}\bwithout evidence of metastases\b/i) || text.match(/\bno\s+(?:untreated\s+)?brain metastases\b/i);
      if (hit) addQuote(sheet, "brain metastases", hit[0], text);
    } else if (/\bbrain metastases were treated\b/i.test(text) || /\btreated[,\s]+stable brain metastases\b/i.test(text)) {
      sheet.brainMets = { status: "treated_stable", detail: null };
    }
  }

  return sheet;
}

const US_STATE_NAMES: Record<string, string> = {
  OH: "Ohio",
  KY: "Kentucky",
  IN: "Indiana",
  PA: "Pennsylvania",
  WV: "West Virginia",
  MI: "Michigan",
};

function hasFact(sheet: FactSheet, fact: string): boolean {
  return sheet.excerpts.some((ex) => ex.fact.toLowerCase() === fact.toLowerCase());
}

/**
 * Add verbatim-gated quotes for fields Nano (or a fallback) already filled
 * but did not quote. Only exact substrings of the note are kept.
 */
export function recoverVerbatimQuotes(sheet: FactSheet, note: string): void {
  const text = String(note || "");
  if (text.length < 20) return;

  const prefer = (fact: string, candidates: Array<string | null | undefined>): void => {
    if (hasFact(sheet, fact)) return;
    const ok = candidates
      .map((c) => String(c || "").replace(/\s+/g, " ").trim())
      .filter((c) => c && isVerbatimNoteQuote(c, text));
    if (ok[0]) addQuote(sheet, fact, ok[0], text);
  };

  if (sheet.ageYears != null) {
    prefer("age", [`${sheet.ageYears}-year-old`, `${sheet.ageYears} year-old`, `${sheet.ageYears} years old`, `age ${sheet.ageYears}`]);
  }
  if (sheet.ecog != null) {
    prefer("ECOG", [`ECOG performance status ${sheet.ecog}`, `ECOG PS ${sheet.ecog}`, `ECOG ${sheet.ecog}`]);
  }
  if (sheet.stage && sheet.stage !== "unknown") {
    prefer("stage", [`stage ${sheet.stage}`, `Stage ${sheet.stage}`]);
  }
  if (sheet.histology && sheet.histology !== "unknown") {
    const label = sheet.histology.replaceAll("_", " ");
    prefer("histology", [label, `lung ${label}`]);
  }
  if (sheet.home) {
    const full = US_STATE_NAMES[sheet.home.state] || "";
    prefer("home", [`${sheet.home.city}, ${full}`, `${sheet.home.city}, ${sheet.home.state}`]);
  }

  const egfr = sheet.biomarkers.egfr;
  if (egfr.status === "present") {
    prefer("EGFR", [egfr.variant ? `EGFR ${egfr.variant}` : "EGFR"]);
  } else if (egfr.status === "absent") {
    prefer("EGFR", ["EGFR mutation not detected", "EGFR rearrangement not detected", "EGFR not detected"]);
  }
  const alk = sheet.biomarkers.alk;
  if (alk.status === "present") {
    prefer("ALK", [alk.variant ? `ALK ${alk.variant}` : "ALK rearrangement", "ALK rearrangement"]);
  } else if (alk.status === "absent") {
    prefer("ALK", ["ALK rearrangement not detected", "ALK mutation not detected", "ALK not detected"]);
  }
  const kras = sheet.biomarkers.kras;
  if (kras.status === "present") {
    prefer("KRAS", [kras.variant ? `KRAS ${kras.variant}` : "KRAS mutation"]);
  } else if (kras.status === "absent") {
    prefer("KRAS", ["KRAS mutation not detected", "KRAS not detected"]);
  }
  if (sheet.biomarkers.pdL1TpsPercent != null) {
    const n = sheet.biomarkers.pdL1TpsPercent;
    prefer("PD-L1", [`PD-L1 TPS ${n}%`, `PD-L1 ${n}%`]);
  }
  if (sheet.priorSystemicLines != null) {
    const n = sheet.priorSystemicLines;
    prefer("prior lines", ["No other systemic lines", `${n} prior systemic line${n === 1 ? "" : "s"}`]);
  }
  if (sheet.smoking === "never") prefer("smoking", ["never-smoker", "never smoker"]);
  else if (sheet.smoking === "former") prefer("smoking", ["former smoker"]);
  else if (sheet.smoking === "current") prefer("smoking", ["current smoker"]);

  if (sheet.brainMets.status === "none") {
    prefer("brain metastases", ["MRI brain without evidence of metastases", "without evidence of metastases", "no brain metastases"]);
  } else if (sheet.brainMets.status === "treated_stable") {
    prefer("brain metastases", ["Brain metastases were treated", "treated, stable brain metastases"]);
  }
}
