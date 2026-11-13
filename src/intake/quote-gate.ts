/** Verbatim evidence-quote gate for on-device clinic-note extraction. */
export const MIN_NOTE_QUOTE_CHARS = 8;

/** Fold typographic punctuation so a verbatim Nano quote still matches the note. */
export function normalizeForQuote(text: string): string {
  return String(text || "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function unwrapQuoteMarks(text: string): string {
  return text.replace(/^["']+|["']+$/g, "").trim();
}

export function excerptQuoteOf(ex: { fact?: string; quote?: string; evidence_quote?: string; evidenceQuote?: string }): string {
  return String(ex.quote || ex.evidence_quote || ex.evidenceQuote || "").trim();
}

export function isVerbatimNoteQuote(quote: string, note: string, minLength = MIN_NOTE_QUOTE_CHARS): boolean {
  const q = unwrapQuoteMarks(normalizeForQuote(quote));
  const t = normalizeForQuote(note);
  if (q.length < minLength) return false;
  if (t.includes(q)) return true;
  return t.toLowerCase().includes(q.toLowerCase());
}

export function keepVerbatimExcerpts(
  excerpts: Array<{ fact?: string; quote?: string; evidence_quote?: string; evidenceQuote?: string }> | undefined,
  note: string,
): { fact: string; quote: string }[] {
  const kept: { fact: string; quote: string }[] = [];
  for (const ex of excerpts || []) {
    const fact = String(ex.fact || "").trim();
    const quote = excerptQuoteOf(ex);
    if (!fact || !isVerbatimNoteQuote(quote, note)) continue;
    kept.push({ fact, quote: unwrapQuoteMarks(normalizeForQuote(quote)) });
  }
  return kept;
}
