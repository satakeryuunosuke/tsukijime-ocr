// 商品マスタ・交換票タブ。
// - 商品の追加・削除・名称/点数変更（保存すると新しいマスタバージョンを作成）
// - 交換票の印刷（レイアウトモデルから生成。ROI座標も同じモデルから自動導出）
import {
  ensureMonth, putMonth, getMaster, getAllMasters, getAllMonths, nextMasterVersion, putMaster,
} from "../db.js";
import { defaultLayout, maxSlots, roiRowsFromLayout, formDocumentHtml } from "../layout.js";
import { openRoiEditor } from "../roiEditor.js";
import { downloadCsv } from "../csv.js";
import { toInt } from "../validate.js";

let app = null;
let editing = false;     // 編集フォームの表示中か
let draft = null;        // 編集中の商品リスト [{key,name,points,isNew}]
let draftEffective = null; // 編集中の適用開始月（再描画で消えないよう保持）
let draftRoiRows = null;   // ROIエディタで設定した座標（未設定なら既定レイアウトを使用）
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

// 商品ID（主キー）は半角英字のIDのみを使う（旧2桁数字コードは廃止済み・Python版と同方針）。
// 一度使ったIDは繰越の自動引き継ぎ等で月をまたいで参照されるため、既存商品のIDは変更不可。
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

async function openPrintWindow() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  if (master.roiSource === "scan" && !window.confirm(
    "このマスタは自作の交換票（スキャンから座標設定）用です。\n" +
    "アプリが生成する票とは配置が異なるため、印刷しても読み取りには使えません。\n参考として表示しますか？")) return;
  const layout = master.layout || defaultLayout();
  const w = window.open("", "_blank");
  if (!w) { alert("ポップアップがブロックされました。許可してください。"); return; }
  w.document.write(formDocumentHtml(layout, master.products));
  w.document.close();
}

async function downloadRoiCsv() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  // マスタに保存された実座標を出力（scan設定でもlayout由来でも正しい）
  const csv = ["ROI_name,x,y,h,w",
    ...master.roiRows.map((r) => `${r.name},${r.x},${r.y},${r.h},${r.w}`)].join("\n");
  downloadCsv(csv, `ROI_coordinate_v${master.version}.csv`);
}

// ---- 編集フォーム ----

function draftRow(p, i, total) {
  const keyCell = p.isNew
    ? `<input class="mst-key" data-i="${i}" value="${p.key}" size="12" placeholder="例: keyholder" />`
    : `<span class="muted">${p.key}</span>`;
  return `
    <tr>
      <td>${keyCell}</td>
      <td><input class="mst-name" data-i="${i}" value="${p.name.replace(/"/g, "&quot;")}" size="18" /></td>
      <td><input class="mst-points" data-i="${i}" type="number" min="5" step="5" value="${p.points}" style="width:70px" /></td>
      <td class="mst-ops">
        <button class="btn-sub" data-up="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn-sub" data-down="${i}" ${i === total - 1 ? "disabled" : ""}>↓</button>
        <button class="btn-sub" data-remove="${i}">削除</button>
      </td>
    </tr>`;
}

