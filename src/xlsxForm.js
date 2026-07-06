// Excel交換票（.xlsx）の解析。
// シート上の「黒塗り2×2セルのマーカー」4つ（A4に2票あるときは8つ→上の票を使用）を基準に、
// 罫線で囲まれた矩形領域＝記入枠を検出し、台形補正後座標系(1000×707)のROI座標を導出する。
// 枠の並びの規則で自動割り当ても行う:
//   ・左が狭い横2連の枠 → 商品（左=10の位, 右=1の位）。列ごとに上から、左の列から順に商品リストと対応
//   ・等幅の横2連の枠   → 日付（左=10の位, 右=1の位）
//   ・横3連の枠         → 合計（左=百の位=total_2, 中=十の位=total_1。右端=一の位は読まない）
//   ・単独の枠           → 無視（月の枠・ラベル枠など）
// 座標は現行 ROI_coordinate.csv（手調整済み）と±2ユニットで一致することを実データで検証済み。
import { ensureExcelJs } from "./excelReport.js";

const SPACE_W = 1000, SPACE_H = 707;
const MAX_SCAN_ROWS = 250, MAX_SCAN_COLS = 100;

// 検出した枠（セル領域の内側）→ ROIへのインセット。
// 手調整された現行ROI CSVから逆算した値（枠線を確実に除外しつつ記入域を最大に取る）。
export function insetRoi(b) {
  return {
    x: Math.round(b.x + 4),
    y: Math.round(b.y + 4),
    w: Math.round(b.w - 9),
    h: Math.round(b.h - 9),
  };
}

function isBlackFill(cell) {
  const f = cell.fill;
  if (!f || f.type !== "pattern" || f.pattern !== "solid" || !f.fgColor) return false;
  const argb = f.fgColor.argb;
  if (argb && /^(FF)?000000$/i.test(argb)) return true;
  // Office既定テーマの theme 1 は黒（テキスト1）
  if (f.fgColor.theme === 1) return true;
  return false;
}

const hasLine = (side) => !!(side && side.style);

