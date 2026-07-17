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

// 本部への売上持ち出し。withdrawals: [{ id, day, counts:{denom:枚数} }]
// 合計金額（円）
export function withdrawalsTotal(withdrawals) {
  return (withdrawals || []).reduce((sum, w) => sum + cashTotal(w.counts), 0);
}

// 日別の持ち出し金種 Map(day -> {denom: 枚数})
function withdrawalsByDay(withdrawals) {
  const byDay = new Map();
  for (const w of withdrawals || []) {
    const day = toInt(w.day);
    const acc = byDay.get(day) || {};
    for (const d of DENOMS) acc[d] = toInt(acc[d]) + toInt(w.counts && w.counts[d]);
    byDay.set(day, acc);
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

function normalize(counts) {
  const out = {};
  for (const d of DENOMS) out[d] = toInt(counts && counts[d]);
  return out;
}

// 金額を金種に貪欲分解（在庫制限なし）。1円玉があるので必ず割り切れる。
function greedyNew(amount) {
  const out = {};
  let rest = amount;
  for (const d of PAY_DENOMS) {
    const n = Math.floor(rest / d);
    if (n > 0) { out[d] = n; rest -= n * d; }
  }
  return out;
}

// avail の範囲で amount をちょうど分解できれば返す。できなければ null。
function exactFit(amount, avail) {
  const out = {};
  let rest = amount;
  for (const d of DENOMS) {
    const n = Math.min(toInt(avail[d]), Math.floor(rest / d));
    if (n > 0) { out[d] = n; rest -= n * d; }
  }
  return rest === 0 ? out : null;
}

// 支払い（受け取る金種）を決める。「月末までに増えるべき金種」= availPay から充当する。
//   1. ちょうどの支払いができればそれを採用
//   2. できなければ「金額以上の最小の1枚」（例: 440円に千円札）→ お釣りを渡す想定
//   3. それも無ければ大きい順に足していく
// availPay で金額に届かなければ null。
function pickPayment(amount, availPay) {
  const exact = exactFit(amount, availPay);
  if (exact) return exact;
  const single = [...DENOMS].reverse().find((d) => d >= amount && toInt(availPay[d]) > 0);
  if (single) return { [single]: 1 };
  const out = {};
  let total = 0;
  for (const d of DENOMS) {
    let n = toInt(availPay[d]);
    while (n > 0 && total < amount) { out[d] = toInt(out[d]) + 1; total += d; n--; }
    if (total >= amount) return out;
  }
  return null;
}

// お釣り（渡す金種）を決める。「月末までに減るべき金種」を優先し、
// 足りない分は手元（cur）から出す。手元でお釣りが作れなければ null。
function pickChange(amount, R, cur) {
  const out = {};
  let rest = amount;
  // 第1候補: 減るべき金種（R < 0）。ただし手元にある枚数まで。
  for (const d of DENOMS) {
    const avail = Math.min(Math.max(-toInt(R[d]), 0), toInt(cur[d]));
    const n = Math.min(avail, Math.floor(rest / d));
    if (n > 0) { out[d] = n; rest -= n * d; }
  }
  // 第2候補: 手元の残り
  for (const d of DENOMS) {
    if (rest <= 0) break;
    const avail = toInt(cur[d]) - toInt(out[d]);
    const n = Math.min(avail, Math.floor(rest / d));
    if (n > 0) { out[d] = toInt(out[d]) + n; rest -= n * d; }
  }
  return rest === 0 ? out : null;
}

// 本部報告用の日別金種表を補間生成する。
// opening/closing: {denom: count}、salesByDay: Map(day -> 円)、withdrawals: 本部持ち出し明細。
// 金種の増減は「客の支払い」「お釣り」「本部への持ち出し」で説明できる形で割り当てる（両替は行わない）:
//   - 月末までに増えるべき金種は売上日の支払いとして受け取ったことに、
//     減るべき金種はお釣りとして渡したことにする。
//   - 持ち出しは記録された日にその金種構成のまま減らす。
//   - 最後の売上日には残りの増減をすべて割り当てる（金額が一致していれば
//     その日の売上額とちょうど一致することが保証される）。
//   - 売上も持ち出しもない日は一切変動しない。
// 月初+売上−持ち出しと月末金額が一致しない場合（consistent=false）や、説明のつかない
// 増減がある場合（residualAdjusted=true）も表は生成するが、月の最終日で帳尻を
// 合わせるため、呼び出し側で警告を出すこと。
// 返り値: { rows: [{ day(0=月初), counts, total, sales, withdrawal }], consistent, residualAdjusted, expectedClosing }
export function buildDailyDenomTable(ym, opening, closing, salesByDay, withdrawals = []) {
  const maxDays = daysInMonth(ym);
  const open = normalize(opening);
  const close = normalize(closing);
  const wByDay = withdrawalsByDay(withdrawals);

  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const expectedClosing = cashTotal(open) + totalSales - withdrawalsTotal(withdrawals);
  const consistent = expectedClosing === cashTotal(close);

  // R: 月末までに増減すべき枚数（月末 − 現在）。日々の割り当てで消し込んでいく。
  const R = {};
  for (const d of DENOMS) R[d] = close[d] - open[d];
  const salesDays = [...salesByDay.keys()].filter((d) => salesByDay.get(d) > 0).sort((a, b) => a - b);
  const lastSalesDay = consistent ? salesDays[salesDays.length - 1] : undefined;

  // day より後の日の持ち出し枚数（金種別）。最後の売上日の割り当てで
  // 「月末構成＋以降の持ち出し分」に着地させるために使う。
  const futureWithdrawals = (day) => {
    const fut = {};
    for (const d of DENOMS) fut[d] = 0;
    for (const [wd, counts] of wByDay) {
      if (wd > day) for (const d of DENOMS) fut[d] += toInt(counts[d]);
    }
    return fut;
  };

  const cur = { ...open };
  const rows = [{ day: 0, counts: { ...cur }, total: cashTotal(cur), sales: 0, withdrawal: 0 }];
  let residualAdjusted = false;

  const applyDelta = (delta, sign) => {
    for (const [d, n] of Object.entries(delta)) {
      cur[d] = toInt(cur[d]) + sign * n;
      R[d] = toInt(R[d]) - sign * n;
    }
  };

  for (let day = 1; day <= maxDays; day++) {
    const S = salesByDay.get(day) || 0;
    if (S > 0) {
      if (day === lastSalesDay) {
        // 最後の売上日: 残りの増減をすべてこの日の支払い/お釣りとして割り当てる。
        // この日以降にまだ持ち出しがある場合はその分を上乗せして着地させる
        // （同日の持ち出しはこの後で引かれるため fut に含める）。
        const fut = futureWithdrawals(day - 1);
        for (const d of DENOMS) {
          cur[d] = toInt(close[d]) + fut[d];
          R[d] = -fut[d];
        }
      } else {
        const availPay = {};
        for (const d of DENOMS) availPay[d] = Math.max(toInt(R[d]), 0);
        let pay = pickPayment(S, availPay);
        let change = null;
        if (pay) {
          const c = cashTotal(pay) - S;
          change = c === 0 ? {} : pickChange(c, R, cur);
        }
        if (!pay || !change) {
          // 割り当て不能（お釣りが作れない等）→ ちょうどの支払いを新規金種で受領。
          // ズレた分は以降の日（最終的には最後の売上日）が自動的に吸収する。
          pay = greedyNew(S);
          change = {};
        }
        applyDelta(pay, +1);
        applyDelta(change, -1);
      }
    }
    // この日の持ち出しを反映（記録された金種構成のまま減らす）
    const w = wByDay.get(day);
    let wYen = 0;
    if (w) {
      wYen = cashTotal(w);
      applyDelta(w, -1);
    }
    if (day === maxDays) {
      // 消し込めなかった増減（金額不一致・売上が無いのに構成が変わった等）は
      // 最終日で帳尻を合わせ、表は必ず入力された月末構成で終わらせる。
      // 通常の consistent なケースでは最後の売上日で R=0 になっているため何もしない。
      for (const d of DENOMS) {
        if (R[d] !== 0) { residualAdjusted = true; cur[d] = toInt(cur[d]) + toInt(R[d]); R[d] = 0; }
      }
    }
    rows.push({ day, counts: { ...cur }, total: cashTotal(cur), sales: S, withdrawal: wYen });
  }
  return { rows, consistent, residualAdjusted, expectedClosing };
}

// 日別金種表 → CSV（本部報告の転記用）
export function buildCashReportCsv(table) {
  const header = ["日付", ...DENOMS.map((d) => DENOM_NAMES[d]), "合計金額", "現金売上", "本部持ち出し"];
  const rows = [header];
  for (const r of table.rows) {
    rows.push([
      r.day === 0 ? "月初" : `${r.day}日`,
      ...DENOMS.map((d) => r.counts[d]),
      r.total,
      r.sales,
      r.withdrawal || "",
    ]);
  }
  return rows.map((r) => r.join(",")).join("\r\n");
}
