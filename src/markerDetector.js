// marker_detector_E.detect_markers の移植。
// 四隅の四角マーカーを検出し、[左上, 右上, 右下, 左下] の4点を返す。検出失敗時 null。
//
// パラメータは NEO_tool_2.load_config のデフォルトと一致させている
// （config.json の nested marker_detection は既存コードでは実際には使われないため、
//  min_area=300 等のデフォルト値を採用）。
export const MARKER_PARAMS = {
  block_size: 11,
  c_value: 2,
  closing_iter: 2,
  min_area: 300,
  solidity_thr: 0.85,
  max_area: 15000,
};

function argExtreme(arr, cmp) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if (cmp(arr[i], arr[idx])) idx = i;
  return idx;
}

// _order_points の移植: [左上, 右上, 右下, 左下]
// 手動四隅指定（マーカー検出失敗時のフォールバック）でも再利用するため export。
export function orderPoints(pts) {
  const sum = pts.map((p) => p[0] + p[1]);
  const diff = pts.map((p) => p[1] - p[0]); // np.diff([x,y]) = y - x
  const tl = pts[argExtreme(sum, (a, b) => a < b)];
  const br = pts[argExtreme(sum, (a, b) => a > b)];
  const tr = pts[argExtreme(diff, (a, b) => a < b)];
  const bl = pts[argExtreme(diff, (a, b) => a > b)];
  return [tl, tr, br, bl];
}

// _is_rectangle の移植: 4内角が 90±tol 度以内か
function isRectangle(pts, tol = 15.0) {
  const angle = (p1, p2, p3) => {
    const v1 = [p1[0] - p2[0], p1[1] - p2[1]];
    const v2 = [p3[0] - p2[0], p3[1] - p2[1]];
    const n1 = Math.hypot(v1[0], v1[1]);
    const n2 = Math.hypot(v2[0], v2[1]);
    let dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
    dot = Math.max(-1, Math.min(1, dot));
    return (Math.acos(dot) * 180) / Math.PI;
  };
  const angles = [
    angle(pts[3], pts[0], pts[1]),
    angle(pts[0], pts[1], pts[2]),
    angle(pts[1], pts[2], pts[3]),
    angle(pts[2], pts[3], pts[0]),
  ];
  return angles.every((a) => Math.abs(a - 90.0) <= tol);
}

// BlockSize は奇数・3以上（adaptiveThreshold の要件）
function normBlockSize(bs) {
  bs = Math.max(3, Math.round(bs));
  return bs % 2 === 0 ? bs + 1 : bs;
}

// 前処理（グレースケール→ブラー→適応二値化→クロージング）。返り値の thresh は呼び出し側で delete。
export function markerThreshold(srcMat, params = MARKER_PARAMS) {
  const cv = window.cv;
  const gray = new cv.Mat();
  cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY);
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  gray.delete();
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV, normBlockSize(params.block_size), params.c_value);
  blurred.delete();
  if (params.closing_iter > 0) {
    const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), params.closing_iter);
    kernel.delete();
  }
  return thresh;
}

// 指定パラメータで「マーカー候補」を検出する（パラメータ調整UI・自動探索用）。
// 返り値: { centers, hulls, metrics }（個数チェック・長方形判定は行わない）
//   metrics: [{ center:[x,y], area, solidity }] — 自動探索で min_area / solidity を
//   再検出なしにローカルで絞り込めるよう、候補ごとの計測値も返す。
export function detectMarkerCandidates(srcMat, params = MARKER_PARAMS) {
  const cv = window.cv;
  const thresh = markerThreshold(srcMat, params);
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thresh, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hier.delete();
  thresh.delete();

  const maxArea = params.max_area ?? MARKER_PARAMS.max_area;
  const centers = [];
  const hulls = [];
  const metrics = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const hull = new cv.Mat();
    cv.convexHull(cnt, hull, false, true);
    const area = cv.contourArea(hull, false);
    if (area < params.min_area || area > maxArea) {
      hull.delete(); cnt.delete(); continue;
    }
    const peri = cv.arcLength(hull, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(hull, approx, 0.04 * peri, true);
    if (approx.rows === 4) {
      const r = cv.boundingRect(approx);
      const aspect = r.width / r.height;
      const solidity = cv.contourArea(cnt, false) / (r.width * r.height);
      if (aspect >= 0.7 && aspect <= 1.3 && solidity > params.solidity_thr) {
        const M = cv.moments(hull, false);
        if (M.m00 !== 0) {
          const center = [Math.trunc(M.m10 / M.m00), Math.trunc(M.m01 / M.m00)];
          centers.push(center);
          const pts = [];
          for (let k = 0; k < hull.rows; k++) pts.push([hull.data32S[k * 2], hull.data32S[k * 2 + 1]]);
          hulls.push(pts);
          metrics.push({ center, area, solidity });
        }
      }
    }
    approx.delete(); hull.delete(); cnt.delete();
  }
  contours.delete();
  return { centers, hulls, metrics };
}

// 自動検出：候補がちょうど4つ かつ 長方形配置のとき [左上,右上,右下,左下] を返す。失敗時 null。
export function detectMarkers(srcMat, params = MARKER_PARAMS) {
  const { centers } = detectMarkerCandidates(srcMat, params);
  if (centers.length !== 4) return null;
  const ordered = orderPoints(centers);
  if (!isRectangle(ordered)) return null;
  return ordered;
}

