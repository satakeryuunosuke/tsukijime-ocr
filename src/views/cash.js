// 現金管理タブ。ノートの現金販売に伴う現金の突合チェックと、
// 本部報告用の日別金種表（自動補間）の表示・CSV出力、本部への売上持ち出しの記録を行う。
// ノート単価の設定は普段変更しないためポップアップに退避している。
import { ensureMonth, putMonth, getMonth, getMaster, getSetting, putSetting } from "../db.js";
import { noteProducts } from "../ledger.js";
import { toInt, daysInMonth } from "../validate.js";
import {
  DENOMS, DENOM_NAMES, cashTotal, dailyCashSales, unpricedCashKeys,
  withdrawalsTotal, buildDailyDenomTable, buildCashReportCsv,
  DEFAULT_NOTE_PRICE,
} from "../cash.js";
import { downloadCsv } from "../csv.js";
import { bindGridNav } from "../keynav.js";
import { toast } from "../toast.js";
import { formatYm, prevYm } from "../dateUtils.js";
import { helpBtn } from "../help.js";

let app = null;
const el = () => document.getElementById("view-cash");

const yen = (n) => n.toLocaleString("ja-JP") + "円";

// 汎用の小さなポップアップ（訂正モーダルのスタイルを流用）
function openModal(title, bodyHtml, width = 560) {
  const shell = document.createElement("div");
  shell.className = "rv-overlay";
  shell.innerHTML = `
    <div class="rv-modal" style="width:min(${width}px,100%)">
      <div class="rv-head"><span class="rv-title"></span><button class="rv-close" title="閉じる">✕</button></div>
      <div class="rv-body"></div>
    </div>`;
  shell.querySelector(".rv-title").textContent = title;
  shell.querySelector(".rv-body").innerHTML = bodyHtml;
  document.body.appendChild(shell);
  const close = () => shell.remove();
  shell.querySelector(".rv-close").onclick = close;
  shell.addEventListener("click", (e) => { if (e.target === shell) close(); });
  return { body: shell.querySelector(".rv-body"), close };
}

// month.cash が無い/古い形式でも withdrawals を持つ形に揃える
function cashOf(month) {
  const cash = month.cash || {};
  return {
    opening: cash.opening || null,
    closing: cash.closing || null,
    withdrawals: cash.withdrawals || [],
  };
}

// 入力欄から金種別枚数を収集。全欄が空なら null（未入力扱い）。
function collectDenoms(root, attr) {
  const inputs = [...root.querySelectorAll(`input[${attr}]`)];
  if (inputs.every((i) => i.value.trim() === "")) return null;
  const data = {};
  for (const i of inputs) data[i.getAttribute(attr)] = toInt(i.value);
  return data;
}

async function saveCash() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため保存できません。"); return; }
  const cash = cashOf(month);
  month.cash = {
    opening: collectDenoms(el(), "data-open"),
    closing: collectDenoms(el(), "data-close"),
    withdrawals: cash.withdrawals, // 持ち出しの記録は保持する
  };
  await putMonth(month);
  toast("現金の枚数を保存しました ✓");
  await show();
}

// 前月の月末金種を今月の月初欄へ流し込む
async function fillOpeningFromPrev() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため変更できません。"); return; }
  const pym = prevYm(app.ym);
  const prev = await getMonth(pym);
  const closing = prev && prev.cash && prev.cash.closing;
  if (!closing) { alert(`前月（${formatYm(pym)}）の月末金種が入力されていません。`); return; }
  el().querySelectorAll("input[data-open]").forEach((inp) => {
    inp.value = toInt(closing[inp.getAttribute("data-open")]);
  });
}

