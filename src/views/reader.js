// 読み取りタブ。アップロード → 展開 → AI認識 → 検算/日付判定 → 訂正・手動フォールバック。
// ✓OK（確定）になったページは対象年月の月データ（IndexedDB）へ自動保存する。
import { openPdf, renderPdfPage } from "../pdf.js";
import { recognizePage } from "../pipeline.js";
import { buildCsv, buildAggregatedCsv, downloadCsv } from "../csv.js";
import { validatePage, daysInMonth, qtyOf, toInt } from "../validate.js";
import { openReview } from "../review.js";
import { ensureMonth, putMonth, getMaster } from "../db.js";

const ASSETS = "public/assets/";
const $ = (id) => document.getElementById(id);

let app = null;
let sources = [];     // [{ type:'pdf', doc } | { type:'image', bitmap }]
let pages = [];       // ページ状態
let sessionYm = null; // 処理時の対象年月（処理後に年月を変えた場合の保存事故を防ぐ）

function setStatus(msg) { $("status").textContent = msg; }

// 対象年月のマスタスナップショットから認識用コンテキストを組み立てる
async function buildCtx(ym) {
  const month = await ensureMonth(ym);
  const master = await getMaster(month.masterVersion);
  if (!master) throw new Error(`マスタ v${month.masterVersion} が見つかりません`);
  return {
    roiRows: master.roiRows,
    products: master.products,
    cfg: master.config,
    model: app.engine.model,
    maxDays: daysInMonth(ym),
  };
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

// ROI名（date_0, notes_Y_1 など）→ 日本語の項目名（桁の区別はしない）
function fieldLabel(name) {
  if (name.startsWith("date")) return "日付";
  if (name.startsWith("total")) return "合計";
  const key = name.replace(/_[01]$/, "");
  const p = ((currentCtx && currentCtx.products) || []).find((x) => x.key === key);
  return p ? p.name : name;
}

function statusHtml(page) {
  if (!page.ok) return `<span class="err">✗ マーカー検出失敗（クリックで手動補正）</span>`;
  const v = page.valid || {};
  if (v.checksumOk === false) return `<span class="err">✗ 合計不一致（要確認）</span>`;
  if (v.dateOk === false) return `<span class="err">✗ 日付不正（要確認）</span>`;
  if (page.lowConfidence && page.lowConfidence.length) {
    const labels = [...new Set(page.lowConfidence.map(fieldLabel))];
    return `<span class="warn">⚠ 低信頼度: ${labels.join("、")}</span>`;
  }
  if (page.autoTuned)
    return `<span class="ok">✓ OK（マーカー自動補正）</span>`;
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

// 認識結果を日本語で要約（商品名×個数・合計点数）
function digitsSummary(predictions) {
  const products = (currentCtx && currentCtx.products) || [];
  const parts = [];
  for (const p of products) {
    const q = qtyOf(predictions, p.key);
    if (q) parts.push(`${p.name}×${q}`);
  }
  const totalPts = (toInt(predictions.total_2) * 10 + toInt(predictions.total_1)) * 10;
  if (totalPts) parts.push(`合計${totalPts}点`);
  return parts;
}
const dateOf = (p) => (p && (`${p.date_1 ?? ""}${p.date_0 ?? ""}`)) || "-";

function rowHtml(p, i) {
  const digits = p.ok ? digitsSummary(p.predictions).join("　") || "(なし)" : "-";
  return `<tr data-idx="${i}" class="clickable ${p.ok ? "" : "row-err"}">
    <td>${p.name}</td><td>${p.ok ? dateOf(p.predictions) : "-"}</td>
    <td class="digits">${digits}</td><td>${statusHtml(p)}</td>
    <td class="edit-cell">✎ 編集</td></tr>`;
}

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

  // 要対応（マーカー失敗・NG・低信頼度）は別枠に、確定分は下の表に分けて表示
  const attention = [], done = [];
  pages.forEach((p, i) => (isFullyOk(p) ? done : attention).push(rowHtml(p, i)));
  $("needFixWrap").hidden = attention.length === 0;
  $("needFixBody").innerHTML = attention.join("");
  $("fixAllBtn").textContent = `要対応 ${attention.length} 件をまとめて修正`;
  $("resultBody").innerHTML = done.length ? done.join("")
    : `<tr><td colspan="5" class="muted">確定したページはまだありません。</td></tr>`;

  $("downloadBtn").disabled = ok.length === 0;
  $("downloadAggBtn").disabled = ok.length === 0;
  $("results").hidden = pages.length === 0;
}

// ✓OK のページを月データへ保存（同名ページは上書き＝再スキャンは修正扱い）。
// あわせて要対応（マーカー失敗・NG・低信頼度）の件数も月データに保存し、
// ホーム画面から「読み取りに未対応が残っている」ことが分かるようにする。
async function saveOkPagesToMonth() {
  if (!sessionYm) return;
  const month = await ensureMonth(sessionYm);
  const okPages = pages.filter(isFullyOk);
  if (okPages.length) {
    const byName = new Map(month.pages.map((p) => [p.name, p]));
    for (const p of okPages) {
      byName.set(p.name, { name: p.name, predictions: p.predictions, savedAt: new Date().toISOString() });
    }
    month.pages = [...byName.values()];
  }
  const fail = pages.filter((p) => !p.ok).length;
  const ng = pages.filter((p) => p.ok && p.valid && (p.valid.checksumOk === false || p.valid.dateOk === false)).length;
  const low = pages.filter((p) => isFullyOk(p) === false && p.ok &&
    !(p.valid && (p.valid.checksumOk === false || p.valid.dateOk === false))).length;
  month.readerPending = fail + ng + low
    ? { fail, ng, low, updatedAt: new Date().toISOString() }
    : null;
  await putMonth(month);
  await renderSavedInfo();
}

async function renderSavedInfo() {
  const ym = sessionYm || app.ym;
  const month = await ensureMonth(ym);
  const okNow = pages.filter(isFullyOk).length;
  $("savedInfo").textContent =
    `✓OK のページは自動で ${ym} の月データに保存されます（保存済み: ${month.pages.length} 枚）。` +
    (okNow ? "" : " まだ確定したページがありません。");
}

async function processAll(ctx) {
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
    page.autoTuned = !!res.autoTuned;
    page.predictions = res.predictions || {};
    page.lowConfidence = res.lowConfidence || [];
    page.valid = res.ok ? validatePage(page.predictions, ctx.products, ctx.maxDays) : null;

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
  await saveOkPagesToMonth();
  setStatus(`完了：${total} ページ処理しました。行をクリックで訂正・検算できます。`);
}

let currentCtx = null; // 直近の処理に使ったコンテキスト（訂正モーダルで使用）

async function handleFiles(files) {
  if (!app.engine) return;
  $("fileInput").disabled = true;
  $("downloadBtn").disabled = true;
  $("results").hidden = false;
  setStatus("ファイルを展開中…");
  try {
    sessionYm = app.ym;
    currentCtx = await buildCtx(sessionYm);
    await prepareSources(files);
  } catch (e) {
    setStatus("展開に失敗しました: " + e.message);
    console.error(e);
    $("fileInput").disabled = false;
    return;
  }
  await processAll(currentCtx);
  $("fileInput").disabled = false;
}

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
  const csv = buildCsv(okRows, currentCtx.products);
  downloadCsv(csv, `recognition_results_${sessionYm || app.ym}.csv`);
}

