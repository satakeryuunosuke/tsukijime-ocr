// 月締めタブ。日別台帳と月末帳簿残の確認、実棚数の入力と差異表示、
// Excel棚卸レポートの出力、保存済みページの管理（削除）を行う。
import { ensureMonth, putMonth, getMaster } from "../db.js";
import { computeLedger, computeDiffs, buildAdjustmentPages } from "../ledger.js";
import { toInt, computeTotalScore, daysInMonth } from "../validate.js";
import { downloadReport } from "../excelReport.js";
import { openReportPreview } from "../reportPreview.js";
import { collectAverageConsumption, buildReorderSuggestions, STOCK_MONTHS } from "../reorder.js";
import { bindGridNav } from "../keynav.js";
import { toast } from "../toast.js";
import { formatYm } from "../dateUtils.js";
import { triggerBackupDownload } from "./backup.js";
import { helpBtn } from "../help.js";

let app = null;
let showPages = false;   // 保存済みページ一覧の開閉
let detailKey = null;    // 日別台帳を表示する商品key
const el = () => document.getElementById("view-closing");

function openBackupPromptModal(ym, onDownload) {
  const shell = document.createElement("div");
  shell.className = "rv-overlay";
  shell.innerHTML = `
    <div class="rv-modal" style="width:min(520px,100%)">
      <div class="rv-head">
        <span class="rv-title">月締め確定完了 🔒</span>
        <button class="rv-close" title="閉じる">✕</button>
      </div>
      <div class="rv-body backup-modal-content">
        <div class="backup-modal-icon">💾</div>
        <h3 class="backup-modal-title">${formatYm(ym)} の月締めを確定しました</h3>
        <p class="backup-modal-desc">
          月締めデータが確定（ロック）され、誤操作から保護されました。<br>
          続けて、最新の全データをバックアップファイル（JSON）としてダウンロードして保存しますか？
        </p>
        <div class="backup-modal-actions">
          <button id="bkModalDownload" class="btn">💾 バックアップをダウンロード</button>
          <button id="bkModalClose" class="btn-sub">あとで（閉じる）</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(shell);
  const close = () => shell.remove();
  shell.querySelector(".rv-close").onclick = close;
  shell.querySelector("#bkModalClose").onclick = close;
  shell.querySelector("#bkModalDownload").onclick = async () => {
    await onDownload();
    close();
  };
  shell.addEventListener("click", (e) => { if (e.target === shell) close(); });
}

async function lockMonth() {
  const month = await ensureMonth(app.ym);
  if (month.physicalCount === null) {
    alert("月締めを確定する前に、実棚数を入力・保存してください。");
    return;
  }
  if (!window.confirm(
    `${formatYm(app.ym)} の月締めを確定（ロック）しますか？\n\n` +
    `確定すると、誤操作防止のため各データの編集や交換票の追加読み取りができなくなります。\n` +
    `（※必要に応じて、いつでもロック解除できます）`
  )) return;

  month.locked = true;
  month.lockedAt = new Date().toISOString();
  await putMonth(month);
  toast(`${formatYm(app.ym)} の月締めを確定（ロック）しました ✓`);
  await show();

  // バックアップダウンロードの選択肢モーダルを表示
  openBackupPromptModal(app.ym, async () => {
    try {
      await triggerBackupDownload();
      toast("バックアップファイルをダウンロードしました ✓");
    } catch (err) {
      alert("バックアップのダウンロードに失敗しました: " + err.message);
    }
  });
}

async function unlockMonth() {
  const month = await ensureMonth(app.ym);
  if (!window.confirm(
    `月締めロックを解除しますか？\n\n` +
    `解除すると、各入力欄の編集や交換票の追加読み取りが再び可能になります。`
  )) return;

  month.locked = false;
  await putMonth(month);
  toast("月締めロックを解除しました");
  await show();
}

async function savePhysical() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定済みのため編集できません。"); return; }
  const data = {};
  el().querySelectorAll("input[data-phys]").forEach((inp) => {
    data[inp.dataset.phys] = toInt(inp.value);
  });
  month.physicalCount = data;
  await putMonth(month);
  const master = await getMaster(month.masterVersion);
  const { shortages, surpluses } = computeDiffs(month, master.products);
  if (Object.keys(shortages).length || Object.keys(surpluses).length) {
    toast("実棚数を保存しました。差異があります — 内容を確認してください");
  } else {
    toast("実棚数を保存しました ✓ 差異はありません");
  }
  await show();
}

// 差異を調整記録で解消する。不足 → 交換ページを自動生成、余剰 → 指定日の入庫に加算。
async function applyAdjustment() {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定済みのため編集できません。"); return; }
  const master = await getMaster(month.masterVersion);
  const products = master.products;
  if (!month.physicalCount) { alert("先に実棚数を入力・保存してください。"); return; }

  const day = toInt(el().querySelector("#adjDay").value) || daysInMonth(app.ym);
  const { shortages } = computeDiffs(month, products);
  const nShort = Object.keys(shortages).length;
  // 余剰（実棚 > 帳簿残）は隠し在庫として帳簿に載せない。不足のみ交換記録で解消する。
  if (!nShort) { alert("交換記録で解消すべき不足はありません。"); return; }

  const nameOf = (k) => (products.find((p) => p.key === k) || { name: k }).name;
  const detail = Object.entries(shortages).map(([k, q]) => `  ${nameOf(k)} × ${q}`).join("\n");
  if (!window.confirm(
    `帳簿在庫が実棚数より多い商品について、差の分だけ交換記録を作成します（${day}日付け）。\n\n` +
    `【交換記録を作成】\n${detail}\n\n` +
    `※ 実棚数が帳簿より多い（余剰）商品は帳簿に載せません（そのまま保管）。\n` +
    `よろしいですか？`)) return;

  const existing = new Set(month.pages.map((p) => p.name));
  month.pages.push(...buildAdjustmentPages(shortages, products, day, existing));
  await putMonth(month);
  await show();
}

async function deletePage(name) {
  const month = await ensureMonth(app.ym);
  if (month.locked) { alert("月締め確定済みのため削除できません。"); return; }
  if (!window.confirm(`保存済みページ「${name}」を削除しますか？\n（集計から除外されます。再スキャンすれば入れ直せます）`)) return;
  month.pages = month.pages.filter((p) => p.name !== name);
  await putMonth(month);
  await show();
}

function stocktakeRows(products, ledger, month) {
  const co = month.carryover || {};
  const phys = month.physicalCount || {};
  const isNote = (p) => p.key.startsWith("notes_");
  const isLocked = !!month.locked;
  return products.map((p) => {
    const rows = ledger.rows[p.key];
    const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
    const book = ledger.closing[p.key];
    const physV = month.physicalCount ? toInt(phys[p.key]) : null;
    const diff = physV === null ? null : physV - book;
    const diffHtml = diff === null ? "－"
      : diff === 0 ? `<span class="ok">0 ✓</span>`
      : `<span class="err">${diff > 0 ? "+" : ""}${diff}</span>`;
    return `
      <tr>
        <td><a href="javascript:void 0" class="lg-detail" data-key="${p.key}">${p.name}</a></td>
        <td class="num">${toInt(co[p.key])}</td>
        <td class="num">${sum("arrival")}</td>
        <td class="num">${sum("exchange")}</td>
        <td class="num">${isNote(p) ? sum("cash") : "－"}</td>
        <td class="num">${isNote(p) ? sum("debit") : "－"}</td>
        <td class="num">${isNote(p) ? sum("point") : "－"}</td>
        <td class="num"><b>${book}</b></td>
        <td><input type="number" inputmode="numeric" min="0" data-phys="${p.key}"
             value="${month.physicalCount ? toInt(phys[p.key]) : ""}" placeholder="実棚" ${isLocked ? "disabled" : ""} /></td>
        <td class="num">${diffHtml}</td>
      </tr>`;
  }).join("");
}

function detailTable(products, ledger) {
  if (!detailKey) return "";
  const p = products.find((x) => x.key === detailKey);
  if (!p) return "";
  const isNote = p.key.startsWith("notes_");
  const rows = ledger.rows[p.key].filter((r) =>
    r.arrival || r.exchange || r.cash || r.debit || r.point);
  return `
    <div class="panel">
      <h3>日別台帳: ${p.name}</h3>
      <table class="result-table narrow">
        <thead><tr><th>日</th><th>入荷</th><th>シール交換</th>${isNote ? "<th>現金</th><th>口座</th><th>ポイント</th>" : ""}<th>残</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((r) => `
            <tr><td>${r.day}日</td><td class="num">${r.arrival || ""}</td><td class="num">${r.exchange || ""}</td>
            ${isNote ? `<td class="num">${r.cash || ""}</td><td class="num">${r.debit || ""}</td><td class="num">${r.point || ""}</td>` : ""}
            <td class="num">${r.balance}</td></tr>`).join("")
            : `<tr><td colspan="7">動きのあった日はありません。</td></tr>`}
        </tbody>
      </table>
      <p class="view-sub">月末帳簿残: <b>${ledger.closing[p.key]}</b>（動きのあった日のみ表示）</p>
    </div>`;
}

// 不足（帳簿 > 実棚）がある場合のみ表示する調整パネル。
// 余剰（実棚 > 帳簿）は隠し在庫として帳簿に載せないため、調整の対象外。
function adjustPanel(month, products) {
  if (!month.physicalCount) return "";
  const { shortages, surpluses } = computeDiffs(month, products);
  const nShort = Object.keys(shortages).length;
  const nSurp = Object.keys(surpluses).length;
  if (!nShort && !nSurp) return "";
  const maxDays = daysInMonth(month.ym);
  const isLocked = !!month.locked;
  const surpNote = nSurp
    ? `<p class="view-sub">余剰（実棚が帳簿より多い）商品が ${nSurp} 件あります。これらは帳簿に載せず、そのまま保管します（調整しません）。</p>`
    : "";
  const shortBlock = nShort ? (
    isLocked
      ? `<p class="view-sub">帳簿在庫と実棚数の差異（不足 ${nShort} 件）は調整済みまたは保管中です（月締めロック中）。</p>`
      : `<p class="view-sub">帳簿在庫が実棚数より多い分だけ交換記録（通常の交換票と同じ形式）を作成し、帳簿を実棚に合わせます。集計・CSV・Excel上は通常の記録と区別されません。</p>
        <div class="row-actions">
          <label>記録する日付
            <select id="adjDay">
              ${Array.from({ length: maxDays }, (_, i) => i + 1).map((d) =>
                `<option value="${d}" ${d === maxDays ? "selected" : ""}>${d}日</option>`).join("")}
            </select>
          </label>
          <button id="adjApply" class="btn">不足分の交換記録を作成する</button>
        </div>`
  ) : "";
  return `
    <div class="panel warn-panel">
      <h3>差異の調整</h3>
      ${surpNote}
      ${shortBlock}
    </div>`;
}

// 発注のめやすパネル。現在庫（実棚数。未保存なら帳簿残）が
// 「月平均払出 × STOCK_MONTHS か月分」を下回る商品と、その発注数を知らせる。
function reorderPanel(month, products, ledger, avgInfo) {
  const { avg, monthsUsed } = avgInfo;
  if (!monthsUsed.length) {
    return `
      <div class="panel">
        <h3>
          発注のめやす
          ${helpBtn("closing_reorder", { size: "sm", title: "発注推奨数の計算基準について" })}
        </h3>
        <p class="view-sub">払出の実績がまだないため計算できません（交換票の読み取りやノート購入を記録すると、翌月から表示されます）。</p>
      </div>`;
  }
  const usePhys = !!month.physicalCount;
  const stock = usePhys
    ? Object.fromEntries(products.map((p) => [p.key, toInt(month.physicalCount[p.key])]))
    : ledger.closing;
  const rows = buildReorderSuggestions(products, stock, avg);
  const toOrder = rows.filter((r) => r.order > 0);
  const noHistory = rows.filter((r) => r.noHistory);
  const fmtAvg = (a) => (a % 1 ? a.toFixed(1) : String(a));
  const basisNote =
    `基準: 在庫が「月平均払出 × ${STOCK_MONTHS}か月分」を下回ったら、その分だけ発注。` +
    `（参照した過去月: ${monthsUsed.map(formatYm).join("・")}、平均の月数: ${monthsUsed.length}か月分）`;
  return `
    <div class="panel">
      <h3>
        発注のめやす
        ${helpBtn("closing_reorder", { size: "sm", title: "発注推奨数の計算基準について" })}
      </h3>
      <p class="view-sub">${basisNote}</p>
      ${toOrder.length ? `
        <table class="result-table narrow">
          <thead><tr><th>商品</th><th>現在庫</th><th>月平均払出</th><th>発注推奨数</th></tr></thead>
          <tbody>
            ${toOrder.map((r) => `
              <tr>
                <td>${r.name}</td>
                <td class="num">${r.stock}</td>
                <td class="num">${fmtAvg(r.avg)}</td>
                <td class="num"><b class="warn">${r.order}</b></td>
              </tr>`).join("")}
          </tbody>
        </table>` : `<p class="view-sub ok">全商品、${STOCK_MONTHS}か月分以上の在庫があります。今月の発注推奨はありません。</p>`}
      ${noHistory.length ? `<p class="view-sub muted">※ 過去の払出実績がないため計算対象外: ${noHistory.map((r) => r.name).join("、")}</p>` : ""}
    </div>`;
}

function pagesPanel(month, products) {
  if (!showPages) {
    return `<button id="clTogglePages" class="btn-sub">保存済みページ一覧を表示（${month.pages.length}枚）</button>`;
  }
  const isLocked = !!month.locked;
  const sorted = [...month.pages].sort((a, b) => {
    const da = toInt(a.predictions.date_1) * 10 + toInt(a.predictions.date_0);
    const db_ = toInt(b.predictions.date_1) * 10 + toInt(b.predictions.date_0);
    return da - db_ || (a.name < b.name ? -1 : 1);
  });
  return `
    <button id="clTogglePages" class="btn-sub">一覧を閉じる</button>
    <table class="result-table">
      <thead><tr><th>ページ</th><th>日付</th><th>合計点数</th><th>保存日時</th><th></th></tr></thead>
      <tbody>
        ${sorted.length ? sorted.map((p) => `
          <tr>
            <td>${p.name}</td>
            <td>${toInt(p.predictions.date_1) * 10 + toInt(p.predictions.date_0)}日</td>
            <td class="num">${computeTotalScore(p.predictions, products)}点</td>
            <td>${(p.savedAt || "").slice(0, 16).replace("T", " ")}</td>
            <td>${isLocked ? '<span class="muted">保護中</span>' : `<button class="btn-sub" data-delpage="${p.name.replace(/"/g, "&quot;")}">削除</button>`}</td>
          </tr>`).join("") : `<tr><td colspan="5">保存済みページはありません。</td></tr>`}
      </tbody>
    </table>`;
}