// ---- ノート単価の設定ポップアップ ----
async function openPricesModal(notes) {
  const prices = (await getSetting("notePrices")) || {};
  const { body, close } = openModal("ノートの販売単価（円）", `
    <p class="view-sub">現金売上の計算に使います。既定値は${DEFAULT_NOTE_PRICE}円です。変更がなければそのままでOKです（全部の月で共通）。</p>
    <table class="entry-table">
      <thead><tr><th>商品</th><th>単価（円）</th></tr></thead>
      <tbody>
        ${notes.map((p) => {
          const val = (prices && prices[p.key] !== undefined && prices[p.key] !== null && prices[p.key] !== "")
            ? toInt(prices[p.key])
            : DEFAULT_NOTE_PRICE;
          return `
          <tr>
            <td>${p.name}</td>
            <td><input type="number" inputmode="numeric" min="0" data-price="${p.key}"
                 value="${val}" placeholder="${DEFAULT_NOTE_PRICE}" /></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="rv-actions"><button class="btn" id="mdPriceSave">単価を保存</button></div>`);

  bindGridNav([...body.querySelectorAll("input[data-price]")], 1);
  body.querySelector("#mdPriceSave").addEventListener("click", async () => {
    const next = (await getSetting("notePrices")) || {};
    body.querySelectorAll("input[data-price]").forEach((inp) => {
      next[inp.dataset.price] = inp.value === "" ? DEFAULT_NOTE_PRICE : toInt(inp.value);
    });
    await putSetting("notePrices", next);
    close();
    await show();
  });
}

// ---- 本部への持ち出しポップアップ ----
async function openWithdrawalModal() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため持ち出しを記録できません。"); return; }
  const maxDays = daysInMonth(app.ym);
  const { body, close } = openModal("本部への売上持ち出しを記録", `
    <p class="view-sub">本部に持ち出した現金を金種別に入力してください。つじつまチェックと日別金種表に反映されます。</p>
    <div class="row-actions">
      <label>日付
        <select id="mdWdDay">
          ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
            `<option value="${d}">${d}日</option>`).join("")}
        </select>
      </label>
    </div>
    <table class="entry-table cash-denoms">
      <thead><tr><th>金種</th><th>枚数</th></tr></thead>
      <tbody>
        ${DENOMS.map((d) => `
          <tr><td>${DENOM_NAMES[d]}</td>
          <td><input type="number" inputmode="numeric" min="0" data-wd="${d}" placeholder="0" /></td></tr>`).join("")}
      </tbody>
    </table>
    <p class="view-sub">合計: <b id="mdWdTotal">0円</b></p>
    <div class="rv-actions"><button class="btn" id="mdWdSave">この内容で記録</button></div>`);

  const inputs = [...body.querySelectorAll("input[data-wd]")];
  bindGridNav(inputs, 1);
  const totalEl = body.querySelector("#mdWdTotal");
  const updateTotal = () => {
    totalEl.textContent = yen(cashTotal(collectDenoms(body, "data-wd") || {}));
  };
  inputs.forEach((i) => i.addEventListener("input", updateTotal));

  body.querySelector("#mdWdSave").addEventListener("click", async () => {
    const counts = collectDenoms(body, "data-wd");
    if (!counts || cashTotal(counts) <= 0) { alert("枚数を入力してください。"); return; }
    const day = toInt(body.querySelector("#mdWdDay").value) || 1;
    const currentMonth = await ensureMonth(app.ym);
    if (currentMonth.locked) { alert("月締め確定（ロック中）のため保存できません。"); return; }
    const cash = cashOf(currentMonth);
    cash.withdrawals.push({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      day, counts,
      createdAt: new Date().toISOString(),
    });
    currentMonth.cash = cash;
    await putMonth(currentMonth);
    close();
    await show();
  });
}

async function deleteWithdrawal(id) {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定（ロック中）のため削除できません。"); return; }
  const cash = cashOf(month);
  const item = cash.withdrawals.find((w) => w.id === id);
  if (!item) return;
  if (!window.confirm(`${item.day}日の持ち出し（${yen(cashTotal(item.counts))}）の記録を削除しますか？`)) return;
  cash.withdrawals = cash.withdrawals.filter((w) => w.id !== id);
  month.cash = cash;
  await putMonth(month);
  await show();
}

function checkPanel(month, products, prices, salesByDay, cash) {
  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const withdrawn = withdrawalsTotal(cash.withdrawals);
  const unpriced = unpricedCashKeys(month, products, prices);
  const nameOf = (k) => (products.find((p) => p.key === k) || { name: k }).name;

  const warns = [];
  if (unpriced.length)
    warns.push(`単価が未設定のまま現金販売の記録があります: ${unpriced.map(nameOf).join("、")}。「ノート単価の設定」から単価を入力してください（売上が0円で計算されています）。`);

  let verdict = `<p class="view-sub">月初と月末の金種を入力すると、現金売上とのつじつまチェックを行います。</p>`;
  if (cash.opening && cash.closing) {
    const openTotal = cashTotal(cash.opening);
    const closeTotal = cashTotal(cash.closing);
    const expected = openTotal + totalSales - withdrawn;
    const diff = closeTotal - expected;
    verdict = `
      <table class="entry-table">
        <tbody>
          <tr><td>月初の現金</td><td class="num">${yen(openTotal)}</td></tr>
          <tr><td>この月の現金売上（ノート購入タブの現金明細から自動計算）</td><td class="num">＋ ${yen(totalSales)}</td></tr>
          ${withdrawn ? `<tr><td>本部への持ち出し</td><td class="num">− ${yen(withdrawn)}</td></tr>` : ""}
          <tr><td><b>あるべき月末の現金</b></td><td class="num"><b>${yen(expected)}</b></td></tr>
          <tr><td>実際の月末の現金（入力値）</td><td class="num">${yen(closeTotal)}</td></tr>
        </tbody>
      </table>
      <p class="cash-verdict">${
        diff === 0
          ? `<span class="ok">✓ 一致しています。不審な点はありません。</span>`
          : `<span class="err">✗ ${yen(Math.abs(diff))} ${diff > 0 ? "多い（過剰）" : "足りない（不足）"}です。ノート購入・持ち出しの記録漏れ・単価・数え間違いを確認してください。</span>`
      }</p>`;
  }
  return `
    <div class="panel">
      <h3>
        つじつまチェック
        ${helpBtn("cash_reconciliation", { size: "sm", title: "つじつまチェックの計算式と判定について" })}
      </h3>
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

