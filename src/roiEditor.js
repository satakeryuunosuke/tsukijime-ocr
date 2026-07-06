// ROI割り当てエディタ。
// - openAssignSession: 下絵（補正済みスキャン or Excel模式図）＋枠候補の上で、
//   各記入項目に枠をクリック割り当てするモーダル。Excel自動抽出の確認・修正にも使う。
// - openRoiEditor: スキャン（画像/PDF）からの座標設定フロー
//   （マーカー検出→失敗時は四隅タップ→台形補正→枠自動検出→openAssignSession）。
// 返り値はどちらも parseRoiCsv と同じ {name,x,y,w,h} の配列（キャンセル時 null）。
import { detectMarkers, orderPoints } from "./markerDetector.js";
import { transformImage, OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./geometry.js";
import { openPdf, renderPdfPage } from "./pdf.js";

const ASSETS = "public/assets/";

// 割り当て対象の項目リスト（10の位→1の位の順。最後に日付・合計）
function buildFields(products) {
  const fields = [];
  for (const p of products) {
    fields.push({ name: `${p.key}_1`, label: `${p.name}｜10の位（左の枠）` });
    fields.push({ name: `${p.key}_0`, label: `${p.name}｜1の位（右の枠）` });
  }
  fields.push({ name: "date_1", label: "日付｜10の位（左の枠）" });
  fields.push({ name: "date_0", label: "日付｜1の位（右の枠）" });
  fields.push({ name: "total_2", label: "合計｜百の位（左の枠）" });
  fields.push({ name: "total_1", label: "合計｜十の位（中の枠）" });
  return fields;
}

// 割り当てモーダル。
// opts: {
//   products, baseCanvas(1000×707の下絵), candidates([{x,y,w,h}]),
//   preAssigned(Map name->rect, 省略可), note(説明文, 省略可)
// }
export function openAssignSession(opts) {
  const { products, baseCanvas, candidates = [], note = "" } = opts;
  return new Promise((resolve) => {
    const fields = buildFields(products);
    const assigned = new Map(opts.preAssigned || []);
    let cursor = 0;

    const overlay = document.createElement("div");
    overlay.className = "rv-overlay";
    overlay.innerHTML = `
      <div class="rv-modal">
        <div class="rv-head">
          <div class="rv-title">交換票の座標設定</div>
          <button class="rv-close" id="asClose">✕</button>
        </div>
        <div class="rv-body" id="asBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    const body = overlay.querySelector("#asBody");

    function close(result) {
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector("#asClose").addEventListener("click", () => close(null));

    function nextUnassigned(from = 0) {
      for (let i = 0; i < fields.length; i++) {
        const idx = (from + i) % fields.length;
        if (!assigned.has(fields[idx].name)) return idx;
      }
      return -1;
    }

    function render() {
      cursor = nextUnassigned(cursor < 0 ? 0 : cursor);
      const done = [...assigned.keys()].filter((n) => fields.some((f) => f.name === n)).length;
      body.innerHTML = `
        ${note ? `<div class="rv-note" style="background:#f0f9ff;border-color:#bae6fd;">${note}</div>` : ""}
        <div class="re-assign">
          <div class="re-canvas-wrap">
            <canvas id="reCv" width="${baseCanvas.width}" height="${baseCanvas.height}" class="re-canvas"></canvas>
            <p class="view-sub">薄い青＝枠の候補（${candidates.length}個）／緑＝割り当て済み。
            候補をクリックすると現在の項目に割り当てます。候補が無い場所は<b>ドラッグで枠を描けます</b>。
            右のリストの項目をクリックすると、その項目を選び直せます。</p>
          </div>
          <div class="re-side">
            <div class="re-current">${cursor >= 0
              ? `次に割り当てる項目:<br><b>${fields[cursor].label}</b>`
              : `<b class="ok">すべて割り当て済みです ✓ 緑枠の位置と名前を確認して確定してください。</b>`}</div>
            <div class="re-progress">${done} / ${fields.length} 枠</div>
            <div class="re-fields" id="reFields">
              ${fields.map((f, i) => `
                <div class="re-field ${i === cursor ? "current" : ""} ${assigned.has(f.name) ? "done" : ""}" data-fi="${i}">
                  ${assigned.has(f.name) ? "✓" : "・"} ${f.label}
                </div>`).join("")}
            </div>
            <div class="rv-actions" style="justify-content:flex-start;flex-wrap:wrap">
              <button class="btn-sub" id="reUndo" ${done ? "" : "disabled"}>一つ戻す</button>
              <button class="btn-sub" id="reClear" ${done ? "" : "disabled"}>すべて解除</button>
            </div>
            <div class="rv-actions">
              <button class="btn-sub" id="reCancel">キャンセル</button>
              <button class="btn" id="reSave" ${done === fields.length ? "" : "disabled"}>この座標で確定</button>
            </div>
          </div>
        </div>`;
      drawCanvas();
      bindEvents();
    }

    function drawCanvas() {
      const cvs = body.querySelector("#reCv");
      const ctx = cvs.getContext("2d");
      ctx.drawImage(baseCanvas, 0, 0);
      const usedRects = new Set([...assigned.values()].map((r) => `${r.x},${r.y}`));
      ctx.lineWidth = 2;
      for (const c of candidates) {
        if (usedRects.has(`${c.x},${c.y}`)) continue;
        ctx.strokeStyle = "rgba(14,165,233,.8)";
        ctx.strokeRect(c.x, c.y, c.w, c.h);
      }
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
      render();
    }

    function bindEvents() {
      const cvs = body.querySelector("#reCv");
      let dragStart = null;
      cvs.addEventListener("mousedown", (e) => { dragStart = canvasPos(cvs, e); });
      cvs.addEventListener("mouseup", (e) => {
        if (!dragStart) return;
        const end = canvasPos(cvs, e);
        const dx = Math.abs(end.x - dragStart.x), dy = Math.abs(end.y - dragStart.y);
        if (dx > 10 && dy > 10) {
          assignRect({
            x: Math.round(Math.min(dragStart.x, end.x)),
            y: Math.round(Math.min(dragStart.y, end.y)),
            w: Math.round(dx),
            h: Math.round(dy),
          });
        } else {
          const hit = candidates
            .filter((c) => end.x >= c.x && end.x <= c.x + c.w && end.y >= c.y && end.y <= c.y + c.h)
            .sort((a, b) => a.w * a.h - b.w * b.h)[0];
          if (hit) assignRect({ x: hit.x, y: hit.y, w: hit.w, h: hit.h });
        }
        dragStart = null;
      });

      body.querySelectorAll(".re-field").forEach((d) =>
        d.addEventListener("click", () => {
          cursor = +d.dataset.fi;
          assigned.delete(fields[cursor].name); // 選び直し（再割り当て）
          render();
        }));

      body.querySelector("#reUndo").addEventListener("click", () => {
        const names = [...assigned.keys()];
        if (!names.length) return;
        const last = names[names.length - 1];
        assigned.delete(last);
        cursor = fields.findIndex((f) => f.name === last);
        render();
      });
      body.querySelector("#reClear").addEventListener("click", () => {
        assigned.clear();
        cursor = 0;
        render();
      });
      body.querySelector("#reCancel").addEventListener("click", () => close(null));
      body.querySelector("#reSave").addEventListener("click", () => {
        // 標準の行順（商品ごとに _0 → _1、最後に date/total）で返す
        const rows = [];
        for (const p of products) {
          rows.push({ name: `${p.key}_0`, ...assigned.get(`${p.key}_0`) });
          rows.push({ name: `${p.key}_1`, ...assigned.get(`${p.key}_1`) });
        }
        for (const n of ["date_0", "date_1", "total_1", "total_2"]) {
          rows.push({ name: n, ...assigned.get(n) });
        }
        close(rows);
      });
    }

    render();
  });
}

// ---- スキャンからの座標設定フロー ----

// 記入枠の自動検出（台形補正後のスキャン画像に対して）
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
      return ix * iy > 0.55 * Math.min(r.w * r.h, k.w * k.h);
    });
    if (!overlaps) kept.push(r);
  }
  return kept;
}

// products: マスタ編集中の商品リスト。返り値: roiRows または null。
export function openRoiEditor(products) {
  return new Promise((resolve) => {
    const cv = window.cv;
    let rawCanvas = null;
    let corners = [];

    const overlay = document.createElement("div");
    overlay.className = "rv-overlay";
    overlay.innerHTML = `
      <div class="rv-modal">
        <div class="rv-head">
          <div class="rv-title">スキャンからの座標設定</div>
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

    function detectAndCorrect() {
      const src = cv.imread(rawCanvas);
      let coords = null;
      try {
        coords = detectMarkers(src);
      } catch (e) {
        console.error(e);
      }
      if (coords) applyTransform(src, coords); // src はこの中で delete
      else { src.delete(); stepCorners(); }
    }

    function applyTransform(src, coords) {
      const dst = transformImage(src, coords);
      src.delete();
      const corrected = document.createElement("canvas");
      corrected.width = OUTPUT_WIDTH;
      corrected.height = OUTPUT_HEIGHT;
      cv.imshow(corrected, dst);
      const candidates = detectBoxCandidates(dst);
      dst.delete();
      // 割り当てモーダルへ引き継ぐ（このモーダルは閉じる）
      overlay.remove();
      openAssignSession({ products, baseCanvas: corrected, candidates }).then(resolve);
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

    stepUpload();
  });
}
