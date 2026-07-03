// 月次台帳の計算（純ロジック・DOM非依存）。
// 旧Excelテンプレート（template.xlsx）の数式と同じ計算を行う:
//   ノート:   残_d = 残_{d-1} + 入荷_d − 現金販売_d − 口座販売_d − シール交換_d − ポイント交換_d
//   グッズ:   残_d = 残_{d-1} + 入荷_d − 交換_d
//   残_0 = 月初繰越在庫（carryover）
// 旧Python版と互換のCSV5種（recognition_results / summary / carryover_inventory /
// arrival / other_manual_entries）の生成もここで行う。
import { qtyOf, toInt, daysInMonth } from "./validate.js";
import { buildCsv } from "./csv.js";

export const SPECIAL_METHODS = [
  { id: "cash", name: "現金" },
  { id: "debit", name: "口座振替" },
  { id: "point", name: "ポイント" },
];

// ノート扱いの商品（特別交換の対象）。現行マスタでは notes_ プレフィックスの4色。
export function noteProducts(products) {
  return products.filter((p) => p.key.startsWith("notes_"));
}

// 読み取り済みページ → 日別交換数 Map(day -> {productKey: qty})
export function aggregateDaily(pages, products) {
  const sums = new Map();
  for (const { predictions } of pages) {
    const day = toInt(predictions.date_1) * 10 + toInt(predictions.date_0);
    if (!sums.has(day)) {
      const qty = {};
      for (const p of products) qty[p.key] = 0;
      sums.set(day, qty);
    }
    const qty = sums.get(day);
    for (const p of products) qty[p.key] += qtyOf(predictions, p.key);
  }
  return sums;
}

// 特別交換明細 → 日別 Map(day -> {method: {productKey: qty}})
export function aggregateSpecials(specials) {
  const byDay = new Map();
  for (const s of specials || []) {
    const day = toInt(s.day);
    if (!byDay.has(day)) byDay.set(day, { cash: {}, debit: {}, point: {} });
    const bucket = byDay.get(day)[s.method];
    if (!bucket) continue;
    for (const [key, q] of Object.entries(s.qty || {})) {
      bucket[key] = (bucket[key] || 0) + toInt(q);
    }
  }
  return byDay;
}

// 月次台帳。month: 月レコード、products: その月のマスタの商品リスト。
// 返り値: {
//   maxDays,
//   rows: { productKey: [{day, arrival, exchange, cash, debit, point, balance}, ...] },
//   closing: { productKey: 月末帳簿残 },
//   totalExchanged: { productKey: 月間交換数（シール交換のみ）},
// }
export function computeLedger(month, products) {
  const maxDays = daysInMonth(month.ym);
  const daily = aggregateDaily(month.pages || [], products);
  const specialsByDay = aggregateSpecials(month.specials);
  const carryover = month.carryover || {};
  const arrivals = month.arrivals || {};

  const rows = {};
  const closing = {};
  const totalExchanged = {};

  for (const p of products) {
    const list = [];
    let balance = toInt(carryover[p.key]);
    let exchangedSum = 0;
    for (let day = 1; day <= maxDays; day++) {
      const arrival = toInt((arrivals[day] || {})[p.key]);
      const exchange = toInt((daily.get(day) || {})[p.key]);
      const sp = specialsByDay.get(day);
      const cash = toInt(sp && sp.cash[p.key]);
      const debit = toInt(sp && sp.debit[p.key]);
      const point = toInt(sp && sp.point[p.key]);
      balance += arrival - exchange - cash - debit - point;
      exchangedSum += exchange;
      list.push({ day, arrival, exchange, cash, debit, point, balance });
    }
    rows[p.key] = list;
    closing[p.key] = balance;
    totalExchanged[p.key] = exchangedSum;
  }
  return { maxDays, rows, closing, totalExchanged };
}

// ---- 棚卸差異の調整 ----
// 実棚数と帳簿残に差異があるとき、帳簿を実棚に合わせるための調整記録を作る。
//   不足（帳簿残 > 実棚）: 通常の交換票と同じ形式のページ（predictions）を生成して追加する。
//     検算が成立するように合計欄も自動計算する。出力（CSV/Excel）上は通常の交換と区別されない。
//   余剰（実棚 > 帳簿残）: 指定日の入庫記録に加算する。
// 制約: 1ページの商品個数は各99まで・合計点数は990点まで（記入欄が2桁のため）。超える分は複数ページに分割。

const PAGE_MAX_TOTAL = 990; // 合計欄は10点単位2桁 → 990点まで
const PAGE_MAX_QTY = 99;    // 個数欄は2桁

// 差異の計算。返り値: { shortages: {key: 個数}, surpluses: {key: 個数} }
export function computeDiffs(month, products) {
  const ledger = computeLedger(month, products);
  const phys = month.physicalCount || {};
  const shortages = {}, surpluses = {};
  for (const p of products) {
    const d = ledger.closing[p.key] - toInt(phys[p.key]); // 帳簿 − 実棚
    if (d > 0) shortages[p.key] = d;
    else if (d < 0) surpluses[p.key] = -d;
  }
  return { shortages, surpluses };
}

