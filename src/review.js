// 訂正・検算・手動フォールバックのモーダルUI。
// - マーカー検出成功ページ: 台形補正画像＋認識値を表示し、個数/日付/合計欄を編集。検算をライブ表示。
// - マーカー検出失敗ページ: 生画像上で四隅を4点タップ→台形補正→認識→編集へ。
import { orderPoints } from "./markerDetector.js";
import { transformImage } from "./geometry.js";
import { extractRois, deleteRois } from "./extractor.js";
import { predictNumbers } from "./predictor.js";
import { drawOverlay } from "./overlay.js";
import { validatePage, qtyOf, toInt, fillTotalFromQty } from "./validate.js";

// page: { name, ok, coords, predictions, lowConfidence }
// ctx:  { roiRows, products, model, cfg, ym, renderRaw, onUpdate }
export function openReview(page, ctx) {
  return new Promise(async (resolve) => {
    const shell = document.createElement("div");
    shell.className = "rv-overlay";
    shell.innerHTML = `
      <div class="rv-modal">
        <div class="rv-head">
          <span class="rv-title"></span>
          <button class="rv-close" title="閉じる">✕</button>
        </div>
        <div class="rv-body"></div>
      </div>`;
    shell.querySelector(".rv-title").textContent = page.name;
    document.body.appendChild(shell);

    const body = shell.querySelector(".rv-body");
    const close = () => { shell.remove(); resolve(); };
    shell.querySelector(".rv-close").onclick = close;
    shell.addEventListener("click", (e) => { if (e.target === shell) close(); });

    const rawCanvas = await ctx.renderRaw(page);

    if (!page.coords) {
      cornerMode(body, rawCanvas, ctx, async (coords) => {
        page.coords = coords;
        await recognizeWithCoords(page, rawCanvas, ctx);
        // ok は保存時に確定（編集をキャンセルしたら未確定のまま）
        editMode(body, page, rawCanvas, ctx, close);
      });
    } else {
      editMode(body, page, rawCanvas, ctx, close);
    }
  });
}

// ---- 認識（指定 coords で台形補正→ROI→推論） ----
async function recognizeWithCoords(page, rawCanvas, ctx) {
  const cv = window.cv;
  const src = cv.imread(rawCanvas);
  const tMat = transformImage(src, page.coords);
  src.delete();
  const rois = extractRois(tMat, ctx.roiRows);
  page.predictions = await predictNumbers(rois, ctx.model, ctx.cfg);
  page.lowConfidence = Object.keys(page.predictions)
    .filter((k) => k.endsWith("_low_confidence_flag") && page.predictions[k] === true)
    .map((k) => k.replace("_low_confidence_flag", ""));
  deleteRois(rois);
  tMat.delete();
}

