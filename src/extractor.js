// extractor_A.extract_rois の移植。
// 台形補正済み画像(Mat)から ROI 座標ごとに部分Mat(ビュー)を切り出す。
// 返り値の mat は srcMat とメモリを共有するビューなので、srcMat は処理完了まで保持すること。
export function extractRois(srcMat, roiRows) {
  const cv = window.cv;
  return roiRows.map(({ name, x, y, w, h }) => ({
    name,
    mat: srcMat.roi(new cv.Rect(x, y, w, h)),
  }));
}

export function deleteRois(rois) {
  for (const r of rois) if (r.mat) r.mat.delete();
}