// 不足分を交換ページ（predictions形式）に変換。ページ分割は greedy。
export function buildAdjustmentPages(shortages, products, day, existingNames = new Set()) {
  const byKey = new Map(products.map((p) => [p.key, p]));
  const queue = Object.entries(shortages)
    .filter(([k, q]) => q > 0 && byKey.has(k))
    .map(([k, q]) => ({ key: k, points: byKey.get(k).points, remaining: q }));

  const pages = [];
  let current = null, total = 0;

  const newPage = () => {
    const predictions = {
      date_1: String(Math.floor(day / 10)),
      date_0: String(day % 10),
    };
    current = predictions;
    total = 0;
    pages.push(predictions);
  };
  const closePage = () => {
    if (!current) return;
    const tens = Math.floor(total / 10);
    current.total_1 = String(tens % 10);
    current.total_2 = String(Math.floor(tens / 10) % 10);
  };

  for (const item of queue) {
    while (item.remaining > 0) {
      if (!current) newPage();
      const room = Math.floor((PAGE_MAX_TOTAL - total) / item.points);
      const chunk = Math.min(item.remaining, PAGE_MAX_QTY, room);
      if (chunk <= 0) { closePage(); current = null; continue; }
      const tens = Math.floor(chunk / 10);
      current[`${item.key}_1`] = tens ? String(tens) : "";
      current[`${item.key}_0`] = String(chunk % 10);
      total += chunk * item.points;
      item.remaining -= chunk;
      // 同一商品の残りは次ページへ（1ページ99個上限のため）
      if (item.remaining > 0) { closePage(); current = null; }
    }
  }
  closePage();

  // ページ名は既存と被らない連番で
  let n = 1;
  const named = pages.map((predictions) => {
    let name;
    do { name = `在庫調整 ${day}日 #${n++}`; } while (existingNames.has(name));
    existingNames.add(name);
    return { name, predictions, savedAt: new Date().toISOString(), adjustment: true };
  });
  return named;
}

function joinCsv(rows) {
  return rows.map((r) => r.join(",")).join("\r\n");
}

// summary_YYYYMM.csv: date, <product_key...>（旧 summarize_results_B.py の出力互換）
export function buildSummaryCsv(month, products) {
  const maxDays = daysInMonth(month.ym);
  const daily = aggregateDaily(month.pages || [], products);
  const rows = [["date", ...products.map((p) => p.key)]];
  for (let d = 1; d <= maxDays; d++) {
    const qty = daily.get(d) || {};
    rows.push([d, ...products.map((p) => toInt(qty[p.key]))]);
  }
  return joinCsv(rows);
}

// carryover_inventory_YYYYMM.csv: product_name, quantity（旧 GUI_tool_1 互換）
export function buildCarryoverCsv(month, products) {
  const co = month.carryover || {};
  const rows = [["product_name", "quantity"]];
  for (const p of products) rows.push([p.key, toInt(co[p.key])]);
  return joinCsv(rows);
}

// arrival_YYYYMM.csv: date, <product_key...>（旧 GUI_tool_4 互換）
export function buildArrivalCsv(month, products) {
  const maxDays = daysInMonth(month.ym);
  const arrivals = month.arrivals || {};
  const rows = [["date", ...products.map((p) => p.key)]];
  for (let d = 1; d <= maxDays; d++) {
    const a = arrivals[d] || {};
    rows.push([d, ...products.map((p) => toInt(a[p.key]))]);
  }
  return joinCsv(rows);
}

// other_manual_entries_YYYYMM.csv: day, cash_<key>..., debit_<key>..., point_<key>...
// （旧 GUI_tool_3 互換。対象はノート商品のみ）
export function buildSpecialsCsv(month, products) {
  const maxDays = daysInMonth(month.ym);
  const notes = noteProducts(products);
  const byDay = aggregateSpecials(month.specials);
  const header = ["day"];
  for (const m of SPECIAL_METHODS) for (const p of notes) header.push(`${m.id}_${p.key}`);
  const rows = [header];
  for (let d = 1; d <= maxDays; d++) {
    const sp = byDay.get(d);
    const cells = [d];
    for (const m of SPECIAL_METHODS) for (const p of notes) cells.push(toInt(sp && sp[m.id][p.key]));
    rows.push(cells);
  }
  return joinCsv(rows);
}

// 月次CSV一式（5種）。返り値: [{ filename, text }]
export function buildMonthlyCsvs(month, products) {
  const ym = month.ym;
  return [
    { filename: `recognition_results_${ym}.csv`, text: buildCsv(month.pages || [], products) },
    { filename: `summary_${ym}.csv`, text: buildSummaryCsv(month, products) },
    { filename: `carryover_inventory_${ym}.csv`, text: buildCarryoverCsv(month, products) },
    { filename: `arrival_${ym}.csv`, text: buildArrivalCsv(month, products) },
    { filename: `other_manual_entries_${ym}.csv`, text: buildSpecialsCsv(month, products) },
  ];
}
