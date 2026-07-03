// 月締めタブ。日別台帳と月末帳簿残の確認、実棚数の入力と差異表示、
// Excel棚卸レポートの出力、保存済みページの管理（削除）を行う。
import { ensureMonth, putMonth, getMaster } from "../db.js";
import { computeLedger, computeDiffs, buildAdjustmentPages } from "../ledger.js";
import { toInt, computeTotalScore, daysInMonth } from "../validate.js";
import { downloadReport } from "../excelReport.js";

let app = null;
let showPages = false;   // 保存済みページ一覧の開閉
let detailKey = null;    // 日別台帳を表示する商品key
const el = () => document.getElementById("view-closing");

async function savePhysical() {
  const month = await ensureMonth(app.ym);
  const data = {};
  el().querySelectorAll("input[data-phys]").forEach((inp) => {
    data[inp.dataset.phys] = toInt(inp.value);
  });
  month.physicalCount = data;
  await putMonth(month);
  await show();
}

// 差異を調整記録で解消する。不足 → 交換ページを自動生成、余剰 → 指定日の入庫に加算。
async function applyAdjustment() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const products = master.products;
  if (!month.physicalCount) { alert("先に実棚数を入力・保存してください。"); return; }

  const day = toInt(el().querySelector("#adjDay").value) || daysInMonth(app.ym);
  const { shortages, surpluses } = computeDiffs(month, products);
  const nShort = Object.keys(shortages).length;
  const nSurp = Object.keys(surpluses).length;
  if (!nShort && !nSurp) { alert("差異はありません。"); return; }

  const nameOf = (k) => (products.find((p) => p.key === k) || { name: k }).name;
  const lines = [];
  if (nShort) lines.push("【不足 → 交換記録を作成】\n" +
    Object.entries(shortages).map(([k, q]) => `  ${nameOf(k)} × ${q}`).join("\n"));
  if (nSurp) lines.push(`【余剰 → ${day}日の入庫に加算】\n` +
    Object.entries(surpluses).map(([k, q]) => `  ${nameOf(k)} × ${q}`).join("\n"));
  if (!window.confirm(
    `帳簿を実棚数に合わせるため、次の調整記録を作成します（${day}日付け）。\n\n${lines.join("\n")}\n\n` +
    `作成後は差異が 0 になります。よろしいですか？`)) return;

  if (nShort) {
    const existing = new Set(month.pages.map((p) => p.name));
    month.pages.push(...buildAdjustmentPages(shortages, products, day, existing));
  }
  if (nSurp) {
    const a = month.arrivals[day] || {};
    for (const [k, q] of Object.entries(surpluses)) a[k] = toInt(a[k]) + q;
    month.arrivals[day] = a;
  }
  await putMonth(month);
  await show();
}

async function deletePage(name) {
  const month = await ensureMonth(app.ym);
  if (!window.confirm(`保存済みページ「${name}」を削除しますか？\n（集計から除外されます。再スキャンすれば入れ直せます）`)) return;
  month.pages = month.pages.filter((p) => p.name !== name);
  await putMonth(month);
  await show();
}

function stocktakeRows(products, ledger, month) {
  const co = month.carryover || {};
  const phys = month.physicalCount || {};
  const isNote = (p) => p.key.startsWith("notes_");
  return products.map((p) => {
    const rows = ledger.rows[p.key];
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const book = ledger.closing[p.key];
    const physV = month.physicalCount ? toInt(phys[p.key]) : null;
    const diff = physV === null ? null : physV - book;
    const diffHtml = diff === null ? "－"
      : diff === 0 ? `<span class="ok">0 ✓</span>`
      : `<span class="err">${diff > 0 ? "+" : ""}${diff}</span>`;
    return `
      <tr>
        <td><a href="javascript:void 0" class="lg-detail" data-key="${p.key}">${p.name}</a></td>
        <td class="num">${toInt(co[p.key])}</td>
        <td class="num">${sum("arrival")}</td>
        <td class="num">${sum("exchange")}</td>
        <td class="num">${isNote(p) ? sum("cash") : "－"}</td>
        <td class="num">${isNote(p) ? sum("debit") : "－"}</td>
        <td class="num">${isNote(p) ? sum("point") : "－"}</td>
        <td class="num"><b>${book}</b></td>
        <td><input type="number" inputmode="numeric" min="0" data-phys="${p.key}"
             value="${month.physicalCount ? toInt(phys[p.key]) : ""}" placeholder="実棚" /></td>
        <td class="num">${diffHtml}</td>
      </tr>`;
  }).join("");
}

function detailTable(products, ledger) {
  if (!detailKey) return "";
  const p = products.find((x) => x.key === detailKey);
  if (!p) return "";
  const isNote = p.key.startsWith("notes_");
  const rows = ledger.rows[p.key].filter((r) =>
    r.arrival || r.exchange || r.cash || r.debit || r.point);
  return `
    <div class="panel">
      <h3>日別台帳: ${p.name}</h3>
      <table class="result-table narrow">
        <thead><tr><th>日</th><th>入荷</th><th>シール交換</th>${isNote ? "<th>現金</th><th>口座</th><th>ポイント</th>" : ""}<th>残</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => `
            <tr><td>${r.day}日</td><td class="num">${r.arrival || ""}</td><td class="num">${r.exchange || ""}</td>
            ${isNote ? `<td class="num">${r.cash || ""}</td><td class="num">${r.debit || ""}</td><td class="num">${r.point || ""}</td>` : ""}
            <td class="num">${r.balance}</td></tr>`).join("")
            : `<tr><td colspan="7">動きのあった日はありません。</td></tr>`}
        </tbody>
      </table>
      <p class="view-sub">月末帳簿残: <b>${ledger.closing[p.key]}</b>（動きのあった日のみ表示）</p>
    </div>`;
}

