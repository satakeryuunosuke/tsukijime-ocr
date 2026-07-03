// ROIエディタ。Excel等で自作した交換票のスキャン（画像/PDF）から記入枠の座標を設定する。
// 流れ: 画像読み込み → マーカー検出（失敗時は四隅を手動タップ）→ 台形補正(1000×707)
//       → 記入枠の自動検出（候補表示）→ クリックで項目に割り当て → ROI座標を返す。
// 返り値は parseRoiCsv と同じ {name,x,y,w,h} の配列（キャンセル時 null）。
import { detectMarkers, orderPoints } from "./markerDetector.js";
import { transformImage, OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./geometry.js";
import { openPdf, renderPdfPage } from "./pdf.js";

const ASSETS = "public/assets/";

// ---- 記入枠の自動検出（台形補正後の画像に対して）----
function detectBoxCandidates(mat) {
  const cv = window.cv;
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  const bin = new cv.Mat();
  cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 4);
  gray.delete();
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  bin.delete();
  hier.delete();

  let rects = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const r = cv.boundingRect(cnt);
    cnt.delete();
    // 記入枠らしいサイズ（現行票は 39-53 × 60）に限定
    if (r.width < 18 || r.width > 130 || r.height < 25 || r.height > 110) continue;
    const aspect = r.width / r.height;
    if (aspect < 0.25 || aspect > 1.6) continue;
    rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  contours.delete();

  // 重複除去: 枠線の外周と内周が両方検出されるため、重なる矩形は小さい方（内側＝記入領域）を残す
  rects.sort((a, b) => a.w * a.h - b.w * b.h);
  const kept = [];
  for (const r of rects) {
    const overlaps = kept.some((k) => {
      const ix = Math.max(0, Math.min(r.x + r.w, k.x + k.w) - Math.max(r.x, k.x));
      const iy = Math.max(0, Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y));
      const inter = ix * iy;
      return inter > 0.55 * Math.min(r.w * r.h, k.w * k.h);
    });
    if (!overlaps) kept.push(r);
  }
  return kept;
}

// 割り当て対象の項目リスト（10の位→1の位の順。最後に日付・合計）
function buildFields(products) {
  const fields = [];
  for (const p of products) {
    fields.push({ name: `${p.key}_1`, label: `${p.name}｜10の位（左の枠）` });
    fields.push({ name: `${p.key}_0`, label: `${p.name}｜1の位（右の枠）` });
  }
  fields.push({ name: "date_1", label: "日付｜10の位（左の枠）" });
  fields.push({ name: "date_0", label: "日付｜1の位（右の枠）" });
  fields.push({ name: "total_2", label: "合計｜十の位（左の枠）" });
  fields.push({ name: "total_1", label: "合計｜一の位（右の枠）" });
  return fields;
}