// arrayBuffer: 交換票の .xlsx
// 返り値: { ok, error?, boxes[], texts[], markers, warnings[], twoForms }
//   boxes: [{x,y,w,h, r1,r2,c1,c2}]（unit空間・インセット前）
export async function parseFormXlsx(arrayBuffer) {
  await ensureExcelJs();
  const wb = new window.ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { ok: false, error: "シートが見つかりません。" };

  const maxRow = Math.min(ws.rowCount || MAX_SCAN_ROWS, MAX_SCAN_ROWS);
  const maxCol = Math.min(ws.columnCount || MAX_SCAN_COLS, MAX_SCAN_COLS);

  // ---- 累積位置（列幅は文字数単位・行高はポイント単位。軸ごとに比率だけ使うので単位換算は不要）----
  const defW = ws.properties.defaultColWidth || 8.43;
  const defH = ws.properties.defaultRowHeight || 15;
  const colX = [0]; // colX[i] = 列1..i の右端位置
  for (let c = 1; c <= maxCol; c++) {
    const w = ws.getColumn(c).width;
    colX[c] = colX[c - 1] + (w == null ? defW : w);
  }
  const rowY = [0];
  for (let r = 1; r <= maxRow; r++) {
    const h = ws.getRow(r).height;
    rowY[r] = rowY[r - 1] + (h == null ? defH : h);
  }

  // ---- 黒塗りセル → 連結ブロック（マーカー）----
  const black = new Set();
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      if (isBlackFill(row.getCell(c))) black.add(r * 1000 + c);
    }
  }
  const seenB = new Set();
  const blocks = [];
  for (const key of black) {
    if (seenB.has(key)) continue;
    const stack = [key];
    seenB.add(key);
    let r1 = 1e9, r2 = 0, c1 = 1e9, c2 = 0;
    while (stack.length) {
      const k = stack.pop();
      const r = Math.floor(k / 1000), c = k % 1000;
      r1 = Math.min(r1, r); r2 = Math.max(r2, r);
      c1 = Math.min(c1, c); c2 = Math.max(c2, c);
      for (const nk of [k + 1, k - 1, k + 1000, k - 1000]) {
        if (black.has(nk) && !seenB.has(nk)) { seenB.add(nk); stack.push(nk); }
      }
    }
    blocks.push({ r1, r2, c1, c2 });
  }
  if (blocks.length < 4) {
    return { ok: false, error: `マーカー（黒塗りセルのかたまり）が ${blocks.length} 個しか見つかりません。四隅に黒塗りの2×2セルが必要です。` };
  }

  // ---- 票1枚目のマーカー4つを特定（上端の2つ＋列位置が一致する次の段の2つ）----
  const center = (b) => ({
    x: (colX[b.c1 - 1] + colX[b.c2]) / 2,
    y: (rowY[b.r1 - 1] + rowY[b.r2]) / 2,
    r1: b.r1,
  });
  const cs = blocks.map(center).sort((a, b) => a.y - b.y || a.x - b.x);
  const topPair = cs.slice(0, 2).sort((a, b) => a.x - b.x);
  // 上端ペアと列位置がほぼ一致する、次に近い段のペアを探す
  const rest = cs.slice(2);
  const tol = (colX[maxCol] || 100) * 0.02;
  let bottomPair = null;
  for (let i = 0; i < rest.length - 1; i++) {
    const cand = rest.filter((p) => Math.abs(p.y - rest[i].y) < 0.1 || p === rest[i]);
    const sorted = cand.sort((a, b) => a.x - b.x);
    if (sorted.length >= 2 &&
        Math.abs(sorted[0].x - topPair[0].x) < tol &&
        Math.abs(sorted[sorted.length - 1].x - topPair[1].x) < tol) {
      bottomPair = [sorted[0], sorted[sorted.length - 1]];
      break;
    }
  }
  if (!bottomPair) return { ok: false, error: "下側のマーカーが見つかりません（上のマーカーと同じ列位置に必要です）。" };

  const xL = (topPair[0].x + bottomPair[0].x) / 2;
  const xR = (topPair[1].x + bottomPair[1].x) / 2;
  const yT = (topPair[0].y + topPair[1].y) / 2;
  const yB = (bottomPair[0].y + bottomPair[1].y) / 2;
  if (xR - xL <= 0 || yB - yT <= 0) return { ok: false, error: "マーカーの配置が不正です。" };
  const toUX = (x) => (x - xL) * SPACE_W / (xR - xL);
  const toUY = (y) => (y - yT) * SPACE_H / (yB - yT);

  const twoForms = blocks.length >= 8;

  // ---- 罫線の壁マップ → フラッドフィルで囲まれた領域を検出（票1枚目の範囲のみ）----
  // 下マーカーの最終行＋2行までを走査対象にする（2票目は対象外）
  let bottomRow = 0;
  for (const b of blocks) {
    if (Math.abs(center(b).y - yB) < 0.1) bottomRow = Math.max(bottomRow, b.r2);
  }
  const R2 = Math.min(maxRow, (bottomRow || maxRow) + 2);

  const vwall = new Set(), hwall = new Set();
  const cellCache = [];
  for (let r = 1; r <= R2; r++) {
    const row = ws.getRow(r);
    cellCache[r] = [];
    for (let c = 1; c <= maxCol; c++) cellCache[r][c] = row.getCell(c).border || {};
  }
  for (let r = 1; r <= R2; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const b = cellCache[r][c];
      const right = c < maxCol ? cellCache[r][c + 1] : null;
      const below = r < R2 ? cellCache[r + 1][c] : null;
      if (hasLine(b.right) || (right && hasLine(right.left))) vwall.add(r * 1000 + c);
      if (hasLine(b.bottom) || (below && hasLine(below.top))) hwall.add(r * 1000 + c);
    }
  }

  const seen = new Set();
  const boxes = [];
  for (let r0 = 1; r0 <= R2; r0++) {
    for (let c0 = 1; c0 <= maxCol; c0++) {
      const k0 = r0 * 1000 + c0;
      if (seen.has(k0)) continue;
      const stack = [k0];
      seen.add(k0);
      let n = 0, r1 = 1e9, r2 = 0, c1 = 1e9, c2 = 0;
      while (stack.length) {
        const k = stack.pop();
        const r = Math.floor(k / 1000), c = k % 1000;
        n++;
        r1 = Math.min(r1, r); r2 = Math.max(r2, r);
        c1 = Math.min(c1, c); c2 = Math.max(c2, c);
        if (c < maxCol && !vwall.has(k) && !seen.has(k + 1)) { seen.add(k + 1); stack.push(k + 1); }
        if (c > 1 && !vwall.has(k - 1) && !seen.has(k - 1)) { seen.add(k - 1); stack.push(k - 1); }
        if (r < R2 && !hwall.has(k) && !seen.has(k + 1000)) { seen.add(k + 1000); stack.push(k + 1000); }
        if (r > 1 && !hwall.has(k - 1000) && !seen.has(k - 1000)) { seen.add(k - 1000); stack.push(k - 1000); }
      }
      const cols = c2 - c1 + 1, rows = r2 - r1 + 1;
      if (!(cols >= 2 && cols <= 10 && rows >= 2 && rows <= 8)) continue;
      if (cols * rows !== n) continue; // 矩形のみ
      const x = toUX(colX[c1 - 1]), y = toUY(rowY[r1 - 1]);
      const w = toUX(colX[c2]) - x, h = toUY(rowY[r2]) - y;
      // 票の範囲内（マーカー矩形の少し外まで許容）
      if (x < -30 || y < -30 || x + w > SPACE_W + 30 || y + h > SPACE_H + 30) continue;
      // 記入枠として妥当なサイズ（ユニット空間）
      if (w < 20 || w > 140 || h < 30 || h > 120) continue;
      boxes.push({ x, y, w, h, r1, r2, c1, c2 });
    }
  }

  // ---- テキスト（スキマティック描画用）----
  const texts = [];
  for (let r = 1; r <= R2; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= maxCol; c++) {
      const v = row.getCell(c).value;
      if (v == null) continue;
      const s = typeof v === "object" ? (v.richText ? v.richText.map((t) => t.text).join("") : String(v.result ?? "")) : String(v);
      if (!s.trim()) continue;
      const x = toUX(colX[c - 1]), y = toUY((rowY[r - 1] + rowY[r]) / 2);
      if (x < -30 || x > SPACE_W + 30 || y < -30 || y > SPACE_H + 30) continue;
      texts.push({ x, y, text: s.trim().slice(0, 14) });
    }
  }

  const warnings = [];
  if (twoForms) warnings.push("A4に2票の構成を検出しました。上の票の配置を使用します（下の票は上と同一にしてください）。");

  return { ok: true, boxes, texts, warnings, twoForms };
}

