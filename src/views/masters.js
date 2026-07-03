// 商品マスタ・交換票タブ。
// - 商品の追加・削除・名称/点数変更（保存すると新しいマスタバージョンを作成）
// - 交換票の印刷（レイアウトモデルから生成。ROI座標も同じモデルから自動導出）
import {
  ensureMonth, putMonth, getMaster, getAllMasters, getAllMonths, nextMasterVersion, putMaster,
} from "../db.js";
import { defaultLayout, maxSlots, roiRowsFromLayout, roiCsvFromLayout, formDocumentHtml } from "../layout.js";
import { downloadCsv } from "../csv.js";
import { toInt } from "../validate.js";

let app = null;
let editing = false;     // 編集フォームの表示中か
let draft = null;        // 編集中の商品リスト [{code,key,name,points,isNew}]
let draftEffective = null; // 編集中の適用開始月（再描画で消えないよう保持）
const el = () => document.getElementById("view-masters");

function nextYm(ym) {
  let y = parseInt(ym.slice(0, 4), 10);
  let m = parseInt(ym.slice(4, 6), 10) + 1;
  if (m > 12) { m = 1; y++; }
  return `${y}${String(m).padStart(2, "0")}`;
}

function monthHasData(m) {
  return !!(m.pages.length || m.carryover || Object.keys(m.arrivals || {}).length ||
    (m.specials || []).length || m.physicalCount);
}

// 新商品のkey（内部ID）を既存と重複しないように自動生成
function genKey(code, existingKeys) {
  let base = `item_${String(code || "x").replace(/[^\w]/g, "")}`;
  let key = base, n = 2;
  while (existingKeys.has(key)) key = `${base}_${n++}`;
  return key;
}

async function openPrintWindow() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const layout = master.layout || defaultLayout();
  const w = window.open("", "_blank");
  if (!w) { alert("ポップアップがブロックされました。許可してください。"); return; }
  w.document.write(formDocumentHtml(layout, master.products));
  w.document.close();
}

async function downloadRoiCsv() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const layout = master.layout || defaultLayout();
  downloadCsv(roiCsvFromLayout(layout, master.products), `ROI_coordinate_v${master.version}.csv`);
}

// ---- 編集フォーム ----

function draftRow(p, i, total) {
  return `
    <tr>
      <td><input class="mst-code" data-i="${i}" value="${p.code}" size="4" /></td>
      <td><input class="mst-name" data-i="${i}" value="${p.name.replace(/"/g, "&quot;")}" size="18" /></td>
      <td><input class="mst-points" data-i="${i}" type="number" min="5" step="5" value="${p.points}" style="width:70px" /></td>
      <td class="muted">${p.isNew ? "新規" : p.key}</td>
      <td class="mst-ops">
        <button class="btn-sub" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn-sub" data-down="${i}" ${i === total - 1 ? "disabled" : ""}>↓</button>
        <button class="btn-sub" data-remove="${i}">削除</button>
      </td>
    </tr>`;
}

function collectDraftInputs() {
  el().querySelectorAll(".mst-code").forEach((inp) => { draft[+inp.dataset.i].code = inp.value.trim(); });
  el().querySelectorAll(".mst-name").forEach((inp) => { draft[+inp.dataset.i].name = inp.value.trim(); });
  el().querySelectorAll(".mst-points").forEach((inp) => { draft[+inp.dataset.i].points = toInt(inp.value); });
  const eff = el().querySelector("#mstEffective");
  if (eff) draftEffective = eff.value.trim();
}

async function saveDraft() {
  collectDraftInputs();
  const effectiveFrom = el().querySelector("#mstEffective").value.trim();
  if (!/^\d{6}$/.test(effectiveFrom)) { alert("適用開始月は YYYYMM 形式（例: 202608）で入力してください。"); return; }
  if (!draft.length) { alert("商品が1件もありません。"); return; }
  if (draft.length > maxSlots()) { alert(`商品は最大 ${maxSlots()} 件までです（交換票のマス数の上限）。`); return; }
  for (const p of draft) {
    if (!p.name) { alert("名称が空の商品があります。"); return; }
    if (p.points <= 0) { alert(`「${p.name}」の点数が正しくありません。`); return; }
  }

  const latest = (await getAllMasters()).pop();
  const layout = defaultLayout();
  const products = draft.map(({ code, key, name, points }) => ({ code, key, name, points }));
  const version = await nextMasterVersion();
  await putMaster({
    version,
    label: `v${version}（${effectiveFrom}〜）`,
    effectiveFrom,
    createdAt: new Date().toISOString(),
    products,
    roiRows: roiRowsFromLayout(layout, products),
    config: latest.config, // 認識閾値は引き継ぐ
    layout,
  });

  // データ未入力の月（適用開始月以降）は新バージョンへ切り替え
  const months = await getAllMonths();
  for (const m of months) {
    if (m.ym >= effectiveFrom && !monthHasData(m) && m.masterVersion !== version) {
      m.masterVersion = version;
      await putMonth(m);
    }
  }

  editing = false;
  draft = null;
  draftEffective = null;
  alert(`マスタ v${version} を保存しました（${effectiveFrom} から適用）。\n` +
    `新しい交換票を印刷して、適用開始月から新しい票に切り替えてください。`);
  await show();
}

