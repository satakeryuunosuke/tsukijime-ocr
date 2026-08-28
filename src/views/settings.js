// 設定タブ。
// 1. 読み取り・検算設定（合計点数の判定桁数 2桁/3桁）
// 2. 商品マスタ・交換票（旧 masters.js）
// 3. データ管理（旧 backup.js）
import { getSetting, putSetting } from "../db.js";
import * as mastersView from "./masters.js";
import * as backupView from "./backup.js";

let app = null;
let currentSubTab = "reading"; // "reading" | "masters" | "backup"
const el = () => document.getElementById("view-settings");

export function init(appRef) {
  app = appRef;
  mastersView.init(appRef);
  backupView.init(appRef);
}

// サブタブの切り替え
export function setSubTab(tab) {
  currentSubTab = tab;
  render();
}

async function renderReadingSettings(container) {
  const currentDigits = Number((await getSetting("checksumDigits")) || 2);
  container.innerHTML = `
    <div class="panel">
      <h3>合計点数の検算判定（チェックデジット）</h3>
      <p class="view-sub">交換票の読み取り時に、商品の単価×個数の計算合計と記入された合計枠を照合する際の判定基準を設定します。</p>
      
      <div class="setting-group">
        <label class="setting-radio ${currentDigits === 2 ? "active" : ""}">
          <input type="radio" name="chkDigits" value="2" ${currentDigits === 2 ? "checked" : ""} />
          <div class="setting-radio-body">
            <b>上2桁で照合（一の位を無視）【既定】</b>
            <span class="setting-desc">商品の単価が25の倍数であるため一の位は判定に使用せず、上2桁（百・十の位）のみで一致を判定します。</span>
          </div>
        </label>
        
        <label class="setting-radio ${currentDigits === 3 ? "active" : ""}">
          <input type="radio" name="chkDigits" value="3" ${currentDigits === 3 ? "checked" : ""} />
          <div class="setting-radio-body">
            <b>3桁完全一致（百の位・十の位・一の位）</b>
            <span class="setting-desc">百・十・一の全3桁が計算合計と完全一致しているかを判定します。</span>
          </div>
        </label>
      </div>
      <p id="stSavedMsg" class="setting-saved" hidden>✓ 設定を保存しました</p>
    </div>
  `;

  const radios = container.querySelectorAll('input[name="chkDigits"]');
  radios.forEach((r) => {
    r.addEventListener("change", async () => {
      const val = parseInt(r.value, 10);
      await putSetting("checksumDigits", val);
      container.querySelectorAll(".setting-radio").forEach((sr) => sr.classList.remove("active"));
      r.closest(".setting-radio").classList.add("active");
      const msg = container.querySelector("#stSavedMsg");
      msg.hidden = false;
      setTimeout(() => { if (msg) msg.hidden = true; }, 2500);
    });
  });
}

export async function show(targetSub = null) {
  if (targetSub) currentSubTab = targetSub;
  await render();
}

async function render() {
  el().innerHTML = `
    <h2 class="view-title">設定</h2>
    <div class="settings-subnav">
      <button class="subnav-btn ${currentSubTab === "reading" ? "active" : ""}" data-sub="reading">読み取り・検算設定</button>
      <button class="subnav-btn ${currentSubTab === "masters" ? "active" : ""}" data-sub="masters">商品・交換票</button>
      <button class="subnav-btn ${currentSubTab === "backup" ? "active" : ""}" data-sub="backup">データ管理（バックアップ）</button>
    </div>
    <div id="settings-content" class="settings-content"></div>
  `;

  const content = el().querySelector("#settings-content");

  el().querySelectorAll(".subnav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSubTab = btn.dataset.sub;
      render();
    });
  });

  if (currentSubTab === "reading") {
    await renderReadingSettings(content);
  } else if (currentSubTab === "masters") {
    const wrapper = document.createElement("div");
    wrapper.id = "view-masters";
    content.appendChild(wrapper);
    await mastersView.show();
  } else if (currentSubTab === "backup") {
    const wrapper = document.createElement("div");
    wrapper.id = "view-backup";
    content.appendChild(wrapper);
    await backupView.show();
  }
}
