// PDF.js による PDF→Canvas 展開。tool_0_pdf_to_jpg.py（Poppler, dpi=200）の代替。
//
// マーカー検出の面積閾値(min_area/max_area)は 200DPI スキャン(=長辺1654px)前提で
// 調整されているため、PDF の各ページも長辺を同程度(既定1654px)に揃えて描画し、
// 閾値の較正を保つ。
// PDF を開いてドキュメントを返す（ページは必要時に renderPdfPage で描画）。
// 全ページを一度に canvas 化するとメモリを大量消費するため、遅延描画に用いる。
export async function openPdf(data, workerSrc) {
  const pdfjsLib = window.pdfjsLib;
  if (workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  return await pdfjsLib.getDocument({ data }).promise;
}

// 指定ページを canvas に描画（長辺を targetLongEdge px に較正）。
export async function renderPdfPage(doc, pageNum, targetLongEdge = 1654, rotation = 0) {
  const page = await doc.getPage(pageNum);
  const base = page.getViewport({ scale: 1, rotation });
  const scale = targetLongEdge / Math.max(base.width, base.height);
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

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
