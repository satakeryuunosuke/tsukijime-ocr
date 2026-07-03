// データ管理タブ。バックアップ（JSON一括エクスポート/インポート）と月次CSVのダウンロード。
// iPad Safari 等では「サイトデータ削除」で保存データが消えるため、定期的なエクスポートを促す。
import { exportAll, importAll, getAllMonths, getMonth, getMaster } from "../db.js";
import { downloadCsv } from "../csv.js";
import { buildMonthlyCsvs } from "../ledger.js";

let app = null;
const el = () => document.getElementById("view-backup");

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function onExport() {
  const data = await exportAll();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  downloadJson(data, `tsukijime_backup_${stamp}.json`);
}

async function onImport(file) {
  try {
    const data = JSON.parse(await file.text());
    const n = data.months ? data.months.length : 0;
    if (!window.confirm(
      `バックアップをインポートすると、この端末の保存データはすべて置き換えられます。\n` +
      `（ファイル内: ${n} ヶ月分のデータ）\n続行しますか？`)) return;
    const res = await importAll(data);
    alert(`インポート完了: ${res.months} ヶ月分・マスタ ${res.masters} 件を取り込みました。`);
    await show();
  } catch (e) {
    alert("インポートに失敗しました: " + e.message);
    console.error(e);
  }
}

async function onDownloadMonthCsvs(ym) {
  const month = await getMonth(ym);
  if (!month) return;
  const master = await getMaster(month.masterVersion);
  const files = buildMonthlyCsvs(month, master.products);
  for (const f of files) downloadCsv(f.text, f.filename);
}

export function init(appRef) { app = appRef; }

export async function show() {
  const months = await getAllMonths();
  const rows = months
    .filter((m) => m.pages.length || m.carryover || Object.keys(m.arrivals || {}).length || (m.specials || []).length)
    .map((m) => `
      <tr>
        <td>${m.ym}</td>
        <td>${m.pages.length} 枚</td>
        <td>${m.carryover ? "✓" : "－"}</td>
        <td>${Object.keys(m.arrivals || {}).length} 日</td>
        <td>${(m.specials || []).length} 件</td>
        <td>${m.physicalCount ? "✓" : "－"}</td>
        <td><button class="btn-sub" data-csv="${m.ym}">CSV一式</button></td>
      </tr>`)
    .join("");

  el().innerHTML = `
    <h2 class="view-title">データ管理（バックアップ・引き継ぎ）</h2>
    <div class="panel warn-panel">
      <b>⚠ 大切:</b> データはこの端末のブラウザ内にだけ保存されています。
      ブラウザの「サイトデータを削除」や端末の初期化で消えるため、<b>月に一度はバックアップを保存</b>してください。
      後任への引き継ぎも、このバックアップファイルを渡して新しい端末で「インポート」するだけです。
    </div>
    <div class="panel">
      <h3>バックアップ（全データ）</h3>
      <div class="row-actions">
        <button id="bkExport" class="btn">バックアップを保存（JSON）</button>
        <label class="btn btn-secondary">バックアップから復元（インポート）
          <input id="bkImport" type="file" accept="application/json,.json" hidden />
        </label>
      </div>
    </div>
    <div class="panel">
      <h3>月ごとのCSVダウンロード</h3>
      <p class="view-sub">旧デスクトップ版と同じ5種類のCSV（読み取り結果・日別集計・繰越・入庫・特別交換）をダウンロードします。</p>
      <table class="result-table">
        <thead><tr><th>年月</th><th>読み取り</th><th>繰越</th><th>入庫</th><th>特別交換</th><th>実棚</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">保存されたデータはまだありません。</td></tr>`}</tbody>
      </table>
    </div>`;

  el().querySelector("#bkExport").addEventListener("click", onExport);
  el().querySelector("#bkImport").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) onImport(e.target.files[0]);
    e.target.value = "";
  });
  el().querySelectorAll("button[data-csv]").forEach((b) =>
    b.addEventListener("click", () => onDownloadMonthCsvs(b.dataset.csv)));
}
