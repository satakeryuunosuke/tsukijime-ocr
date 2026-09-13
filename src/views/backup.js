// データ管理タブ。バックアップ（JSON一括エクスポート/インポート）と月次CSVのダウンロード。
// iPad Safari 等では「サイトデータ削除」で保存データが消えるため、定期的なエクスポートを促す。
import { exportAll, importAll, getAllMonths, getMonth, getMaster, getSetting, putSetting, deleteSetting } from "../db.js";
import { downloadCsv } from "../csv.js";
import { buildMonthlyCsvs } from "../ledger.js";
import { formatYm } from "../dateUtils.js";
import { helpBtn } from "../help.js";
import { toast } from "../toast.js";

let app = null;
const el = () => document.getElementById("view-backup");

export const isFileSystemAccessSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function triggerBackupDownload() {
  const data = await exportAll();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  downloadJson(data, `tsukijime_backup_${stamp}.json`);
}

export async function getBackupFolderInfo() {
  const handle = await getSetting("backupDirHandle");
  const name = (await getSetting("backupDirName")) || (handle ? handle.name : null);
  return { handle, name };
}

export async function setBackupFolder() {
  if (!isFileSystemAccessSupported) {
    throw new Error("お使いのブラウザはフォルダ選択（File System Access API）に対応していません。Google ChromeまたはMicrosoft Edgeをご利用ください。");
  }
  const handle = await window.showDirectoryPicker({
    id: "tsukijime_backup_dir",
    mode: "readwrite",
  });
  await putSetting("backupDirHandle", handle);
  await putSetting("backupDirName", handle.name);
  return handle;
}

export async function clearBackupFolder() {
  await deleteSetting("backupDirHandle");
  await deleteSetting("backupDirName");
}

export async function verifyFolderPermission(dirHandle, readWrite = true) {
  if (!dirHandle) return false;
  const options = {};
  if (readWrite) options.mode = "readwrite";
  try {
    if ((await dirHandle.queryPermission(options)) === "granted") {
      return true;
    }
    if ((await dirHandle.requestPermission(options)) === "granted") {
      return true;
    }
  } catch (err) {
    console.warn("フォルダのアクセス許可確認でエラー:", err);
  }
  return false;
}

export async function saveBackupToFolder(dirHandle) {
  const granted = await verifyFolderPermission(dirHandle, true);
  if (!granted) {
    throw new Error("バックアップ先フォルダへの書き込み権限が許可されませんでした。");
  }
  const data = await exportAll();
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `tsukijime_backup_${stamp}.json`;
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 1));
  await writable.close();
  return { filename, folderName: dirHandle.name };
}

export async function listBackupsFromFolder(dirHandle) {
  if (!dirHandle) return [];
  const list = [];
  try {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".json")) {
        try {
          const file = await entry.getFile();
          list.push({
            name: entry.name,
            entry,
            file,
            size: file.size,
            lastModified: file.lastModified,
            isTsukijime: entry.name.startsWith("tsukijime_backup_"),
          });
        } catch (fileErr) {
          console.warn("ファイル情報取得エラー:", entry.name, fileErr);
        }
      }
    }
  } catch (err) {
    console.warn("共有フォルダのファイル走査エラー:", err);
    throw new Error("共有フォルダ内のファイル一覧を取得できませんでした: " + err.message);
  }

  // ソート順:
  // 1. tsukijime_backup_ プレフィックス優先
  // 2. ファイル名（日付順）降順
  // 3. 最終更新日時 降順
  list.sort((a, b) => {
    if (a.isTsukijime && !b.isTsukijime) return -1;
    if (!a.isTsukijime && b.isTsukijime) return 1;
    if (a.name > b.name) return -1;
    if (a.name < b.name) return 1;
    return b.lastModified - a.lastModified;
  });

  return list;
}

export async function getLatestBackupFromFolder(dirHandle) {
  const list = await listBackupsFromFolder(dirHandle);
  return list.length > 0 ? list[0] : null;
}

