// 発注のめやす（棚卸時のリコメンド）。
// 基準: 「平均的な2か月分の在庫」を下回っていたら、2か月分に戻すだけの数を発注する。
//   月平均払出 = 直近 HISTORY_MONTHS か月（当月含む・動きのあった月のみ）の
//                総払出数（シール交換＋現金＋口座＋ポイント）の平均
//   目標在庫   = 月平均払出 × STOCK_MONTHS（端数切り上げ）
//   発注数     = 目標在庫 − 現在庫（実棚数。未入力なら帳簿残）
// 各月の払出はその月のマスタ（商品構成）で計算し、商品は key で月をまたいで対応付ける。
import { computeLedger } from "./ledger.js";
import { getAllMonths, getMaster } from "./db.js";
import { toInt } from "./validate.js";

export const STOCK_MONTHS = 2;   // 何か月分の在庫を確保するか
export const HISTORY_MONTHS = 3; // 平均をとる直近月数（当月含む）

// 1か月の総払出数を商品keyごとに集計（シール交換＋現金＋口座＋ポイント）。
export function monthlyConsumption(month, products) {
  const ledger = computeLedger(month, products);
  const out = {};
  for (const p of products) {
    out[p.key] = ledger.rows[p.key].reduce(
      (a, r) => a + r.exchange + r.cash + r.debit + r.point, 0);
  }
  return out;
}

// 対象年月以前の直近 HISTORY_MONTHS か月から商品keyごとの月平均払出数を計算する。
// 払出が1件もない月（作っただけの空レコード等）は平均に入れない。
// 返り値: { avg: {key: 月平均}, monthsUsed: ["YYYYMM", ...]（新しい順） }
export async function collectAverageConsumption(ym) {
  const months = (await getAllMonths()).filter((m) => String(m.ym) <= String(ym));
  months.sort((a, b) => (a.ym > b.ym ? -1 : 1)); // 新しい順
  const masters = new Map();
  const sum = {}, count = {};
  const monthsUsed = [];
  for (const m of months) {
    if (monthsUsed.length >= HISTORY_MONTHS) break;
    if (!masters.has(m.masterVersion)) masters.set(m.masterVersion, await getMaster(m.masterVersion));
    const master = masters.get(m.masterVersion);
    if (!master) continue;
    const cons = monthlyConsumption(m, master.products);
    if (!Object.values(cons).some((v) => v > 0)) continue;
    monthsUsed.push(m.ym);
    for (const [key, v] of Object.entries(cons)) {
      sum[key] = (sum[key] || 0) + v;
      count[key] = (count[key] || 0) + 1;
    }
  }
  const avg = {};
  for (const key of Object.keys(sum)) avg[key] = sum[key] / count[key];
  return { avg, monthsUsed };
}

// 発注提案（純ロジック）。stock: {key: 現在庫}, avg: {key: 月平均払出}。
// 返り値: products と同順の [{key, name, avg, target, stock, order, noHistory}]
//   order > 0 の商品が「発注すべき品物と数」。
export function buildReorderSuggestions(products, stock, avg) {
  return products.map((p) => {
    const s = toInt(stock[p.key]);
    if (!(p.key in avg)) {
      return { key: p.key, name: p.name, avg: null, target: null, stock: s, order: 0, noHistory: true };
    }
    const a = avg[p.key];
    const target = Math.ceil(a * STOCK_MONTHS);
    return {
      key: p.key, name: p.name, avg: a, target, stock: s,
      order: Math.max(0, target - s), noHistory: false,
    };
  });
}
