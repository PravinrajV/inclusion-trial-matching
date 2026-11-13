/**
 * Known typos in ClinicalTrials.gov source text. Applied only when rendering
 * verbatim quotes, so the cached trial record stays untouched.
 */
export const SOURCE_TYPOS = ["positive-positive"] as const;

export function markSic(text: string): string {
  let out = text;
  for (const typo of SOURCE_TYPOS) {
    const re = new RegExp(escapeRegExp(typo), "gi");
    out = out.replace(re, (match, offset: number) => {
      const after = out.slice(offset + match.length);
      if (after.startsWith(" [sic]") || after.startsWith("[sic]")) return match;
      return `${match} [sic]`;
    });
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
