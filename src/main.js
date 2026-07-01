// アプリ本体コントローラ。
// PDF/画像アップロード → PDF→Canvas → AI認識 → 結果表示 → CSV ダウンロード。
import { loadConfig, parseRoiCsv } from "./config.js";
import { initBackend } from "./backend.js";
import { pdfToCanvases } from "./pdf.js";
import { recognizePage } from "./pipeline.js";
import { buildCsv, downloadCsv } from "./csv.js";

const ASSETS = "public/assets/";
const $ = (id) => document.getElementById(id);

let ctx = null;        // { roiRows, model, cfg }
let results = [];      // 認識結果

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
    setStatus("エンジン初期化中…");
    await waitCv();
    const backend = await initBackend();
    const model = await window.tf.loadLayersModel(ASSETS + "model/model.json");
    const cfg = await loadConfig(ASSETS);
    const roiRows = parseRoiCsv(await (await fetch(ASSETS + "ROI_coordinate.csv")).text());
    ctx = { roiRows, model, cfg };
    setStatus(`準備完了（backend=${backend}, ROI ${roiRows.length}件）。PDFまたは画像を選択してください。`);
    $("fileInput").disabled = false;
  } catch (e) {
    setStatus("初期化エラー: " + e.message);
    console.error(e);
  }
}

async function fileToPages(file) {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (isPdf) {
    const buf = await file.arrayBuffer();
    const canvases = await pdfToCanvases(buf, {
      workerSrc: ASSETS + "vendor/pdf.worker.min.js",
      targetLongEdge: 1654,
    });
    return canvases.map((c, i) => ({ name: `${file.name} #${i + 1}`, canvas: c }));
  }
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return [{ name: file.name, canvas: c }];
}

function digitsSummary(predictions) {
  const parts = [];
  for (const [k, v] of Object.entries(predictions)) {
    if (k.endsWith("_confidence") || k.endsWith("_low_confidence_flag")) continue;
    if (v !== "" && v != null) parts.push(`${k}=${v}`);
  }
  return parts;
}

function dateOf(predictions) {
  const d = `${predictions.date_1 ?? ""}${predictions.date_0 ?? ""}`;
  return d || "-";
}

function renderResults() {
  const ok = results.filter((r) => r.ok);
  const markerFail = results.filter((r) => !r.ok);
  const lowConf = ok.filter((r) => r.lowConfidence && r.lowConfidence.length);

  $("summary").innerHTML =
    `<b>${results.length}</b> ページ処理 / 認識成功 <b>${ok.length}</b> / ` +
    `<span class="warn">要確認(低信頼度) ${lowConf.length}</span> / ` +
    `<span class="err">マーカー検出失敗 ${markerFail.length}</span>`;

  const rows = results
    .map((r) => {
      if (!r.ok) {
        return `<tr class="row-err"><td>${r.name}</td><td>-</td><td>-</td>
                <td class="err">✗ マーカー検出失敗（要手動処理）</td></tr>`;
      }
      const digits = digitsSummary(r.predictions);
      const low = r.lowConfidence.length
        ? `<span class="warn">⚠ 低信頼度: ${r.lowConfidence.join(", ")}</span>`
        : `<span class="ok">✓ OK</span>`;
      return `<tr><td>${r.name}</td><td>${dateOf(r.predictions)}</td>
              <td class="digits">${digits.join("　") || "(なし)"}</td><td>${low}</td></tr>`;
    })
    .join("");

  $("resultBody").innerHTML = rows;
  $("downloadBtn").disabled = ok.length === 0;
  $("results").hidden = results.length === 0;
}

async function handleFiles(files) {
  if (!ctx) return;
  $("fileInput").disabled = true;
  $("downloadBtn").disabled = true;
  results = [];
  $("resultBody").innerHTML = "";
  $("results").hidden = false;

  // 全ファイルをページへ展開
  setStatus("ファイルを展開中…");
  let pages = [];
  for (const f of files) {
    try {
      pages = pages.concat(await fileToPages(f));
    } catch (e) {
      console.error("展開失敗", f.name, e);
      setStatus(`「${f.name}」の展開に失敗しました: ${e.message}`);
    }
  }

  const total = pages.length;
  $("progressWrap").hidden = false;
  for (let i = 0; i < total; i++) {
    const { name, canvas } = pages[i];
    const src = window.cv.imread(canvas);
    let res;
    try {
      res = await recognizePage(src, ctx);
    } catch (e) {
      res = { ok: false, reason: "error" };
      console.error(name, e);
    } finally {
      src.delete();
    }
    results.push({ name, ...res });

    const pct = Math.round(((i + 1) / total) * 100);
    $("progressBar").style.width = pct + "%";
    setStatus(`認識中… ${i + 1} / ${total} ページ`);
    // 一定間隔で描画更新
    if (i % 2 === 0 || i === total - 1) {
      renderResults();
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  renderResults();
  $("progressWrap").hidden = true;
  setStatus(`完了：${total} ページ処理しました。`);
  $("fileInput").disabled = false;
}

function onDownload() {
  const okRows = results.filter((r) => r.ok);
  const csv = buildCsv(okRows, ctx.roiRows);
  const ym = $("ymInput").value.trim() || "output";
  downloadCsv(csv, `recognition_results_${ym}.csv`);
}

// イベント配線
$("fileInput").addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length) handleFiles(Array.from(e.target.files));
});
$("downloadBtn").addEventListener("click", onDownload);

// ドラッグ&ドロップ
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
