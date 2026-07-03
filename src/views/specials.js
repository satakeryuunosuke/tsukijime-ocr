// ノート購入タブ。ノートの現金・口座振替・栄冠ポイントでの購入を明細で記録する
// （旧 GUI_tool_3_enter_notes_cdp_hybrid 相当）。
import { ensureMonth, putMonth, getMaster } from "../db.js";
import { noteProducts, SPECIAL_METHODS } from "../ledger.js";
import { daysInMonth, toInt } from "../validate.js";

let app = null;
const el = () => document.getElementById("view-specials");

const methodName = (id) => (SPECIAL_METHODS.find((m) => m.id === id) || {}).name || id;

async function addEntry() {
  const day = toInt(el().querySelector("#spDay").value);
  const method = el().querySelector("input[name=spMethod]:checked").value;
  const qty = {};
  let any = false;
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    const v = toInt(inp.value);
    if (v > 0) { qty[inp.dataset.key] = v; any = true; }
  });
  if (!day) { alert("日付を選択してください。"); return; }
  if (!any) { alert("冊数を1冊以上入力してください。"); return; }

  const month = await ensureMonth(app.ym);
  month.specials.push({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    day, method, qty,
    createdAt: new Date().toISOString(),
  });
  await putMonth(month);
  await show();
}

async function deleteEntry(id) {
  const month = await ensureMonth(app.ym);
  const item = month.specials.find((s) => s.id === id);
  if (!item) return;
  if (!window.confirm(`${item.day}日の${methodName(item.method)}交換の記録を削除しますか？`)) return;
  month.specials = month.specials.filter((s) => s.id !== id);
  await putMonth(month);
  await show();
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const notes = noteProducts(master.products);
  const maxDays = daysInMonth(app.ym);
  const items = [...(month.specials || [])].sort((a, b) => a.day - b.day);

  const qtyText = (s) =>
    notes.filter((p) => toInt(s.qty[p.key]) > 0)
         .map((p) => `${p.name.replace("ノート", "")}×${toInt(s.qty[p.key])}`)
         .join(" ") || "-";

  el().innerHTML = `
    <h2 class="view-title">ノート購入（${app.ym.slice(0, 4)}年${parseInt(app.ym.slice(4), 10)}月）</h2>
    <p class="view-sub">現金・口座振替・栄冠ポイントでのノート購入があったら、その都度ここに記録してください（交換票とは別管理）。</p>
    <div class="panel">
      <h3>記録を追加</h3>
      <div class="sp-form">
        <label>日付
          <select id="spDay">
            ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
              `<option value="${d}">${d}日</option>`).join("")}
          </select>
        </label>
        <div class="sp-methods">
          ${SPECIAL_METHODS.map((m, i) => `
            <label class="sp-radio"><input type="radio" name="spMethod" value="${m.id}" ${i === 0 ? "checked" : ""}/> ${m.name}</label>`).join("")}
        </div>
        <div class="sp-notes">
          ${notes.map((p) => `
            <label class="sp-note">${p.name}
              <input type="number" inputmode="numeric" min="0" data-key="${p.key}" placeholder="0" />
            </label>`).join("")}
        </div>
        <button id="spAdd" class="btn">追加</button>
      </div>
    </div>
    <div class="panel">
      <h3>この月の記録（${items.length}件）</h3>
      <table class="result-table">
        <thead><tr><th>日付</th><th>方法</th><th>冊数</th><th></th></tr></thead>
        <tbody>
          ${items.length ? items.map((s) => `
            <tr>
              <td>${s.day}日</td>
              <td>${methodName(s.method)}</td>
              <td>${qtyText(s)}</td>
              <td><button class="btn-sub" data-del="${s.id}">削除</button></td>
            </tr>`).join("") : `<tr><td colspan="4">まだ記録がありません。</td></tr>`}
        </tbody>
      </table>
    </div>`;

  el().querySelector("#spAdd").addEventListener("click", addEntry);
  el().querySelectorAll("button[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteEntry(b.dataset.del)));
}
