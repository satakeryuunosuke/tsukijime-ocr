// 入庫タブ。本部からの納品を日付ごとに記録する（旧 GUI_tool_4_enter_arrivals 相当）。
// 日付を選ぶ → その日の商品×個数を縦表で入力、のシンプルな構成（iPadでも入力しやすい）。
import { ensureMonth, putMonth, getMaster } from "../db.js";
import { daysInMonth, toInt } from "../validate.js";

let app = null;
let selectedDay = 1;
const el = () => document.getElementById("view-arrivals");

async function saveDay() {
  const month = await ensureMonth(app.ym);
  const data = {};
  let any = false;
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    const v = toInt(inp.value);
    if (v > 0) { data[inp.dataset.key] = v; any = true; }
  });
  if (any) month.arrivals[selectedDay] = data;
  else delete month.arrivals[selectedDay];
  await putMonth(month);
  await show();
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const maxDays = daysInMonth(app.ym);
  if (selectedDay > maxDays) selectedDay = 1;
  const arrivals = month.arrivals || {};
  const dayData = arrivals[selectedDay] || {};

  const dayList = Object.keys(arrivals).map(Number).sort((a, b) => a - b);

  el().innerHTML = `
    <h2 class="view-title">入庫の記録（${app.ym.slice(0, 4)}年${parseInt(app.ym.slice(4), 10)}月）</h2>
    <p class="view-sub">グッズが届いた日を選び、届いた個数を入力して保存してください。
      ${dayList.length ? `入庫済み: ${dayList.map((d) => `${d}日`).join("・")}` : "この月の入庫はまだ記録されていません。"}</p>
    <div class="row-actions">
      <label>日付
        <select id="arDay">
          ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
            `<option value="${d}" ${d === selectedDay ? "selected" : ""}>${d}日${arrivals[d] ? " ●" : ""}</option>`).join("")}
        </select>
      </label>
    </div>
    <table class="entry-table">
      <thead><tr><th>商品</th><th>入庫数（${selectedDay}日）</th></tr></thead>
      <tbody>
        ${master.products.map((p) => `
          <tr>
            <td>${p.name}</td>
            <td><input type="number" inputmode="numeric" min="0" data-key="${p.key}"
                 value="${toInt(dayData[p.key]) || ""}" placeholder="0" /></td>
          </tr>`).join("")}
      </tbody>
    </table>
    <div class="row-actions">
      <button id="arSave" class="btn">この日の入庫を保存</button>
      <span class="view-sub">0（空欄）のまま保存するとその日の記録は削除されます。</span>
    </div>`;

  el().querySelector("#arDay").addEventListener("change", async (e) => {
    selectedDay = toInt(e.target.value) || 1;
    await show();
  });
  el().querySelector("#arSave").addEventListener("click", saveDay);

  const inputs = [...el().querySelectorAll("input[data-key]")];
  inputs.forEach((inp, i) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault();
        (inputs[i + 1] || inputs[i]).focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        (inputs[i - 1] || inputs[i]).focus();
      }
    });
  });
}
