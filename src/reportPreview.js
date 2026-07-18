// Excelレポート（report_YYYYMM.xlsx）のブラウザプレビュー。
// 人が見るシート（棚卸・ノート台帳・グッズ台帳・現金管理）と同じ内容をHTMLの表で表示する。
// summary_* などの元データシートは含まない。
// 表はドラッグで範囲選択してコピー → Excelにそのまま貼り付けられる。
import { computeLedger, noteProducts } from "./ledger.js";
import { toInt } from "./validate.js";
import { getSetting } from "./db.js";
import { DENOMS, DENOM_NAMES, cashTotal, dailyCashSales, withdrawalsTotal, buildDailyDenomTable } from "./cash.js";

const GOODS_PER_SHEET = 8; // Excelレポートのグッズ台帳と同じ分割単位

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v) => `<td class="num">${v === "" || v === null ? "" : v}</td>`;
const sumOf = (rows, field) => rows.reduce((a, r) => a + r[field], 0);

// 棚卸シート相当
function stocktakeTable(month, products, ledger) {
  const phys = month.physicalCount || {};
  const hasPhys = !!month.physicalCount;
  const co = month.carryover || {};
  const isNote = (p) => p.key.startsWith("notes_");

  const rows = products.map((p) => {
    const r = ledger.rows[p.key];
    const s = (f) => sumOf(r, f);
    const book = ledger.closing[p.key];
    const physV = hasPhys ? toInt(phys[p.key]) : null;
    const diff = physV === null ? null : physV - book;
    return `<tr><td>${esc(p.name)}</td>${num(toInt(co[p.key]))}${num(s("arrival"))}${num(s("exchange"))}` +
      `${num(isNote(p) ? s("cash") : "")}${num(isNote(p) ? s("debit") : "")}${num(isNote(p) ? s("point") : "")}` +
      `${num(book)}${num(physV === null ? "" : physV)}<td class="num${diff ? " err" : ""}">${diff === null ? "" : diff}</td></tr>`;
  }).join("");

  return `
    <h3>棚卸</h3>
    <div class="table-scroll"><table class="rp-table">
      <thead><tr><th>商品</th><th>繰越</th><th>入庫計</th><th>シール交換計</th><th>現金</th><th>口座</th><th>ポイント</th><th>帳簿残</th><th>実棚数</th><th>差異(実棚-帳簿)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// ノート台帳相当（繰越行＋日別＋合計行）
function notesTable(month, notes, ledger) {
  if (!notes.length) return "";
  const sub = ["入荷", "現金", "口座", "ｼｰﾙ交換", "ﾎﾟｲﾝﾄ", "残"];
  const co = month.carryover || {};

  const head1 = `<tr><th rowspan="2">日付</th>${notes.map((p) => `<th colspan="${sub.length}">${esc(p.name)}</th>`).join("")}</tr>`;
  const head2 = `<tr>${notes.map(() => sub.map((s) => `<th>${s}</th>`).join("")).join("")}</tr>`;
  const coRow = `<tr><td>繰越</td>${notes.map((p) =>
    `${num("")}${num("")}${num("")}${num("")}${num("")}<td class="num rp-bal">${toInt(co[p.key])}</td>`).join("")}</tr>`;

  const dayRows = [];
  for (let d = 1; d <= ledger.maxDays; d++) {
    dayRows.push(`<tr><td>${d}</td>${notes.map((p) => {
      const r = ledger.rows[p.key][d - 1];
      return `${num(r.arrival || "")}${num(r.cash || "")}${num(r.debit || "")}${num(r.exchange || "")}${num(r.point || "")}<td class="num rp-bal">${r.balance}</td>`;
    }).join("")}</tr>`);
  }

  const totRow = `<tr class="rp-total"><td>合計</td>${notes.map((p) => {
    const rows = ledger.rows[p.key];
    return `${num(sumOf(rows, "arrival"))}${num(sumOf(rows, "cash"))}${num(sumOf(rows, "debit"))}${num(sumOf(rows, "exchange"))}${num(sumOf(rows, "point"))}${num("")}`;
  }).join("")}</tr>`;

  return `
    <h3>ノート台帳</h3>
    <div class="table-scroll"><table class="rp-table">
      <thead>${head1}${head2}</thead>
      <tbody>${coRow}${dayRows.join("")}${totRow}</tbody>
    </table></div>`;
}

// グッズ台帳相当（Excelと同じ8商品ごとに分割。繰越行＋日別＋合計行）
function goodsTables(month, products, ledger) {
  const goods = products.filter((p) => !p.key.startsWith("notes_"));
  const sub = ["入荷", "交換", "残"];
  const co = month.carryover || {};
  const parts = [];
  for (let i = 0; i < goods.length; i += GOODS_PER_SHEET) {
    const chunk = goods.slice(i, i + GOODS_PER_SHEET);
    const title = `グッズ台帳${goods.length > GOODS_PER_SHEET ? Math.floor(i / GOODS_PER_SHEET) + 1 : ""}`;
    const head1 = `<tr><th rowspan="2">日付</th>${chunk.map((p) => `<th colspan="${sub.length}">${esc(p.name)}</th>`).join("")}</tr>`;
    const head2 = `<tr>${chunk.map(() => sub.map((s) => `<th>${s}</th>`).join("")).join("")}</tr>`;
    const coRow = `<tr><td>繰越</td>${chunk.map((p) =>
      `${num("")}${num("")}<td class="num rp-bal">${toInt(co[p.key])}</td>`).join("")}</tr>`;
    const dayRows = [];
    for (let d = 1; d <= ledger.maxDays; d++) {
      dayRows.push(`<tr><td>${d}</td>${chunk.map((p) => {
        const r = ledger.rows[p.key][d - 1];
        return `${num(r.arrival || "")}${num(r.exchange || "")}<td class="num rp-bal">${r.balance}</td>`;
      }).join("")}</tr>`);
    }
    const totRow = `<tr class="rp-total"><td>合計</td>${chunk.map((p) => {
      const rows = ledger.rows[p.key];
      return `${num(sumOf(rows, "arrival"))}${num(sumOf(rows, "exchange"))}${num("")}`;
    }).join("")}</tr>`;
    parts.push(`
      <h3>${title}</h3>
      <div class="table-scroll"><table class="rp-table">
        <thead>${head1}${head2}</thead>
        <tbody>${coRow}${dayRows.join("")}${totRow}</tbody>
      </table></div>`);
  }
  return parts.join("");
}

// 現金管理シート相当（つじつま要約＋日別金種表）
function cashSection(month, products, notes, prices) {
  if (!notes.length) return "";
  const salesByDay = dailyCashSales(month, products, prices);
  const cash = month.cash || {};
  const withdrawals = cash.withdrawals || [];
  const openTotal = cashTotal(cash.opening);
  const closeTotal = cashTotal(cash.closing);
  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const withdrawn = withdrawalsTotal(withdrawals);
  const expected = openTotal + totalSales - withdrawn;
  const fmt = (n) => n.toLocaleString("ja-JP");

  const summary = [
    ["月初の現金", openTotal],
    ["現金売上", totalSales],
    ["本部への持ち出し", -withdrawn],
    ["あるべき月末の現金", expected],
    ["実際の月末の現金", closeTotal],
    ["差異（実際−あるべき）", closeTotal - expected],
  ];
  const sumTable = `
    <table class="rp-table"><tbody>
      ${summary.map(([label, v]) => `<tr><td>${label}</td>${num(fmt(v))}</tr>`).join("")}
    </tbody></table>`;

  let daily = `<p class="view-sub">月初・月末の金種が未入力のため、日別金種表はありません。</p>`;
  if (cash.opening && cash.closing) {
    const table = buildDailyDenomTable(month.ym, cash.opening, cash.closing, salesByDay, withdrawals);
    daily = `
      <div class="table-scroll"><table class="rp-table">
        <thead><tr><th>日付</th>${DENOMS.map((d) => `<th>${DENOM_NAMES[d]}</th>`).join("")}<th>合計金額</th><th>現金売上</th><th>本部持ち出し</th></tr></thead>
        <tbody>
          ${table.rows.map((r) => `<tr><td>${r.day === 0 ? "月初" : r.day + "日"}</td>` +
            `${DENOMS.map((d) => num(r.counts[d])).join("")}${num(fmt(r.total))}` +
            `${num(r.sales ? fmt(r.sales) : "")}${num(r.withdrawal ? fmt(r.withdrawal) : "")}</tr>`).join("")}
        </tbody>
      </table></div>`;
  }
  return `<h3>現金管理</h3>${sumTable}<h3>本部報告用・日別金種表</h3>${daily}`;
}

// プレビューをモーダルで開く。コピー中の誤操作を避けるため、閉じるのは ✕ / Esc のみ。
export async function openReportPreview(month, products) {
  const ledger = computeLedger(month, products);
  const notes = noteProducts(products);
  const prices = (await getSetting("notePrices")) || {};
  const ym = month.ym;

  const shell = document.createElement("div");
  shell.className = "rv-overlay";
  shell.innerHTML = `
    <div class="rv-modal rp-modal">
      <div class="rv-head"><span class="rv-title"></span><button class="rv-close" title="閉じる">✕</button></div>
      <div class="rv-body rp-body"></div>
    </div>`;
  shell.querySelector(".rv-title").textContent =
    `レポートプレビュー（${ym.slice(0, 4)}年${parseInt(ym.slice(4), 10)}月）`;
  shell.querySelector(".rv-body").innerHTML = `
    <p class="view-sub">report_${ym}.xlsx のうち人が見るシート（棚卸・ノート台帳・グッズ台帳・現金管理）です。
    表をドラッグで範囲選択してコピーすると、Excelにそのまま貼り付けられます。</p>
    ${stocktakeTable(month, products, ledger)}
    ${notesTable(month, notes, ledger)}
    ${goodsTables(month, products, ledger)}
    ${cashSection(month, products, notes, prices)}`;
  document.body.appendChild(shell);

  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => { shell.remove(); document.removeEventListener("keydown", onKey); };
  shell.querySelector(".rv-close").onclick = close;
  document.addEventListener("keydown", onKey);
}
