import type { CheckResult, DiscussItem, TrialMatch } from "../match/evaluate";
import { GROUP_DISCUSS, GROUP_MET, GROUP_NOT_MET } from "./copy";
import { driverRowMetThroughOrList, extractDisjunctiveGeneSets, quotesOf } from "./driver-or";
import { icon } from "./icons";
import { quoteLabelFor, renderQuoteHtml } from "./verdict";

export type MatrixRowKey = "driver" | "stage" | "ecog" | "brain" | "labs" | "prior";

export const MATRIX_ROWS: { key: MatrixRowKey; label: string }[] = [
  { key: "driver", label: "Driver" },
  { key: "stage", label: "Stage" },
  { key: "ecog", label: "ECOG" },
  { key: "brain", label: "Brain metastases" },
  { key: "labs", label: "Labs" },
  { key: "prior", label: "Prior therapy" },
];

const EMPTY_ASK: Record<MatrixRowKey, string> = {
  driver: "Not checked automatically. Ask: does my tumor driver fit this trial?",
  stage: "Not checked automatically. Ask: does my stage fit this trial?",
  ecog: "Not checked automatically. Ask: does my ECOG performance status fit this trial?",
  brain: "Not checked automatically. Ask: do my brain metastases findings fit this trial?",
  labs: "Not checked automatically. Ask: do my recent labs fit this trial?",
  prior: "Not checked automatically. Ask: does my prior therapy fit this trial?",
};

const HINT: Record<MatrixRowKey, RegExp> = {
  driver:
    /\b(egfr|alk|kras|ros-?1|ret\b|c-?met|braf|ntrk|her2|erbb2|mtap|nrg1|mutation|rearrangement|fusion|wild-?type|oncogene|biomarker)\b/i,
  stage: /\bstage\s+(i{1,3}|iv|[1-4]|iii[abc]?|ii[abc]?)|\brecurrent\b|\blocally advanced\b/i,
  ecog: /\becog\b|\bperformance status\b|\bwho\s+ps\b/i,
  brain: /\bbrain\s+met|\bcns\s+met|\bintracranial\b|\bleptomeningeal\b|\bbrain metastasis/i,
  labs:
    /\b(?:anc|neutrophil|platelet|hemoglobin|bilirubin|creatinine|aspartate|alanine|ast\b|alt\b|renal function|hepatic function|laboratory)\b/i,
  prior:
    /\b(?:prior|previous|progress(?:ed|ion)|washout|osimertinib|alectinib|tki|chemotherapy|treated with|treatment with|lines of)\b/i,
};

function kindKey(kind: string): MatrixRowKey | null {
  // Labs must be checked before the driver prefix: egfr_min is kidney function,
  // not an EGFR driver check.
  if (/^(creatinine_max|bilirubin_max|ast_max|alt_max|anc_min|platelets_min|hemoglobin_min|egfr_min)/.test(kind)) {
    return "labs";
  }
  if (/^(egfr|alk|kras|ros1|ret|met|braf|ntrk|her2|mtap|nrg1)_/.test(kind)) return "driver";
  if (kind === "stage_in") return "stage";
  if (kind === "ecog_max") return "ecog";
  if (kind === "brain_mets") return "brain";
  if (/^prior_/.test(kind)) return "prior";
  return null;
}

function rankState(judgment: CheckResult["judgment"]): number {
  if (judgment === "not_met") return 0;
  if (judgment === "unknown") return 1;
  return 2;
}

/**
 * True when some item quote contains a gene list joined by "or" / "and/or".
 * A bare "or" elsewhere in the sentence does not count. This is not enough
 * on its own to mark the driver row met: pickMatrixItem also requires that
 * every unknown sibling is in that list with a met gene, and it will not
 * override a not_met sibling.
 */
export function driverQuotesAreDisjunctive(items: CheckResult[]): boolean {
  for (const text of items.flatMap((i) => quotesOf(i))) {
    if (extractDisjunctiveGeneSets(text).length > 0) return true;
  }
  return false;
}