function withdrawalsPanel(cash, isLocked = false) {
  const items = [...cash.withdrawals].sort((a, b) => a.day - b.day);
  const detail = (w) => DENOMS.filter((d) => toInt(w.counts[d]) > 0)
    .map((d) => `${DENOM_NAMES[d]}×${toInt(w.counts[d])}`).join(" ");
  return `
    <div class="panel">
      <h3>
        本部への売上持ち出し
        ${helpBtn("cash_withdrawals", { size: "sm", title: "売上持ち出し記録について" })}
      </h3>
      <p class="view-sub">売り上げを本部に持ち出したら、その都度ここに記録してください。</p>
      ${isLocked ? "" : `<div class="row-actions"><button id="cashWdAdd" class="btn">持ち出しを記録する</button></div>`}
      ${items.length ? `
        <table class="result-table narrow">
          <thead><tr><th>日付</th><th>金額</th><th>内訳</th><th></th></tr></thead>
          <tbody>
            ${items.map((w) => `
              <tr>
                <td>${w.day}日</td>
                <td class="num">${yen(cashTotal(w.counts))}</td>
                <td>${detail(w)}</td>
                <td>${isLocked ? '<span class="muted">保護中</span>' : `<button class="btn-sub" data-delwd="${w.id}">削除</button>`}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : ""}
    </div>`;
}

function denomTablePanel(cash, salesByDay) {
  if (!cash.opening || !cash.closing) {
    return `
      <div class="panel">
        <h3>
          本部報告用・日別金種表
          ${helpBtn("cash_daily_report", { size: "sm", title: "日別金種表とCSV出力について" })}
        </h3>
        <p class="view-sub">月初と月末の金種を入力・保存すると、毎日の金種枚数の表を自動作成します。</p>
      </div>`;
  }
  const table = buildDailyDenomTable(app.ym, cash.opening, cash.closing, salesByDay, cash.withdrawals);
  let warn = "";
  if (!table.consistent) {
    warn = `<p class="err">⚠ 月初＋売上−持ち出しと月末の金額が一致していないため、月の最終日に差額を含めて帳尻を合わせた表になっています。先に上のチェックの原因を解消してください。</p>`;
  } else if (table.residualAdjusted) {
    warn = `<p class="err">⚠ 売上・持ち出しで説明のつかない金種の増減を月の最終日にまとめて反映しています。枚数の入力を確認してください。</p>`;
  }
  const hasWd = cash.withdrawals.length > 0;
  return `
    <div class="panel">
      <h3>
        本部報告用・日別金種表
        ${helpBtn("cash_daily_report", { size: "sm", title: "日別金種表とCSV出力について" })}
      </h3>
      <p class="view-sub">月初の金種と日々の現金売上・持ち出しから、つじつまの合う毎日の金種枚数を自動で補間した表です。金種の増減は「お客さんがどの金種で支払い、どの金種でお釣りを渡したか」として売上のあった日に割り当て、持ち出しは記録した日にその金種のまま減らします。売上も持ち出しもない日は変動しません。そのまま報告書に転記できます。</p>
      ${warn}
      <div class="table-scroll">
        <table class="result-table narrow cash-daily">
          <thead><tr><th>日付</th>${DENOMS.map((d) => `<th>${DENOM_NAMES[d]}</th>`).join("")}<th>合計金額</th><th>現金売上</th>${hasWd ? "<th>持ち出し</th>" : ""}</tr></thead>
          <tbody>
            ${table.rows.map((r) => `
              <tr class="${r.sales || r.withdrawal ? "cash-sale-day" : ""}">
                <td>${r.day === 0 ? "月初" : r.day + "日"}</td>
                ${DENOMS.map((d) => `<td class="num">${r.counts[d]}</td>`).join("")}
                <td class="num"><b>${r.total.toLocaleString("ja-JP")}</b></td>
                <td class="num">${r.sales ? r.sales.toLocaleString("ja-JP") : ""}</td>
                ${hasWd ? `<td class="num">${r.withdrawal ? r.withdrawal.toLocaleString("ja-JP") : ""}</td>` : ""}
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
  const cash = cashOf(month);
  const pym = prevYm(app.ym);
  const isLocked = !!month.locked;

  const lockBannerHtml = isLocked ? `
    <div class="lock-banner">
      <div class="lock-banner-info">
        <span class="lock-icon">🔒</span>
        <div>
          <div class="lock-title">この月（${formatYm(app.ym)}）は月締め確定（ロック中）です</div>
          <div class="lock-meta">誤操作防止のため編集できません。「月締め」画面からロックを解除できます。</div>
        </div>
      </div>
    </div>` : "";

  el().innerHTML = `
    <h2 class="view-title">
      現金管理（${formatYm(app.ym)}）${isLocked ? '<span class="lock-badge">🔒 締め確定済み</span>' : ""}
      ${helpBtn("cash_overview", { size: "lg", title: "現金管理と金庫つじつまチェックの概要" })}
    </h2>
    ${lockBannerHtml}
    <p class="view-sub">ノートの現金販売で受け取った現金を管理します。月末に金庫の現金を数えて入力すると、売上記録とのつじつまを自動チェックします。</p>

    <div class="panel">
      <h3>
        現金の枚数（金種別）
        ${helpBtn("cash_denoms", { size: "sm", title: "金種別枚数の入力について" })}
      </h3>
      <p class="view-sub">月初（前月から引き継いだ時点）と月末（締めのとき）に数えた枚数を入力してください。</p>
      <div class="row-actions">
        <button id="cashFillPrev" class="btn-sub" ${isLocked ? "disabled" : ""}>前月（${formatYm(pym)}）の月末金種を月初に引き継ぐ</button>
        <button id="cashPrices" class="btn-sub">ノート単価の設定…</button>
        ${helpBtn("cash_unit_price", { size: "sm", title: "ノート単価設定について" })}
      </div>
      <table class="entry-table cash-denoms">
        <thead><tr><th>金種</th><th>月初（枚）</th><th>月末（枚）</th></tr></thead>
        <tbody>
          ${DENOMS.map((d) => `
            <tr>
              <td>${DENOM_NAMES[d]}</td>
              <td><input type="number" inputmode="numeric" min="0" data-open="${d}"
                   value="${cash.opening ? toInt(cash.opening[d]) : ""}" placeholder="0" ${isLocked ? "disabled" : ""} /></td>
              <td><input type="number" inputmode="numeric" min="0" data-close="${d}"
                   value="${cash.closing ? toInt(cash.closing[d]) : ""}" placeholder="0" ${isLocked ? "disabled" : ""} /></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="row-actions">
        <button id="cashSave" class="btn" ${isLocked ? "disabled" : ""}>枚数を保存</button>
        <span class="view-sub">月初計: <b>${yen(cashTotal(cash.opening))}</b> ／ 月末計: <b>${yen(cashTotal(cash.closing))}</b></span>
      </div>
    </div>

    ${withdrawalsPanel(cash, isLocked)}

    ${checkPanel(month, products, prices, salesByDay, cash)}

    <div class="panel">
      <h3>現金売上の明細（自動集計）</h3>
      ${salesDetail(salesByDay)}
    </div>

    ${denomTablePanel(cash, salesByDay)}`;

  if (!isLocked) {
    el().querySelector("#cashSave").addEventListener("click", saveCash);
    el().querySelector("#cashFillPrev").addEventListener("click", fillOpeningFromPrev);
    const wdAddBtn = el().querySelector("#cashWdAdd");
    if (wdAddBtn) wdAddBtn.addEventListener("click", openWithdrawalModal);
    el().querySelectorAll("button[data-delwd]").forEach((b) =>
      b.addEventListener("click", () => deleteWithdrawal(b.dataset.delwd)));

    // 金種の月初/月末欄を 矢印キー / Enter で移動（行優先: 左→右、上→下）
    const gridInputs = [];
    el().querySelectorAll(".cash-denoms tbody tr").forEach((tr) => {
      gridInputs.push(...tr.querySelectorAll("input"));
    });
    bindGridNav(gridInputs, 2);
  }

  el().querySelector("#cashPrices").addEventListener("click", () => openPricesModal(notes));
  const csvBtn = el().querySelector("#cashCsv");
  if (csvBtn) csvBtn.addEventListener("click", () => {
    const table = buildDailyDenomTable(app.ym, cash.opening, cash.closing, salesByDay, cash.withdrawals);
    downloadCsv(buildCashReportCsv(table), `cash_report_${app.ym}.csv`);
  });
}
