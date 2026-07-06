// 商品マスタ・交換票タブ。
// 交換票は Excel（.xlsx）に一本化: マスタに票ファイルを保存し、ダウンロード → Excelで編集 →
// アップロードすると、マーカー（黒塗り2×2セル）と罫線から記入枠を自動抽出・自動割り当てして
// ROI座標を設定する（A4に2票の構成に対応。上の票を使用）。
// 予備として、印刷物のスキャンから設定する方法（ROIエディタ）も残している。
import {
  ensureMonth, putMonth, getMaster, getAllMasters, getAllMonths, nextMasterVersion, putMaster,
} from "../db.js";
import { openRoiEditor, openAssignSession } from "../roiEditor.js";
import { parseFormXlsx, autoAssign, schematicCanvas, insetRoi } from "../xlsxForm.js";
import { downloadCsv } from "../csv.js";
import { toInt } from "../validate.js";

const ASSETS = "public/assets/";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let app = null;
let editing = false;       // 編集フォームの表示中か
let draft = null;          // 編集中の商品リスト [{key,name,points,isNew}]
let draftEffective = null; // 編集中の適用開始月（再描画で消えないよう保持）
let draftRoiRows = null;   // 設定済みのROI座標（null なら未設定）
let draftRoiSource = null; // 'xlsx' | 'scan'
let draftFormB64 = null;   // アップロードされた交換票（base64）
let draftFormName = null;
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