export function pickMatrixItem(items: CheckResult[], key?: MatrixRowKey): CheckResult | null {
  if (!items.length) return null;
  // A met gene in an OR / and/or list may cover UNKNOWN siblings on the
  // driver row. A not_met sibling always wins. An "or" that is not joining
  // those genes does not apply the override, so the row stays Discuss.
  if (key === "driver" && driverRowMetThroughOrList(items)) {
    return items.find((i) => i.judgment === "met") ?? items[0];
  }
  return [...items].sort((a, b) => rankState(a.judgment) - rankState(b.judgment))[0] ?? null;
}

export function keyCriteriaTally(match: TrialMatch): { met: number; total: number } {
  const groups = groupMatrix(match);
  let met = 0;
  for (const { key } of MATRIX_ROWS) {
    if (pickMatrixItem(groups[key], key)?.judgment === "met") met += 1;
  }
  return { met, total: MATRIX_ROWS.length };
}

export function groupMatrix(match: TrialMatch): Record<MatrixRowKey, CheckResult[]> {
  const groups: Record<MatrixRowKey, CheckResult[]> = {
    driver: [],
    stage: [],
    ecog: [],
    brain: [],
    labs: [],
    prior: [],
  };
  for (const r of match.results) {
    const key = kindKey(r.check.kind);
    if (key) groups[key].push(r);
  }
  return groups;
}

/** Pick the trial's own sentence for a row that was not checked automatically. */
export function findTrialSentence(key: MatrixRowKey, items: DiscussItem[]): DiscussItem | null {
  const re = HINT[key];
  const hits = items.filter((d) => re.test(d.sourceText || ""));
  if (!hits.length) return null;
  // Prefer a shorter, specific sentence over a long catch-all line.
  return [...hits].sort((a, b) => (a.sourceText.length || 0) - (b.sourceText.length || 0))[0] ?? null;
}

function stateIcon(judgment: CheckResult["judgment"]): string {
  if (judgment === "met") return icon("check");
  if (judgment === "not_met") return icon("x");
  return icon("help");
}

function stateLabel(judgment: CheckResult["judgment"]): string {
  if (judgment === "met") return GROUP_MET;
  if (judgment === "not_met") return GROUP_NOT_MET;
  return GROUP_DISCUSS;
}

function stateClass(judgment: CheckResult["judgment"]): string {
  if (judgment === "met") return "met";
  if (judgment === "not_met") return "not-met";
  return "unknown";
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function quoteBlock(source: string, ev: string, label: string): string {
  if (!source) return "";
  return `<blockquote class="matrix-quote"><p class="quote-kicker">${escapeHtml(label)}</p><div class="quote">${renderQuoteHtml(source, ev, escapeHtml)}</div></blockquote>`;
}

export function renderCriteriaMatrix(match: TrialMatch): string {
  const groups = groupMatrix(match);
  const rows = MATRIX_ROWS.map(({ key, label }) => {
    const item = pickMatrixItem(groups[key], key);
    if (!item) {
      const sentence = findTrialSentence(key, match.discussItems);
      const quote = sentence
        ? quoteBlock(sentence.sourceText, sentence.sourceText, quoteLabelFor(undefined, sentence.polarity || "inclusion"))
        : "";
      return `<tr class="matrix-row is-empty" data-row="${key}">
        <th scope="row">${escapeHtml(label)}</th>
        <td class="matrix-state"><span class="matrix-ico is-unknown">${icon("help")}</span></td>
        <td>
          <p class="matrix-line">${escapeHtml(EMPTY_ASK[key])}</p>
          ${quote}
        </td>
      </tr>`;
    }
    const cls = stateClass(item.judgment);
    const source = item.quote || item.check.sourceText || "";
    const ev = item.quote || item.check.evidence_quote || item.check.sourceText || "";
    const quote = quoteBlock(source, ev, item.quoteLabel || "Trial's own words");
    return `<tr class="matrix-row is-${cls}" data-row="${key}">
      <th scope="row">${escapeHtml(label)}</th>
      <td class="matrix-state"><span class="matrix-ico is-${cls}" title="${escapeHtml(stateLabel(item.judgment))}">${stateIcon(item.judgment)}</span></td>
      <td>
        <p class="matrix-line">${escapeHtml(item.headline)}</p>
        ${quote}
      </td>
    </tr>`;
  }).join("");
  return `<table class="criteria-matrix"><caption>Key criteria</caption><tbody>${rows}</tbody></table>`;
}
