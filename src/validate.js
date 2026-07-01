// 検算（合計点数）と日付妥当性チェック。NEO_tool_2.main の判定ロジックを移植。
//   計算合計 = Σ(単価 × 個数)、個数 = key_1*10 + key_0
//   検算OK   = floor(計算合計 / 10) === (total_2*10 + total_1)   ← 合計欄は点数の1/10を記入
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

// ym: 'YYYYMM' 文字列。その月の日数を返す（不正なら31）。
export function daysInMonth(ym) {
  const y = parseInt(String(ym).slice(0, 4), 10);
  const m = parseInt(String(ym).slice(4, 6), 10);
  if (!y || !m || m < 1 || m > 12) return 31;
  return new Date(y, m, 0).getDate();
}

export function validatePage(predictions, products, maxDays) {
  const computed = computeTotalScore(predictions, products);
  const computedTens = Math.floor(computed / 10);
  const totalBox = toInt(predictions.total_2) * 10 + toInt(predictions.total_1);
  const checksumOk = computedTens === totalBox;
  const dateValue = toInt(predictions.date_1) * 10 + toInt(predictions.date_0);
  const dateOk = dateValue >= 1 && dateValue <= maxDays;
  return { computed, computedTens, totalBox, checksumOk, dateValue, dateOk };
}

// 個数から合計欄(total_1/total_2)を自動算出してセット（手動入力・訂正補助）。
export function fillTotalFromQty(predictions, products) {
  const tens = Math.floor(computeTotalScore(predictions, products) / 10);
  predictions.total_1 = tens % 10;
  predictions.total_2 = Math.floor(tens / 10) % 10;
  return predictions;
}
