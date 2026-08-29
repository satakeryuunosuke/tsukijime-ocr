// 読み取りタブ。アップロード → 展開 → AI認識 → 検算/日付判定 → 訂正・手動フォールバック。
// ✓OK（確定）になったページは対象年月の月データ（IndexedDB）へ自動保存する。
import { openPdf, renderPdfPage } from "../pdf.js";
import { recognizePage } from "../pipeline.js";
import { buildCsv, buildAggregatedCsv, downloadCsv } from "../csv.js";
import { validatePage, daysInMonth, qtyOf, toInt } from "../validate.js";
import { formatYm } from "../dateUtils.js";
import { openReview } from "../review.js";
import { ensureMonth, putMonth, getMaster, getSetting } from "../db.js";
import { toast } from "../toast.js";

const ASSETS = "public/assets/";
const $ = (id) => document.getElementById(id);

let app = null;
let sources = [];     // [{ type:'pdf', doc } | { type:'image', bitmap }]
let pages = [];       // ページ状態
let sessionYm = null; // 処理時の対象年月（処理後に年月を変えた場合の保存事故を防ぐ）

function setStatus(msg) { $("status").textContent = msg; }

function ensureTotal0(roiRows) {
  if (!roiRows || roiRows.some((r) => r.name === "total_0")) return roiRows;
  const t1 = roiRows.find((r) => r.name === "total_1");
  const t2 = roiRows.find((r) => r.name === "total_2");
  if (t1 && t2) {
    const dx = t1.x - t2.x;
    return [...roiRows, { name: "total_0", x: t1.x + dx, y: t1.y, h: t1.h, w: t1.w }];
  }
  return roiRows;
}