// 枠の並び規則による自動割り当て。
// boxes: parseFormXlsx の boxes、products: マスタの商品リスト（票の並び順＝左の列の上から順）
// 現行の票では1商品の行は [10の位(狭)][1の位(広)][単位ラベル(最狭)] の3連になる
// （結合セルの単位ラベルにも罫線があり検出されるため）。ラベルが検出されない票では2連。
// 返り値: { assigned: Map(roiName -> {x,y,w,h}), messages: [] }
export function autoAssign(boxes, products) {
  const messages = [];
  const assigned = new Map();
  const EQ = 6; // 幅の同一判定の許容（ユニット）

  // 同じ行帯（r1,r2が一致）で列が連続する枠をチェーンにまとめる
  const sorted = [...boxes].sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1);
  const chains = [];
  for (const b of sorted) {
    const chain = chains.find((ch) => {
      const last = ch[ch.length - 1];
      return last.r1 === b.r1 && last.r2 === b.r2 && b.c1 === last.c2 + 1;
    });
    if (chain) chain.push(b);
    else chains.push([b]);
  }

  // 先に合計（等幅の3連以上）と日付（等幅の2連）を確定する
  let dateChain = null, totalChain = null;
  for (const ch of chains) {
    const w = ch.map((b) => b.w);
    if (ch.length >= 3 && Math.abs(w[0] - w[1]) <= EQ && Math.abs(w[1] - w[2]) <= EQ) {
      if (totalChain) messages.push("合計らしい枠（等幅の3連）が複数見つかりました。最初のものを使用します。");
      else totalChain = ch;
    } else if (ch.length === 2 && Math.abs(w[0] - w[1]) <= EQ) {
      if (dateChain) messages.push("日付らしい枠（等幅の2連）が複数見つかりました。最初のものを使用します。");
      else dateChain = ch;
    }
  }

  // 商品ペア: 先頭2枠が「狭→広」の2連以上。
  // 日付欄と行範囲が完全に一致するチェーン（スタッフ記入欄の「例」の枠など、
  // 日付と同じ段に並ぶ飾り枠）は商品として扱わない。
  const sameRows = (a, b) => b && a[0].r1 === b[0].r1 && a[0].r2 === b[0].r2;
  const productPairs = [];
  for (const ch of chains) {
    if (ch === dateChain || ch === totalChain) continue;
    if (ch.length < 2) continue;
    if (!(ch[0].w < ch[1].w - EQ)) continue;
    if (sameRows(ch, dateChain) || sameRows(ch, totalChain)) continue;
    productPairs.push(ch);
  }

  // 商品ペアを列（帯）→上から の順に並べる（現行の票の並び＝商品リストの順）
  const bandXs = [...new Set(productPairs.map((p) => p[0].c1))].sort((a, b) => a - b);
  const bandOf = (p) => bandXs.findIndex((x) => Math.abs(x - p[0].c1) <= 1);
  productPairs.sort((a, b) => bandOf(a) - bandOf(b) || a[0].r1 - b[0].r1);

  if (productPairs.length !== products.length) {
    messages.push(`商品の枠ペアが ${productPairs.length} 組見つかりましたが、商品リストは ${products.length} 件です。割り当てを確認してください。`);
  }
  const n = Math.min(productPairs.length, products.length);
  for (let i = 0; i < n; i++) {
    const [tens, ones] = productPairs[i];
    assigned.set(`${products[i].key}_1`, { x: tens.x, y: tens.y, w: tens.w, h: tens.h });
    assigned.set(`${products[i].key}_0`, { x: ones.x, y: ones.y, w: ones.w, h: ones.h });
  }
  if (dateChain) {
    assigned.set("date_1", { x: dateChain[0].x, y: dateChain[0].y, w: dateChain[0].w, h: dateChain[0].h });
    assigned.set("date_0", { x: dateChain[1].x, y: dateChain[1].y, w: dateChain[1].w, h: dateChain[1].h });
  } else {
    messages.push("日付の枠（等幅の横2連）が見つかりませんでした。手動で割り当ててください。");
  }
  if (totalChain) {
    assigned.set("total_2", { x: totalChain[0].x, y: totalChain[0].y, w: totalChain[0].w, h: totalChain[0].h });
    assigned.set("total_1", { x: totalChain[1].x, y: totalChain[1].y, w: totalChain[1].w, h: totalChain[1].h });
  } else {
    messages.push("合計の枠（横3連）が見つかりませんでした。手動で割り当ててください。");
  }
  return { assigned, messages };
}

// スキマティック（模式図）キャンバス: 白地にセルのテキストを描画（枠は割り当てUI側が描く）
export function schematicCanvas(parsed) {
  const c = document.createElement("canvas");
  c.width = SPACE_W;
  c.height = SPACE_H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, SPACE_W, SPACE_H);
  g.fillStyle = "#64748b";
  g.font = "11px sans-serif";
  for (const t of parsed.texts) g.fillText(t.text, t.x + 1, t.y + 4);
  return c;
}