function bindDraftEvents() {
  const reRender = async () => { await show(); };
  el().querySelectorAll("button[data-up]").forEach((b) => b.addEventListener("click", () => {
    collectDraftInputs();
    const i = +b.dataset.up;
    [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]];
    reRender();
  }));
  el().querySelectorAll("button[data-down]").forEach((b) => b.addEventListener("click", () => {
    collectDraftInputs();
    const i = +b.dataset.down;
    [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]];
    reRender();
  }));
  el().querySelectorAll("button[data-remove]").forEach((b) => b.addEventListener("click", () => {
    collectDraftInputs();
    const i = +b.dataset.remove;
    if (!window.confirm(`「${draft[i].name}」を削除しますか？`)) return;
    draft.splice(i, 1);
    reRender();
  }));
  el().querySelector("#mstAdd").addEventListener("click", () => {
    collectDraftInputs();
    const keys = new Set(draft.map((p) => p.key));
    const code = String(draft.length + 1);
    draft.push({ code, key: genKey(code, keys), name: "", points: 25, isNew: true });
    reRender();
  });
  el().querySelector("#mstSave").addEventListener("click", saveDraft);
  el().querySelector("#mstCancel").addEventListener("click", async () => {
    editing = false;
    draft = null;
    draftEffective = null;
    await show();
  });
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const allMasters = await getAllMasters();
  const latest = allMasters[allMasters.length - 1];

  const versionRows = allMasters.map((m) => `
    <tr ${m.version === month.masterVersion ? 'class="row-active"' : ""}>
      <td>v${m.version}</td>
      <td>${m.label || ""}</td>
      <td>${m.effectiveFrom === "000000" ? "（最初から）" : m.effectiveFrom + "〜"}</td>
      <td>${m.products.length} 商品</td>
      <td>${m.version === month.masterVersion ? `<b class="ok">✓ ${app.ym}で使用中</b>` : ""}</td>
    </tr>`).join("");

  const editPanel = editing ? `
    <div class="panel">
      <h3>商品の入れ替え（新しいマスタを作成）</h3>
      <p class="view-sub">保存すると新しいバージョンになります（過去の月のデータには影響しません）。
      商品は最大 ${maxSlots()} 件。<b>順番どおりに交換票のマスに配置されます</b>（左の列の上から順）。</p>
      <table class="entry-table">
        <thead><tr><th>コード</th><th>名称</th><th>点数</th><th>内部ID</th><th>操作</th></tr></thead>
        <tbody>${draft.map((p, i) => draftRow(p, i, draft.length)).join("")}</tbody>
      </table>
      <div class="row-actions">
        <button id="mstAdd" class="btn-sub">＋ 商品を追加</button>
      </div>
      <div class="row-actions">
        <label>適用開始月 <input id="mstEffective" value="${draftEffective || nextYm(app.ym)}" size="7" maxlength="6" /></label>
        <button id="mstSave" class="btn">新しいマスタとして保存</button>
        <button id="mstCancel" class="btn-sub">キャンセル</button>
      </div>
      <div class="panel warn-panel">
        ⚠ 商品を入れ替えたら<b>必ず新しい交換票を印刷</b>し、適用開始月の初めから古い票と入れ替えてください。
        月の途中で新旧の票が混ざると正しく読み取れません。
      </div>
    </div>` : `
    <div class="panel">
      <h3>商品の入れ替え</h3>
      <p class="view-sub">商品の追加・削除・点数変更を行うと、新しいバージョンのマスタと交換票が作られます。</p>
      <button id="mstEdit" class="btn">商品マスタを編集する</button>
    </div>`;

  el().innerHTML = `
    <h2 class="view-title">商品マスタ・交換票</h2>
    <div class="panel">
      <h3>${app.ym} の商品マスタ（v${month.masterVersion}）</h3>
      <table class="result-table">
        <thead><tr><th>コード</th><th>名称</th><th>点数</th></tr></thead>
        <tbody>${master.products.map((p) => `<tr><td>${p.code}</td><td>${p.name}</td><td>${p.points}点</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="panel">
      <h3>交換票の印刷</h3>
      <p class="view-sub">この月のマスタから交換票（A5横）を生成します。印刷ダイアログでは<b>用紙A5・横向き・余白なし・倍率100%</b>を指定してください。</p>
      <div class="row-actions">
        <button id="mstPrint" class="btn">交換票を表示・印刷</button>
        <button id="mstRoi" class="btn-sub">ROI座標CSVをダウンロード（開発用）</button>
      </div>
    </div>
    ${editPanel}
    <div class="panel">
      <h3>マスタの履歴</h3>
      <table class="result-table">
        <thead><tr><th>版</th><th>ラベル</th><th>適用開始</th><th>商品数</th><th></th></tr></thead>
        <tbody>${versionRows}</tbody>
      </table>
    </div>`;

  el().querySelector("#mstPrint").addEventListener("click", openPrintWindow);
  el().querySelector("#mstRoi").addEventListener("click", downloadRoiCsv);
  if (editing) {
    bindDraftEvents();
  } else {
    el().querySelector("#mstEdit").addEventListener("click", async () => {
      editing = true;
      draft = latest.products.map((p) => ({ ...p }));
      await show();
    });
  }
}