// 対象年月のマスタスナップショットから認識用コンテキストを組み立てる
async function buildCtx(ym) {
  const month = await ensureMonth(ym);
  const master = await getMaster(month.masterVersion);
  if (!master) throw new Error(`マスタ v${month.masterVersion} が見つかりません`);
  const checksumDigits = (await getSetting("checksumDigits")) || 2;
  return {
    roiRows: ensureTotal0(master.roiRows),
    products: master.products,
    cfg: master.config,
    model: app.engine.model,
    maxDays: daysInMonth(ym),
    checksumDigits: Number(checksumDigits),
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

// 2桁モード（上2桁照合）の時は total_0（一の位）の低信頼度を無視する
function getEffectiveLow(page) {
  if (!page || !page.lowConfidence) return [];
  const digits = currentCtx ? Number(currentCtx.checksumDigits) : 2;
  return page.lowConfidence.filter((k) => !(digits === 2 && k === "total_0"));
}

function statusHtml(page) {
  if (!page.ok) return `<span class="err">✗ マーカー検出失敗（クリックで手動補正）</span>`;
  const v = page.valid || {};
  if (v.checksumOk === false) return `<span class="err">✗ 合計不一致（要確認）</span>`;
  if (v.dateOk === false) return `<span class="err">✗ 日付不正（要確認）</span>`;
  const effectiveLow = getEffectiveLow(page);
  if (effectiveLow.length) {
    const labels = [...new Set(effectiveLow.map(fieldLabel))];
    return `<span class="warn">⚠ 低信頼度: ${labels.join("、")}</span>`;
  }
  if (page.autoTuned)
    return `<span class="ok">✓ OK（マーカー自動補正）</span>`;
  return `<span class="ok">✓ OK</span>`;
}

// マーカー成功かつ検算・日付OKだが、低信頼度項目だけがあるページ
function isLowConfidenceOnly(p) {
  if (!p.ok) return false;
  const v = p.valid || {};
  if (v.checksumOk === false || v.dateOk === false) return false;
  return getEffectiveLow(p).length > 0;
}

// 状態列に「✓ OK」（チェックマーク）が表示される行かどうか。
function isFullyOk(page) {
  if (!page.ok) return false;
  const v = page.valid || {};
  if (v.checksumOk === false || v.dateOk === false) return false;
  if (getEffectiveLow(page).length) return false;
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
  const hasTotal = predictions.total_0 !== "" && predictions.total_0 != null ||
                   predictions.total_1 !== "" && predictions.total_1 != null ||
                   predictions.total_2 !== "" && predictions.total_2 != null;
  if (hasTotal) {
    const totalPts = toInt(predictions.total_2) * 100 + toInt(predictions.total_1) * 10 + toInt(predictions.total_0);
    parts.push(`合計${totalPts}点`);
  }
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
  const lowConf = ok.filter((p) => getEffectiveLow(p).length);
  const lowOnlyPages = pages.filter(isLowConfidenceOnly);

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

  // 低信頼度のみのページを一括承認するボタン
  const approveLowBtn = $("approveLowBtn");
  if (approveLowBtn) {
    approveLowBtn.hidden = lowOnlyPages.length === 0;
    approveLowBtn.textContent = `✓ 低信頼度のみの ${lowOnlyPages.length} 件をまとめて承認`;
  }

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
  if (month.locked) {
    console.warn("月締め確定（ロック中）のため保存をスキップしました");
    return;
  }
  const okPages = pages.filter(isFullyOk);
  if (okPages.length) {
    const byName = new Map(month.pages.map((p) => [p.name, p]));
    for (const p of okPages) {
      byName.set(p.name, { name: p.name, predictions: p.predictions, savedAt: new Date().toISOString() });
    }
    month.pages = [...byName.values()];
    month.readerSkipped = false;
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

async function skipReader() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため変更できません。"); return; }
  month.readerSkipped = true;
  await putMonth(month);
  toast("今月の交換票を「交換票なし（スキップ）」に設定しました ✓");
  app.navigate("arrivals");
}

async function unskipReader() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため変更できません。"); return; }
  month.readerSkipped = false;
  await putMonth(month);
  toast("交換票のスキップを解除しました");
  await show();
}

async function renderSavedInfo() {
  const ym = sessionYm || app.ym;
  const month = await ensureMonth(ym);
  const okNow = pages.filter(isFullyOk).length;
  if (month.locked) {
    $("savedInfo").innerHTML = `<b class="warn">🔒 この月（${formatYm(ym)}）は月締め確定（ロック中）です。データの追加・編集はできません。</b>`;
    return;
  }
  $("savedInfo").textContent =
    `✓OK のページは自動で ${formatYm(ym)} の月データに保存されます（保存済み: ${month.pages.length} 枚）。` +
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
    page.valid = res.ok ? validatePage(page.predictions, ctx.products, ctx.maxDays, ctx.checksumDigits) : null;

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
  const month = await ensureMonth(app.ym);
  if (month.locked) {
    alert(`この月（${formatYm(app.ym)}）は月締め確定（ロック）されているため、新しい交換票の読み取りはできません。\n読み取りを行う場合は「月締め」タブからロックを解除してください。`);
    return;
  }
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

// 低信頼度のみのページを一括承認（低信頼度フラグをクリアして確定扱いに）
async function onApproveLowOnly() {
  const targets = pages.filter(isLowConfidenceOnly);
  if (!targets.length) return;
  const count = targets.length;
  targets.forEach((p) => {
    p.lowConfidence = [];
  });
  renderResults();
  await saveOkPagesToMonth();
  toast(`低信頼度のみの ${count} ページを一括承認しました`);
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
  const approveLowBtn = $("approveLowBtn");
  if (approveLowBtn) approveLowBtn.addEventListener("click", onApproveLowOnly);

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
  const month = await ensureMonth(app.ym);
  const isLocked = !!month.locked;
  const isSkipped = !!month.readerSkipped;
  const hasPages = month.pages && month.pages.length > 0;

  const skipBannerEl = $("readerSkipBanner");
  if (skipBannerEl) {
    if (!isLocked && isSkipped && !hasPages) {
      skipBannerEl.innerHTML = `
        <div class="panel" style="margin: 0 0 .75rem; background: #ecfdf5; border-color: #a7f3d0;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: .5rem;">
            <span style="color: #065f46; font-size: .9rem;">
              ✓ <b>この月は「交換票なし（スキップ）」として確認済みです。</b>（交換票を読み取ると自動的に確定保存状態になります）
            </span>
            <button id="readerUnskipBtn" class="btn-sub" style="font-size: .85rem; padding: .25rem .6rem;" type="button">スキップを解除する</button>
          </div>
        </div>`;
      const unskipBtn = skipBannerEl.querySelector("#readerUnskipBtn");
      if (unskipBtn) unskipBtn.addEventListener("click", unskipReader);
    } else {
      skipBannerEl.innerHTML = "";
    }
  }

  const skipAreaEl = $("readerSkipArea");
  if (skipAreaEl) {
    if (!isLocked && !hasPages && !isSkipped) {
      skipAreaEl.innerHTML = `<button id="readerQuickSkipBtn" class="btn-sub" style="font-size: .88rem; border-color: #94a3b8;" type="button">※今月は交換票なし（スキップして入庫へ） →</button>`;
      const quickSkipBtn = skipAreaEl.querySelector("#readerQuickSkipBtn");
      if (quickSkipBtn) quickSkipBtn.addEventListener("click", skipReader);
    } else {
      skipAreaEl.innerHTML = "";
    }
  }

  if (app.engine) {
    if (month.locked) {
      setStatus(`🔒 この月（${formatYm(app.ym)}）は月締め確定（ロック中）のため読み取りできません。（月締めタブでロック解除可能）`);
      $("fileInput").disabled = true;
    } else {
      setStatus(`準備完了。${formatYm(app.ym)} の交換票（PDF/画像）を選択してください。`);
      $("fileInput").disabled = false;
    }
  }
  await renderSavedInfo();
}

// エンジン初期化完了時に main.js から呼ばれる
export async function onEngineReady() {
  const month = await ensureMonth(app.ym);
  if (month.locked) {
    setStatus(`🔒 この月（${formatYm(app.ym)}）は月締め確定（ロック中）のため読み取りできません。（月締めタブでロック解除可能）`);
    $("fileInput").disabled = true;
  } else {
    setStatus(`準備完了。${formatYm(app.ym)} の交換票（PDF/画像）を選択してください。`);
    $("fileInput").disabled = false;
  }
}

export function setLoadStatus(msg) { setStatus(msg); }

