// 検算（合計点数）を用いた数字認識の自動補正モジュール。
// 検算不一致が発生した場合、低信頼度項目や Top-K 候補を探索し、
// 検算が合致する一意の組み合わせを発見した際に自動補正する。

import { validatePage, toInt } from "./validate.js";

/**
 * predictions の検算チェックを行い、不一致なら1桁の補正を試みる
 *
 * @param {Object} predictions predictNumbers の出力
 * @param {Array} products 商品マスタ配列 [{ key, name, points }, ...]
 * @param {number} checksumDigits 検算桁数 (2 または 3)
 * @param {Object} cfg OCR設定（tens_place_valid_classes 等）
 * @returns {Object} { predictions, corrected: boolean, corrections: Array }
 */
export function correctPredictionsWithChecksum(predictions, products, checksumDigits = 2, cfg = {}) {
  const digits = Number(checksumDigits) === 2 ? 2 : 3;
  const initialValid = validatePage(predictions, products, 31, digits);

  // すでに検算が一致している場合は何もしない
  if (initialValid.checksumOk) {
    return { predictions, corrected: false, corrections: [] };
  }

  const tensValid = cfg.tens_place_valid_classes || [1, 2];

  // 補正対象となりうるフィールドのリストを作成
  // 各商品の一の位・十の位、および合計欄
  const targetFields = [];

  for (const p of products) {
    targetFields.push({ name: `${p.key}_0`, isTens: false, points: p.points, type: "qty" });
    targetFields.push({ name: `${p.key}_1`, isTens: true, points: p.points, type: "qty" });
  }

  if (digits === 3) {
    targetFields.push({ name: "total_0", isTens: false, points: 0, type: "total" });
  }
  targetFields.push({ name: "total_1", isTens: false, points: 0, type: "total" });
  targetFields.push({ name: "total_2", isTens: false, points: 0, type: "total" });

  // 優先順位付け：低信頼度フラグがあるものを最優先、次に信頼度が低い順
  targetFields.sort((a, b) => {
    const aLow = predictions[`${a.name}_low_confidence_flag`] ? 1 : 0;
    const bLow = predictions[`${b.name}_low_confidence_flag`] ? 1 : 0;
    if (aLow !== bLow) return bLow - aLow; // 低信頼度フラグ優先

    const aConf = predictions[`${a.name}_confidence`] ?? 1.0;
    const bConf = predictions[`${b.name}_confidence`] ?? 1.0;
    return aConf - bConf; // 信頼度が低い順
  });

  const matchingSolutions = [];

  // 1桁置換探索
  for (const field of targetFields) {
    const currentVal = predictions[field.name] ?? "";
    const candidates = predictions[`${field.name}_candidates`] || [];

    // 試行する代替候補のリスト
    const trialValues = [];

    // 1. Top-K候補（Top-3）から現在値と異なるものを抽出
    for (const cand of candidates) {
      if (cand.digit !== currentVal) {
        if (field.isTens) {
          if (tensValid.includes(parseInt(cand.digit, 10))) {
            trialValues.push({ val: cand.digit, prob: cand.prob });
          }
        } else {
          trialValues.push({ val: cand.digit, prob: cand.prob });
        }
      }
    }

    // 2. 十の位特有のケース：空文字 "" ⇔ 有効数字 の切替
    if (field.isTens) {
      if (currentVal !== "" && !trialValues.some((t) => t.val === "")) {
        // 十の位の誤検出（インク滲み・ノイズで 1 と読まれたが実際は空欄）
        trialValues.push({ val: "", prob: 0.2 });
      } else if (currentVal === "") {
        // 空欄と判定されたが実は 1 だったケース
        for (const tv of tensValid) {
          const strVal = String(tv);
          if (!trialValues.some((t) => t.val === strVal)) {
            trialValues.push({ val: strVal, prob: 0.2 });
          }
        }
      }
    }

    // 代替値を適用して検算をテスト
    for (const trial of trialValues) {
      const testPredictions = { ...predictions, [field.name]: trial.val };
      const testValid = validatePage(testPredictions, products, 31, digits);

      if (testValid.checksumOk) {
        matchingSolutions.push({
          fieldName: field.name,
          from: currentVal,
          to: trial.val,
          prob: trial.prob,
          origConf: predictions[`${field.name}_confidence`] ?? 0,
          isLowConf: !!predictions[`${field.name}_low_confidence_flag`],
        });
      }
    }
  }

  // 解の選定：
  // 1. 解がちょうど1つ（唯一の解）なら安全に補正適用
  // 2. 複数ある場合、低信頼度フラグが付いているフィールドの解が1つだけならそれを採用
  let chosenSolution = null;

  if (matchingSolutions.length === 1) {
    chosenSolution = matchingSolutions[0];
  } else if (matchingSolutions.length > 1) {
    // 低信頼度フラグ付きフィールドの解に絞り込み
    const lowConfSolutions = matchingSolutions.filter((s) => s.isLowConf);
    if (lowConfSolutions.length === 1) {
      chosenSolution = lowConfSolutions[0];
    } else {
      // 候補確率が最も高いものをチェック。2位と十分な差（> 0.3）があれば採用
      matchingSolutions.sort((a, b) => b.prob - a.prob);
      if (matchingSolutions[0].prob - matchingSolutions[1].prob > 0.3) {
        chosenSolution = matchingSolutions[0];
      }
    }
  }

  if (chosenSolution) {
    const { fieldName, from, to, prob, origConf } = chosenSolution;
    predictions[`${fieldName}_original`] = from;
    predictions[`${fieldName}_corrected`] = true;
    predictions[`${fieldName}_correction_reason`] =
      `検算による自動補正（元: "${from}", 信頼度: ${(origConf * 100).toFixed(0)}% → 新: "${to}", 候補確率: ${(prob * 100).toFixed(0)}%）`;
    predictions[fieldName] = to;
    predictions[`${fieldName}_confidence`] = prob;
    predictions[`${fieldName}_low_confidence_flag`] = false;

    return {
      predictions,
      corrected: true,
      corrections: [
        {
          field: fieldName,
          from,
          to,
          reason: predictions[`${fieldName}_correction_reason`],
        },
      ],
    };
  }

  return { predictions, corrected: false, corrections: [] };
}
