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

// スキャナー取り込み前提の幾何制約
export const SCANNER_CONSTRAINTS = {
  max_skew_deg: 7.0,          // 各辺の水平・垂直からの最大許容傾き（度）
  min_coverage_w: 0.60,       // 画像幅に対するマーカー間幅の最小比率（用紙の端近くに配置）
  min_coverage_h: 0.55,       // 画像高さに対するマーカー間高さの最小比率
  min_aspect_ratio: 1.15,     // A5横帳票（~1.414）のアスペクト比下限
  max_aspect_ratio: 1.75,     // アスペクト比上限
  corner_margin_x: 0.30,      // TL/BL は 0..margin_x, TR/BR は 1-margin_x..1
  corner_margin_y: 0.35,      // TL/TR は 0..margin_y, BL/BR は 1-margin_y..1
  corner_tol_angle: 8.0,      // 4内角の 90度からの許容差（度）
  min_symmetry: 0.88,         // 対辺の長さ比率 (min / max)
};

// スキャナー前提の四隅マーカー幾何妥当性を総合チェックする
// ordered: [左上, 右上, 右下, 左下]
// 返り値: { ok: boolean, reason?: string, message?: string, metrics?: object }
export function validateScannerMarkers(ordered, imgW = 0, imgH = 0, constraints = SCANNER_CONSTRAINTS) {
  if (!ordered || ordered.length !== 4) {
    return { ok: false, reason: "count", message: "マーカーが4点ありません。" };
  }
  const uniq = new Set(ordered.map((p) => p[0] + "," + p[1]));
  if (uniq.size !== 4) {
    return { ok: false, reason: "duplicate", message: "重複した点が含まれています。" };
  }

  // 1. 各内角（90 ± tol 度）
  const angle = (p1, p2, p3) => {
    const v1 = [p1[0] - p2[0], p1[1] - p2[1]];
    const v2 = [p3[0] - p2[0], p3[1] - p2[1]];
    const n1 = Math.hypot(v1[0], v1[1]);
    const n2 = Math.hypot(v2[0], v2[1]);
    if (n1 === 0 || n2 === 0) return 0;
    let dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
    dot = Math.max(-1, Math.min(1, dot));
    return (Math.acos(dot) * 180) / Math.PI;
  };
  const angles = [
    angle(ordered[3], ordered[0], ordered[1]),
    angle(ordered[0], ordered[1], ordered[2]),
    angle(ordered[1], ordered[2], ordered[3]),
    angle(ordered[2], ordered[3], ordered[0]),
  ];
  const tolAngle = constraints.corner_tol_angle ?? 8.0;
  if (!angles.every((a) => Math.abs(a - 90.0) <= tolAngle)) {
    return { ok: false, reason: "angle", message: `内角が直角から外れています（最大ズレ: ${Math.max(...angles.map((a) => Math.abs(a - 90))).toFixed(1)}°）。` };
  }

  // 2. 対辺の長さと対称性
  const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const top = len(ordered[0], ordered[1]);
  const bottom = len(ordered[3], ordered[2]);
  const left = len(ordered[0], ordered[3]);
  const right = len(ordered[1], ordered[2]);

  const symTB = Math.min(top, bottom) / Math.max(top, bottom || 1);
  const symLR = Math.min(left, right) / Math.max(left, right || 1);
  const minSym = constraints.min_symmetry ?? 0.88;
  if (symTB < minSym || symLR < minSym) {
    return { ok: false, reason: "symmetry", message: "対辺の長さが不揃いです（歪み過大）。" };
  }

  // 3. スキュー角（水平・垂直からの傾き）
  // スキャナー取り込みのため、原稿はほぼ水平・垂直
  const skewTop = Math.abs(Math.atan2(ordered[1][1] - ordered[0][1], ordered[1][0] - ordered[0][0]) * 180 / Math.PI);
  const skewBottom = Math.abs(Math.atan2(ordered[2][1] - ordered[3][1], ordered[2][0] - ordered[3][0]) * 180 / Math.PI);
  const skewLeft = Math.abs(Math.atan2(ordered[3][0] - ordered[0][0], ordered[3][1] - ordered[0][1]) * 180 / Math.PI);
  const skewRight = Math.abs(Math.atan2(ordered[2][0] - ordered[1][0], ordered[2][1] - ordered[1][1]) * 180 / Math.PI);
  const maxSkew = Math.max(skewTop, skewBottom, skewLeft, skewRight);
  const limitSkew = constraints.max_skew_deg ?? 7.0;
  if (maxSkew > limitSkew) {
    return { ok: false, reason: "skew", message: `原稿の傾きが許容値を超えています（${maxSkew.toFixed(1)}° > ${limitSkew}°）。` };
  }

  // 4. アスペクト比（A5横: 約1.414）
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  const aspectRatio = h > 0 ? w / h : 0;
  const minAspect = constraints.min_aspect_ratio ?? 1.15;
  const maxAspect = constraints.max_aspect_ratio ?? 1.75;
  if (aspectRatio < minAspect || aspectRatio > maxAspect) {
    return { ok: false, reason: "aspect_ratio", message: `アスペクト比がA5横帳票の基準外です（${aspectRatio.toFixed(2)}）。` };
  }

  // 5. 画像サイズ基準のチェック（占有率・四隅配置ゾーン）
  let coverageW = 0, coverageH = 0;
  if (imgW > 0 && imgH > 0) {
    coverageW = w / imgW;
    coverageH = h / imgH;
    const minCovW = constraints.min_coverage_w ?? 0.60;
    const minCovH = constraints.min_coverage_h ?? 0.55;
    if (coverageW < minCovW || coverageH < minCovH) {
      return { ok: false, reason: "coverage", message: `マーカー領域が画像全体に対して小さすぎます（幅${Math.round(coverageW * 100)}%, 高${Math.round(coverageH * 100)}%）。` };
    }

    // 四隅象限配置チェック: 表内のセルなど中央寄りの候補を確実に排除
    const mx = constraints.corner_margin_x ?? 0.30;
    const my = constraints.corner_margin_y ?? 0.35;
    const [tl, tr, br, bl] = ordered;
    if (tl[0] > imgW * mx || tl[1] > imgH * my) {
      return { ok: false, reason: "quadrant", message: "左上マーカーが左上四隅エリアから外れています。" };
    }
    if (tr[0] < imgW * (1 - mx) || tr[1] > imgH * my) {
      return { ok: false, reason: "quadrant", message: "右上マーカーが右上四隅エリアから外れています。" };
    }
    if (br[0] < imgW * (1 - mx) || br[1] < imgH * (1 - my)) {
      return { ok: false, reason: "quadrant", message: "右下マーカーが右下四隅エリアから外れています。" };
    }
    if (bl[0] > imgW * mx || bl[1] < imgH * (1 - my)) {
      return { ok: false, reason: "quadrant", message: "左下マーカーが左下四隅エリアから外れています。" };
    }
  }

  return {
    ok: true,
    reason: null,
    message: "スキャナー幾何チェック合格",
    metrics: { top, bottom, left, right, w, h, aspectRatio, maxSkew, coverageW, coverageH, angles, symTB, symLR },
  };
}

