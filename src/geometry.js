// geometry_B.transform_image の移植。
// マーカー4点([左上,右上,右下,左下])で台形補正し、固定サイズ(既定 1000x707, A5横)へ変換する。
export const OUTPUT_WIDTH = 1000;
export const OUTPUT_HEIGHT = 707;

export function transformImage(srcMat, coords, W = OUTPUT_WIDTH, H = OUTPUT_HEIGHT) {
  const cv = window.cv;
  const pts1 = cv.matFromArray(4, 1, cv.CV_32FC2, [
    coords[0][0], coords[0][1],
    coords[1][0], coords[1][1],
    coords[2][0], coords[2][1],
    coords[3][0], coords[3][1],
  ]);
  const pts2 = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
  const M = cv.getPerspectiveTransform(pts1, pts2);
  const dst = new cv.Mat();
  cv.warpPerspective(srcMat, dst, M, new cv.Size(W, H)); // 既定 INTER_LINEAR
  pts1.delete();
  pts2.delete();
  M.delete();
  return dst; // RGBA W x H
}