export async function syncFromSharedFolder({ targetFileName = null, confirm = true } = {}) {
  if (!isFileSystemAccessSupported) {
    alert("お使いのブラウザは共有フォルダ機能（File System Access API）に対応していません。\nPCのGoogle ChromeまたはMicrosoft Edgeをご利用ください。");
    return { success: false, reason: "unsupported" };
  }

  const { handle, name } = await getBackupFolderInfo();
  if (!handle) {
    const wantSet = window.confirm(
      "共有フォルダ（バックアップ保存先）がまだ設定されていません。\n" +
      "フォルダ（ファイルサーバー等）を指定して接続しますか？"
    );
    if (wantSet) {
      try {
        await setBackupFolder();
        toast("共有フォルダを設定しました ✓");
        await updateShareStatusBadge();
        if (app && app.currentView === "settings") await show();
        return await syncFromSharedFolder({ targetFileName, confirm });
      } catch (err) {
        if (err.name !== "AbortError") alert("フォルダ設定エラー: " + err.message);
        return { success: false, reason: "aborted" };
      }
    }
    return { success: false, reason: "not_configured" };
  }

  // 権限確認・要求
  const granted = await verifyFolderPermission(handle, true);
  if (!granted) {
    alert(`共有フォルダ「${name}」へのアクセスが許可されませんでした。`);
    await updateShareStatusBadge();
    return { success: false, reason: "permission_denied" };
  }

  // ファイル探索
  let files;
  try {
    files = await listBackupsFromFolder(handle);
  } catch (err) {
    alert(err.message);
    return { success: false, reason: "scan_error", error: err };
  }

  if (files.length === 0) {
    alert(`共有フォルダ「${name}」内にバックアップファイル（.json）が見つかりませんでした。\n先に「月締め」を行うか、設定画面で「今すぐテスト保存」を行ってください。`);
    return { success: false, reason: "no_backups" };
  }

  let target = null;
  if (targetFileName) {
    target = files.find((f) => f.name === targetFileName);
    if (!target) {
      alert(`共有フォルダ内に指定されたファイル「${targetFileName}」が見つかりませんでした。`);
      return { success: false, reason: "file_not_found" };
    }
  } else {
    target = files[0];
  }

  // ファイル読み込みとJSON解析
  let text = "";
  let data = null;
  try {
    text = await target.file.text();
    data = JSON.parse(text);
  } catch (err) {
    alert(`バックアップファイル「${target.name}」の読み込みまたは解析に失敗しました: ${err.message}`);
    return { success: false, reason: "parse_error", error: err };
  }

  if (!data || data.app !== "tsukijime" || !Array.isArray(data.months)) {
    alert(`ファイル「${target.name}」はグッズ交換・月締めシステムの有効なバックアップデータではありません。`);
    return { success: false, reason: "invalid_format" };
  }

  const monthsCount = data.months.length;
  const mastersCount = (data.masters || []).length;
  const modDateStr = new Date(target.lastModified).toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });

  if (confirm) {
    const ok = window.confirm(
      `共有フォルダからバックアップを読み込みます。\n\n` +
      `【対象ファイル】: ${target.name}\n` +
      `【更新日時】: ${modDateStr}\n` +
      `【データ内容】: ${monthsCount} ヶ月分（マスタ ${mastersCount} 件）\n\n` +
      `※ インポートすると、この端末に保存されている現在のデータはすべて置き換えられます。\n続行しますか？`
    );
    if (!ok) return { success: false, reason: "cancelled_by_user" };
  }

  // インポート実行
  try {
    const res = await importAll(data);
    toast(`共有フォルダから読み込みました（${res.months}ヶ月分） ✓`);
    await updateShareStatusBadge();

    // 画面の再描画
    if (app) {
      if (typeof app.refreshCurrentView === "function") {
        await app.refreshCurrentView();
      } else if (typeof app.showView === "function") {
        await app.showView(app.currentView);
      }
    }
    return { success: true, filename: target.name, months: res.months };
  } catch (err) {
    alert("インポート中にエラーが発生しました: " + err.message);
    return { success: false, reason: "import_error", error: err };
  }
}