// products: マスタ編集中の商品リスト。返り値: roiRows（標準の行順）または null。
export function openRoiEditor(products) {
  return new Promise((resolve) => {
    const cv = window.cv;
    const fields = buildFields(products);
    const assigned = new Map(); // fieldName -> {x,y,w,h}
    let candidates = [];        // 自動検出した候補
    let correctedCanvas = null; // 台形補正後の画像（1000×707）
    let cursor = 0;             // 現在割り当て中の項目 index
    let rawCanvas = null;       // 元画像（四隅タップ用）
    let corners = [];           // 手動四隅

    const overlay = document.createElement("div");
    overlay.className = "rv-overlay";
    overlay.innerHTML = `
      <div class="rv-modal">
        <div class="rv-head">
          <div class="rv-title">交換票の座標設定（ROIエディタ）</div>
          <button class="rv-close" id="reClose">✕</button>
        </div>
        <div class="rv-body" id="reBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector("#reBody");

    function close(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector("#reClose").addEventListener("click", () => close(null));

    // ---- step 1: ファイル読み込み ----
    function stepUpload(message = "") {
      body.innerHTML = `
        ${message ? `<div class="rv-note">${message}</div>` : ""}
        <p>新しい交換票を<b>本番と同じ複合機でスキャン</b>したファイル（PDF または 画像）を選んでください。
        四隅のマーカー（黒い正方形）が写っている必要があります。</p>
        <p class="view-sub">記入枠は空欄のまま（何も書いていない状態）でスキャンしてください。枠の自動検出の精度が上がります。</p>
        <label class="btn">ファイルを選択
          <input type="file" id="reFile" accept="application/pdf,image/*" hidden />
        </label>`;
      body.querySelector("#reFile").addEventListener("change", async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
            const doc = await openPdf(await f.arrayBuffer(), ASSETS + "vendor/pdf.worker.min.js");
            rawCanvas = await renderPdfPage(doc, 1, 1654);
          } else {
            const bmp = await createImageBitmap(f);
            rawCanvas = document.createElement("canvas");
            rawCanvas.width = bmp.width;
            rawCanvas.height = bmp.height;
            rawCanvas.getContext("2d").drawImage(bmp, 0, 0);
          }
          detectAndCorrect();
        } catch (err) {
          stepUpload(`読み込みに失敗しました: ${err.message}`);
        }
      });
    }

    // ---- step 2: マーカー検出→台形補正（失敗時は四隅タップ） ----
    function detectAndCorrect() {
      const src = cv.imread(rawCanvas);
      let coords = null;
      try {
        coords = detectMarkers(src);
      } catch (e) {
        console.error(e);
      }
      if (coords) {
        applyTransform(src, coords); // src はこの中で delete
      } else {
        src.delete();
        stepCorners();
      }
    }

    function applyTransform(src, coords) {
      const dst = transformImage(src, coords);
      src.delete();
      correctedCanvas = document.createElement("canvas");
      correctedCanvas.width = OUTPUT_WIDTH;
      correctedCanvas.height = OUTPUT_HEIGHT;
      cv.imshow(correctedCanvas, dst);
      const mat = dst; // 候補検出に使ってから解放
      candidates = detectBoxCandidates(mat);
      mat.delete();
      stepAssign();
    }

    function stepCorners() {
      corners = [];
      body.innerHTML = `
        <div class="rv-note">マーカーの自動検出に失敗しました。画像の<b>四隅のマーカーの中心</b>を順にタップしてください（順不同）。</div>
        <div class="rv-corner-wrap"><canvas id="reCornerCv" class="rv-corner-canvas"></canvas></div>
        <div class="rv-corner-status" id="reCornerStatus">0 / 4</div>
        <div class="rv-actions"><button class="btn-sub" id="reCornerReset">やり直す</button></div>`;
      const cvs = body.querySelector("#reCornerCv");
      const scale = Math.min(1, 900 / rawCanvas.width);
      cvs.width = Math.round(rawCanvas.width * scale);
      cvs.height = Math.round(rawCanvas.height * scale);
      const ctx = cvs.getContext("2d");
      const draw = () => {
        ctx.drawImage(rawCanvas, 0, 0, cvs.width, cvs.height);
        ctx.fillStyle = "#0ea5e9";
        for (const [x, y] of corners) {
          ctx.beginPath();
          ctx.arc(x * scale, y * scale, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      draw();
      cvs.addEventListener("click", (e) => {
        if (corners.length >= 4) return;
        const r = cvs.getBoundingClientRect();
        const x = (e.clientX - r.left) * (cvs.width / r.width) / scale;
        const y = (e.clientY - r.top) * (cvs.height / r.height) / scale;
        corners.push([x, y]);
        body.querySelector("#reCornerStatus").textContent = `${corners.length} / 4`;
        draw();
        if (corners.length === 4) {
          const src = cv.imread(rawCanvas);
          applyTransform(src, orderPoints(corners));
        }
      });
      body.querySelector("#reCornerReset").addEventListener("click", stepCorners);
    }

    // ---- step 3: 候補の割り当て ----
    function nextUnassigned(from = 0) {
      for (let i = 0; i < fields.length; i++) {
        const idx = (from + i) % fields.length;
        if (!assigned.has(fields[idx].name)) return idx;
      }
      return -1;
    }

    function stepAssign() {
      cursor = nextUnassigned(cursor < 0 ? 0 : cursor);
      const done = [...assigned.keys()].length;
      body.innerHTML = `
        <div class="re-assign">
          <div class="re-canvas-wrap">
            <canvas id="reCv" width="${OUTPUT_WIDTH}" height="${OUTPUT_HEIGHT}" class="re-canvas"></canvas>
            <p class="view-sub">薄い青＝自動検出された枠の候補（${candidates.length}個）／緑＝割り当て済み。
            候補をクリックすると現在の項目に割り当てます。候補が無い場所は<b>ドラッグで枠を描けます</b>。</p>
          </div>
          <div class="re-side">
            <div class="re-current">${cursor >= 0
              ? `次に割り当てる項目:<br><b>${fields[cursor].label}</b>`
              : `<b class="ok">すべて割り当て済みです ✓</b>`}</div>
            <div class="re-progress">${done} / ${fields.length} 枠</div>
            <div class="re-fields" id="reFields">
              ${fields.map((f, i) => `
                <div class="re-field ${i === cursor ? "current" : ""} ${assigned.has(f.name) ? "done" : ""}" data-fi="${i}">
                  ${assigned.has(f.name) ? "✓" : "・"} ${f.label}
                </div>`).join("")}
            </div>
            <div class="rv-actions" style="justify-content:flex-start;flex-wrap:wrap">
              <button class="btn-sub" id="reUndo" ${done ? "" : "disabled"}>一つ戻す</button>
              <button class="btn-sub" id="reRestart">画像を選び直す</button>
            </div>
            <div class="rv-actions">
              <button class="btn-sub" id="reCancel">キャンセル</button>
              <button class="btn" id="reSave" ${done === fields.length ? "" : "disabled"}>この座標で確定</button>
            </div>
          </div>
        </div>`;
      drawCanvas();
      bindAssignEvents();
    }

    function drawCanvas() {
      const cvs = body.querySelector("#reCv");
      if (!cvs) return;
      const ctx = cvs.getContext("2d");
      ctx.drawImage(correctedCanvas, 0, 0);
      // 候補（未割り当てのみ薄青）
      const usedRects = new Set([...assigned.values()].map((r) => `${r.x},${r.y}`));
      ctx.lineWidth = 2;
      for (const c of candidates) {
        if (usedRects.has(`${c.x},${c.y}`)) continue;
        ctx.strokeStyle = "rgba(14,165,233,.8)";
        ctx.strokeRect(c.x, c.y, c.w, c.h);
      }
      // 割り当て済み（緑＋項目名）
      ctx.font = "11px sans-serif";
      for (const [name, r] of assigned) {
        ctx.strokeStyle = "#059669";
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = "#059669";
        ctx.fillText(name, r.x, Math.max(10, r.y - 3));
      }
    }

    function canvasPos(cvs, e) {
      const r = cvs.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (cvs.width / r.width),
        y: (e.clientY - r.top) * (cvs.height / r.height),
      };
    }

    function assignRect(rect) {
      if (cursor < 0) return;
      assigned.set(fields[cursor].name, rect);
      cursor = nextUnassigned(cursor + 1);
      stepAssign();
    }

    function bindAssignEvents() {
      const cvs = body.querySelector("#reCv");
      let dragStart = null;

      cvs.addEventListener("mousedown", (e) => { dragStart = canvasPos(cvs, e); });
      cvs.addEventListener("mouseup", (e) => {
        if (!dragStart) return;
        const end = canvasPos(cvs, e);
        const dx = Math.abs(end.x - dragStart.x), dy = Math.abs(end.y - dragStart.y);
        if (dx > 10 && dy > 10) {
          // ドラッグ → 手動で枠を作成
          assignRect({
            x: Math.round(Math.min(dragStart.x, end.x)),
            y: Math.round(Math.min(dragStart.y, end.y)),
            w: Math.round(dx),
            h: Math.round(dy),
          });
        } else {
          // クリック → 含まれる候補のうち最小のものを割り当て
          const hit = candidates
            .filter((c) => end.x >= c.x && end.x <= c.x + c.w && end.y >= c.y && end.y <= c.y + c.h)
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];
          if (hit) assignRect({ ...hit });
        }
        dragStart = null;
      });

      body.querySelectorAll(".re-field").forEach((d) =>
        d.addEventListener("click", () => {
          cursor = +d.dataset.fi;
          assigned.delete(fields[cursor].name); // 選び直し（再割り当て）
          stepAssign();
        }));

      body.querySelector("#reUndo").addEventListener("click", () => {
        const names = [...assigned.keys()];
        if (!names.length) return;
        const last = names[names.length - 1];
        assigned.delete(last);
        cursor = fields.findIndex((f) => f.name === last);
        stepAssign();
      });
      body.querySelector("#reRestart").addEventListener("click", () => {
        assigned.clear();
        candidates = [];
        cursor = 0;
        stepUpload();
      });
      body.querySelector("#reCancel").addEventListener("click", () => close(null));
      body.querySelector("#reSave").addEventListener("click", () => {
        // 標準の行順（商品ごとに _0 → _1、最後に date/total）で返す
        const rows = [];
        for (const p of products) {
          const r0 = assigned.get(`${p.key}_0`), r1 = assigned.get(`${p.key}_1`);
          rows.push({ name: `${p.key}_0`, ...r0 });
          rows.push({ name: `${p.key}_1`, ...r1 });
        }
        for (const n of ["date_0", "date_1", "total_1", "total_2"]) {
          rows.push({ name: n, ...assigned.get(n) });
        }
        close(rows);
      });
    }

    stepUpload();
  });
}