function onDownloadAggregated() {
  if (!confirmIfUnchecked()) return;
  const okRows = pages.filter((p) => p.ok).map((p) => ({ predictions: p.predictions }));
  const ym = sessionYm || app.ym;
  const csv = buildAggregatedCsv(okRows, currentCtx.products, daysInMonth(ym));
  downloadCsv(csv, `recognition_results_${ym}_daily.csv`);
}

// 訂正モーダルを開いて、閉じたら再描画・保存する
async function reviewPage(page) {
  await openReview(page, {
    ...currentCtx,
    renderRaw,
    onUpdate: () => renderResults(),
  });
  renderResults();
  await saveOkPagesToMonth();
}

// 要対応のページを順番に連続で修正する。
// ユーザーが未解決のまま閉じたら（キャンセル）そこで中断する。
async function fixAllSequential() {
  for (;;) {
    const next = pages.find((p) => !isFullyOk(p));
    if (!next) break;
    await reviewPage(next);
    if (!isFullyOk(next)) break;
  }
}

// 一度だけ呼ばれる初期化（イベント紐付け）
export function init(appRef) {
  app = appRef;

  const onRowClick = (e) => {
    const tr = e.target.closest("tr[data-idx]");
    if (!tr) return;
    reviewPage(pages[+tr.dataset.idx]);
  };
  $("resultBody").addEventListener("click", onRowClick);
  $("needFixBody").addEventListener("click", onRowClick);
  $("fixAllBtn").addEventListener("click", fixAllSequential);

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
    if (!app.engine) return;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  });
}

// タブ表示時（対象年月の変更時にも呼ばれる）
export async function show() {
  if (app.engine) {
    setStatus(`準備完了。${app.ym} の交換票（PDF/画像）を選択してください。`);
    $("fileInput").disabled = false;
  }
  await renderSavedInfo();
}

// エンジン初期化完了時に main.js から呼ばれる
export function onEngineReady() {
  setStatus(`準備完了。${app.ym} の交換票（PDF/画像）を選択してください。`);
  $("fileInput").disabled = false;
}

export function setLoadStatus(msg) { setStatus(msg); }
