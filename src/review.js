// 訂正・検算・手動フォールバックのモーダルUI。
// - マーカー検出成功ページ: 台形補正画像＋認識値を表示し、個数/日付/合計欄を編集。検算をライブ表示。
// - マーカー検出失敗ページ: 生画像上で四隅を4点タップ→台形補正→認識→編集へ。
import { orderPoints, detectMarkers, detectMarkerCandidates, markerThreshold, MARKER_PARAMS } from "./markerDetector.js";
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

    // coords が決まったら認識→編集へ（ok は保存時に確定）
    const onCoords = async (coords) => {
      page.coords = coords;
      await recognizeWithCoords(page, rawCanvas, ctx);
      editMode(body, page, rawCanvas, ctx, close);
    };
    if (!page.coords) {
      // マーカー検出失敗: まずパラメータ調整で自動検出を試す（手動タップにも切替可）
      paramMode(body, rawCanvas, ctx, onCoords);
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

// ---- パラメータ調整モード（setup_marker_detector_B.MarkerTunerApp 相当） ----
function paramMode(body, rawCanvas, ctx, onDone) {
  const cv = window.cv;
  const SLIDERS = [
    { key: "block_size", label: "BlockSize（奇数）", min: 3, max: 51, step: 2, val: MARKER_PARAMS.block_size },
    { key: "c_value", label: "C_Value", min: 0, max: 30, step: 1, val: MARKER_PARAMS.c_value },
    { key: "closing_iter", label: "Closing（膨張回数）", min: 0, max: 15, step: 1, val: MARKER_PARAMS.closing_iter },
    { key: "min_area", label: "Min_Area（最小面積）", min: 50, max: 5000, step: 10, val: MARKER_PARAMS.min_area },
    { key: "solidity_thr", label: "Solidity（充填率）", min: 0.1, max: 1.0, step: 0.05, val: MARKER_PARAMS.solidity_thr },
  ];

  body.innerHTML = `
    <p class="rv-note">マーカー検出に失敗しました。スライダーで<b>検出パラメータを調整</b>し、
      緑枠が<b>4つ</b>付く状態にして「この設定で確定」を押してください。うまくいかなければ「手動で4点タップ」へ。</p>
    <div class="rv-tuner">
      <div class="rv-previews">
        <figure><canvas class="rv-pv-result"></canvas><figcaption>検出結果（緑=マーカー候補）</figcaption></figure>
        <figure><canvas class="rv-pv-thresh"></canvas><figcaption>二値化プレビュー</figcaption></figure>
      </div>
      <div class="rv-sliders"></div>
    </div>
    <div class="rv-count">検出: 0 / 4</div>
    <p class="rv-guide">目安: マーカーが消える→C_Value下げ ／ ノイズ過多→C_Value上げ ／ 輪郭欠損→Closing上げ ／
      未検出→Solidity・Min_Area下げ ／ 文字を誤検出→Min_Area上げ ／ 枠を誤検出→Solidity上げ</p>
    <div class="rv-actions">
      <button class="btn-sub rv-manual">手動で4点タップ</button>
      <button class="btn rv-confirm" disabled>この設定で確定</button>
    </div>`;

  const resultC = body.querySelector(".rv-pv-result");
  const threshC = body.querySelector(".rv-pv-thresh");
  const countEl = body.querySelector(".rv-count");
  const confirmBtn = body.querySelector(".rv-confirm");
  const slidersWrap = body.querySelector(".rv-sliders");

  const state = {};
  const readEls = {};
  for (const s of SLIDERS) {
    state[s.key] = s.val;
    const row = document.createElement("div");
    row.className = "rv-srow";
    row.innerHTML = `<label>${s.label}</label>
      <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.val}" data-key="${s.key}" />
      <span class="rv-sval">${s.val}</span>`;
    const inp = row.querySelector("input");
    const valEl = row.querySelector(".rv-sval");
    inp.addEventListener("input", () => {
      state[s.key] = parseFloat(inp.value);
      valEl.textContent = s.step < 1 ? state[s.key].toFixed(2) : state[s.key];
      scheduleUpdate();
    });
    readEls[s.key] = inp;
    slidersWrap.appendChild(row);
  }

  const params = () => ({ ...state, max_area: MARKER_PARAMS.max_area });

  const drawResult = (hulls, centers) => {
    resultC.width = rawCanvas.width; resultC.height = rawCanvas.height;
    const g = resultC.getContext("2d");
    g.drawImage(rawCanvas, 0, 0);
    g.strokeStyle = "#059669"; g.lineWidth = 4;
    for (const h of hulls) {
      g.beginPath();
      h.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath(); g.stroke();
    }
    g.fillStyle = "#dc2626";
    for (const c of centers) { g.beginPath(); g.arc(c[0], c[1], 9, 0, Math.PI * 2); g.fill(); }
  };

  let timer = null;
  const scheduleUpdate = () => { clearTimeout(timer); timer = setTimeout(update, 120); };
  function update() {
    const src = cv.imread(rawCanvas);
    const p = params();
    const th = markerThreshold(src, p);
    cv.imshow(threshC, th);
    th.delete();
    const { centers, hulls } = detectMarkerCandidates(src, p);
    src.delete();
    drawResult(hulls, centers);
    const n = centers.length;
    countEl.textContent = `検出: ${n} / 4`;
    countEl.className = "rv-count " + (n === 4 ? "ok" : "err");
    confirmBtn.disabled = n !== 4;
  }

  body.querySelector(".rv-manual").onclick = () => cornerMode(body, rawCanvas, ctx, onDone);
  confirmBtn.onclick = () => {
    const src = cv.imread(rawCanvas);
    const coords = detectMarkers(src, params());
    src.delete();
    if (!coords) {
      countEl.textContent = "4点見つかりましたが長方形配置ではありません。位置を見直すか手動タップへ。";
      countEl.className = "rv-count err";
      return;
    }
    onDone(coords);
  };

  update();
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
      <div class="rv-img">
        <div class="rv-img-tools"><button class="btn-sub rv-raw-toggle">元のスキャン画像を表示</button></div>
        <canvas class="rv-disp"></canvas>
      </div>
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

  // 補正後画像 ⇔ 生画像（切り取り前）の表示切替。
  // 切り取り（台形補正）が疑わしいとき、元のスキャンとマーカー位置（赤点）を確認できる。
  let showRaw = false;
  let lastSelected = null;
  const rawToggle = body.querySelector(".rv-raw-toggle");
  rawToggle.onclick = () => {
    showRaw = !showRaw;
    rawToggle.textContent = showRaw ? "補正後の画像に戻す" : "元のスキャン画像を表示";
    redraw(lastSelected);
  };

  const redraw = (selected) => {
    lastSelected = selected;
    const base = showRaw ? rawCanvas : tCanvas;
    disp.width = base.width;
    disp.height = base.height;
    const g = disp.getContext("2d");
    g.drawImage(base, 0, 0);
    if (showRaw) {
      // 生画像には切り取りに使った4点を表示（枠の位置ズレの確認用）
      if (page.coords) {
        g.strokeStyle = "#dc2626"; g.fillStyle = "#dc2626"; g.lineWidth = 3;
        g.beginPath();
        page.coords.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath(); g.stroke();
        for (const p of page.coords) { g.beginPath(); g.arc(p[0], p[1], 10, 0, Math.PI * 2); g.fill(); }
      }
    } else {
      drawOverlay(disp, ctx.roiRows, P, selected);
    }
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
