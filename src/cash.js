// 現金管理の計算ロジック（純ロジック・DOM非依存）。
// ノートの現金販売による現金の動きを管理する:
//   期待月末金額 = 月初金額 + Σ(現金販売数 × 単価)
// 本部報告用の「日別金種表」は毎日実測していない前提で、
// 月初の金種構成と日々の現金売上から矛盾のない表を補間生成する。
import { toInt, daysInMonth } from "./validate.js";
import { noteProducts } from "./ledger.js";

// 金種（入力・表示用）。二千円札は入力可能だが自動補間の支払いには使わない。
export const DENOMS = [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1];
export const DENOM_NAMES = {
  10000: "一万円札", 5000: "五千円札", 2000: "二千円札", 1000: "千円札",
  500: "500円玉", 100: "100円玉", 50: "50円玉", 10: "10円玉", 5: "5円玉", 1: "1円玉",
};
const PAY_DENOMS = [10000, 5000, 1000, 500, 100, 50, 10, 5, 1];

// 金種別枚数 {denom: count} → 合計金額（円）
export function cashTotal(counts) {
  if (!counts) return 0;
  return DENOMS.reduce((sum, d) => sum + d * toInt(counts[d]), 0);
}

// 日別の現金売上（円）。specials の method==='cash' の明細 × 単価。
// prices: { productKey: 円 }。返り値: Map(day -> 円)
export function dailyCashSales(month, products, prices) {
  const notes = noteProducts(products);
  const byDay = new Map();
  for (const s of month.specials || []) {
    if (s.method !== "cash") continue;
    let yen = 0;
    for (const p of notes) yen += toInt(s.qty[p.key]) * toInt(prices[p.key]);
    const day = toInt(s.day);
    if (yen > 0) byDay.set(day, (byDay.get(day) || 0) + yen);
  }
  return byDay;
}

// 単価未設定（0円）のまま現金販売記録がある商品キーの一覧（チェック用）
export function unpricedCashKeys(month, products, prices) {
  const notes = noteProducts(products);
  const keys = new Set();
  for (const s of month.specials || []) {
    if (s.method !== "cash") continue;
    for (const p of notes) {
      if (toInt(s.qty[p.key]) > 0 && toInt(prices[p.key]) <= 0) keys.add(p.key);
    }
  }
  return [...keys];
}

// 金額を金種に貪欲分解して counts に加算した新しいオブジェクトを返す
function addGreedy(counts, amount) {
  const out = { ...counts };
  let rest = amount;
  for (const d of PAY_DENOMS) {
    const n = Math.floor(rest / d);
    if (n > 0) { out[d] = toInt(out[d]) + n; rest -= n * d; }
  }
  return out;
}

function normalize(counts) {
  const out = {};
  for (const d of DENOMS) out[d] = toInt(counts && counts[d]);
  return out;
}

// 本部報告用の日別金種表を補間生成する。
// opening/closing: {denom: count}、salesByDay: Map(day -> 円)。
// 考え方:
//   1. 月初から前進シミュレーション（売上日はその金額を金種分解して加算＝ちょうどの支払いを仮定）
//   2. シミュレーション最終値と実際の月末構成の差（両替相当）を「最後の売上日」以降に反映
//      → 各日の金額増分は必ずその日の売上と一致し、月末は入力どおりの構成で終わる
// 月初+売上と月末金額が一致しない場合も表は生成する（最終日で差額ごと調整）が、
// consistent=false を返すので呼び出し側で警告を出すこと。
// 返り値: { rows: [{ day(0=月初), counts, total, sales }], consistent, expectedClosing }
export function buildDailyDenomTable(ym, opening, closing, salesByDay) {
  const maxDays = daysInMonth(ym);
  const open = normalize(opening);
  const close = normalize(closing);

  // 前進シミュレーション
  const sim = [open];
  let cur = open;
  let lastSalesDay = 0;
  for (let d = 1; d <= maxDays; d++) {
    const s = salesByDay.get(d) || 0;
    if (s > 0) { cur = addGreedy(cur, s); lastSalesDay = d; }
    sim.push(cur);
  }

  // 月末実測との構成差。金額が一致していれば差の合計金額は0（＝両替扱い）。
  const diff = {};
  for (const d of DENOMS) diff[d] = close[d] - toInt(sim[maxDays][d]);
  const adjustDay = lastSalesDay || maxDays;

  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const expectedClosing = cashTotal(open) + totalSales;
  const consistent = expectedClosing === cashTotal(close);

  const rows = [];
  for (let d = 0; d <= maxDays; d++) {
    let counts = sim[d];
    if (d >= adjustDay) {
      counts = { ...counts };
      for (const dn of DENOMS) counts[dn] = toInt(counts[dn]) + diff[dn];
    }
    rows.push({
      day: d,
      counts: normalize(counts),
      total: cashTotal(counts),
      sales: d === 0 ? 0 : (salesByDay.get(d) || 0),
    });
  }
  return { rows, consistent, expectedClosing };
}

// 日別金種表 → CSV（本部報告の転記用）
export function buildCashReportCsv(table) {
  const header = ["日付", ...DENOMS.map((d) => DENOM_NAMES[d]), "合計金額", "現金売上"];
  const rows = [header];
  for (const r of table.rows) {
    rows.push([
      r.day === 0 ? "月初" : `${r.day}日`,
      ...DENOMS.map((d) => r.counts[d]),
      r.total,
      r.sales,
    ]);
  }
  return rows.map((r) => r.join(",")).join("\r\n");
}
