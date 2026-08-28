// 検算（合計点数）と日付妥当性チェック。
//   計算合計 = Σ(単価 × 個数)、個数 = key_1*10 + key_0
//   検算OK   = 計算合計 === (total_2*100 + total_1*10 + total_0)
//   日付OK   = 1 <= (date_1*10 + date_0) <= その月の日数

export function toInt(v) {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

export function qtyOf(predictions, key) {
  return toInt(predictions[`${key}_1`]) * 10 + toInt(predictions[`${key}_0`]);
}

export function computeTotalScore(predictions, products) {
  let total = 0;
  for (const p of products) total += p.points * qtyOf(predictions, p.key);
  return total;
}

import { daysInMonth } from "./dateUtils.js";
export { daysInMonth };

export function validatePage(predictions, products, maxDays, checksumDigits = 2) {
  const computed = computeTotalScore(predictions, products);
  const totalBox = toInt(predictions.total_2) * 100 + toInt(predictions.total_1) * 10 + toInt(predictions.total_0);
  const computedTens = Math.floor(computed / 10);
  const boxTens = toInt(predictions.total_2) * 10 + toInt(predictions.total_1);
  const digits = Number(checksumDigits) === 2 ? 2 : 3;
  const checksumOk = digits === 2 ? (computedTens === boxTens) : (computed === totalBox);
  const dateValue = toInt(predictions.date_1) * 10 + toInt(predictions.date_0);
  const dateOk = dateValue >= 1 && dateValue <= maxDays;
  return { computed, computedTens, totalBox, boxTens, checksumOk, checksumDigits: digits, dateValue, dateOk };
}

// 個数から合計欄(total_0/total_1/total_2)を自動算出してセット（手動入力・訂正補助）。
export function fillTotalFromQty(predictions, products) {
  const total = computeTotalScore(predictions, products);
  predictions.total_0 = total % 10;
  predictions.total_1 = Math.floor(total / 10) % 10;
  predictions.total_2 = Math.floor(total / 100) % 10;
  return predictions;
}
