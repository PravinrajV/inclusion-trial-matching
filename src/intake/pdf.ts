/**
 * Extract plain text from a PDF with pdf.js. No images are sent to a model.
 * The text stays in memory on this page until the user starts a match.
 * pdf.js is loaded on demand so the main bundle stays small until a PDF is chosen.
 */
export async function extractPdfText(file: File): Promise<string> {
  const { GlobalWorkerOptions, getDocument } = await import("pdfjs-dist");
  GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const loading = getDocument({ data });
  const pdf = await loading.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(line);
  }
  return pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
}