export async function tryAutoBackup() {
  if (!isFileSystemAccessSupported) {
    return { attempted: false, reason: "unsupported" };
  }
  const { handle, name } = await getBackupFolderInfo();
  if (!handle) {
    return { attempted: false, reason: "not_configured" };
  }
  try {
    const res = await saveBackupToFolder(handle);
    await updateShareStatusBadge();
    return { attempted: true, success: true, filename: res.filename, folderName: name || res.folderName };
  } catch (err) {
    console.warn("Auto backup failed:", err);
    await updateShareStatusBadge();
    return { attempted: true, success: false, error: err, folderName: name };
  }
}

export async function checkShareStatus() {
  if (!isFileSystemAccessSupported) {
    return {
      status: "unsupported",
      label: "共有: 非対応",
      title: "お使いのブラウザはフォルダ直接共有（File System Access API）に対応していません（PCのChrome / Edgeをご利用ください）。",
    };
  }
  const { handle, name } = await getBackupFolderInfo();
  if (!handle) {
    return {
      status: "disconnected",
      label: "共有: 未接続 (設定する)",
      title: "クリックして共有バックアップ先フォルダ（ファイルサーバー等）を指定してください。",
    };
  }

  // 権限確認（セッション経過や再起動による期限切れの検知）
  let perm;
  try {
    perm = await handle.queryPermission({ mode: "readwrite" });
  } catch (err) {
    return {
      status: "error",
      name: name || "フォルダ",
      label: `共有: エラー (${name || "未定"})`,
      title: `アクセス権限の確認でエラーが発生しました: ${err.message}。クリックして再設定してください。`,
    };
  }

  if (perm === "prompt") {
    return {
      status: "expired",
      name,
      label: `共有: 期限切れ (${name})`,
      title: `ブラウザのアクセス権限が切れています。クリックして再接続（アクセス許可）してください。`,
    };
  }
  if (perm === "denied") {
    return {
      status: "denied",
      name,
      label: `共有: 拒否 (${name})`,
      title: `フォルダへの書き込みアクセスが拒否されています。クリックして再設定してください。`,
    };
  }

  // 許可済み（正常接続）
  return {
    status: "connected",
    name,
    label: `共有中: ${name}`,
    title: `共有フォルダ「${name}」に接続されています（クリックで変更または確認）。`,
  };
}

export async function updateShareStatusBadge() {
  const btn = document.getElementById("shareStatusBtn");
  if (!btn) return;
  const text = btn.querySelector(".share-status-text");

  const info = await checkShareStatus();

  btn.className = `share-status-btn status-${info.status}`;
  btn.title = info.title;
  if (text) text.textContent = info.label;
}

