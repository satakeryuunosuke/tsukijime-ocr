// 現金管理タブ。ノートの現金販売に伴う現金の突合チェックと、
// 本部報告用の日別金種表（自動補間）の表示・CSV出力を行う。
import { ensureMonth, putMonth, getMonth, getMaster, getSetting, putSetting } from "../db.js";
import { noteProducts } from "../ledger.js";
import { toInt } from "../validate.js";
import {
  DENOMS, DENOM_NAMES, cashTotal, dailyCashSales, unpricedCashKeys,
  buildDailyDenomTable, buildCashReportCsv,
} from "../cash.js";
import { downloadCsv } from "../csv.js";

let app = null;
const el = () => document.getElementById("view-cash");

const yen = (n) => n.toLocaleString("ja-JP") + "円";

function prevYm(ym) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) - 1;
  if (m < 1) { m = 12; y--; }
  return `${y}${String(m).padStart(2, "0")}`;
}

// 入力欄から金種別枚数を収集。全欄が空なら null（未入力扱い）。
function collectDenoms(attr) {
  const inputs = [...el().querySelectorAll(`input[${attr}]`)];
  if (inputs.every((i) => i.value.trim() === "")) return null;
  const data = {};
  for (const i of inputs) data[i.getAttribute(attr)] = toInt(i.value);
  return data;
}

async function savePrices(notes) {
  const prices = (await getSetting("notePrices")) || {};
  el().querySelectorAll("input[data-price]").forEach((inp) => {
    prices[inp.dataset.price] = toInt(inp.value);
  });
  await putSetting("notePrices", prices);
  await show();
}

async function saveCash() {
  const month = await ensureMonth(app.ym);
  month.cash = {
    opening: collectDenoms("data-open"),
    closing: collectDenoms("data-close"),
  };
  await putMonth(month);
  await show();
}

// 前月の月末金種を今月の月初欄へ流し込む
async function fillOpeningFromPrev() {
  const pym = prevYm(app.ym);
  const prev = await getMonth(pym);
  const closing = prev && prev.cash && prev.cash.closing;
  if (!closing) { alert(`前月（${pym}）の月末金種が入力されていません。`); return; }
  el().querySelectorAll("input[data-open]").forEach((inp) => {
    inp.value = toInt(closing[inp.getAttribute("data-open")]);
  });
}

function checkPanel(month, products, prices, salesByDay) {
  const cash = month.cash || {};
  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const unpriced = unpricedCashKeys(month, products, prices);
  const nameOf = (k) => (products.find((p) => p.key === k) || { name: k }).name;

  const warns = [];
  if (unpriced.length)
    warns.push(`単価が未設定のまま現金販売の記録があります: ${unpriced.map(nameOf).join("、")}。上の表で単価を入力してください（売上が0円で計算されています）。`);

  let verdict = `<p class="view-sub">月初と月末の金種を入力すると、現金売上とのつじつまチェックを行います。</p>`;
  if (cash.opening && cash.closing) {
    const openTotal = cashTotal(cash.opening);
    const closeTotal = cashTotal(cash.closing);
    const expected = openTotal + totalSales;
    const diff = closeTotal - expected;
    verdict = `
      <table class="entry-table">
        <tbody>
          <tr><td>月初の現金</td><td class="num">${yen(openTotal)}</td></tr>
          <tr><td>この月の現金売上（ノート購入タブの現金明細から自動計算）</td><td class="num">＋ ${yen(totalSales)}</td></tr>
          <tr><td><b>あるべき月末の現金</b></td><td class="num"><b>${yen(expected)}</b></td></tr>
          <tr><td>実際の月末の現金（入力値）</td><td class="num">${yen(closeTotal)}</td></tr>
        </tbody>
      </table>
      <p class="cash-verdict">${
        diff === 0
          ? `<span class="ok">✓ 一致しています。不審な点はありません。</span>`
          : `<span class="err">✗ ${yen(Math.abs(diff))} ${diff > 0 ? "多い（過剰）" : "足りない（不足）"}です。ノート購入の記録漏れ・単価・数え間違いを確認してください。</span>`
      }</p>`;
  }
  return `
    <div class="panel">
      <h3>つじつまチェック</h3>
      ${warns.map((w) => `<p class="err">⚠ ${w}</p>`).join("")}
      ${verdict}
    </div>`;
}

function salesDetail(salesByDay) {
  const days = [...salesByDay.keys()].sort((a, b) => a - b);
  if (!days.length) return `<p class="view-sub">この月の現金販売の記録はまだありません（<a href="#specials">ノート購入</a>で記録します）。</p>`;
  return `
    <table class="result-table narrow">
      <thead><tr><th>日付</th><th>現金売上</th></tr></thead>
      <tbody>${days.map((d) => `<tr><td>${d}日</td><td class="num">${yen(salesByDay.get(d))}</td></tr>`).join("")}</tbody>
    </table>`;
}

