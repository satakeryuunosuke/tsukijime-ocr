// 交換票レイアウトモデル。
// 座標系はマーカー中心を四隅 (0,0)-(1000,707) とする台形補正後の空間（A5横比率）。
// 同じモデルから (a) ROI座標（認識用）と (b) 印刷用の票 の両方を導出することで、
// 商品入れ替え時も「マスタ編集 → 新しい票を印刷」だけで座標の整合が保たれる。
//
// スロット配置は現行の交換票と同じ「5列（1〜4列目は4行・5列目は5行）」の列優先。
// 既定座標は現行 ROI_coordinate.csv を誤差0で再現する（tools/check_layout.html で検証）。

export const SPACE = { w: 1000, h: 707 };

// 現行の交換票と同じ既定レイアウト
export function defaultLayout() {
  return {
    space: { ...SPACE },
    // 列ごとの記入枠X座標（10の位＝tens は左、1の位＝ones は右）
    colTensX: [67, 259, 449, 639, 830],
    colOnesX: [116, 305, 497, 687, 877],
    rowY: [73, 160, 246, 333, 418],
    rowsPerCol: [4, 4, 4, 4, 5], // 5列目のみ5行（最下段は合計・日付欄と重なるため他列は4行）
    box: { tensW: 39, onesW: 53, h: 60 },
    date: { tensX: 386, tensW: 53, onesX: 449, onesW: 53, y: 454, h: 60 },
    total: { hiX: 83, loX: 146, w: 53, y: 435, h: 60 }, // hi=total_2(十の位), lo=total_1(一の位)
  };
}

// 配置可能な商品数の上限
export function maxSlots(layout = defaultLayout()) {
  return layout.rowsPerCol.reduce((a, b) => a + b, 0);
}

// 商品リストの i 番目のスロット（列優先: 1列目の上から順に埋める）
export function slotOf(layout, i) {
  let col = 0, rest = i;
  while (col < layout.rowsPerCol.length && rest >= layout.rowsPerCol[col]) {
    rest -= layout.rowsPerCol[col];
    col++;
  }
  if (col >= layout.rowsPerCol.length) return null;
  return { col, row: rest };
}

// products の並び順でROI座標配列を生成（parseRoiCsv と同じ {name,x,y,w,h} 形式・同じ行順）
export function roiRowsFromLayout(layout, products) {
  if (products.length > maxSlots(layout)) {
    throw new Error(`商品が多すぎます（最大 ${maxSlots(layout)} 件、現在 ${products.length} 件）`);
  }
  const rows = [];
  products.forEach((p, i) => {
    const s = slotOf(layout, i);
    rows.push({ name: `${p.key}_0`, x: layout.colOnesX[s.col], y: layout.rowY[s.row], w: layout.box.onesW, h: layout.box.h });
    rows.push({ name: `${p.key}_1`, x: layout.colTensX[s.col], y: layout.rowY[s.row], w: layout.box.tensW, h: layout.box.h });
  });
  rows.push({ name: "date_0", x: layout.date.onesX, y: layout.date.y, w: layout.date.onesW, h: layout.date.h });
  rows.push({ name: "date_1", x: layout.date.tensX, y: layout.date.y, w: layout.date.tensW, h: layout.date.h });
  rows.push({ name: "total_1", x: layout.total.loX, y: layout.total.y, w: layout.total.w, h: layout.total.h });
  rows.push({ name: "total_2", x: layout.total.hiX, y: layout.total.y, w: layout.total.w, h: layout.total.h });
  return rows;
}

// ROI座標CSVテキスト（ROI_coordinate.csv と同形式）
export function roiCsvFromLayout(layout, products) {
  const rows = roiRowsFromLayout(layout, products);
  return ["ROI_name,x,y,h,w", ...rows.map((r) => `${r.name},${r.x},${r.y},${r.h},${r.w}`)].join("\n");
}

// ---- 印刷用HTMLの生成 ----
// A5横（210×148mm）。マーカー中心の矩形を 180×127.26mm とし、中央に配置する。
// 単位変換: 1ユニット = 0.18mm（縦横同スケールなので比率が保存される）
const MM_PER_UNIT = 0.18;
const PAGE = { w: 210, h: 148 };
const RECT = { w: SPACE.w * MM_PER_UNIT, h: SPACE.h * MM_PER_UNIT }; // 180 × 127.26
const ORIGIN = { x: (PAGE.w - RECT.w) / 2, y: (PAGE.h - RECT.h) / 2 }; // 15, 10.37
const MARKER_MM = 9; // マーカー正方形の一辺

const mmX = (u) => ORIGIN.x + u * MM_PER_UNIT;
const mmY = (u) => ORIGIN.y + u * MM_PER_UNIT;
const mm = (u) => u * MM_PER_UNIT;

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function abs(x, y, w, h, style = "") {
  return `position:absolute;left:${x.toFixed(2)}mm;top:${y.toFixed(2)}mm;width:${w.toFixed(2)}mm;height:${h.toFixed(2)}mm;${style}`;
}

