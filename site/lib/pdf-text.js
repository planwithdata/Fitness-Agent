import { getDocument, GlobalWorkerOptions } from '../vendor/pdf.mjs';

GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;

function textLines(items) {
  const fragments = items.filter(item => typeof item.str === 'string' && item.str.trim())
    .map(item => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const fragment of fragments) {
    const previous = lines.at(-1);
    if (!previous || Math.abs(previous.y - fragment.y) > 2) lines.push({ y: fragment.y, fragments: [fragment] });
    else previous.fragments.push(fragment);
  }
  return lines.map(line => line.fragments.sort((a, b) => a.x - b.x).map(fragment => fragment.text).join(' '));
}

export async function readPdfText(bytes, maxPages = 30) {
  const task = getDocument({ data: bytes, isEvalSupported: false, useWasm: false, useWorkerFetch: false,
    useSystemFonts: false, disableFontFace: true, enableXfa: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > maxPages) throw new Error(`Choose a PDF with ${maxPages} pages or fewer.`);
    const lines = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      lines.push(...textLines((await page.getTextContent()).items));
      page.cleanup();
    }
    return lines.join('\n').slice(0, 350_000);
  } finally {
    await task.destroy();
  }
}
