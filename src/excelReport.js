// Excel棚卸レポート（report_YYYYMM.xlsx）の生成。
// 旧 template.xlsx と同構造の日次台帳（ノート／グッズ、日付×[入荷・交換・残]）を
// 現在の商品マスタから動的に生成する（商品入れ替えに追従するため、テンプレ貼付方式は廃止）。
// 追加で「棚卸」シート（帳簿残 vs 実棚数 vs 差異）と元データ4シートを含める。
import { computeLedger, noteProducts, aggregateSpecials, aggregateDaily, SPECIAL_METHODS } from "./ledger.js";
import { toInt, daysInMonth } from "./validate.js";
import { getSetting } from "./db.js";
import { DENOMS, DENOM_NAMES, cashTotal, dailyCashSales, withdrawalsTotal, buildDailyDenomTable } from "./cash.js";

const ASSETS = "public/assets/";
const GOODS_PER_SHEET = 8;

let loading = null;
export function ensureExcelJs() {
  if (window.ExcelJS) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = ASSETS + "vendor/exceljs.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("exceljs.min.js の読み込みに失敗しました"));
      document.head.appendChild(s);
    });
  }
  return loading;
}

const thin = { style: "thin", color: { argb: "FF999999" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const HEAD_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
const BAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };

function styleHeaderRow(row) {
  row.eachCell((c) => {
    c.fill = HEAD_FILL;
    c.font = { bold: true };
    c.border = BORDER;
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
}

function borderRows(ws, fromRow, toRow, toCol) {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = 1; c <= toCol; c++) ws.getCell(r, c).border = BORDER;
  }
}

// ノート台帳: 商品ごとに [入荷, 現金, 口座, シール交換, ポイント, 残] の6列。
// ヘッダの直後（1日の行の上）に繰越（月初在庫）の行を入れる。
function addNotesSheet(wb, month, products, ledger) {
  const notes = noteProducts(products);
  if (!notes.length) return;
  const ws = wb.addWorksheet("ノート台帳");
  const sub = ["入荷", "現金", "口座", "ｼｰﾙ交換", "ﾎﾟｲﾝﾄ", "残"];
  const co = month.carryover || {};

  const head1 = ["日付"];
  const head2 = [""];
  for (const p of notes) {
    head1.push(p.name, "", "", "", "", "");
    head2.push(...sub);
  }
  ws.addRow(head1);
  ws.addRow(head2);
  for (let i = 0; i < notes.length; i++) {
    const c0 = 2 + i * sub.length;
    ws.mergeCells(1, c0, 1, c0 + sub.length - 1);
  }
  ws.mergeCells(1, 1, 2, 1);
  styleHeaderRow(ws.getRow(1));
  styleHeaderRow(ws.getRow(2));

  const coCells = ["繰越"];
  for (const p of notes) coCells.push("", "", "", "", "", toInt(co[p.key]));
  ws.addRow(coCells);

  for (let d = 1; d <= ledger.maxDays; d++) {
    const cells = [d];
    for (const p of notes) {
      const r = ledger.rows[p.key][d - 1];
      cells.push(r.arrival || "", r.cash || "", r.debit || "", r.exchange || "", r.point || "", r.balance);
    }
    ws.addRow(cells);
  }
  borderRows(ws, 3, 3 + ledger.maxDays, 1 + notes.length * sub.length);
  // 残の列と繰越行は薄グレーで見やすく
  ws.getRow(3).font = { bold: true };
  for (let i = 0; i < notes.length; i++) {
    const col = 1 + (i + 1) * sub.length;
    for (let r = 3; r <= 3 + ledger.maxDays; r++) ws.getCell(r, col).fill = BAL_FILL;
  }
  ws.getColumn(1).width = 6;
  for (let c = 2; c <= 1 + notes.length * sub.length; c++) ws.getColumn(c).width = 8;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
}

// グッズ台帳: 商品ごとに [入荷, 交換, 残] の3列（8商品/シートで分割）。
// ヘッダの直後（1日の行の上）に繰越（月初在庫）の行を入れる。
function addGoodsSheets(wb, month, products, ledger) {
  const goods = products.filter((p) => !p.key.startsWith("notes_"));
  const sub = ["入荷", "交換", "残"];
  const co = month.carryover || {};
  for (let i = 0; i < goods.length; i += GOODS_PER_SHEET) {
    const chunk = goods.slice(i, i + GOODS_PER_SHEET);
    const ws = wb.addWorksheet(`グッズ台帳${goods.length > GOODS_PER_SHEET ? Math.floor(i / GOODS_PER_SHEET) + 1 : ""}`);
    const head1 = ["日付"];
    const head2 = [""];
    for (const p of chunk) {
      head1.push(p.name, "", "");
      head2.push(...sub);
    }
    ws.addRow(head1);
    ws.addRow(head2);
    for (let j = 0; j < chunk.length; j++) {
      const c0 = 2 + j * sub.length;
      ws.mergeCells(1, c0, 1, c0 + sub.length - 1);
    }
    ws.mergeCells(1, 1, 2, 1);
    styleHeaderRow(ws.getRow(1));
    styleHeaderRow(ws.getRow(2));

    const coCells = ["繰越"];
    for (const p of chunk) coCells.push("", "", toInt(co[p.key]));
    ws.addRow(coCells);

    for (let d = 1; d <= ledger.maxDays; d++) {
      const cells = [d];
      for (const p of chunk) {
        const r = ledger.rows[p.key][d - 1];
        cells.push(r.arrival || "", r.exchange || "", r.balance);
      }
      ws.addRow(cells);
    }
    borderRows(ws, 3, 3 + ledger.maxDays, 1 + chunk.length * sub.length);
    ws.getRow(3).font = { bold: true };
    for (let j = 0; j < chunk.length; j++) {
      const col = 1 + (j + 1) * sub.length;
      for (let r = 3; r <= 3 + ledger.maxDays; r++) ws.getCell(r, col).fill = BAL_FILL;
    }
    ws.getColumn(1).width = 6;
    for (let c = 2; c <= 1 + chunk.length * sub.length; c++) ws.getColumn(c).width = 9;
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
  }
}

// 棚卸シート: 商品×[繰越, 入庫計, 交換計, 現金, 口座, ポイント, 帳簿残, 実棚, 差異]
function addStocktakeSheet(wb, month, products, ledger) {
  const ws = wb.addWorksheet("棚卸", { properties: { tabColor: { argb: "FF0EA5E9" } } });
  const phys = month.physicalCount || {};
  const co = month.carryover || {};
  const isNote = (p) => p.key.startsWith("notes_");

  ws.addRow([`${month.ym.slice(0, 4)}年${parseInt(month.ym.slice(4), 10)}月 棚卸表`]);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  const head = ws.addRow(["商品", "繰越", "入庫計", "シール交換計", "現金", "口座", "ポイント", "帳簿残", "実棚数", "差異(実棚-帳簿)"]);
  styleHeaderRow(head);

  for (const p of products) {
    const rows = ledger.rows[p.key];
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const book = ledger.closing[p.key];
    const physV = month.physicalCount ? toInt(phys[p.key]) : null;
    const diff = physV === null ? null : physV - book;
    const row = ws.addRow([
      p.name, toInt(co[p.key]), sum("arrival"), sum("exchange"),
      isNote(p) ? sum("cash") : "", isNote(p) ? sum("debit") : "", isNote(p) ? sum("point") : "",
      book, physV === null ? "" : physV, diff === null ? "" : diff,
    ]);
    if (diff !== null && diff !== 0) {
      row.getCell(10).font = { bold: true, color: { argb: "FFDC2626" } };
    }
  }
  borderRows(ws, 2, 2 + products.length, 10);
  ws.getColumn(1).width = 20;
  for (let c = 2; c <= 10; c++) ws.getColumn(c).width = 11;
}

// 現金管理シート: つじつまチェックの要約と日別金種表（現金管理タブと同じ内容）
async function addCashSheet(wb, month, products) {
  const notes = noteProducts(products);
  if (!notes.length) return;
  const prices = (await getSetting("notePrices")) || {};
  const salesByDay = dailyCashSales(month, products, prices);
  const cash = month.cash || {};
  const withdrawals = cash.withdrawals || [];

  const ws = wb.addWorksheet("現金管理", { properties: { tabColor: { argb: "FF16A34A" } } });
  ws.addRow([`${month.ym.slice(0, 4)}年${parseInt(month.ym.slice(4), 10)}月 現金管理`]);
  ws.getCell(1, 1).font = { bold: true, size: 14 };

  const openTotal = cashTotal(cash.opening);
  const closeTotal = cashTotal(cash.closing);
  const totalSales = [...salesByDay.values()].reduce((a, b) => a + b, 0);
  const withdrawn = withdrawalsTotal(withdrawals);
  const expected = openTotal + totalSales - withdrawn;

  const summary = [
    ["月初の現金", openTotal],
    ["現金売上", totalSales],
    ["本部への持ち出し", -withdrawn],
    ["あるべき月末の現金", expected],
    ["実際の月末の現金", closeTotal],
    ["差異（実際−あるべき）", closeTotal - expected],
  ];
  for (const [label, value] of summary) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).numFmt = "#,##0";
  }

  ws.addRow([]);
  if (cash.opening && cash.closing) {
    const table = buildDailyDenomTable(month.ym, cash.opening, cash.closing, salesByDay, withdrawals);
    const headRow = ws.addRow(["日付", ...DENOMS.map((d) => DENOM_NAMES[d]), "合計金額", "現金売上", "本部持ち出し"]);
    styleHeaderRow(headRow);
    for (const r of table.rows) {
      ws.addRow([
        r.day === 0 ? "月初" : `${r.day}日`,
        ...DENOMS.map((d) => r.counts[d]),
        r.total, r.sales || "", r.withdrawal || "",
      ]);
    }
    borderRows(ws, headRow.number, ws.rowCount, 1 + DENOMS.length + 3);
  } else {
    ws.addRow(["月初・月末の金種が未入力のため、日別金種表は作成していません。"]);
  }

  ws.getColumn(1).width = 20;
  for (let c = 2; c <= 1 + DENOMS.length + 3; c++) ws.getColumn(c).width = 11;
}