// 2桁の記入枠（10の位と1の位が枠線を共有する連結ボックス）。
// 重要: 枠線はROI矩形の外側（6ユニットのクリアランス）に描く。孤立した正方形は
// マーカー検出の候補（面積・アスペクト比が条件内）になり誤検出を招くため、
// 2つの枠を連結して横長（アスペクト比>1.3）にし、マーカー候補から除外させる。
const BOX_CLEAR = 6;   // ROIと枠線のクリアランス（ユニット）
const STROKE = 0.7;    // 枠線の太さ（mm）
function doubleBox(x1, w1, x2, w2, y, h) {
  const left = x1 - BOX_CLEAR, right = x2 + w2 + BOX_CLEAR;
  const divider = (x1 + w1 + x2) / 2; // 2枠の中間
  return (
    `<div style="${abs(mmX(left), mmY(y - BOX_CLEAR), mm(right - left), mm(h + BOX_CLEAR * 2), `border:${STROKE}mm solid #000;box-sizing:border-box;`)}"></div>` +
    `<div style="${abs(mmX(divider) - STROKE / 2, mmY(y - BOX_CLEAR), STROKE, mm(h + BOX_CLEAR * 2), "background:#000;")}"></div>`
  );
}

// 票1枚分のHTML（<div class="sheet">…</div>）
export function formSheetHtml(layout, products, opts = {}) {
  const title = opts.title || "栄冠シール グッズ交換票";
  const parts = [];

  // 四隅マーカー（中心が矩形の角に一致する黒正方形）
  for (const [ux, uy] of [[0, 0], [SPACE.w, 0], [0, SPACE.h], [SPACE.w, SPACE.h]]) {
    parts.push(`<div style="${abs(mmX(ux) - MARKER_MM / 2, mmY(uy) - MARKER_MM / 2, MARKER_MM, MARKER_MM, "background:#000;")}"></div>`);
  }

  // タイトルと名前欄（上部の空き帯。1行目のラベル(y≈47〜)と重ならない高さに収める）
  parts.push(`<div style="${abs(mmX(120), mmY(2), mm(430), mm(38), "font-size:4.4mm;font-weight:bold;display:flex;align-items:center;")}">${esc(title)}</div>`);
  parts.push(`<div style="${abs(mmX(570), mmY(2), mm(380), mm(38), "font-size:3mm;display:flex;align-items:flex-end;border-bottom:0.3mm solid #000;")}">名前：</div>`);

  // 商品スロット（ラベル＋連結記入枠）
  products.forEach((p, i) => {
    const s = slotOf(layout, i);
    if (!s) return;
    const tX = layout.colTensX[s.col], oX = layout.colOnesX[s.col], y = layout.rowY[s.row];
    const labelW = oX + layout.box.onesW - tX + 14;
    parts.push(`<div style="${abs(mmX(tX - 6), mmY(y - 26 - BOX_CLEAR), mm(labelW), mm(24),
      "font-size:2.4mm;line-height:1.1;display:flex;align-items:flex-end;white-space:nowrap;overflow:hidden;")}">${esc(p.name)}<span style="margin-left:auto;font-size:2.2mm;">${p.points}点</span></div>`);
    parts.push(doubleBox(tX, layout.box.tensW, oX, layout.box.onesW, y, layout.box.h));
  });

  // 合計欄（記入は10点単位: □□0点）
  const t = layout.total;
  parts.push(`<div style="${abs(mmX(t.hiX - 6), mmY(t.y - 26 - BOX_CLEAR), mm(220), mm(24), "font-size:2.6mm;display:flex;align-items:flex-end;")}">合計点数</div>`);
  parts.push(doubleBox(t.hiX, t.w, t.loX, t.w, t.y, t.h));
  parts.push(`<div style="${abs(mmX(t.loX + t.w + 12), mmY(t.y + 14), mm(60), mm(40), "font-size:4mm;font-weight:bold;")}">0点</div>`);

  // 日付欄（□□日）
  const d = layout.date;
  parts.push(`<div style="${abs(mmX(d.tensX - 6), mmY(d.y - 26 - BOX_CLEAR), mm(200), mm(24), "font-size:2.6mm;display:flex;align-items:flex-end;")}">交換日</div>`);
  parts.push(doubleBox(d.tensX, d.tensW, d.onesX, d.onesW, d.y, d.h));
  parts.push(`<div style="${abs(mmX(d.onesX + d.onesW + 12), mmY(d.y + 14), mm(40), mm(40), "font-size:4mm;font-weight:bold;")}">日</div>`);

  // 記入上の注意（下部の空き帯）
  parts.push(`<div style="${abs(mmX(60), mmY(545), mm(880), mm(120),
    "font-size:2.6mm;color:#333;line-height:1.5;")}">・数字は枠いっぱいに、はっきり書いてください（左の枠＝10の位、右の枠＝1の位。9個までは右の枠だけ）。<br>・合計点数は10点単位で書いてください（例: 75点 →「7」「5」、250点 → 「2」「5」）。</div>`);

  return `<div class="sheet" style="position:relative;width:${PAGE.w}mm;height:${PAGE.h}mm;background:#fff;overflow:hidden;">${parts.join("")}</div>`;
}

// 印刷用の完全なHTMLドキュメント
export function formDocumentHtml(layout, products, opts = {}) {
  const sheet = formSheetHtml(layout, products, opts);
  return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"><title>交換票の印刷</title>
<style>
  @page { size: 210mm 148mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Hiragino Sans", "Meiryo", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen {
    body { background: #64748b; padding: 10mm; }
    .sheet { box-shadow: 0 2mm 8mm rgba(0,0,0,.4); margin: 0 auto; }
    .print-bar { position: fixed; top: 8px; right: 8px; }
    .print-bar button { font-size: 14px; padding: 8px 18px; border: none; border-radius: 8px;
      background: #0ea5e9; color: #fff; font-weight: bold; cursor: pointer; }
  }
  @media print { .print-bar { display: none; } }
</style></head>
<body>
<div class="print-bar"><button onclick="window.print()">印刷（用紙: A5横・余白なし・倍率100%）</button></div>
${sheet}</body></html>`;
}