// 差異がある場合のみ表示する調整パネル
function adjustPanel(month, products) {
  if (!month.physicalCount) return "";
  const { shortages, surpluses } = computeDiffs(month, products);
  if (!Object.keys(shortages).length && !Object.keys(surpluses).length) return "";
  const maxDays = daysInMonth(month.ym);
  return `
    <div class="panel warn-panel">
      <h3>差異の調整</h3>
      <p class="view-sub">帳簿を実棚数に合わせます。不足分は交換記録（通常の交換票と同じ形式）として、
      余剰分は入庫記録として作成されるため、集計・CSV・Excel上は通常の記録と区別されません。</p>
      <div class="row-actions">
        <label>記録する日付
          <select id="adjDay">
            ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
              `<option value="${d}" ${d === maxDays ? "selected" : ""}>${d}日</option>`).join("")}
          </select>
        </label>
        <button id="adjApply" class="btn">差異を調整記録で解消する</button>
      </div>
    </div>`;
}

function pagesPanel(month, products) {
  if (!showPages) {
    return `<button id="clTogglePages" class="btn-sub">保存済みページ一覧を表示（${month.pages.length}枚）</button>`;
  }
  const sorted = [...month.pages].sort((a, b) => {
    const da = toInt(a.predictions.date_1) * 10 + toInt(a.predictions.date_0);
    const db_ = toInt(b.predictions.date_1) * 10 + toInt(b.predictions.date_0);
    return da - db_ || (a.name < b.name ? -1 : 1);
  });
  return `
    <button id="clTogglePages" class="btn-sub">一覧を閉じる</button>
    <table class="result-table">
      <thead><tr><th>ページ</th><th>日付</th><th>合計点数</th><th>保存日時</th><th></th></tr></thead>
      <tbody>
        ${sorted.length ? sorted.map((p) => `
          <tr>
            <td>${p.name}</td>
            <td>${toInt(p.predictions.date_1) * 10 + toInt(p.predictions.date_0)}日</td>
            <td class="num">${computeTotalScore(p.predictions, products)}点</td>
            <td>${(p.savedAt || "").slice(0, 16).replace("T", " ")}</td>
            <td><button class="btn-sub" data-delpage="${p.name.replace(/"/g, "&quot;")}">削除</button></td>
          </tr>`).join("") : `<tr><td colspan="5">保存済みページはありません。</td></tr>`}
      </tbody>
    </table>`;
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const products = master.products;
  const ledger = computeLedger(month, products);
  const y = app.ym.slice(0, 4), m = parseInt(app.ym.slice(4), 10);

  const warns = [];
  if (month.carryover === null) warns.push(`繰越在庫が未入力です（<a href="#carryover">繰越在庫</a>で入力）。帳簿残は繰越0として計算されています。`);
  if (!month.pages.length) warns.push(`読み取り済みの交換票がありません（<a href="#reader">読み取り</a>で保存）。`);

  el().innerHTML = `
    <h2 class="view-title">月締め・棚卸（${y}年${m}月）</h2>
    ${warns.length ? `<div class="panel warn-panel">${warns.map((w) => `<div>⚠ ${w}</div>`).join("")}</div>` : ""}
    <div class="panel">
      <h3>棚卸表</h3>
      <p class="view-sub">「帳簿残」= 繰越 + 入庫 − 交換（シール・現金・口座・ポイント）。実際に棚を数えて「実棚数」に入力すると差異が出ます。商品名をクリックで日別台帳を表示。</p>
      <div class="table-scroll">
        <table class="result-table stocktake">
          <thead><tr><th>商品</th><th>繰越</th><th>入庫計</th><th>ｼｰﾙ交換</th><th>現金</th><th>口座</th><th>ﾎﾟｲﾝﾄ</th><th>帳簿残</th><th>実棚数</th><th>差異</th></tr></thead>
          <tbody>${stocktakeRows(products, ledger, month)}</tbody>
        </table>
      </div>
      <div class="row-actions">
        <button id="clSavePhys" class="btn">実棚数を保存</button>
        <button id="clReport" class="btn btn-secondary">Excelレポート（report_${app.ym}.xlsx）</button>
      </div>
    </div>
    ${adjustPanel(month, products)}
    ${detailTable(products, ledger)}
    <div class="panel">
      <h3>保存済みの交換票</h3>
      ${pagesPanel(month, products)}
    </div>`;

  el().querySelector("#clSavePhys").addEventListener("click", savePhysical);
  el().querySelector("#clReport").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await downloadReport(month, products);
    } catch (err) {
      alert("レポート生成に失敗しました: " + err.message);
      console.error(err);
    } finally {
      e.target.disabled = false;
    }
  });
  const adjBtn = el().querySelector("#adjApply");
  if (adjBtn) adjBtn.addEventListener("click", applyAdjustment);
  const toggle = el().querySelector("#clTogglePages");
  if (toggle) toggle.addEventListener("click", async () => { showPages = !showPages; await show(); });
  el().querySelectorAll("button[data-delpage]").forEach((b) =>
    b.addEventListener("click", () => deletePage(b.dataset.delpage)));
  el().querySelectorAll(".lg-detail").forEach((a) =>
    a.addEventListener("click", async () => {
      detailKey = detailKey === a.dataset.key ? null : a.dataset.key;
      await show();
    }));
}