export async function handleShareStatusClick() {
  const current = await checkShareStatus();
  if (current.status === "unsupported") {
    alert("お使いのブラウザはフォルダ直接共有（File System Access API）に対応していません。\nPCのGoogle ChromeまたはMicrosoft Edgeをご利用ください。");
    return;
  }
  if (current.status === "disconnected") {
    try {
      await setBackupFolder();
      toast("共有バックアップ先フォルダを設定しました ✓");
      await updateShareStatusBadge();
      if (app && app.currentView === "settings") {
        await show();
      }
    } catch (err) {
      if (err.name !== "AbortError") alert("フォルダ設定エラー: " + err.message);
    }
    return;
  }
  if (current.status === "expired") {
    try {
      const { handle } = await getBackupFolderInfo();
      const granted = await verifyFolderPermission(handle, true);
      if (granted) {
        toast(`共有フォルダ「${handle.name}」へ再接続しました ✓`);
      } else {
        alert("アクセスが許可されませんでした。");
      }
      await updateShareStatusBadge();
    } catch (err) {
      alert("再接続エラー: " + err.message);
    }
    return;
  }
  if (current.status === "denied" || current.status === "error") {
    const choice = window.confirm(
      `共有先「${current.name || "フォルダ"}」へのアクセスが制限されています。\n（${current.title}）\n\n` +
      `【OK】: 別のフォルダを再選択する\n` +
      `【キャンセル】: 閉じる`
    );
    if (choice) {
      try {
        await setBackupFolder();
        toast("共有フォルダを再設定しました ✓");
        await updateShareStatusBadge();
        if (app && app.currentView === "settings") await show();
      } catch (err) {
        if (err.name !== "AbortError") alert("フォルダ設定エラー: " + err.message);
      }
    }
    return;
  }
  if (current.status === "connected") {
    const choice = window.confirm(
      `共有フォルダ「${current.name}」に正常接続されています。\n\n` +
      `【OK】: 共有フォルダから最新データを読み込む（更新）\n` +
      `【キャンセル】: 別の共有フォルダへの変更または閉じる`
    );
    if (choice) {
      await syncFromSharedFolder();
    } else {
      const change = window.confirm(
        `別の共有フォルダに変更しますか？\n\n` +
        `【OK】: フォルダを変更する\n` +
        `【キャンセル】: 何もせず閉じる`
      );
      if (change) {
        try {
          await setBackupFolder();
          toast("共有フォルダを変更しました ✓");
          await updateShareStatusBadge();
          if (app && app.currentView === "settings") await show();
        } catch (err) {
          if (err.name !== "AbortError") alert("フォルダ変更エラー: " + err.message);
        }
      }
    }
    return;
  }
}

export function initShareStatusWatcher() {
  const btn = document.getElementById("shareStatusBtn");
  if (btn) {
    btn.addEventListener("click", handleShareStatusClick);
  }

  const refreshBtn = document.getElementById("shareRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      refreshBtn.classList.add("loading");
      try {
        await syncFromSharedFolder();
      } catch (err) {
        console.error("共有フォルダ読み取りエラー:", err);
        alert("共有フォルダの読み込みでエラーが発生しました: " + err.message);
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove("loading");
      }
    });
  }

  // 初回チェック
  updateShareStatusBadge();
  // タブ再フォーカス時に権限・期限切れをチェック
  window.addEventListener("focus", () => updateShareStatusBadge());
  // 45秒おきに権限・期限切れを監視
  setInterval(() => updateShareStatusBadge(), 45000);
}

