// 入庫タブ。納品を日付ごとに記録する。
// PCの横長画面を活かした2カラムレイアウト ＆ 商品マスタ変更に完全対応した動的グリッド。
import { ensureMonth, putMonth, getMaster } from "../db.js";
import { daysInMonth, toInt } from "../validate.js";
import { bindGridNav } from "../keynav.js";
import { toast } from "../toast.js";

let app = null;
let selectedDay = 1;
const el = () => document.getElementById("view-arrivals");

function getInputsTotal() {
  let total = 0;
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    total += toInt(inp.value);
  });
  return total;
}

function updateLiveStats() {
  const total = getInputsTotal();
  const numEl = el().querySelector("#arTotalNum");
  if (numEl) numEl.textContent = total.toLocaleString();

  el().querySelectorAll(".ar-card").forEach((card) => {
    const inp = card.querySelector("input[data-key]");
    if (!inp) return;
    const v = toInt(inp.value);
    if (v > 0) {
      card.classList.add("has-value");
    } else {
      card.classList.remove("has-value");
    }
  });
}

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
  toast(any ? `${selectedDay}日の入庫を保存しました ✓` : `${selectedDay}日の入庫記録を削除しました`);
  await show();
}

async function deleteDay(d) {
  const month = await ensureMonth(app.ym);
  if (!month.arrivals || !month.arrivals[d]) return;
  if (!window.confirm(`${d}日の入庫記録を削除しますか？`)) return;
  delete month.arrivals[d];
  await putMonth(month);
  toast(`${d}日の入庫記録を削除しました`);
  await show();
}

function clearCurrentDayInputs() {
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    inp.value = "";
  });
  updateLiveStats();
  const first = el().querySelector("input[data-key]");
  if (first) first.focus();
}

