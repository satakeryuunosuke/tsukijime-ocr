// アプリ本体コントローラ。
// アップロード → 展開 → AI認識 → 検算/日付判定 → 訂正・手動フォールバック → CSV出力。
import { loadConfig, parseRoiCsv } from "./config.js";
import { initBackend } from "./backend.js";
import { openPdf, renderPdfPage } from "./pdf.js";
import { recognizePage } from "./pipeline.js";
import { buildCsv, buildAggregatedCsv, downloadCsv } from "./csv.js";
import { loadProducts } from "./products.js";
import { validatePage, daysInMonth } from "./validate.js";
import { openReview } from "./review.js";

const ASSETS = "public/assets/";
const $ = (id) => document.getElementById(id);

let ctx = null;       // { roiRows, products, model, cfg }
let sources = [];     // [{ type:'pdf', doc } | { type:'image', bitmap }]
let pages = [];       // ページ状態

function setStatus(msg) { $("status").textContent = msg; }

async function waitCv() {
  const t0 = Date.now();
  while (!window.__CV_READY__ || typeof window.tf === "undefined" || typeof window.pdfjsLib === "undefined") {
    if (Date.now() - t0 > 30000) throw new Error("ライブラリ初期化タイムアウト");
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function init() {
  try {
    // 年月の初期値（当月）
    const now = new Date();
    $("ymInput").value = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

    setStatus("エンジン初期化中…");
    await waitCv();
    const backend = await initBackend();
    const model = await window.tf.loadLayersModel(ASSETS + "model/model.json");
    const cfg = await loadConfig(ASSETS);
    const roiRows = parseRoiCsv(await (await fetch(ASSETS + "ROI_coordinate.csv")).text());
    const products = await loadProducts(ASSETS);
    ctx = { roiRows, products, model, cfg };
    setStatus(`準備完了（backend=${backend}, 商品${products.length}件）。PDFまたは画像を選択してください。`);
    $("fileInput").disabled = false;
  } catch (e) {
    setStatus("初期化エラー: " + e.message);
    console.error(e);
  }
}

// ---- 生画像の遅延レンダリング ----
async function renderRaw(page) {
  const s = sources[page.sourceIdx];
  if (s.type === "pdf") return await renderPdfPage(s.doc, page.pageNum, 1654);
  const c = document.createElement("canvas");
  c.width = s.bitmap.width;
  c.height = s.bitmap.height;
  c.getContext("2d").drawImage(s.bitmap, 0, 0);
  return c;
}

async function prepareSources(files) {
  sources = [];
  pages = [];
  for (const f of files) {
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const doc = await openPdf(await f.arrayBuffer(), ASSETS + "vendor/pdf.worker.min.js");
      const idx = sources.push({ type: "pdf", doc }) - 1;
      for (let p = 1; p <= doc.numPages; p++) {
        pages.push({ name: `${f.name} #${p}`, sourceIdx: idx, pageNum: p });
      }
    } else {
      const bitmap = await createImageBitmap(f);
      const idx = sources.push({ type: "image", bitmap }) - 1;
      pages.push({ name: f.name, sourceIdx: idx, pageNum: 1 });
    }
  }
}

function statusHtml(page) {
  if (!page.ok) return `<span class="err">✗ マーカー検出失敗（クリックで手動補正）</span>`;
  const v = page.valid || {};
  if (v.checksumOk === false) return `<span class="err">✗ 合計不一致（要確認）</span>`;
  if (v.dateOk === false) return `<span class="err">✗ 日付不正（要確認）</span>`;
  if (page.lowConfidence && page.lowConfidence.length)
    return `<span class="warn">⚠ 低信頼度: ${page.lowConfidence.join(", ")}</span>`;
  return `<span class="ok">✓ OK</span>`;
}

// 状態列に「✓ OK」（チェックマーク）が表示される行かどうか。
function isFullyOk(page) {
  if (!page.ok) return false;
  const v = page.valid || {};
  if (v.checksumOk === false || v.dateOk === false) return false;
  if (page.lowConfidence && page.lowConfidence.length) return false;
  return true;
}

function digitsSummary(predictions) {
  const parts = [];
  for (const [k, v] of Object.entries(predictions || {})) {
    if (k.endsWith("_confidence") || k.endsWith("_low_confidence_flag")) continue;
    if (v !== "" && v != null) parts.push(`${k}=${v}`);
  }
  return parts;
}
const dateOf = (p) => (p && (`${p.date_1 ?? ""}${p.date_0 ?? ""}`)) || "-";

function renderResults() {
  const ok = pages.filter((p) => p.ok);
  const markerFail = pages.filter((p) => !p.ok);
  const needFix = ok.filter((p) => p.valid && (p.valid.checksumOk === false || p.valid.dateOk === false));
  const lowConf = ok.filter((p) => p.lowConfidence && p.lowConfidence.length);

  $("summary").innerHTML =
    `<b>${pages.length}</b> ページ / 認識 <b>${ok.length}</b> / ` +
    `<span class="err">検算・日付NG ${needFix.length}</span> / ` +
    `<span class="warn">低信頼度 ${lowConf.length}</span> / ` +
    `<span class="err">マーカー失敗 ${markerFail.length}</span>`;

  $("resultBody").innerHTML = pages
    .map((p, i) => {
      const digits = p.ok ? digitsSummary(p.predictions).join("　") || "(なし)" : "-";
      return `<tr data-idx="${i}" class="clickable ${p.ok ? "" : "row-err"}">
        <td>${p.name}</td><td>${p.ok ? dateOf(p.predictions) : "-"}</td>
        <td class="digits">${digits}</td><td>${statusHtml(p)}</td>
        <td class="edit-cell">✎ 編集</td></tr>`;
    })
    .join("");

  $("downloadBtn").disabled = ok.length === 0;
  $("downloadAggBtn").disabled = ok.length === 0;
  $("results").hidden = pages.length === 0;
}

async function processAll() {
  const maxDays = daysInMonth($("ymInput").value.trim());
  ctx.maxDays = maxDays;
  const total = pages.length;
  $("progressWrap").hidden = false;

  for (let i = 0; i < total; i++) {
    const page = pages[i];
    const canvas = await renderRaw(page);
    const src = window.cv.imread(canvas);
    let res;
    try {
      res = await recognizePage(src, ctx);
    } catch (e) {
      res = { ok: false, reason: "error" };
      console.error(page.name, e);
    } finally {
      src.delete();
    }
    page.ok = res.ok;
    page.coords = res.coords || null;
    page.predictions = res.predictions || {};
    page.lowConfidence = res.lowConfidence || [];
    page.valid = res.ok ? validatePage(page.predictions, ctx.products, maxDays) : null;

    $("progressBar").style.width = Math.round(((i + 1) / total) * 100) + "%";
    setStatus(`認識中… ${i + 1} / ${total} ページ`);
    if (i % 2 === 0 || i === total - 1) {
      renderResults();
      // UIへyield（requestAnimationFrame はタブ非表示時に発火しないため setTimeout を使う）
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  renderResults();
  $("progressWrap").hidden = true;
  setStatus(`完了：${total} ページ処理しました。行をクリックで訂正・検算できます。`);
}

async function handleFiles(files) {
  if (!ctx) return;
  $("fileInput").disabled = true;
  $("downloadBtn").disabled = true;
  $("results").hidden = false;
  setStatus("ファイルを展開中…");
  try {
    await prepareSources(files);
  } catch (e) {
    setStatus("展開に失敗しました: " + e.message);
    console.error(e);
    $("fileInput").disabled = false;
    return;
  }
  await processAll();
  $("fileInput").disabled = false;
}

// 行クリック → 訂正モーダル
$("resultBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-idx]");
  if (!tr) return;
  const page = pages[+tr.dataset.idx];
  openReview(page, {
    ...ctx,
    renderRaw,
    onUpdate: () => renderResults(),
  }).then(() => renderResults());
});

// 未確認（状態が「✓ OK」でない）行がある場合、ダウンロード前に確認を促す。
function confirmIfUnchecked() {
  if (pages.every(isFullyOk)) return true;
  return window.confirm(
    "チェックマーク（✓ OK）が付いていない読み取り結果があります。このままダウンロードしますか？"
  );
}

function onDownload() {
  if (!confirmIfUnchecked()) return;
  const okRows = pages.filter((p) => p.ok).map((p) => ({ predictions: p.predictions }));
  const csv = buildCsv(okRows, ctx.products);
  const ym = $("ymInput").value.trim() || "output";
  downloadCsv(csv, `recognition_results_${ym}.csv`);
}

function onDownloadAggregated() {
  if (!confirmIfUnchecked()) return;
  const okRows = pages.filter((p) => p.ok).map((p) => ({ predictions: p.predictions }));
  const ym = $("ymInput").value.trim() || "output";
  const csv = buildAggregatedCsv(okRows, ctx.products, daysInMonth(ym));
  downloadCsv(csv, `recognition_results_${ym}_daily.csv`);
}

$("fileInput").addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length) handleFiles(Array.from(e.target.files));
});
$("downloadBtn").addEventListener("click", onDownload);
$("downloadAggBtn").addEventListener("click", onDownloadAggregated);

const drop = $("dropzone");
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => {
  if (!ctx) return;
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) handleFiles(files);
});

init();
