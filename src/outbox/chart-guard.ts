/**
 * Proof that chart text does not leave the device: every outbound request
 * is scanned for snippets from the pasted record and the fact sheet.
 */

export const MIN_SNIPPET_LENGTH = 8;

export interface ChartLeak {
  snippet: string;
  foundIn: "url" | "body" | "headers";
  encoding: "plain" | "uri" | "base64" | "json-escaped";
}

function compact(s: string): string {
  return compactForGuard(s);
}

function encodingsOf(snippet: string): { encoding: ChartLeak["encoding"]; value: string }[] {
  const plain = compact(snippet);
  if (plain.length < MIN_SNIPPET_LENGTH) return [];
  const uri = encodeURIComponent(snippet).toLowerCase();
  const uriPlus = encodeURIComponent(snippet).replace(/%20/g, "+").toLowerCase();
  const jsonEscaped = JSON.stringify(snippet).slice(1, -1).toLowerCase();
  const out: { encoding: ChartLeak["encoding"]; value: string }[] = [
    { encoding: "plain", value: plain },
    { encoding: "uri", value: uri },
    { encoding: "uri", value: uriPlus },
    { encoding: "json-escaped", value: jsonEscaped },
  ];
  try {
    const bytes = new TextEncoder().encode(snippet);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    out.push({ encoding: "base64", value: btoa(bin).toLowerCase() });
  } catch {
    // ignore environments without btoa
  }
  return out;
}

export function compactForGuard(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A chart snippet that also occurs verbatim in the public trial text being
 * sent is not chart data in that request. Chart-unique snippets still block.
 */
export function snippetInPublicText(snippet: string, publicText: string): boolean {
  if (!publicText) return false;
  const s = compactForGuard(snippet);
  const p = compactForGuard(publicText);
  return s.length >= MIN_SNIPPET_LENGTH && p.includes(s);
}

export function findChartLeaks(
  haystack: { url?: string; body?: string; headers?: string },
  snippets: string[],
  opts?: { publicText?: string },
): ChartLeak[] {
  const leaks: ChartLeak[] = [];
  const publicText = opts?.publicText ?? "";
  const fields: { foundIn: ChartLeak["foundIn"]; text: string }[] = [
    { foundIn: "url", text: haystack.url ?? "" },
    { foundIn: "body", text: haystack.body ?? "" },
    { foundIn: "headers", text: haystack.headers ?? "" },
  ];
  for (const snippet of snippets) {
    if (publicText && snippetInPublicText(snippet, publicText)) continue;
    const variants = encodingsOf(snippet);
    for (const { encoding, value } of variants) {
      if (value.length < MIN_SNIPPET_LENGTH) continue;
      for (const field of fields) {
        if (!field.text) continue;
        const hay = encoding === "plain" ? compact(field.text) : field.text.toLowerCase();
        if (hay.includes(value)) {
          leaks.push({ snippet: snippet.slice(0, 80), foundIn: field.foundIn, encoding });
        }
      }
    }
  }
  // unique by foundIn+encoding+snippet
  const seen = new Set<string>();
  return leaks.filter((l) => {
    const k = `${l.foundIn}|${l.encoding}|${l.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function isLocalDestination(url: string): boolean {
  try {
    const u = new URL(url, "http://localhost");
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