// ---- base64 ヘルパー（IndexedDBのJSONエクスポートに乗せるため文字列で保持）----
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function b64ToBlob(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// マスタの交換票（Excel）をダウンロード。v1 は同梱アセットにフォールバック。
async function downloadFormXlsx(master) {
  if (master.formXlsxB64) {
    downloadBlob(b64ToBlob(master.formXlsxB64, XLSX_MIME), master.formXlsxName || `交換用紙_v${master.version}.xlsx`);
    return;
  }
  try {
    const resp = await fetch(ASSETS + "exchange_form.xlsx");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    downloadBlob(await resp.blob(), `交換用紙_v${master.version}.xlsx`);
  } catch (e) {
    alert("このマスタには交換票（Excel）が保存されていません。\n" + e.message);
  }
}

async function downloadRoiCsv() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
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

function validateDraftProducts() {
  if (!draft.length) { alert("商品が1件もありません。"); return false; }
  const seen = new Set();
  for (const p of draft) {
    if (!p.name) { alert("名称が空の商品があります。"); return false; }
    if (p.points <= 0) { alert(`「${p.name}」の点数が正しくありません。`); return false; }
    if (!KEY_RE.test(p.key)) {
      alert(`「${p.name}」の商品IDが不正です: "${p.key}"\n半角英字で始まり、英数字と _ のみ使えます（例: notes_Y, keyholder）。`);
      return false;
    }
    if (seen.has(p.key)) { alert(`商品ID "${p.key}" が重複しています。`); return false; }
    seen.add(p.key);
  }
  return true;
}

// 商品構成（IDの並び）が同じか
function sameKeys(a, b) {
  return a.length === b.length && a.every((p, i) => p.key === b[i].key);
}

// 編集したExcel交換票のアップロード → 枠抽出 → 自動割り当て → 確認モーダル
async function onUploadFormXlsx(file) {
  collectDraftInputs();
  if (!validateDraftProducts()) return;
  let parsed;
  const buf = await file.arrayBuffer();
  try {
    parsed = await parseFormXlsx(buf);
  } catch (e) {
    alert("Excelの解析に失敗しました: " + e.message);
    console.error(e);
    return;
  }
  if (!parsed.ok) { alert("Excelの解析に失敗しました:\n" + parsed.error); return; }

  const auto = autoAssign(parsed.boxes, draft);
  const notes = [...parsed.warnings, ...auto.messages];
  const note =
    `Excelから枠を${parsed.boxes.length}個検出し、自動割り当てしました。` +
    `<b>緑枠のラベルが商品と合っているか確認</b>し、間違いは右のリストから選び直してください。` +
    (notes.length ? `<br>⚠ ${notes.join("<br>⚠ ")}` : "");

  const candidates = parsed.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  const rows = await openAssignSession({
    products: draft,
    baseCanvas: schematicCanvas(parsed),
    candidates,
    preAssigned: auto.assigned,
    note,
  });
  if (!rows) { await show(); return; }

  // 候補（セル領域そのまま）はROI用に内側へインセット。手描きの枠はそのまま使う。
  const candSet = new Set(candidates.map((c) => `${c.x},${c.y},${c.w},${c.h}`));
  draftRoiRows = rows.map((r) => {
    const isCandidate = candSet.has(`${r.x},${r.y},${r.w},${r.h}`);
    const rect = isCandidate ? insetRoi(r) : r;
    return { name: r.name, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  });
  draftRoiSource = "xlsx";
  draftFormB64 = bufToB64(buf);
  draftFormName = file.name;
  await show();
}

async function saveDraft() {
  collectDraftInputs();
  const effectiveFrom = el().querySelector("#mstEffective").value.trim();
  if (!/^\d{6}$/.test(effectiveFrom)) { alert("適用開始月は YYYYMM 形式（例: 202608）で入力してください。"); return; }
  if (!validateDraftProducts()) return;

  const latest = (await getAllMasters()).pop();

  // 座標の決定: アップロード/スキャンで設定済み → それを使用。
  // 未設定でも商品構成が前のマスタと同じ（名称・点数変更のみ）なら座標と票を引き継ぐ。
  let roiRows, roiSource, formXlsxB64, formXlsxName;
  if (draftRoiRows) {
    const expected = new Set([...draft.flatMap((p) => [`${p.key}_0`, `${p.key}_1`]), "date_0", "date_1", "total_1", "total_2"]);
    const actual = new Set(draftRoiRows.map((r) => r.name));
    const same = expected.size === actual.size && [...expected].every((n) => actual.has(n));
    if (!same) {
      alert("座標を設定した後に商品構成が変わっています。交換票のアップロード（または座標設定）をやり直してください。");
      return;
    }
    roiRows = draftRoiRows;
    roiSource = draftRoiSource || "scan";
    formXlsxB64 = draftFormB64;
    formXlsxName = draftFormName;
  } else if (sameKeys(draft, latest.products)) {
    // 商品の入れ替えなし（点数・名称の変更のみ）→ 票・座標は前のバージョンを引き継ぐ
    roiRows = latest.roiRows;
    roiSource = latest.roiSource || "inherited";
    formXlsxB64 = latest.formXlsxB64 || null;
    formXlsxName = latest.formXlsxName || null;
  } else {
    alert(
      "商品構成が変わっているため、新しい交換票の座標設定が必要です。\n\n" +
      "1.「現在の交換票（Excel）をダウンロード」で票を取得\n" +
      "2. Excelで商品や枠を編集（四隅の黒マーカーは残す）\n" +
      "3.「編集したExcelをアップロード」で座標を設定\n" +
      "してから保存してください。");
    return;
  }

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
    roiSource,
    formXlsxB64,
    formXlsxName,
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
  draftRoiSource = null;
  draftFormB64 = null;
  draftFormName = null;
  alert(`マスタ v${version} を保存しました（${effectiveFrom} から適用）。\n` +
    `交換票（Excel）をA4で印刷（1枚に2票）して切り分け、適用開始月から古い票と入れ替えてください。`);
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

  el().querySelector("#mstDlForm").addEventListener("click", async () => {
    const latest = (await getAllMasters()).pop();
    await downloadFormXlsx(latest);
  });
  el().querySelector("#mstUpForm").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    await onUploadFormXlsx(f);
  });
  el().querySelector("#mstRoiScan").addEventListener("click", async () => {
    collectDraftInputs();
    if (!window.__CV_READY__) { alert("画像処理エンジンの初期化中です。少し待ってからもう一度お試しください。"); return; }
    if (!validateDraftProducts()) return;
    const rows = await openRoiEditor(draft);
    if (rows) { draftRoiRows = rows; draftRoiSource = "scan"; draftFormB64 = null; draftFormName = null; }
    await show();
  });
  const roiClear = el().querySelector("#mstRoiClear");
  if (roiClear) roiClear.addEventListener("click", async () => {
    draftRoiRows = null;
    draftRoiSource = null;
    draftFormB64 = null;
    draftFormName = null;
    await show();
  });
  el().querySelector("#mstSave").addEventListener("click", saveDraft);
  el().querySelector("#mstCancel").addEventListener("click", async () => {
    editing = false;
    draft = null;
    draftEffective = null;
    draftRoiRows = null;
    draftRoiSource = null;
    draftFormB64 = null;
    draftFormName = null;
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

  const coordStatus = draftRoiRows
    ? `<b class="ok">設定済み（${draftRoiSource === "xlsx" ? "Excelから抽出" : "スキャンから設定"}・${draftRoiRows.length}枠）✓</b>`
    : (draft && sameKeys(draft, latest.products)
      ? `未設定（商品構成が同じため、保存時に前のマスタから引き継ぎます）`
      : `<span class="err">未設定（商品構成が変わったため、編集したExcelのアップロードが必要です）</span>`);

  const editPanel = editing ? `
    <div class="panel">
      <h3>商品の入れ替え（新しいマスタを作成）</h3>
      <p class="view-sub">保存すると新しいバージョンになります（過去の月のデータには影響しません）。
      商品の並び順は<b>交換票の並び（左の列の上から順）と同じ</b>にしてください。</p>
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
        <h3>交換票（Excel）の更新</h3>
        <p class="view-sub">座標の状態: ${coordStatus}</p>
        <ol class="mst-steps">
          <li>「現在の交換票をダウンロード」でExcelファイルを取得</li>
          <li>Excelで商品名・点数・枠を編集（<b>四隅の黒塗りマーカー(2×2セル)は動かさない</b>。A4に2票の場合は上下とも同じに）</li>
          <li>「編集したExcelをアップロード」→ 枠が自動で検出・割り当てされるので確認して確定</li>
        </ol>
        <div class="row-actions">
          <button id="mstDlForm" class="btn-sub">現在の交換票をダウンロード</button>
          <label class="btn">編集したExcelをアップロード
            <input id="mstUpForm" type="file" accept=".xlsx,${XLSX_MIME}" hidden />
          </label>
          ${draftRoiRows ? `<button id="mstRoiClear" class="btn-sub">設定を解除</button>` : ""}
        </div>
        <div class="row-actions">
          <button id="mstRoiScan" class="btn-sub">（予備）印刷物のスキャンから座標を設定</button>
        </div>
      </div>
      <div class="row-actions">
        <label>適用開始月 <input id="mstEffective" value="${draftEffective || nextYm(app.ym)}" size="7" maxlength="6" /></label>
        <button id="mstSave" class="btn">新しいマスタとして保存</button>
        <button id="mstCancel" class="btn-sub">キャンセル</button>
      </div>
      <div class="panel warn-panel">
        ⚠ 商品を入れ替えたら新しい交換票をExcelから印刷し、<b>適用開始月の初め</b>から古い票と入れ替えてください。
        月の途中で新旧の票が混ざると正しく読み取れません。
      </div>
    </div>` : `
    <div class="panel">
      <h3>商品の入れ替え</h3>
      <p class="view-sub">商品の追加・削除・点数変更と、交換票（Excel）の更新を行います。</p>
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
      <h3>交換票（Excel）</h3>
      <p class="view-sub">この月のマスタに対応する交換票です。ダウンロードしてExcelから印刷してください（A4縦・1枚に2票→切って使用）。</p>
      <div class="row-actions">
        <button id="mstDl" class="btn">交換票（Excel）をダウンロード</button>
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

  el().querySelector("#mstDl").addEventListener("click", () => downloadFormXlsx(master));
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