// ---- 自動パラメータ探索（既定値で失敗したときのフォールバック）----
// 典型例: 既定値では文字などを含む5個以上が検出される → 充填率(solidity)や最小面積を
// 引き上げると本物のマーカー4個に絞り込める。ユーザーが手動でやっていた操作を自動化する。
//
// 手順（見つかった時点で終了）:
//  1. 二値化パラメータ（block_size / c_value / closing_iter）のバリエーションごとに
//     緩い条件で候補を一括検出し、min_area × solidity を厳しい順にスイープ。
//     「ちょうど4個 かつ 長方形配置」になった組を採用。
//  2. それでも4個に絞れない場合は、候補から4点の組合せを総当たりし、
//     マーカーらしい長方形（isMarkerRectangle）になる組を選ぶ。

const SOLIDITY_STEPS = [0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];
const MIN_AREA_STEPS = [1500, 1000, 700, 500, 300, 150];

// マーカー4点として妥当な長方形か。
//  - 4内角が 90±tol 度（長方形配置）
//  - 対辺の長さがほぼ等しい（歪んだ四角形を排除）
//  - 用紙の四隅に置かれたマーカーなので、画像に対して十分大きい
// ordered: orderPoints 済みの [左上,右上,右下,左下]。imgW/imgH 省略時はサイズ条件をスキップ。
export function isMarkerRectangle(ordered, imgW = 0, imgH = 0, tol = 12.0) {
  const uniq = new Set(ordered.map((p) => p[0] + "," + p[1]));
  if (uniq.size !== 4) return false;
  if (!isRectangle(ordered, tol)) return false;
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const top = len(ordered[0], ordered[1]);
  const bottom = len(ordered[3], ordered[2]);
  const left = len(ordered[0], ordered[3]);
  const right = len(ordered[1], ordered[2]);
  if (Math.min(top, bottom) / Math.max(top, bottom) < 0.85) return false;
  if (Math.min(left, right) / Math.max(left, right) < 0.85) return false;
  if (imgW && imgH) {
    const w = (top + bottom) / 2;
    const h = (left + right) / 2;
    if (w < imgW * 0.4 || h < imgH * 0.3) return false;
  }
  return true;
}

// 候補（metrics）から4点の組合せを総当たりし、マーカーらしい長方形になる組を返す。
// 複数見つかった場合は「面積の大きい長方形・マーカー同士の大きさが揃っている」ものを優先。
function pickMarkerSubset(cands, imgW, imgH) {
  if (cands.length < 4 || cands.length > 14) return null; // 多すぎるとノイズ画像なので諦める
  let best = null;
  const n = cands.length;
  for (let a = 0; a < n - 3; a++)
    for (let b = a + 1; b < n - 2; b++)
      for (let c = b + 1; c < n - 1; c++)
        for (let d = c + 1; d < n; d++) {
          const four = [cands[a], cands[b], cands[c], cands[d]];
          const areas = four.map((m) => m.area);
          if (Math.max(...areas) > Math.min(...areas) * 3) continue; // マーカーはほぼ同じ大きさ
          const ordered = orderPoints(four.map((m) => m.center));
          if (!isMarkerRectangle(ordered, imgW, imgH)) continue;
          const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
          const score = len(ordered[0], ordered[1]) * len(ordered[0], ordered[3]);
          if (!best || score > best.score) best = { score, ordered };
        }
  return best ? best.ordered : null;
}

// 自動パラメータ探索。成功時 { coords, params }（params は組合せ絞り込みの場合 null）、失敗時 null。
export function autoDetectMarkers(srcMat, baseParams = MARKER_PARAMS) {
  const imgW = srcMat.cols;
  const imgH = srcMat.rows;
  const variants = [
    {}, // まず既定の二値化のまま（最頻: しきい値スイープだけで4個に絞れる）
    { closing_iter: 3 }, { closing_iter: 4 }, { closing_iter: 1 },
    { c_value: 4 }, { c_value: 6 }, { c_value: 1 },
    { block_size: 15 }, { block_size: 21 },
  ];
  let defaultMetrics = null;

  for (const v of variants) {
    const probe = { ...baseParams, ...v, min_area: 150, solidity_thr: 0.5 };
    const { metrics } = detectMarkerCandidates(srcMat, probe);
    if (v === variants[0]) defaultMetrics = metrics;
    if (metrics.length < 4) continue;

    for (const minArea of MIN_AREA_STEPS) {
      for (const sol of SOLIDITY_STEPS) {
        const f = metrics.filter((m) => m.area >= minArea && m.solidity > sol);
        if (f.length < 4) continue;   // 条件が厳しすぎ → さらに緩める
        if (f.length > 4) break;      // これ以上緩めても増えるだけ → 次の min_area へ
        const ordered = orderPoints(f.map((m) => m.center));
        if (isMarkerRectangle(ordered, imgW, imgH)) {
          return { coords: ordered, params: { ...baseParams, ...v, min_area: minArea, solidity_thr: sol } };
        }
        break; // 4個だが長方形でない → この min_area では見込みなし
      }
    }
  }

  // パラメータでは4個に絞れない → 既定二値化の候補から組合せで絞り込む
  if (defaultMetrics) {
    const pool = defaultMetrics.filter((m) => m.area >= baseParams.min_area && m.solidity > 0.7);
    const coords = pickMarkerSubset(pool, imgW, imgH);
    if (coords) return { coords, params: null };
  }
  return null;
}
