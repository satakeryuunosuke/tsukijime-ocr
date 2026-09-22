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

  // 1.1 ハイブリッド二値化（大津の二値化 + 適応的二値化のOR結合で薄い筆跡を救出）
  const thOtsu = new cv.Mat();
  cv.threshold(gray, thOtsu, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const thAdapt = new cv.Mat();
  const blockSize = Math.min(21, Math.max(9, (Math.floor(Math.min(gray.rows, gray.cols) / 4) * 2) + 1));
  cv.adaptiveThreshold(gray, thAdapt, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, 4);

  const th = new cv.Mat();
  cv.bitwise_or(thOtsu, thAdapt, th);
  thOtsu.delete();
  thAdapt.delete();
  gray.delete();

  // 1.2 端部の枠線残骸除去（ROI外周付近にのみ侵入した長直線を除去）
  removeBorderArtifacts(th, cv);

  // モルフォロジー演算で微小ノイズ除去 & 線分結合
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

  // 全輪郭点の外接矩形 = 各輪郭の boundingRect の和集合
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

  // 学習モデルの学習データセットと一致する正方パディング (+20)
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
  cv.resize(padded, resized, new cv.Size(28, 28)); // 既定 INTER_LINEAR
  padded.delete();

  const seg = new Uint8Array(resized.data); // 784 値(0-255) をコピー
  resized.delete();

  return { seg, dark };
}

// 端部に入り込んだ枠線の直線残骸を消去する
function removeBorderArtifacts(thMat, cv) {
  const rows = thMat.rows;
  const cols = thMat.cols;

  // 上下端 15% に接する水平直線を除去
  const hLineLen = Math.max(8, Math.floor(cols * 0.45));
  if (hLineLen > 0) {
    const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hLineLen, 1));
    const hLines = new cv.Mat();
    cv.morphologyEx(thMat, hLines, cv.MORPH_OPEN, hKernel);
    hKernel.delete();

    // 上下端15%のみをマスクにして減算
    const topLimit = Math.floor(rows * 0.15);
    const bottomLimit = Math.floor(rows * 0.85);
    const hData = hLines.data;
    const thData = thMat.data;
    for (let r = 0; r < rows; r++) {
      if (r < topLimit || r > bottomLimit) {
        const offset = r * cols;
        for (let c = 0; c < cols; c++) {
          if (hData[offset + c] > 0) {
            thData[offset + c] = 0;
          }
        }
      }
    }
    hLines.delete();
  }

  // 左右端 15% に接する垂直直線を除去
  const vLineLen = Math.max(8, Math.floor(rows * 0.45));
  if (vLineLen > 0) {
    const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vLineLen));
    const vLines = new cv.Mat();
    cv.morphologyEx(thMat, vLines, cv.MORPH_OPEN, vKernel);
    vKernel.delete();

    // 左右端15%のみをマスクにして減算
    const leftLimit = Math.floor(cols * 0.15);
    const rightLimit = Math.floor(cols * 0.85);
    const vData = vLines.data;
    const thData = thMat.data;
    for (let r = 0; r < rows; r++) {
      const offset = r * cols;
      for (let c = 0; c < cols; c++) {
        if (c < leftLimit || c > rightLimit) {
          if (vData[offset + c] > 0) {
            thData[offset + c] = 0;
          }
        }
      }
    }
    vLines.delete();
  }
}
