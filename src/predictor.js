// predictor_C.predict_numbers_from_extracted_data の移植。
// バッチ推論 + 十の位フィルタ + 信頼度フラグまで Python と同一。
import { segmentDigit } from "./segmenter.js";

// rois: [{ name, mat }]  mat は ROI の RGBA Mat（extractor が生成）
// model: tf.LayersModel
// 返り値: predictions オブジェクト（Python の predictions dict と同じキー体系）
export async function predictNumbers(rois, model, cfg) {
  const tf = window.tf;
  const predictions = {};

  // ステップ1: 前処理・情報収集
  const batchSeg = [];
  const meta = []; // { name, isTens, dark }
  for (const { name, mat } of rois) {
    const isTens =
      !(name.startsWith("total") || name.startsWith("date")) && name.endsWith("1");

    let res = null;
    if (mat && mat.rows > 0 && mat.cols > 0) {
      res = segmentDigit(mat, cfg);
    }
    if (res) {
      // 十の位の厳格フィルタ：暗ピクセルが閾値未満なら推論スキップ
      if (isTens && res.dark < cfg.tens_place_min_ink) {
        predictions[name] = "";
        continue;
      }
      batchSeg.push(res.seg);
      meta.push({ name, isTens, dark: res.dark });
    } else {
      predictions[name] = "";
    }
  }

  // ステップ2: バッチ推論
  if (batchSeg.length > 0) {
    const n = batchSeg.length;
    const buf = new Float32Array(n * 784);
    for (let i = 0; i < n; i++) {
      const s = batchSeg[i];
      for (let j = 0; j < 784; j++) buf[i * 784 + j] = s[j] / 255.0;
    }
    const x = tf.tensor(buf, [n, 28, 28, 1]);
    const y = model.predict(x);
    const data = await y.data(); // n*10
    x.dispose();
    y.dispose();

    // ステップ3: 後処理・文脈フィルタ・Top-K候補抽出
    for (let i = 0; i < n; i++) {
      const classProbs = [];
      for (let c = 0; c < 10; c++) {
        classProbs.push({ digit: String(c), prob: data[i * 10 + c] });
      }
      classProbs.sort((a, b) => b.prob - a.prob);

      const top1 = classProbs[0];
      const arg = parseInt(top1.digit, 10);
      const mx = top1.prob;
      const { name, isTens } = meta[i];

      const recog =
        isTens && !cfg.tens_place_valid_classes.includes(arg) ? "" : String(arg);
      predictions[name] = recog;

      // Top-3 候補を保存（自動補正・手動修正サジェスト用）
      predictions[`${name}_candidates`] = classProbs.slice(0, 3);

      if (recog !== "") {
        predictions[`${name}_confidence`] = mx;
        predictions[`${name}_low_confidence_flag`] = mx < cfg.confidence_threshold;
      }
    }
  }

  return predictions;
}