function getProductLot(p) {
  const name = p.name || "";
  const key = p.key || "";
  if (name.includes("ノート") || key.startsWith("notes_")) return 100;
  if (name.includes("カド消し") || key.includes("eraser")) return 20;
  if (name.includes("鉛筆削り") || key.includes("sharpener")) return 5;
  if (name.includes("下じき") || name.includes("下敷き") || key.includes("pad")) return 5;
  if (name.includes("ホルダーケース") || key.startsWith("case_")) return 6;
  return 10;
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

  // 月間商品別合計の集計
  const monthlyProductTotals = {};
  let monthlyGrandTotal = 0;
  master.products.forEach((p) => { monthlyProductTotals[p.key] = 0; });
  for (const d of Object.keys(arrivals)) {
    const dObj = arrivals[d] || {};
    for (const [k, q] of Object.entries(dObj)) {
      const v = toInt(q);
      if (v > 0) {
        monthlyProductTotals[k] = (monthlyProductTotals[k] || 0) + v;
        monthlyGrandTotal += v;
      }
    }
  }
  const productsWithMonthlyArrivals = master.products.filter(
    (p) => monthlyProductTotals[p.key] > 0
  );

  const qtyText = (data) => master.products
    .filter((p) => toInt(data[p.key]) > 0)
    .map((p) => `${p.name}×${toInt(data[p.key])}`)
    .join(" ") || "-";

  const dayTotal = Object.values(dayData).reduce((sum, v) => sum + toInt(v), 0);

  el().innerHTML = `
    <h2 class="view-title">入庫の記録（${app.ym.slice(0, 4)}年${parseInt(app.ym.slice(4), 10)}月）</h2>
    <p class="view-sub">グッズが届いた日を選び、届いた個数を入力して保存してください。</p>

    <div class="ar-container">
      <!-- 左側：入庫入力メイン -->
      <div class="ar-main">
        <!-- 日付選択カード -->
        <div class="ar-date-card">
          <div class="ar-date-header">
            <div class="ar-date-controls">
              <button id="arPrevDay" class="ar-date-nav-btn" ${selectedDay <= 1 ? "disabled" : ""}>◀ 前日</button>
              <label style="font-weight: 700; display: flex; align-items: center; gap: .3rem;">
                <select id="arDay">
                  ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
                    `<option value="${d}" ${d === selectedDay ? "selected" : ""}>${d}日${arrivals[d] ? " (登録あり)" : ""}</option>`).join("")}
                </select>
              </label>
              <button id="arNextDay" class="ar-date-nav-btn" ${selectedDay >= maxDays ? "disabled" : ""}>翌日 ▶</button>
            </div>
            <div class="view-sub" style="margin: 0;">● = 入庫あり</div>
          </div>
          <!-- 日付クイックストリップ -->
          <div class="ar-date-strip">
            ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => `
              <div class="ar-date-chip ${d === selectedDay ? "active" : ""} ${arrivals[d] ? "has-data" : ""}" data-day="${d}">
                <span>${d}</span>
              </div>`).join("")}
          </div>
        </div>

        <!-- 商品入力動的グリッド -->
        <div class="ar-grid">
          ${master.products.map((p) => {
            const val = toInt(dayData[p.key]);
            const hasVal = val > 0;
            const lot = getProductLot(p);
            return `
              <div class="ar-card ${hasVal ? "has-value" : ""}">
                <div class="ar-card-head">
                  <span class="ar-card-name">${p.name}</span>
                  <span class="ar-card-pts">${p.points}点</span>
                </div>
                <div class="ar-card-body">
                  <div class="ar-quick-chips">
                    <button type="button" class="ar-chip" data-add="${lot}" data-target="${p.key}">+${lot}</button>
                  </div>
                  <div class="ar-input-wrap">
                    <input type="number" inputmode="numeric" min="0" data-key="${p.key}" class="ar-input"
                           value="${val || ""}" placeholder="0" />
                  </div>
                </div>
              </div>`;
          }).join("")}
        </div>

        <!-- ボトムバー（合計 & アクション） -->
        <div class="ar-bottom-bar">
          <div class="ar-total-info">
            <span class="ar-total-label">${selectedDay}日の合計入庫数:</span>
            <span id="arTotalNum" class="ar-total-num">${dayTotal.toLocaleString()}</span>
            <span class="ar-total-unit">個</span>
          </div>
          <div class="ar-actions">
            <button id="arClear" class="btn-sub" type="button">この日の入力をクリア</button>
            <button id="arSave" class="btn" type="button">この日の入庫を保存</button>
          </div>
        </div>
      </div>

      <!-- 右側：今月のサマリー & 登録履歴サイドバー -->
      <div class="ar-sidebar">
        <!-- 今月の商品別入庫合計 -->
        <div class="panel" style="margin: 0;">
          <h3>今月の商品別入庫合計</h3>
          ${productsWithMonthlyArrivals.length ? `
            <table class="ar-sum-table">
              <thead><tr><th>商品</th><th style="text-align: right;">今月入庫数</th></tr></thead>
              <tbody>
                ${productsWithMonthlyArrivals.map((p) => `
                  <tr>
                    <td>${p.name}</td>
                    <td class="num">${monthlyProductTotals[p.key].toLocaleString()}</td>
                  </tr>`).join("")}
                <tr class="ar-sum-total">
                  <td>全商品合計</td>
                  <td class="num">${monthlyGrandTotal.toLocaleString()} 個</td>
                </tr>
              </tbody>
            </table>` : `<p class="view-sub" style="margin: .4rem 0 0;">今月の入庫はまだ記録されていません。</p>`}
        </div>

        <!-- 登録済みの入庫（日別） -->
        <div class="panel" style="margin: 0;">
          <h3>登録済みの入庫（${dayList.length}日分）</h3>
          ${dayList.length ? `
            <div class="ar-history-list">
              ${dayList.map((d) => `
                <div class="ar-history-item ${d === selectedDay ? "active" : ""}">
                  <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: baseline; gap: .4rem;">
                      <span class="ar-hist-day">${d}日</span>
                      <span class="ar-hist-detail" title="${qtyText(arrivals[d])}">${qtyText(arrivals[d])}</span>
                    </div>
                  </div>
                  <div class="ar-hist-btns">
                    <button class="btn-sub" style="padding: .25rem .5rem;" data-editday="${d}">編集</button>
                    <button class="btn-sub" style="padding: .25rem .5rem; color: var(--err);" data-delday="${d}">削除</button>
                  </div>
                </div>`).join("")}
            </div>` : `<p class="view-sub" style="margin: .4rem 0 0;">この月の入庫記録はありません。</p>`}
        </div>
      </div>
    </div>`;

  // イベント登録
  el().querySelector("#arDay").addEventListener("change", async (e) => {
    selectedDay = toInt(e.target.value) || 1;
    await show();
  });

  const prevBtn = el().querySelector("#arPrevDay");
  if (prevBtn) prevBtn.addEventListener("click", async () => {
    if (selectedDay > 1) {
      selectedDay--;
      await show();
    }
  });

  const nextBtn = el().querySelector("#arNextDay");
  if (nextBtn) nextBtn.addEventListener("click", async () => {
    if (selectedDay < maxDays) {
      selectedDay++;
      await show();
    }
  });

  el().querySelectorAll(".ar-date-chip[data-day]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      selectedDay = toInt(chip.dataset.day) || 1;
      await show();
    });
  });

  // クイック加算チップ
  el().querySelectorAll(".ar-chip[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const add = toInt(btn.dataset.add);
      const targetKey = btn.dataset.target;
      const inp = el().querySelector(`input[data-key="${targetKey}"]`);
      if (inp) {
        inp.value = (toInt(inp.value) || 0) + add;
        updateLiveStats();
      }
    });
  });

  // リアルタイム入力変更
  el().querySelectorAll("input[data-key]").forEach((inp) => {
    inp.addEventListener("input", updateLiveStats);
    inp.addEventListener("focus", () => inp.select());
  });

  el().querySelector("#arSave").addEventListener("click", saveDay);
  el().querySelector("#arClear").addEventListener("click", clearCurrentDayInputs);

  el().querySelectorAll("button[data-editday]").forEach((b) =>
    b.addEventListener("click", async () => {
      selectedDay = toInt(b.dataset.editday);
      await show();
    }));

  el().querySelectorAll("button[data-delday]").forEach((b) =>
    b.addEventListener("click", async () => {
      await deleteDay(toInt(b.dataset.delday));
    }));

  const allInputs = [...el().querySelectorAll("input[data-key]")];
  bindGridNav(allInputs, 1);
  const last = allInputs[allInputs.length - 1];
  if (last) last.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el().querySelector("#arSave").focus();
    }
  });
}

