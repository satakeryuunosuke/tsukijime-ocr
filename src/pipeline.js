// 1ページ分の認識パイプライン（Phase 1+2 の統合）。
// NEO_tool_2.main の1画像分に相当する中核。検算・訂正・リネームは対象外（OCRエクスポートに限定）。
import { detectMarkers, autoDetectMarkers } from "./markerDetector.js";
import { transformImage } from "./geometry.js";
import { extractRois, deleteRois } from "./extractor.js";
import { predictNumbers } from "./predictor.js";
import { snapRoisToBoxes } from "./boxSnap.js";
import { correctPredictionsWithChecksum } from "./checksumCorrector.js";

// srcMat: RGBA Mat（呼び出し側が delete する）
// ctx: { roiRows, model, cfg, products, checksumDigits }
// 返り値: { ok, reason?, coords?, predictions?, lowConfidence:[names], autoTuned?, snappedRows?, corrections?, autoCorrected? }
export async function recognizePage(srcMat, ctx) {
  let coords = detectMarkers(srcMat);
  let autoTuned = false;
  if (!coords) {
    // 既定パラメータで失敗 → パラメータ自動探索（手動スライダー調整の自動化）
    const auto = autoDetectMarkers(srcMat);
    if (auto) { coords = auto.coords; autoTuned = true; }
  }
  if (!coords) return { ok: false, reason: "marker" };

  const tMat = transformImage(srcMat, coords);
  const snapEnabled = ctx?.cfg?.enableBoxSnap !== false;
  const snappedRows = snapRoisToBoxes(tMat, ctx.roiRows, { enabled: snapEnabled });
  const rois = extractRois(tMat, snappedRows);
  const predictions = await predictNumbers(rois, ctx.model, ctx.cfg);
  deleteRois(rois);
  tMat.delete();

  // 検算に基づく自動補正（商品マスタが存在する場合に実施）
  let corrections = [];
  let autoCorrected = false;
  if (ctx?.products && Array.isArray(ctx.products) && ctx.products.length > 0) {
    const corrResult = correctPredictionsWithChecksum(
      predictions,
      ctx.products,
      ctx.checksumDigits ?? 2,
      ctx.cfg ?? {}
    );
    corrections = corrResult.corrections;
    autoCorrected = corrResult.corrected;
  }

  let lowConfidence = Object.keys(predictions)
    .filter((k) => k.endsWith("_low_confidence_flag") && predictions[k] === true)
    .map((k) => k.replace("_low_confidence_flag", ""));

  if (Number(ctx?.checksumDigits ?? 2) === 2) {
    lowConfidence = lowConfidence.filter((k) => k !== "total_0");
  }

  return { ok: true, coords, predictions, lowConfidence, autoTuned, snappedRows, corrections, autoCorrected };
}
