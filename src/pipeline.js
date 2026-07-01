// 1ページ分の認識パイプライン（Phase 1+2 の統合）。
// NEO_tool_2.main の1画像分に相当する中核。検算・訂正・リネームは対象外（OCRエクスポートに限定）。
import { detectMarkers } from "./markerDetector.js";
import { transformImage } from "./geometry.js";
import { extractRois, deleteRois } from "./extractor.js";
import { predictNumbers } from "./predictor.js";

// srcMat: RGBA Mat（呼び出し側が delete する）
// ctx: { roiRows, model, cfg }
// 返り値: { ok, reason?, coords?, predictions?, lowConfidence:[names] }
export async function recognizePage(srcMat, ctx) {
  const coords = detectMarkers(srcMat);
  if (!coords) return { ok: false, reason: "marker" };

  const tMat = transformImage(srcMat, coords);
  const rois = extractRois(tMat, ctx.roiRows);
  const predictions = await predictNumbers(rois, ctx.model, ctx.cfg);
  deleteRois(rois);
  tMat.delete();

  const lowConfidence = Object.keys(predictions)
    .filter((k) => k.endsWith("_low_confidence_flag") && predictions[k] === true)
    .map((k) => k.replace("_low_confidence_flag", ""));

  return { ok: true, coords, predictions, lowConfidence };
}
