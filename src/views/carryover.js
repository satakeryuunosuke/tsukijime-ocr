// 繰越在庫タブ。月初時点の在庫数を商品ごとに入力する（旧 GUI_tool_1_enter_carryover 相当）。
// 前月の帳簿残（または実棚数）からのワンタップ自動入力に対応。
import { ensureMonth, putMonth, getMonth, getMaster } from "../db.js";
import { computeLedger } from "../ledger.js";
import { toInt } from "../validate.js";
import { bindGridNav } from "../keynav.js";

let app = null;
const el = () => document.getElementById("view-carryover");

function prevYm(ym) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) - 1;
  if (m < 1) { m = 12; y--; }
  return `${y}${String(m).padStart(2, "0")}`;
}

function collectInputs() {
  const data = {};
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    data[inp.dataset.key] = toInt(inp.value);
  });
  return data;
}

async function save(silent = false) {
  const month = await ensureMonth(app.ym);
  month.carryover = collectInputs();
  await putMonth(month);
  if (!silent) {
    const note = el().querySelector("#coSavedNote");
    note.textContent = "保存しました ✓";
    setTimeout(() => { note.textContent = ""; }, 2000);
  }
}

// 前月の帳簿残 or 実棚数を各入力欄へ流し込む
async function fillFromPrev(usePhysical) {
  const pym = prevYm(app.ym);
  const prev = await getMonth(pym);
  if (!prev) { alert(`前月（${pym}）のデータがありません。`); return; }
  let values;
  if (usePhysical) {
    if (!prev.physicalCount) { alert(`前月（${pym}）の実棚数が入力されていません。`); return; }
    values = prev.physicalCount;
  } else {
    const master = await getMaster(prev.masterVersion);
    values = computeLedger(prev, master.products).closing;
  }
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    if (values[inp.dataset.key] !== undefined) inp.value = toInt(values[inp.dataset.key]);
  });
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const co = month.carryover || {};
  const pym = prevYm(app.ym);

  el().innerHTML = `
    <h2 class="view-title">繰越在庫（${app.ym.slice(0, 4)}年${parseInt(app.ym.slice(4), 10)}月の月初在庫）</h2>
    <p class="view-sub">月初時点で棚にある数を商品ごとに入力してください。${month.carryover ? "" : "<b>未入力です。</b>"}</p>
    <div class="row-actions">
      <button id="coFillLedger" class="btn-sub">前月（${pym}）の帳簿残から自動入力</button>
      <button id="coFillPhys" class="btn-sub">前月（${pym}）の実棚数から自動入力</button>
    </div>
    <table class="entry-table">
      <thead><tr><th>商品</th><th>点数</th><th>繰越在庫数</th></tr></thead>
      <tbody>
        ${master.products.map((p) => `
          <tr>
            <td>${p.name}</td>
            <td class="muted">${p.points}点</td>
            <td><input type="number" inputmode="numeric" min="0" data-key="${p.key}"
                 value="${month.carryover ? toInt(co[p.key]) : ""}" placeholder="0" /></td>
          </tr>`).join("")}
      </tbody>
    </table>
    <div class="row-actions">
      <button id="coSave" class="btn">保存</button>
      <span id="coSavedNote" class="ok"></span>
    </div>`;

  el().querySelector("#coSave").addEventListener("click", () => save());
  el().querySelector("#coFillLedger").addEventListener("click", () => fillFromPrev(false));
  el().querySelector("#coFillPhys").addEventListener("click", () => fillFromPrev(true));

  // Enter / 矢印キーで次の入力欄へ（旧GUI版の操作感を踏襲）
  bindGridNav([...el().querySelectorAll("input[data-key]")], 1);
}