function denomTablePanel(month, salesByDay) {
  const cash = month.cash || {};
  if (!cash.opening || !cash.closing) {
    return `
      <div class="panel">
        <h3>本部報告用・日別金種表</h3>
        <p class="view-sub">月初と月末の金種を入力・保存すると、毎日の金種枚数の表を自動作成します。</p>
      </div>`;
  }
  const table = buildDailyDenomTable(app.ym, cash.opening, cash.closing, salesByDay);
  let warn = "";
  if (!table.consistent) {
    warn = `<p class="err">⚠ 月初＋売上と月末の金額が一致していないため、月の最終日に差額を含めて帳尻を合わせた表になっています。先に上のチェックの原因を解消してください。</p>`;
  } else if (table.residualAdjusted) {
    warn = `<p class="err">⚠ 現金売上が無い（または少ない）のに金種の構成が変わっているため、説明のつかない増減を月の最終日にまとめて反映しています。枚数の入力を確認してください。</p>`;
  }
  return `
    <div class="panel">
      <h3>本部報告用・日別金種表</h3>
      <p class="view-sub">月初の金種と日々の現金売上から、つじつまの合う毎日の金種枚数を自動で補間した表です。金種の増減は「お客さんがどの金種で支払い、どの金種でお釣りを渡したか」として売上のあった日に割り当てます（例: 千円札が増えていれば千円札で支払われ、お釣りを渡したことになります）。売上のない日は変動しません。そのまま報告書に転記できます。</p>
      ${warn}
      <div class="table-scroll">
        <table class="result-table narrow cash-daily">
          <thead><tr><th>日付</th>${DENOMS.map((d) => `<th>${DENOM_NAMES[d]}</th>`).join("")}<th>合計金額</th><th>現金売上</th></tr></thead>
          <tbody>
            ${table.rows.map((r) => `
              <tr class="${r.sales ? "cash-sale-day" : ""}">
                <td>${r.day === 0 ? "月初" : r.day + "日"}</td>
                ${DENOMS.map((d) => `<td class="num">${r.counts[d]}</td>`).join("")}
                <td class="num"><b>${r.total.toLocaleString("ja-JP")}</b></td>
                <td class="num">${r.sales ? r.sales.toLocaleString("ja-JP") : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="row-actions">
        <button id="cashCsv" class="btn btn-secondary">CSVダウンロード（cash_report_${app.ym}.csv）</button>
      </div>
    </div>`;
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const products = master.products;
  const notes = noteProducts(products);
  const prices = (await getSetting("notePrices")) || {};
  const salesByDay = dailyCashSales(month, products, prices);
  const cash = month.cash || {};
  const pym = prevYm(app.ym);

  el().innerHTML = `
    <h2 class="view-title">現金管理（${app.ym.slice(0, 4)}年${parseInt(app.ym.slice(4), 10)}月）</h2>
    <p class="view-sub">ノートの現金販売で受け取った現金を管理します。月末に金庫の現金を数えて入力すると、売上記録とのつじつまを自動チェックします。</p>

    <div class="panel">
      <h3>ノートの販売単価（円）</h3>
      <p class="view-sub">現金売上の計算に使います。値上げ等がなければ一度設定するだけでOKです（全部の月で共通）。</p>
      <table class="entry-table">
        <thead><tr><th>商品</th><th>単価（円）</th></tr></thead>
        <tbody>
          ${notes.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td><input type="number" inputmode="numeric" min="0" data-price="${p.key}"
                   value="${toInt(prices[p.key]) || ""}" placeholder="0" /></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="row-actions"><button id="cashSavePrices" class="btn">単価を保存</button></div>
    </div>

    <div class="panel">
      <h3>現金の枚数（金種別）</h3>
      <p class="view-sub">月初（前月から引き継いだ時点）と月末（締めのとき）に数えた枚数を入力してください。</p>
      <div class="row-actions">
        <button id="cashFillPrev" class="btn-sub">前月（${pym}）の月末金種を月初に引き継ぐ</button>
      </div>
      <table class="entry-table cash-denoms">
        <thead><tr><th>金種</th><th>月初（枚）</th><th>月末（枚）</th></tr></thead>
        <tbody>
          ${DENOMS.map((d) => `
            <tr>
              <td>${DENOM_NAMES[d]}</td>
              <td><input type="number" inputmode="numeric" min="0" data-open="${d}"
                   value="${cash.opening ? toInt(cash.opening[d]) : ""}" placeholder="0" /></td>
              <td><input type="number" inputmode="numeric" min="0" data-close="${d}"
                   value="${cash.closing ? toInt(cash.closing[d]) : ""}" placeholder="0" /></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="row-actions">
        <button id="cashSave" class="btn">枚数を保存</button>
        <span class="view-sub">月初計: <b>${yen(cashTotal(cash.opening))}</b> ／ 月末計: <b>${yen(cashTotal(cash.closing))}</b></span>
      </div>
    </div>

    ${checkPanel(month, products, prices, salesByDay)}

    <div class="panel">
      <h3>現金売上の明細（自動集計）</h3>
      ${salesDetail(salesByDay)}
    </div>

    ${denomTablePanel(month, salesByDay)}`;

  el().querySelector("#cashSavePrices").addEventListener("click", () => savePrices(notes));
  el().querySelector("#cashSave").addEventListener("click", saveCash);
  el().querySelector("#cashFillPrev").addEventListener("click", fillOpeningFromPrev);
  const csvBtn = el().querySelector("#cashCsv");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    const table = buildDailyDenomTable(app.ym, cash.opening, cash.closing, salesByDay);
    downloadCsv(buildCashReportCsv(table), `cash_report_${app.ym}.csv`);
  });
}
