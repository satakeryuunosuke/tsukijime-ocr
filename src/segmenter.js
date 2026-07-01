// predictor_C.segment_digits_internal の移植。
// ROI画像(RGBA Mat)を受け取り、28x28 の数字画像(Uint8Array 784)と暗ピクセル数を返す。
// 数字なし/ノイズと判定した場合は null。
//
// Python との対応:
//   - BGR2GRAY → RGBA2GRAY（グレースケール値は同一）
//   - dark_pixels = gray < 150 の画素数
//   - 大津の二値化(THRESH_BINARY_INV) → OPEN → CLOSE
//   - 全輪郭点の外接矩形 → アスペクト比フィルタ → 正方パディング → 28x28 リサイズ
export function segmentDigit(roiMat, cfg) {
  const cv = window.cv;
  const gray = new cv.Mat();
  cv.cvtColor(roiMat, gray, cv.COLOR_RGBA2GRAY);

  // 暗ピクセル(< 150)を数える
  let dark = 0;
  const g = gray.data;
  for (let i = 0; i < g.length; i++) if (g[i] < 150) dark++;
  if (dark < cfg.ink_threshold) {
    gray.delete();
    return null;
  }

  const th = new cv.Mat();
  cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  gray.delete();

  const ko = cv.Mat.ones(cfg.kernel_open_size[0], cfg.kernel_open_size[1], cv.CV_8U);
  const kc = cv.Mat.ones(cfg.kernel_close_size[0], cfg.kernel_close_size[1], cv.CV_8U);
  cv.morphologyEx(th, th, cv.MORPH_OPEN, ko);
  cv.morphologyEx(th, th, cv.MORPH_CLOSE, kc);
  ko.delete();
  kc.delete();

  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(th, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  hier.delete();

  if (contours.size() === 0) {
    th.delete();
    contours.delete();
    return null;
  }

  // 全輪郭点の外接矩形 = 各輪郭の boundingRect の和集合（Python の boundingRect(concat) と等価）
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const r = cv.boundingRect(c);
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
    c.delete();
  }
  contours.delete();

  const x = minX, y = minY, w = maxX - minX, h = maxY - minY;
  if (w === 0 || h === 0) {
    th.delete();
    return null;
  }

  // アスペクト比フィルタ
  const aspect = w / h;
  if (aspect >= cfg.aspect_ratio_max) {
    th.delete();
    return null;
  }

  // 正方パディング（中央配置）→ 28x28 リサイズ
  const pad = Math.max(h, w) + 20;
  const padded = cv.Mat.zeros(pad, pad, cv.CV_8U);
  const sx = Math.floor((pad - w) / 2);
  const sy = Math.floor((pad - h) / 2);
  const crop = th.roi(new cv.Rect(x, y, w, h));
  const dstRoi = padded.roi(new cv.Rect(sx, sy, w, h));
  crop.copyTo(dstRoi);
  crop.delete();
  dstRoi.delete();
  th.delete();

  const resized = new cv.Mat();
  cv.resize(padded, resized, new cv.Size(28, 28)); // 既定 INTER_LINEAR（Python と一致）
  padded.delete();

  const seg = new Uint8Array(resized.data); // 784 値(0-255) をコピー
  resized.delete();

  return { seg, dark };
}
