// 台形補正後画像(1000x707)上で記入枠（罫線）を検出し、
// 枠の黒線を含めずに内側の記入領域へROI座標をスナップさせる。

/**
 * 台形補正済み画像から記入枠の候補矩形を検出する。
 * モルフォロジー演算で水平・垂直罫線を強調抽出するため、
 * 記入された数字等のストロークに影響されず純粋な枠線のみを検出できる。
 */
export function detectBoxes(tMat) {
  const cv = window.cv;
  if (!cv || !tMat) return [];

  const gray = new cv.Mat();
  cv.cvtColor(tMat, gray, cv.COLOR_RGBA2GRAY);

  // 適応二値化で白黒反転（罫線・文字が白/255、背景が黒/0）
  const bin = new cv.Mat();
  cv.adaptiveThreshold(
    gray,
    bin,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    15,
    4
  );
  gray.delete();

  // 水平線・垂直線の強調（モルフォロジーOPEN）
  // 記入枠の線は短くても約20〜30px以上あるため、細かい手書き文字を消去できる
  const kernelH = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(14, 1));
  const kernelV = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, 14));

  const hLines = new cv.Mat();
  const vLines = new cv.Mat();
  cv.morphologyEx(bin, hLines, cv.MORPH_OPEN, kernelH);
  cv.morphologyEx(bin, vLines, cv.MORPH_OPEN, kernelV);
  bin.delete();
  kernelH.delete();
  kernelV.delete();

  const tableGrid = new cv.Mat();
  cv.add(hLines, vLines, tableGrid);
  hLines.delete();
  vLines.delete();

  // 枠線の輪郭検出
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(tableGrid, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  tableGrid.delete();
  hier.delete();

  const boxes = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const r = cv.boundingRect(cnt);
    cnt.delete();

    // 記入枠らしいサイズ（現行票: 幅35〜65, 高さ50〜75程度。余裕を持たせてフィルタ）
    if (r.width >= 18 && r.width <= 130 && r.height >= 25 && r.height <= 110) {
      const aspect = r.width / r.height;
      if (aspect >= 0.25 && aspect <= 1.8) {
        boxes.push({
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          cx: r.x + r.width / 2,
          cy: r.y + r.height / 2,
        });
      }
    }
  }
  contours.delete();

  return boxes;
}

/**
 * 事前定義されたROI座標（roiRows）を、画像上の実枠に合わせてスナップする。
 * 
 * 重要:
 * 枠の黒線（罫線）が切り出し画像に含まれると数字認識に悪影響を及ぼすため、
 * スナップ後のROIは枠線の内側（罫線を除外した安全なインセット領域）に配置される。
 * 
 * @param {cv.Mat} tMat 台形補正済みRGBA画像(1000x707)
 * @param {Array<{name:string, x:number, y:number, w:number, h:number}>} roiRows 基準ROI座標
 * @param {Object} options オプション設定 { maxShift?: number, inset?: number, enabled?: boolean }
 * @returns {Array<{name:string, x:number, y:number, w:number, h:number, snapped?: boolean}>}
 */
export function snapRoisToBoxes(tMat, roiRows, options = {}) {
  if (!roiRows || !roiRows.length) return roiRows;
  if (options.enabled === false) return roiRows.map((r) => ({ ...r, snapped: false }));

  const maxShift = options.maxShift ?? 15; // 許容する最大中心移動距離（px）
  const inset = options.inset ?? 3;        // 枠線（黒線）を除外するための最小余白（px）
  const imgW = tMat.cols || 1000;
  const imgH = tMat.rows || 707;

  let boxes = [];
  try {
    boxes = detectBoxes(tMat);
  } catch (err) {
    console.warn("枠検出でエラーが発生したため、固定ROI座標をそのまま使用します:", err);
    return roiRows.map((r) => ({ ...r, snapped: false }));
  }

  if (boxes.length === 0) {
    return roiRows.map((r) => ({ ...r, snapped: false }));
  }

  return roiRows.map((roi) => {
    const roiCx = roi.x + roi.w / 2;
    const roiCy = roi.y + roi.h / 2;

    // 近傍にある枠候補を探索（中心間距離が近く、サイズ差が大きすぎないもの）
    let bestBox = null;
    let bestDist = Infinity;

    for (const b of boxes) {
      const dist = Math.hypot(b.cx - roiCx, b.cy - roiCy);
      if (dist > maxShift) continue;

      // 幅・高さがROIから極端に離れているものは除外
      if (Math.abs(b.w - roi.w) > 24 || Math.abs(b.h - roi.h) > 24) continue;

      if (dist < bestDist) {
        bestDist = dist;
        bestBox = b;
      }
    }

    // 妥当な枠が見つからない場合は元の座標をそのまま使用（安全なフォールバック）
    if (!bestBox) {
      return { ...roi, snapped: false };
    }

    // 枠の中心に合わせてROIを配置
    let newX = Math.round(bestBox.cx - roi.w / 2);
    let newY = Math.round(bestBox.cy - roi.h / 2);
    let newW = roi.w;
    let newH = roi.h;

    // 【黒線除外処理】枠線の内側から inset ピクセル以上離れた領域に厳格に収める
    if (newX < bestBox.x + inset) {
      newX = bestBox.x + inset;
    }
    if (newY < bestBox.y + inset) {
      newY = bestBox.y + inset;
    }
    if (newX + newW > bestBox.x + bestBox.w - inset) {
      newW = Math.max(10, bestBox.x + bestBox.w - inset - newX);
    }
    if (newY + newH > bestBox.y + bestBox.h - inset) {
      newH = Math.max(10, bestBox.y + bestBox.h - inset - newY);
    }

    // 画像範囲内へのクランプ
    newX = Math.max(0, Math.min(imgW - newW, newX));
    newY = Math.max(0, Math.min(imgH - newH, newY));

    return {
      name: roi.name,
      x: newX,
      y: newY,
      w: newW,
      h: newH,
      snapped: true,
      shiftX: newX - roi.x,
      shiftY: newY - roi.y,
    };
  });
}
