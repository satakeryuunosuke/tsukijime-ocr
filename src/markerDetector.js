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
  solidity_thr: 0.8,
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

// 指定パラメータで「マーカー候補」を検出する（パラメータ調整UI用）。
// 返り値: { centers: [[x,y]...], hulls: [[[x,y]...]...] }（個数チェック・長方形判定は行わない）
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
          centers.push([Math.trunc(M.m10 / M.m00), Math.trunc(M.m01 / M.m00)]);
          const pts = [];
          for (let k = 0; k < hull.rows; k++) pts.push([hull.data32S[k * 2], hull.data32S[k * 2 + 1]]);
          hulls.push(pts);
        }
      }
    }
    approx.delete(); hull.delete(); cnt.delete();
  }
  contours.delete();
  return { centers, hulls };
}

// 自動検出：候補がちょうど4つ かつ 長方形配置のとき [左上,右上,右下,左下] を返す。失敗時 null。
export function detectMarkers(srcMat, params = MARKER_PARAMS) {
  const { centers } = detectMarkerCandidates(srcMat, params);
  if (centers.length !== 4) return null;
  const ordered = orderPoints(centers);
  if (!isRectangle(ordered)) return null;
  return ordered;
}