// 元データシート（旧テンプレの summary_yyyymm 等と同じ列構成）
function addDataSheets(wb, month, products) {
  const maxDays = daysInMonth(month.ym);
  const notes = noteProducts(products);

  // summary
  let ws = wb.addWorksheet(`summary_${month.ym}`);
  const daily = aggregateDaily(month.pages || [], products);
  ws.addRow(["date", ...products.map((p) => p.key)]);
  for (let d = 1; d <= maxDays; d++) {
    const q = daily.get(d) || {};
    ws.addRow([d, ...products.map((p) => toInt(q[p.key]))]);
  }

  // carryover
  ws = wb.addWorksheet(`carryover_inventory_${month.ym}`);
  ws.addRow(["product_name", "quantity"]);
  for (const p of products) ws.addRow([p.key, toInt((month.carryover || {})[p.key])]);

  // arrival
  ws = wb.addWorksheet(`arrival_${month.ym}`);
  ws.addRow(["date", ...products.map((p) => p.key)]);
  for (let d = 1; d <= maxDays; d++) {
    const a = (month.arrivals || {})[d] || {};
    ws.addRow([d, ...products.map((p) => toInt(a[p.key]))]);
  }

  // other_manual_entries
  ws = wb.addWorksheet(`other_manual_entries_${month.ym}`);
  const header = ["day"];
  for (const m of SPECIAL_METHODS) for (const p of notes) header.push(`${m.id}_${p.key}`);
  ws.addRow(header);
  const byDay = aggregateSpecials(month.specials);
  for (let d = 1; d <= maxDays; d++) {
    const sp = byDay.get(d);
    const cells = [d];
    for (const m of SPECIAL_METHODS) for (const p of notes) cells.push(toInt(sp && sp[m.id][p.key]));
    ws.addRow(cells);
  }
}

// month + products から report_YYYYMM.xlsx を生成してダウンロード
export async function downloadReport(month, products) {
  await ensureExcelJs();
  const ledger = computeLedger(month, products);

  const wb = new window.ExcelJS.Workbook();
  wb.creator = "グッズ交換・月締めシステム";
  wb.created = new Date();

  addStocktakeSheet(wb, month, products, ledger);
  addNotesSheet(wb, month, products, ledger);
  addGoodsSheets(wb, month, products, ledger);
  await addCashSheet(wb, month, products);
  addDataSheets(wb, month, products);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report_${month.ym}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