async function onExport() {
  await triggerBackupDownload();
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
  const [months, folderInfo] = await Promise.all([
    getAllMonths(),
    getBackupFolderInfo(),
  ]);

  let backupFiles = [];
  if (folderInfo.handle) {
    try {
      const hasPerm = await verifyFolderPermission(folderInfo.handle, false);
      if (hasPerm) {
        backupFiles = await listBackupsFromFolder(folderInfo.handle);
      }
    } catch (e) {
      console.warn("共有フォルダ内ファイル取得スキップ:", e);
    }
  }

  const rows = months
    .filter((m) => m.pages.length || m.carryover || Object.keys(m.arrivals || {}).length || (m.specials || []).length)
    .map((m) => `
      <tr>
        <td>${formatYm(m.ym)}</td>
        <td>${m.pages.length} 枚</td>
        <td>${m.carryover ? "✓" : "－"}</td>
        <td>${Object.keys(m.arrivals || {}).length} 日</td>
        <td>${(m.specials || []).length} 件</td>
        <td>${m.physicalCount ? "✓" : "－"}</td>
        <td><button class="btn-sub" data-csv="${m.ym}">CSV一式</button></td>
      </tr>`)
    .join("");

  el().innerHTML = `
    <h2 class="view-title">
      データ管理（バックアップ・引き継ぎ）
      ${helpBtn("settings_backup", { size: "lg", title: "データ管理とバックアップの重要性" })}
    </h2>
    <div class="panel warn-panel">
      <b>⚠ 大切:</b> データはこの端末のブラウザ内にだけ保存されています。
      ブラウザの「サイトデータを削除」や端末の初期化で消えるため、<b>月に一度はバックアップを保存</b>してください。
      後任への引き継ぎも、このバックアップファイルを渡して新しい端末で「インポート」するだけです。
    </div>
    <div class="panel">
      <h3>
        月締め完了時の自動バックアップ先（ファイルサーバー等）
        ${helpBtn("backup_auto_folder", { size: "sm", title: "ファイルサーバー等の自動バックアップ保存先設定" })}
      </h3>
      <p class="view-sub">
        「月締め」タブで月締めを確定（ロック）した際、指定した共有フォルダ（ファイルサーバーやネットワークドライブ等）へ最新の全データバックアップを自動保存します。<br>
        後から別のPCで同じ共有フォルダのバックアップを「更新」ボタンや下のボタンから読み取って確認できます。
      </p>
      ${!isFileSystemAccessSupported ? `
        <p class="view-sub warn">
          ※ お使いのブラウザ・端末はフォルダ直接保存（File System Access API）に対応していません。<br>
          PCのGoogle ChromeまたはMicrosoft Edgeをご利用いただくと、ファイルサーバーへの自動保存・同期機能が有効になります（非対応時は手動ダウンロードとなります）。
        </p>
      ` : `
        <div class="backup-folder-box" style="margin: 10px 0; padding: 14px 16px; background: var(--bg-card, #f8f9fa); border-radius: 8px; border: 1px solid var(--border, #ddd);">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:20px;">📁</span>
            <div>
              <strong>保存先フォルダ:</strong>
              <span id="bkFolderName" style="margin-left:8px; font-weight:bold; color: ${folderInfo.name ? "var(--color-primary, #1976d2)" : "var(--muted, #888)"};">
                ${folderInfo.name ? folderInfo.name : "未設定（手動ダウンロードのみ）"}
              </span>
            </div>
          </div>
          <div class="row-actions" style="margin-top: 14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button id="bkSetFolder" class="btn">${folderInfo.name ? "📁 フォルダを変更する" : "📁 保存先フォルダを指定する"}</button>
            ${folderInfo.name ? `
              <button id="bkSyncFolder" class="btn" style="background:#0284c7; color:#fff; display:inline-flex; align-items:center; gap:4px;">🔄 共有フォルダから読み込む（最新化）</button>
              <button id="bkTestFolder" class="btn-sub">💾 今すぐテスト保存</button>
              <button id="bkClearFolder" class="btn-sub" style="color:var(--color-err, #d32f2f);">解除</button>
            ` : ""}
          </div>
          ${folderInfo.name && backupFiles.length > 0 ? `
            <div style="margin-top:16px; padding-top:14px; border-top:1px dashed var(--border, #cbd5e1);">
              <div style="font-size:0.88rem; font-weight:700; color:var(--text, #1e293b); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between;">
                <span>共有フォルダ内のバックアップ一覧 (${backupFiles.length} 件):</span>
                <span style="font-size:0.78rem; font-weight:normal; color:var(--muted, #64748b);">※「読込」を押すとその時点のデータを取り込みます</span>
              </div>
              <div style="max-height:180px; overflow-y:auto; border:1px solid var(--border, #e2e8f0); border-radius:6px; background:#fff;">
                <table class="result-table" style="margin:0; font-size:0.82rem; width:100%;">
                  <thead>
                    <tr style="background:#f1f5f9;">
                      <th style="padding:6px 10px;">ファイル名</th>
                      <th style="padding:6px 10px;">更新日時</th>
                      <th style="padding:6px 10px;">サイズ</th>
                      <th style="padding:6px 10px; text-align:center;">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${backupFiles.map((f, i) => `
                      <tr style="${i === 0 ? "background:#f0fdf4;" : ""}">
                        <td style="padding:6px 10px;">
                          <b>${f.name}</b>
                          ${i === 0 ? '<span style="margin-left:6px; background:#dcfce7; color:#166534; font-size:0.72rem; padding:1px 6px; border-radius:4px; font-weight:bold;">最新</span>' : ""}
                        </td>
                        <td style="padding:6px 10px;">${new Date(f.lastModified).toLocaleString("ja-JP")}</td>
                        <td style="padding:6px 10px;">${(f.size / 1024).toFixed(1)} KB</td>
                        <td style="padding:6px 10px; text-align:center;">
                          <button class="btn-sub" data-import-shared="${f.name}" style="padding:2px 8px; font-size:0.78rem;">読込</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ""}
        </div>
      `}
    </div>
    <div class="panel">
      <h3>
        バックアップ（全データ）
        ${helpBtn("backup_export_import", { size: "sm", title: "全データJSONバックアップの保存・復元について" })}
      </h3>
      <div class="row-actions">
        <button id="bkExport" class="btn">バックアップを保存（JSON）</button>
        <label class="btn btn-secondary">バックアップから復元（インポート）
          <input id="bkImport" type="file" accept="application/json,.json" hidden />
        </label>
      </div>
    </div>
    <div class="panel">
      <h3>
        月ごとのCSVダウンロード
        ${helpBtn("backup_monthly_csv", { size: "sm", title: "月次CSV一式ダウンロードについて" })}
      </h3>
      <p class="view-sub">旧デスクトップ版と同じ5種類のCSV（読み取り結果・日別集計・繰越・入庫・ノート購入）をダウンロードします。</p>
      <table class="result-table">
        <thead><tr><th>年月</th><th>読み取り</th><th>繰越</th><th>入庫</th><th>ノート購入</th><th>実棚</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">保存されたデータはまだありません。</td></tr>`}</tbody>
      </table>
    </div>`;

  const setFolderBtn = el().querySelector("#bkSetFolder");
  if (setFolderBtn) {
    setFolderBtn.addEventListener("click", async () => {
      try {
        await setBackupFolder();
        toast("バックアップ先フォルダを設定しました ✓");
        await updateShareStatusBadge();
        await show();
      } catch (err) {
        if (err.name !== "AbortError") {
          alert("フォルダの選択に失敗しました: " + err.message);
        }
      }
    });
  }

  const syncFolderBtn = el().querySelector("#bkSyncFolder");
  if (syncFolderBtn) {
    syncFolderBtn.addEventListener("click", async () => {
      syncFolderBtn.disabled = true;
      try {
        await syncFromSharedFolder();
      } catch (err) {
        alert("共有フォルダの読み込みに失敗しました: " + err.message);
      } finally {
        syncFolderBtn.disabled = false;
      }
    });
  }

  const testFolderBtn = el().querySelector("#bkTestFolder");
  if (testFolderBtn) {
    testFolderBtn.addEventListener("click", async () => {
      testFolderBtn.disabled = true;
      try {
        const { handle } = await getBackupFolderInfo();
        if (!handle) throw new Error("フォルダが設定されていません。");
        const res = await saveBackupToFolder(handle);
        toast(`フォルダ「${res.folderName}」にバックアップ「${res.filename}」を保存しました ✓`);
        await updateShareStatusBadge();
        await show();
      } catch (err) {
        alert("バックアップの保存に失敗しました: " + err.message);
      } finally {
        testFolderBtn.disabled = false;
      }
    });
  }

  const clearFolderBtn = el().querySelector("#bkClearFolder");
  if (clearFolderBtn) {
    clearFolderBtn.addEventListener("click", async () => {
      if (!window.confirm("自動バックアップ先フォルダの設定を解除しますか？\n（解除後は通常のダウンロード確認に戻ります）")) return;
      await clearBackupFolder();
      toast("バックアップ先フォルダの設定を解除しました");
      await updateShareStatusBadge();
      await show();
    });
  }

  el().querySelectorAll("button[data-import-shared]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fileName = btn.dataset.importShared;
      if (!fileName) return;
      btn.disabled = true;
      try {
        await syncFromSharedFolder({ targetFileName: fileName });
      } catch (err) {
        alert("読み込みに失敗しました: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });

  el().querySelector("#bkExport").addEventListener("click", onExport);
  el().querySelector("#bkImport").addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) onImport(e.target.files[0]);
    e.target.value = "";
  });
  el().querySelectorAll("button[data-csv]").forEach((b) =>
    b.addEventListener("click", () => onDownloadMonthCsvs(b.dataset.csv)));
}
