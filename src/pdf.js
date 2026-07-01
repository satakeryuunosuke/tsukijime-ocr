// PDF.js による PDF→Canvas 展開。tool_0_pdf_to_jpg.py（Poppler, dpi=200）の代替。
//
// マーカー検出の面積閾値(min_area/max_area)は 200DPI スキャン(=長辺1654px)前提で
// 調整されているため、PDF の各ページも長辺を同程度(既定1654px)に揃えて描画し、
// 閾値の較正を保つ。
export async function pdfToCanvases(data, opts = {}) {
  const { targetLongEdge = 1654, workerSrc, rotation = 0 } = opts;
  const pdfjsLib = window.pdfjsLib;
  if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const canvases = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1, rotation });
    const scale = targetLongEdge / Math.max(base.width, base.height);
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}