function collectDraftInputs() {
  el().querySelectorAll(".mst-key").forEach((inp) => { draft[+inp.dataset.i].key = inp.value.trim(); });
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
  // 既定レイアウト使用時のみマス数上限あり（自作票＝ROIエディタ設定済みなら票の設計次第なので制限しない）
  if (!draftRoiRows && draft.length > maxSlots()) {
    alert(`既定レイアウトの交換票に置ける商品は最大 ${maxSlots()} 件です。\nそれ以上にする場合はExcel等で票を自作し、「スキャンから座標を設定」を使ってください。`);
    return;
  }
  for (const p of draft) {
    if (!p.name) { alert("名称が空の商品があります。"); return; }
    if (p.points <= 0) { alert(`「${p.name}」の点数が正しくありません。`); return; }
  }

  // 商品ID（主キー）の検証: 半角英字ID・重複なし
  const seen = new Set();
  for (const p of draft) {
    if (!KEY_RE.test(p.key)) {
      alert(`「${p.name || "(名称未入力)"}」の商品IDが不正です: "${p.key}"\n半角英字で始まり、英数字と _ のみ使えます（例: notes_Y, keyholder）。`);
      return;
    }
    if (seen.has(p.key)) { alert(`商品ID "${p.key}" が重複しています。`); return; }
    seen.add(p.key);
  }

  // 座標: ROIエディタ設定済みならそれを使用（商品構成と一致するか検証）、未設定なら既定レイアウト
  let roiRows, layout, roiSource;
  if (draftRoiRows) {
    const expected = new Set([...draft.flatMap((p) => [`${p.key}_0`, `${p.key}_1`]), "date_0", "date_1", "total_1", "total_2"]);
    const actual = new Set(draftRoiRows.map((r) => r.name));
    const same = expected.size === actual.size && [...expected].every((n) => actual.has(n));
    if (!same) {
      alert("座標を設定した後に商品構成が変わっています。「スキャンから座標を設定」をやり直してください。");
      return;
    }
    roiRows = draftRoiRows;
    layout = null;
    roiSource = "scan";
  } else {
    if (!window.confirm(
      "交換票の座標が未設定のため、既定レイアウト（このアプリで生成・印刷する票と同じ配置）を使います。\n" +
      "Excel等で自作した票を使う場合はキャンセルし、「スキャンから座標を設定」を行ってください。\n\n" +
      "既定レイアウトのまま保存しますか？")) return;
    layout = defaultLayout();
    roiRows = roiRowsFromLayout(layout, draft);
    roiSource = "layout";
  }

  const latest = (await getAllMasters()).pop();
  const products = draft.map(({ key, name, points }) => ({ key, name, points }));
  const version = await nextMasterVersion();
  await putMaster({
    version,
    label: `v${version}（${effectiveFrom}〜）`,
    effectiveFrom,
    createdAt: new Date().toISOString(),
    products,
    roiRows,
    config: latest.config, // 認識閾値は引き継ぐ
    layout,
    roiSource,
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
  draftRoiRows = null;
  alert(`マスタ v${version} を保存しました（${effectiveFrom} から適用）。\n` +
    (roiSource === "scan"
      ? `自作した交換票を、適用開始月から古い票と入れ替えて使ってください。`
      : `「交換票を表示・印刷」から新しい票を印刷し、適用開始月から切り替えてください。`));
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
    draft.push({ key: "", name: "", points: 25, isNew: true });
    reRender();
  });
  el().querySelector("#mstRoiEdit").addEventListener("click", async () => {
    collectDraftInputs();
    if (!window.__CV_READY__) { alert("画像処理エンジンの初期化中です。少し待ってからもう一度お試しください。"); return; }
    for (const p of draft) {
      if (!p.name || !KEY_RE.test(p.key)) {
        alert("先に商品リストを完成させてください（名称と商品IDが必要です）。");
        return;
      }
    }
    const rows = await openRoiEditor(draft);
    if (rows) draftRoiRows = rows;
    await show();
  });
  const roiClear = el().querySelector("#mstRoiClear");
  if (roiClear) roiClear.addEventListener("click", async () => {
    draftRoiRows = null;
    await show();
  });
  el().querySelector("#mstSave").addEventListener("click", saveDraft);
  el().querySelector("#mstCancel").addEventListener("click", async () => {
    editing = false;
    draft = null;
    draftEffective = null;
    draftRoiRows = null;
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
        <thead><tr><th>商品ID（半角英字）</th><th>名称</th><th>点数</th><th>操作</th></tr></thead>
        <tbody>${draft.map((p, i) => draftRow(p, i, draft.length)).join("")}</tbody>
      </table>
      <p class="view-sub">商品IDはデータの主キーです（例: notes_Y）。既存商品のIDは変更できません。
      新商品は半角英字のIDを付けてください（英字で始まり、英数字と _ のみ）。</p>
      <div class="row-actions">
        <button id="mstAdd" class="btn-sub">＋ 商品を追加</button>
      </div>
      <div class="panel">
        <h3>交換票の座標</h3>
        <p class="view-sub">現在の設定:
          ${draftRoiRows
            ? `<b class="ok">スキャンから設定済み（${draftRoiRows.length} 枠）✓</b>`
            : `既定レイアウト（このアプリで生成・印刷する票の配置）`}
        </p>
        <p class="view-sub">Excel等で<b>交換票を自作</b>する場合は、票に四隅のマーカー（黒い正方形）を入れて
        スキャンし、下のボタンから記入枠の位置を設定してください（枠は自動検出され、クリックで割り当てられます）。</p>
        <div class="row-actions">
          <button id="mstRoiEdit" class="btn-sub">スキャンから座標を設定（ROIエディタ）</button>
          ${draftRoiRows ? `<button id="mstRoiClear" class="btn-sub">既定レイアウトに戻す</button>` : ""}
        </div>
      </div>
      <div class="row-actions">
        <label>適用開始月 <input id="mstEffective" value="${draftEffective || nextYm(app.ym)}" size="7" maxlength="6" /></label>
        <button id="mstSave" class="btn">新しいマスタとして保存</button>
        <button id="mstCancel" class="btn-sub">キャンセル</button>
      </div>
      <div class="panel warn-panel">
        ⚠ 商品を入れ替えたら<b>新しい交換票</b>（アプリで印刷 または Excelで自作）を用意し、
        適用開始月の初めから古い票と入れ替えてください。月の途中で新旧の票が混ざると正しく読み取れません。
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
        <thead><tr><th>商品ID</th><th>名称</th><th>点数</th></tr></thead>
        <tbody>${master.products.map((p) => `<tr><td class="muted">${p.key}</td><td>${p.name}</td><td>${p.points}点</td></tr>`).join("")}</tbody>
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