// ---- 四隅タップモード ----
function cornerMode(body, rawCanvas, ctx, onDone) {
  body.innerHTML = `
    <p class="rv-note">マーカー検出に失敗しました。用紙<b>四隅の■マーカー4点</b>をタップしてください（順不同）。</p>
    <div class="rv-corner-wrap"><canvas class="rv-corner-canvas"></canvas></div>
    <div class="rv-actions">
      <button class="rv-reset btn-sub">やり直し</button>
      <button class="rv-run btn" disabled>この4点で認識する</button>
    </div>
    <p class="rv-corner-status">タップ: 0 / 4</p>`;

  const canvas = body.querySelector(".rv-corner-canvas");
  const maxW = Math.min(760, window.innerWidth - 60);
  const scale = maxW / rawCanvas.width;
  canvas.width = rawCanvas.width;
  canvas.height = rawCanvas.height;
  canvas.style.width = maxW + "px";
  canvas.style.height = rawCanvas.height * scale + "px";

  const pts = [];
  const draw = () => {
    const g = canvas.getContext("2d");
    g.drawImage(rawCanvas, 0, 0);
    g.fillStyle = "#dc2626";
    g.strokeStyle = "#dc2626";
    g.lineWidth = 3;
    pts.forEach((p, i) => {
      g.beginPath();
      g.arc(p[0], p[1], 12, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "bold 16px system-ui";
      g.fillText(String(i + 1), p[0] - 5, p[1] + 6);
      g.fillStyle = "#dc2626";
    });
  };
  draw();

  canvas.addEventListener("click", (e) => {
    if (pts.length >= 4) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * rawCanvas.width;
    const y = (e.clientY - rect.top) / rect.height * rawCanvas.height;
    pts.push([Math.round(x), Math.round(y)]);
    body.querySelector(".rv-corner-status").textContent = `タップ: ${pts.length} / 4`;
    body.querySelector(".rv-run").disabled = pts.length !== 4;
    draw();
  });
  body.querySelector(".rv-reset").onclick = () => {
    pts.length = 0;
    body.querySelector(".rv-corner-status").textContent = "タップ: 0 / 4";
    body.querySelector(".rv-run").disabled = true;
    draw();
  };
  body.querySelector(".rv-run").onclick = () => {
    const ordered = orderPoints(pts.map((p) => [p[0], p[1]]));
    onDone(ordered);
  };
}

// ---- 編集モード ----
function editMode(body, page, rawCanvas, ctx, close) {
  const cv = window.cv;
  // 台形補正画像を1枚だけ作ってオフスクリーンに保持
  const src = cv.imread(rawCanvas);
  const tMat = transformImage(src, page.coords);
  src.delete();
  const tCanvas = document.createElement("canvas");
  cv.imshow(tCanvas, tMat);
  tMat.delete();

  body.innerHTML = `
    <div class="rv-edit">
      <div class="rv-img"><canvas class="rv-disp"></canvas></div>
      <div class="rv-form">
        <div class="rv-field rv-date">
          <label>日付（日）</label>
          <input type="number" min="1" max="31" class="rv-in-date" inputmode="numeric" />
          <span class="rv-date-flag"></span>
        </div>
        <div class="rv-products"></div>
        <div class="rv-field rv-total">
          <label>記入された合計欄</label>
          <input type="number" min="0" max="99" class="rv-in-total" inputmode="numeric" />
          <button class="btn-sub rv-fill">個数から自動</button>
        </div>
        <div class="rv-check"></div>
        <div class="rv-actions">
          <button class="btn-sub rv-cancel">キャンセル</button>
          <button class="btn rv-save">保存</button>
        </div>
      </div>
    </div>`;

  const disp = body.querySelector(".rv-disp");
  // 編集はクローンに対して行い、保存時のみ page.predictions へ反映（キャンセルで破棄）
  const P = { ...page.predictions };

  const redraw = (selected) => {
    disp.width = tCanvas.width;
    disp.height = tCanvas.height;
    disp.getContext("2d").drawImage(tCanvas, 0, 0);
    drawOverlay(disp, ctx.roiRows, P, selected);
  };

  // 桁分解ヘルパ（空の上位桁は "" にして OCR 表現と揃える）
  const setTwoDigit = (obj, base, value) => {
    const v = Math.max(0, Math.min(99, value | 0));
    obj[`${base}_0`] = v % 10;
    obj[`${base}_1`] = v >= 10 ? Math.floor(v / 10) : "";
  };

  // 日付
  const dateIn = body.querySelector(".rv-in-date");
  dateIn.value = toInt(P.date_1) * 10 + toInt(P.date_0) || "";

  // 商品フォーム
  const prodWrap = body.querySelector(".rv-products");
  for (const p of ctx.products) {
    const row = document.createElement("div");
    row.className = "rv-prow";
    row.innerHTML = `<label>${p.name} <small>(${p.points}点)</small></label>
      <input type="number" min="0" max="99" inputmode="numeric" data-key="${p.key}" />`;
    const inp = row.querySelector("input");
    inp.value = qtyOf(P, p.key) || "";
    inp.addEventListener("input", () => {
      setTwoDigit(P, p.key, parseInt(inp.value, 10) || 0);
      recompute();
      redraw(`${p.key}_0`);
    });
    prodWrap.appendChild(row);
  }

  // 合計欄
  const totalIn = body.querySelector(".rv-in-total");
  totalIn.value = toInt(P.total_2) * 10 + toInt(P.total_1) || "";
  totalIn.addEventListener("input", () => {
    setTwoDigit(P, "total", parseInt(totalIn.value, 10) || 0);
    recompute();
    redraw("total_1");
  });
  dateIn.addEventListener("input", () => {
    setTwoDigit(P, "date", parseInt(dateIn.value, 10) || 0);
    recompute();
    redraw("date_0");
  });

  body.querySelector(".rv-fill").onclick = () => {
    fillTotalFromQty(P, ctx.products);
    totalIn.value = toInt(P.total_2) * 10 + toInt(P.total_1) || "";
    recompute();
    redraw("total_1");
  };

  const checkEl = body.querySelector(".rv-check");
  const dateFlag = body.querySelector(".rv-date-flag");
  const maxDays = ctx.maxDays;
  let curValid = null; // 編集中はローカルに保持し、保存時のみ page.valid へ反映
  function recompute() {
    const v = validatePage(P, ctx.products, maxDays);
    curValid = v;
    checkEl.innerHTML =
      `<div>計算合計 <b>${v.computed}</b> 点（÷10 = ${v.computedTens}）</div>` +
      `<div>記入合計欄 <b>${v.totalBox}</b> → 検算 ` +
      (v.checksumOk ? `<span class="ok">✓ 一致</span>` : `<span class="err">✗ 不一致</span>`) + `</div>`;
    dateFlag.innerHTML = v.dateOk ? `<span class="ok">✓</span>` : `<span class="err">✗ 範囲外</span>`;
  }

  body.querySelector(".rv-cancel").onclick = close;
  body.querySelector(".rv-save").onclick = () => {
    recompute();
    page.predictions = P;           // 保存時に確定
    page.valid = curValid;
    page.ok = true;
    page.lowConfidence = [];         // 手動確認済みとして低信頼度フラグを解除
    if (ctx.onUpdate) ctx.onUpdate(page);
    close();
  };

  redraw(null);
  recompute();
}