export function init(appRef) { app = appRef; }

export async function show() {
  const month = await ensureMonth(app.ym);
  const master = await getMaster(month.masterVersion);
  const products = master.products;
  const ledger = computeLedger(month, products);
  const avgInfo = await collectAverageConsumption(app.ym);
  const isLocked = !!month.locked;

  const warns = [];
  if (month.carryover === null) warns.push(`繰越在庫が未入力です（<a href="#carryover">繰越在庫</a>で入力）。帳簿残は繰越0として計算されています。`);
  if (!month.pages.length) warns.push(`読み取り済みの交換票がありません（<a href="#reader">読み取り</a>で保存）。`);

  const lockBannerHtml = isLocked ? `
    <div class="lock-banner">
      <div class="lock-banner-info">
        <span class="lock-icon">🔒</span>
        <div>
          <div class="lock-title">この月（${formatYm(app.ym)}）は月締め確定（ロック中）です</div>
          <div class="lock-meta">確定日時: ${new Date(month.lockedAt || Date.now()).toLocaleString("ja-JP")} ／ 誤操作防止のため編集不可</div>
        </div>
      </div>
      <button id="clUnlock" class="btn-unlock cl-btn-unlock">🔓 ロックを解除して再編集</button>
    </div>` : "";

  const stocktakeActionsHtml = isLocked ? `
    <div class="stocktake-locked-note">🔒 月締め確定（ロック中）のため、実棚数は保護されています。</div>` : `
    <div class="stocktake-actions">
      <button id="clSavePhys" class="btn">実棚数を保存</button>
      <span class="stocktake-save-hint">※ 実棚数を入力したら保存してください。差異の確認や月締め確定ができるようになります。</span>
    </div>`;

  const closingCardsHtml = `
    <div class="closing-action-grid">
      <div class="closing-card report-card">
        <div class="closing-card-header">
          <span class="closing-card-icon">📊</span>
          <div>
            <h3 class="closing-card-title">
              月次レポート（帳票出力）
              ${helpBtn("closing_report", { size: "sm", title: "Excel月締めレポートについて" })}
            </h3>
            <p class="closing-card-desc">当月の棚卸表・日別交換明細・集計データをExcel形式でダウンロード、またはブラウザ上で確認できます。</p>
          </div>
        </div>
        <div class="closing-card-actions">
          <button id="clReport" class="btn btn-secondary">📥 Excelレポート（report_${app.ym}.xlsx）</button>
          <button id="clPreview" class="btn-sub">🔍 レポートをブラウザで見る</button>
        </div>
      </div>

      <div class="closing-card lock-card ${isLocked ? "is-locked" : ""}">
        <div class="closing-card-header">
          <span class="closing-card-icon">${isLocked ? "🔒" : "🛡️"}</span>
          <div>
            <h3 class="closing-card-title">
              月締めステータス・確定
              ${helpBtn("closing_lock", { size: "sm", title: "月締め確定（ロック）と保護について" })}
            </h3>
            <p class="closing-card-desc">
              ${isLocked
                ? `この月（${formatYm(app.ym)}）は月締め確定（ロック中）です。誤操作防止のためデータが保護されています。`
                : month.physicalCount !== null
                  ? "棚卸・集計の確認が完了したら、誤操作防止のため月締めを確定（ロック）します。"
                  : "実棚数を入力・保存すると、月締めを確定（ロック）できるようになります。"
              }
            </p>
          </div>
        </div>
        <div class="closing-card-actions">
          ${isLocked
            ? `<button class="btn-unlock cl-btn-unlock">🔓 ロックを解除して再編集</button>`
            : month.physicalCount !== null
              ? `<button id="clLock" class="btn btn-lock">🔒 月締めを確定してロック</button>`
              : `<button class="btn btn-lock" disabled title="先に実棚数を入力・保存してください">🔒 実棚数を保存後に確定可能</button>`
          }
        </div>
      </div>
    </div>`;

  el().innerHTML = `
    <h2 class="view-title">
      月締め・棚卸（${formatYm(app.ym)}）${isLocked ? '<span class="lock-badge">🔒 締め確定済み</span>' : ""}
      ${helpBtn("closing_overview", { size: "lg", title: "月締め・棚卸作業の全体フロー" })}
    </h2>
    ${lockBannerHtml}
    ${warns.length ? `<div class="panel warn-panel">${warns.map((w) => `<div>⚠ ${w}</div>`).join("")}</div>` : ""}
    <div class="panel">
      <h3>
        棚卸表
        ${helpBtn("closing_ledger", { size: "sm", title: "日別台帳と帳簿残について" })}
      </h3>
      <p class="view-sub">「帳簿残」= 繰越 + 入庫 − 交換（シール・現金・口座・ポイント）。実際に棚を数えて「実棚数」に入力すると差異が出ます。商品名をクリックで日別台帳を表示。</p>
      <div class="table-scroll">
        <table class="result-table stocktake">
          <thead>
            <tr>
              <th>商品</th>
              <th>繰越</th>
              <th>入庫計</th>
              <th>ｼｰﾙ交換</th>
              <th>現金</th>
              <th>口座</th>
              <th>ﾎﾟｲﾝﾄ</th>
              <th>帳簿残</th>
              <th>実棚数 ${helpBtn("closing_physical_count", { size: "sm", title: "実棚数の入力と差異計算について" })}</th>
              <th>差異</th>
            </tr>
          </thead>
          <tbody>${stocktakeRows(products, ledger, month)}</tbody>
        </table>
      </div>
      ${stocktakeActionsHtml}
    </div>
    ${adjustPanel(month, products)}
    ${closingCardsHtml}
    ${reorderPanel(month, products, ledger, avgInfo)}
    ${detailTable(products, ledger)}
    <div class="panel">
      <h3>
        保存済みの交換票
        ${helpBtn("closing_pages_list", { size: "sm", title: "保存済み交換票の確認・削除について" })}
      </h3>
      ${pagesPanel(month, products)}
    </div>`;

  const saveBtn = el().querySelector("#clSavePhys");
  if (saveBtn) saveBtn.addEventListener("click", savePhysical);
  const lockBtn = el().querySelector("#clLock");
  if (lockBtn) lockBtn.addEventListener("click", lockMonth);
  el().querySelectorAll(".cl-btn-unlock").forEach((btn) =>
    btn.addEventListener("click", unlockMonth));

  el().querySelector("#clReport").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await downloadReport(month, products);
    } catch (err) {
      alert("レポート生成に失敗しました: " + err.message);
      console.error(err);
    } finally {
      e.target.disabled = false;
    }
  });
  el().querySelector("#clPreview").addEventListener("click", () => openReportPreview(month, products));
  const adjBtn = el().querySelector("#adjApply");
  if (adjBtn) adjBtn.addEventListener("click", applyAdjustment);
  const toggle = el().querySelector("#clTogglePages");
  if (toggle) toggle.addEventListener("click", async () => { showPages = !showPages; await show(); });
  el().querySelectorAll("button[data-delpage]").forEach((b) =>
    b.addEventListener("click", () => deletePage(b.dataset.delpage)));
  el().querySelectorAll(".lg-detail").forEach((a) =>
    a.addEventListener("click", async () => {
      detailKey = detailKey === a.dataset.key ? null : a.dataset.key;
      await show();
    }));

  if (!isLocked) {
    // 実棚数の入力欄を Enter / 矢印キーで移動できるようにする
    bindGridNav([...el().querySelectorAll("input[data-phys]")], 1);
  }
}