// 自動検出：候補がちょうど4つ かつ スキャナー幾何条件を満たすとき [左上,右上,右下,左下] を返す。失敗時 null。
export function detectMarkers(srcMat, params = MARKER_PARAMS) {
  const { centers } = detectMarkerCandidates(srcMat, params);
  if (centers.length !== 4) return null;
  const ordered = orderPoints(centers);
  const validation = validateScannerMarkers(ordered, srcMat.cols, srcMat.rows);
  if (!validation.ok) return null;
  return ordered;
}

// ---- 自動パラメータ探索（既定値で失敗したときのフォールバック）----
// 典型例: 既定値では文字などを含む5個以上が検出される → 充填率(solidity)や最小面積を
// 引き上げると本物のマーカー4個に絞り込める。ユーザーが手動でやっていた操作を自動化する。

const SOLIDITY_STEPS = [0.96, 0.94, 0.92, 0.9, 0.88, 0.86, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6];
const MIN_AREA_STEPS = [1500, 1000, 700, 500, 300, 150];

// マーカー4点として妥当な長方形か（validateScannerMarkers のラッパー）。
export function isMarkerRectangle(ordered, imgW = 0, imgH = 0, tol = 8.0) {
  const custom = { ...SCANNER_CONSTRAINTS, corner_tol_angle: tol };
  const res = validateScannerMarkers(ordered, imgW, imgH, custom);
  return res.ok;
}

// 候補（metrics）から4点の組合せを総当たりし、スキャナー条件を満たす組を返す。
// 複数見つかった場合は「面積の大きい長方形・傾きが小さい・マーカー同士の大きさが揃っている」ものを優先。
function pickMarkerSubset(cands, imgW, imgH) {
  if (cands.length < 4 || cands.length > 16) return null; // 多すぎるとノイズ画像なので諦める
  let best = null;
  const n = cands.length;
  for (let a = 0; a < n - 3; a++)
    for (let b = a + 1; b < n - 2; b++)
      for (let c = b + 1; c < n - 1; c++)
        for (let d = c + 1; d < n; d++) {
          const four = [cands[a], cands[b], cands[c], cands[d]];
          const areas = four.map((m) => m.area);
          if (Math.max(...areas) > Math.min(...areas) * 2.2) continue; // マーカーはほぼ同じ大きさ
          const ordered = orderPoints(four.map((m) => m.center));
          const val = validateScannerMarkers(ordered, imgW, imgH);
          if (!val.ok) continue;
          // スコア: 面積（カバレッジ）重視、傾きペナルティ
          const areaScore = (val.metrics.w * val.metrics.h);
          const skewPenalty = 1.0 - (val.metrics.maxSkew / 10.0);
          const score = areaScore * Math.max(0.1, skewPenalty);
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
